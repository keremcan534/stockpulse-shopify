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
  businessName: "Saatadam",
  storeDomain: "https://SmartSaat.com/products/demo",
  sourceUrl: "https://evidence.example.test/shopify",
  rationale: "Public catalogue shows multiple stock states.",
  targetRole: "Founder",
  channelSourceUrl: "https://contact.example.test/business",
};

it("normalizes a shop URL to a stable lower-case domain", () => {
  expect(normalizeBusinessDomain(candidateInput.storeDomain)).toBe("smartsaat.com");
});

it("creates one draft per business and requires approval before sent", () => {
  let state = createCandidate(EMPTY_STATE, candidateInput, now);
  state = createInitialDraft(state, "P01", now);
  const [draft] = state.messages;
  expect(draft).toMatchObject({ id: "P01-initial", kind: "initial", state: "draft" });
  expect(() => recordSent(state, draft.id, now)).toThrow(/must be approved/i);
});

it("stores the approved initial template body in an initial draft", () => {
  let state = createCandidate(EMPTY_STATE, candidateInput, now);
  state = createInitialDraft(state, "P01", now);
  expect(state.messages[0].body).toContain(candidateInput.rationale);
  expect(state.messages[0].body).toContain("örnek verili demoyu göndermemi ister misiniz?");
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
  expect(() => approveMessage(state, "P04-initial", now)).toThrow(/daily limit/i);
});

it("creates one follow-up after five business days", () => {
  let state = createCandidate(
    EMPTY_STATE,
    candidateInput,
    new Date("2026-09-04T09:00:00Z"),
  );
  state = createInitialDraft(state, "P01", new Date("2026-09-04T09:00:00Z"));
  state = approveMessage(state, "P01-initial", new Date("2026-09-04T09:01:00Z"));
  state = recordSent(state, "P01-initial", new Date("2026-09-04T09:02:00Z"));
  expect(createDueFollowups(state, new Date("2026-09-10T09:02:00Z")).messages).toHaveLength(1);
  const due = createDueFollowups(state, new Date("2026-09-11T09:02:00Z"));
  expect(due.messages.filter((message) => message.kind === "followup")).toHaveLength(1);
});

it("makes opt-out terminal and suppresses later drafts", () => {
  let state = createCandidate(EMPTY_STATE, candidateInput, now);
  state = recordReply(state, "P01", ["opt_out"], now);
  expect(state.suppressions).toEqual([
    {
      businessDomain: "smartsaat.com",
      createdAt: now.toISOString(),
      reason: "recipient_request",
    },
  ]);
  expect(() => createInitialDraft(state, "P01", now)).toThrow(/suppressed/i);
});

it("prevents approval of a draft after a reply", () => {
  let state = createCandidate(EMPTY_STATE, candidateInput, now);
  state = createInitialDraft(state, "P01", now);
  state = recordReply(state, "P01", ["meaningful_reply"], now);
  expect(() => approveMessage(state, "P01-initial", now)).toThrow(/not active/i);
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
