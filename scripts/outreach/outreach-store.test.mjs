import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, expect, it } from "vitest";
import { EMPTY_STATE } from "./outreach-domain.mjs";
import {
  loadState,
  resolveStatePath,
  saveState,
  updateState,
} from "./outreach-store.mjs";

const temp = path.join(tmpdir(), `stockpulse-outreach-store-${process.pid}`);
const file = path.join(temp, "state.json");
const state = {
  version: 1,
  candidates: [],
  messages: [],
  suppressions: [],
};
const candidate = {
  code: "P01",
  businessName: "Fictional Inventory Lab",
  businessDomain: "inventory-lab.test",
  sourceUrl: "https://evidence.example.test/shopify",
  rationale: "Public catalogue shows multiple stock states.",
  targetRole: "Inventory owner",
  channelSourceUrl: "https://contact.example.test/business",
  status: "active",
  createdAt: "2026-08-31T09:00:00.000Z",
  updatedAt: "2026-08-31T09:00:00.000Z",
  replyLabels: [],
};
const sentCandidate = {
  ...candidate,
  updatedAt: "2026-08-31T09:03:00.000Z",
};
const sentInitial = {
  id: "P01-initial",
  candidateCode: "P01",
  kind: "initial",
  state: "sent",
  body: "Fictional outreach body.",
  createdAt: "2026-08-31T09:01:00.000Z",
  approvedAt: "2026-08-31T09:02:00.000Z",
  sentAt: "2026-08-31T09:03:00.000Z",
  scheduledFor: null,
};

function validSentState() {
  return {
    version: 1,
    candidates: [{ ...sentCandidate, replyLabels: [] }],
    messages: [{ ...sentInitial }],
    suppressions: [],
  };
}

afterEach(async () => {
  await rm(temp, { recursive: true, force: true });
});

it("defaults inside the gitignored local outreach directory", async () => {
  expect(resolveStatePath("C:/workspace")).toBe(
    path.join("C:/workspace", ".stockpulse-outreach", "state.json"),
  );
  expect(await readFile(".gitignore", "utf8")).toContain(
    "/.stockpulse-outreach/",
  );
});

it("returns a fresh empty state when the file does not exist", async () => {
  const loaded = await loadState(path.join(temp, "missing.json"));
  expect(loaded).toEqual(EMPTY_STATE);
  expect(loaded).not.toBe(EMPTY_STATE);
});

it("writes valid versioned JSON atomically and reloads it", async () => {
  await saveState(file, state);
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual(state);
  expect(await loadState(file)).toEqual(state);
});

it("rejects corrupt JSON and unsupported schema versions without overwriting", async () => {
  const corrupt = "{not-json";
  await mkdir(temp, { recursive: true });
  await writeFile(file, corrupt);
  await expect(loadState(file)).rejects.toThrow(/corrupt/i);
  expect(await readFile(file, "utf8")).toBe(corrupt);

  const unsupported = JSON.stringify({
    version: 2,
    candidates: [],
    messages: [],
    suppressions: [],
  });
  await writeFile(file, unsupported);
  await expect(loadState(file)).rejects.toThrow(/unsupported version/i);
  expect(await readFile(file, "utf8")).toBe(unsupported);
});

it("rejects semantically corrupt persisted entities without exposing their contents", async () => {
  const corrupt = JSON.stringify({
    version: 1,
    candidates: [
      { code: "P01", replyLabels: null, privateNote: "do not expose" },
    ],
    messages: [],
    suppressions: [],
  });
  await mkdir(temp, { recursive: true });
  await writeFile(file, corrupt);

  await expect(loadState(file)).rejects.toThrow("corrupt state data");
  expect(await readFile(file, "utf8")).toBe(corrupt);
});

it("canonicalizes candidate and suppression domain aliases when loading", async () => {
  const aliased = {
    version: 1,
    candidates: [
      {
        ...candidate,
        businessDomain: "WWW.Inventory-Lab.test...",
        status: "opted_out",
        replyLabels: ["opt_out"],
      },
    ],
    messages: [],
    suppressions: [
      {
        businessDomain: "inventory-lab.test.",
        createdAt: candidate.updatedAt,
        reason: "recipient_request",
      },
    ],
  };
  await mkdir(temp, { recursive: true });
  await writeFile(file, JSON.stringify(aliased));

  const loaded = await loadState(file);
  expect(loaded.candidates[0].businessDomain).toBe("inventory-lab.test");
  expect(loaded.suppressions[0].businessDomain).toBe("inventory-lab.test");
});

it("rejects candidate domains that collide after canonicalization", async () => {
  const duplicated = {
    version: 1,
    candidates: [
      { ...candidate, businessDomain: "inventory-lab.test" },
      {
        ...candidate,
        code: "P02",
        businessName: "Fictional Stock Studio Two",
        businessDomain: "www.inventory-lab.test.",
      },
    ],
    messages: [],
    suppressions: [],
  };
  await mkdir(temp, { recursive: true });
  await writeFile(file, JSON.stringify(duplicated));

  await expect(loadState(file)).rejects.toThrow("corrupt state data");
});

it("normalizes parsed candidate URLs when loading", async () => {
  const unnormalized = {
    version: 1,
    candidates: [
      {
        ...candidate,
        sourceUrl: "HTTPS://Evidence.Example.Test:443/a/../shopify",
        channelSourceUrl: "https://Contact.Example.Test:443/business",
      },
    ],
    messages: [],
    suppressions: [],
  };
  await mkdir(temp, { recursive: true });
  await writeFile(file, JSON.stringify(unnormalized));

  const loaded = await loadState(file);
  expect(loaded.candidates[0].sourceUrl).toBe(
    "https://evidence.example.test/shopify",
  );
  expect(loaded.candidates[0].channelSourceUrl).toBe(
    "https://contact.example.test/business",
  );
});

it.each([
  ["sourceUrl", "mailto:evidence@inventory-lab.test"],
  ["channelSourceUrl", "https://user:pass@contact.example.test/business"],
  ["businessName", "Fictional Stock Studio\nInjected"],
  ["rationale", "Verified rationale\u0000Injected"],
  ["targetRole", "Inventory\towner"],
  ["sourceUrl", "https://evidence.example.test/shopify\rInjected"],
])(
  "rejects persisted candidate %s containing an unsafe value",
  async (field, value) => {
    const invalid = {
      version: 1,
      candidates: [{ ...candidate, [field]: value }],
      messages: [],
      suppressions: [],
    };
    const content = JSON.stringify(invalid);
    await mkdir(temp, { recursive: true });
    await writeFile(file, content);

    await expect(loadState(file)).rejects.toThrow("corrupt state data");
    expect(await readFile(file, "utf8")).toBe(content);
  },
);

it.each([
  {
    defect: "a non-canonical message ID for its candidate and kind",
    corrupt(state) {
      state.messages[0].id = "P01-approved-audit";
    },
  },
  {
    defect: "more than one initial message for a candidate",
    corrupt(state) {
      state.messages.push({
        ...sentInitial,
        id: "P01-initial-copy",
        createdAt: "2026-08-31T09:01:30.000Z",
        approvedAt: "2026-08-31T09:02:30.000Z",
      });
    },
  },
  {
    defect: "an approved timestamp on a draft",
    corrupt(state) {
      state.messages[0] = {
        ...state.messages[0],
        state: "draft",
        sentAt: null,
      };
    },
  },
  {
    defect: "a sent state without a sent timestamp",
    corrupt(state) {
      state.messages[0].sentAt = null;
    },
  },
  {
    defect: "reply outcomes without a sent message",
    corrupt(state) {
      state.candidates[0] = {
        ...state.candidates[0],
        status: "replied",
        replyLabels: ["meaningful_reply"],
      };
      state.messages[0] = {
        ...state.messages[0],
        state: "approved",
        sentAt: null,
      };
    },
  },
  {
    defect: "an opted-out candidate without its suppression",
    corrupt(state) {
      state.candidates[0] = {
        ...state.candidates[0],
        status: "opted_out",
        replyLabels: ["opt_out"],
      };
    },
  },
  {
    defect: "a suppression that references no candidate",
    corrupt(state) {
      state.suppressions.push({
        businessDomain: "missing-business.test",
        createdAt: "2026-08-31T09:04:00.000Z",
        reason: "recipient_request",
      });
    },
  },
  {
    defect: "message timestamps outside chronological order",
    corrupt(state) {
      state.messages[0].sentAt = "2026-08-31T09:01:30.000Z";
    },
  },
  {
    defect: "a candidate update before candidate creation",
    corrupt(state) {
      state.candidates[0].updatedAt = "2026-08-31T08:59:00.000Z";
    },
  },
  {
    defect: "a follow-up without a sent initial message",
    corrupt(state) {
      state.messages = [
        {
          ...sentInitial,
          id: "P01-followup",
          kind: "followup",
          state: "draft",
          approvedAt: null,
          sentAt: null,
          scheduledFor: "2026-09-07T09:03:00.000Z",
        },
      ];
    },
  },
])("rejects persisted state with $defect", async ({ corrupt }) => {
  const invalid = validSentState();
  corrupt(invalid);
  const content = JSON.stringify(invalid);
  await mkdir(temp, { recursive: true });
  await writeFile(file, content);

  await expect(loadState(file)).rejects.toThrow("corrupt state data");
  expect(await readFile(file, "utf8")).toBe(content);
});

it("updates persisted state through the supplied transform", async () => {
  const updated = await updateState(file, (current) => ({
    ...current,
    candidates: [candidate],
  }));

  expect(updated.candidates).toEqual([candidate]);
  expect(await loadState(file)).toEqual(updated);
});
