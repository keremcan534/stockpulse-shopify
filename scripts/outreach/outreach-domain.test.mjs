import { expect, it } from "vitest";
import {
  EMPTY_STATE,
  approveMessage,
  createCandidate,
  createDueFollowups,
  createInitialDraft,
  normalizeBusinessDomain,
  recordReply,
  recordSent,
  summary,
} from "./outreach-domain.mjs";

const now = new Date("2026-08-31T09:00:00.000Z");
const candidateInput = {
  code: "P01",
  businessName: "Fictional Inventory Lab",
  storeDomain: "https://WWW.Inventory-Lab.test./products/demo",
  sourceUrl: "https://evidence.example.test/shopify",
  rationale: "Public catalogue shows multiple stock states.",
  targetRole: "Inventory owner",
  channelSourceUrl: "https://contact.example.test/business",
};

it("normalizes a shop URL to a stable lower-case domain", () => {
  expect(normalizeBusinessDomain(candidateInput.storeDomain)).toBe(
    "inventory-lab.test",
  );
});

it.each([
  ["https://inventory-lab.test./catalog", "inventory-lab.test"],
  ["https://www.inventory-lab.test.../catalog", "inventory-lab.test"],
  ["https://www.www.inventory-lab.test./catalog", "www.inventory-lab.test"],
])("canonicalizes the business hostname in %s", (value, expected) => {
  expect(normalizeBusinessDomain(value)).toBe(expected);
});

it("treats www and terminal-dot aliases as the same business", () => {
  let state = createCandidate(
    EMPTY_STATE,
    {
      ...candidateInput,
      storeDomain: "https://inventory-lab.test/catalog",
    },
    now,
  );

  expect(() =>
    createCandidate(
      state,
      {
        ...candidateInput,
        code: "P02",
        storeDomain: "https://www.inventory-lab.test./catalog",
      },
      now,
    ),
  ).toThrow(/business domain.*unique/i);

  state = recordReply(state, "P01", ["opt_out"], now);
  expect(() =>
    createCandidate(
      state,
      {
        ...candidateInput,
        code: "P02",
        storeDomain: "https://www.inventory-lab.test./catalog",
      },
      now,
    ),
  ).toThrow(/suppressed/i);
});

it.each([
  ["storeDomain", "mailto:store@inventory-lab.test"],
  ["sourceUrl", "mailto:evidence@inventory-lab.test"],
  ["channelSourceUrl", "ftp://contact.inventory-lab.test/business"],
  ["storeDomain", "https://user:pass@inventory-lab.test/catalog"],
  ["sourceUrl", "https://user@evidence.example.test/shopify"],
  ["channelSourceUrl", "https://:pass@contact.example.test/business"],
])("rejects unsafe candidate URL in %s", (field, value) => {
  expect(() =>
    createCandidate(EMPTY_STATE, { ...candidateInput, [field]: value }, now),
  ).toThrow(/http\(s\)|credentials/i);
});

it("persists normalized parsed candidate URLs", () => {
  const state = createCandidate(
    EMPTY_STATE,
    {
      ...candidateInput,
      storeDomain: "HTTPS://WWW.Inventory-Lab.test.:443/catalog",
      sourceUrl: "HTTPS://Evidence.Example.Test:443/a/../shopify",
      channelSourceUrl: "https://Contact.Example.Test:443/business",
    },
    now,
  );

  expect(state.candidates[0]).toMatchObject({
    businessDomain: "inventory-lab.test",
    sourceUrl: "https://evidence.example.test/shopify",
    channelSourceUrl: "https://contact.example.test/business",
  });
});

it.each([
  ["businessName", "Fictional Stock Studio\nInjected"],
  ["rationale", "Verified rationale\u0000Injected"],
  ["targetRole", "Inventory\towner"],
  ["targetRole", "Inventory\u0085owner"],
  ["sourceUrl", "https://evidence.example.test/shopify\rInjected"],
  ["channelSourceUrl", "https://contact.example.test/business\u007fInjected"],
])("rejects control characters in candidate %s", (field, value) => {
  expect(() =>
    createCandidate(EMPTY_STATE, { ...candidateInput, [field]: value }, now),
  ).toThrow(/control character/i);
});

it("creates one draft per business and requires approval before sent", () => {
  let state = createCandidate(EMPTY_STATE, candidateInput, now);
  state = createInitialDraft(state, "P01", now);
  const [draft] = state.messages;
  expect(draft).toMatchObject({
    id: "P01-initial",
    kind: "initial",
    state: "draft",
  });
  expect(() => recordSent(state, draft.id, now)).toThrow(/must be approved/i);
});

it("stores the approved initial template body in an initial draft", () => {
  let state = createCandidate(EMPTY_STATE, candidateInput, now);
  state = createInitialDraft(state, "P01", now);
  expect(state.messages[0].body).toContain(candidateInput.rationale);
  expect(state.messages[0].body).toContain(
    "örnek verili demoyu göndermemi ister misiniz?",
  );
});

it("blocks a fourth initial approval on the same local date", () => {
  let state = EMPTY_STATE;
  for (let index = 1; index <= 4; index += 1) {
    const code = `P0${index}`;
    state = createCandidate(
      state,
      {
        ...candidateInput,
        code,
        businessName: `Store ${index}`,
        storeDomain: `https://store-${index}.test`,
      },
      now,
    );
    state = createInitialDraft(state, code, now);
    if (index <= 3) state = approveMessage(state, `${code}-initial`, now);
  }
  expect(() => approveMessage(state, "P04-initial", now)).toThrow(
    /daily limit/i,
  );
});

it("creates one follow-up after five business days", () => {
  let state = createCandidate(
    EMPTY_STATE,
    candidateInput,
    new Date("2026-09-04T09:00:00Z"),
  );
  state = createInitialDraft(state, "P01", new Date("2026-09-04T09:00:00Z"));
  state = approveMessage(
    state,
    "P01-initial",
    new Date("2026-09-04T09:01:00Z"),
  );
  state = recordSent(state, "P01-initial", new Date("2026-09-04T09:02:00Z"));
  expect(
    createDueFollowups(state, new Date("2026-09-10T09:02:00Z")).messages,
  ).toHaveLength(1);
  const due = createDueFollowups(state, new Date("2026-09-11T09:02:00Z"));
  expect(
    due.messages.filter((message) => message.kind === "followup"),
  ).toHaveLength(1);
});

it("makes opt-out terminal and suppresses later drafts", () => {
  let state = createCandidate(EMPTY_STATE, candidateInput, now);
  state = recordReply(state, "P01", ["opt_out"], now);
  expect(state.suppressions).toEqual([
    {
      businessDomain: "inventory-lab.test",
      createdAt: now.toISOString(),
      reason: "recipient_request",
    },
  ]);
  expect(() => createInitialDraft(state, "P01", now)).toThrow(/suppressed/i);
});

it("requires a recorded sent message before accepting outcome labels", () => {
  const state = createCandidate(EMPTY_STATE, candidateInput, now);

  expect(() =>
    recordReply(state, "P01", ["meaningful_reply", "demo_requested"], now),
  ).toThrow(/sent message/i);
});

it("requires opt-out to be recorded as a standalone label", () => {
  const state = createCandidate(EMPTY_STATE, candidateInput, now);

  expect(() =>
    recordReply(state, "P01", ["opt_out", "demo_requested"], now),
  ).toThrow(/opt_out.*standalone/i);
});

it("replaces earlier outcome labels when a later opt-out is recorded", () => {
  let state = createCandidate(EMPTY_STATE, candidateInput, now);
  state = createInitialDraft(state, "P01", now);
  state = approveMessage(state, "P01-initial", now);
  state = recordSent(state, "P01-initial", now);
  state = recordReply(state, "P01", ["meaningful_reply"], now);

  state = recordReply(state, "P01", ["opt_out"], now);

  expect(state.candidates[0].replyLabels).toEqual(["opt_out"]);
  expect(summary(state)).toMatchObject({ meaningfulReplies: 0, optedOut: 1 });
});

it("prevents approval of a draft after a reply", () => {
  let state = createCandidate(EMPTY_STATE, candidateInput, now);
  state = createInitialDraft(state, "P01", now);
  state = approveMessage(state, "P01-initial", now);
  state = recordSent(state, "P01-initial", now);
  state = recordReply(state, "P01", ["meaningful_reply"], now);
  expect(() => approveMessage(state, "P01-initial", now)).toThrow(
    /not active/i,
  );
});

it("cancels an approved follow-up after any reply", () => {
  let state = createCandidate(
    EMPTY_STATE,
    candidateInput,
    new Date("2026-09-01T09:00:00.000Z"),
  );
  state = createInitialDraft(
    state,
    "P01",
    new Date("2026-09-01T09:01:00.000Z"),
  );
  state = approveMessage(
    state,
    "P01-initial",
    new Date("2026-09-01T09:02:00.000Z"),
  );
  state = recordSent(
    state,
    "P01-initial",
    new Date("2026-09-01T09:03:00.000Z"),
  );
  state = createDueFollowups(state, new Date("2026-09-08T09:03:00.000Z"));
  state = approveMessage(
    state,
    "P01-followup",
    new Date("2026-09-08T09:04:00.000Z"),
  );

  state = recordReply(
    state,
    "P01",
    ["meaningful_reply"],
    new Date("2026-09-08T09:05:00.000Z"),
  );

  expect(
    state.messages.find((message) => message.kind === "followup")?.state,
  ).toBe("cancelled");
});

it("counts approved, sent, replies, demo requests, pilot requests and price statements separately", () => {
  let state = createCandidate(EMPTY_STATE, candidateInput, now);
  state = createInitialDraft(state, "P01", now);
  state = approveMessage(state, "P01-initial", now);
  state = recordSent(state, "P01-initial", now);
  state = recordReply(
    state,
    "P01",
    ["meaningful_reply", "problem_confirmed", "demo_requested"],
    now,
  );
  expect(summary(state)).toEqual({
    candidates: 1,
    drafts: 0,
    approved: 0,
    sent: 1,
    meaningfulReplies: 1,
    problemsConfirmed: 1,
    demosRequested: 1,
    demoFeedback: 0,
    pilotsRequested: 0,
    pricesStated: 0,
    optedOut: 0,
  });
});
