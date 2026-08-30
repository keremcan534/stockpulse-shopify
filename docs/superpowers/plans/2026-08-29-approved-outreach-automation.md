# Approved Outreach Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, dry-run-first command-line tool that prepares, individually approves, schedules, and measures written StockPulse outreach without sending live messages.

**Architecture:** Keep outreach operations outside the merchant-facing Shopify routes and database. Pure domain functions enforce transitions, limits, follow-up rules, and opt-outs; a JSON store persists operational data only under a gitignored local directory; a Node CLI exposes candidate, draft, approve, preview, reply, and summary workflows. There is no live sender in this plan.

**Tech Stack:** Node.js ESM (existing Node >=20.19 requirement), built-in `node:fs/promises`, `node:path`, `node:util.parseArgs`, Node test runner/Vitest through the existing `npm test` script, Git.

**Spec:** `docs/superpowers/specs/2026-08-29-approved-outreach-automation-design.md`

## Global Constraints

- The first release is dry-run only and cannot transmit a message.
- Every message must pass `draft → approved` before preview; follow-ups require separate approval.
- Maximum 3 approved initial messages per local calendar day.
- Maximum 1 initial and 1 follow-up per business.
- Follow-up becomes due after 5 business days only when there is no reply or opt-out.
- Opt-out suppresses every later draft and transition for the same normalized business domain.
- Do not infer/buy personal contact details or automate LinkedIn.
- Do not commit real addresses, message bodies, secrets, or replies; local state lives in `.stockpulse-outreach/`.
- Do not log secrets or raw replies. Ambiguous reply classification remains human-reviewed.
- No new runtime dependency.

---

### Task 1: Domain model, state transitions, and templates

**Files:**
- Create: `scripts/outreach/outreach-domain.mjs`
- Create: `scripts/outreach/outreach-domain.test.mjs`
- Create: `scripts/outreach/message-templates.mjs`
- Create: `scripts/outreach/message-templates.test.mjs`

**Interfaces:**
- Produces `normalizeBusinessDomain(value): string`.
- Produces `createCandidate(state, input, now): OutreachState`.
- Produces `createInitialDraft(state, candidateCode, now): OutreachState`.
- Produces `approveMessage(state, messageId, now): OutreachState`.
- Produces `recordSent(state, messageId, now): OutreachState`.
- Produces `recordReply(state, candidateCode, labels, now): OutreachState`.
- Produces `createDueFollowups(state, now): OutreachState`.
- Produces `summary(state): OutreachSummary`.
- Produces `initialMessage(candidate): string` and `followupMessage(candidate): string`.

Use these exact JSDoc shapes:

```js
/**
 * @typedef {{code:string,businessName:string,businessDomain:string,sourceUrl:string,
 * rationale:string,targetRole:string,channelSourceUrl:string,
 * status:"active"|"replied"|"opted_out"|"closed",createdAt:string,updatedAt:string,
 * replyLabels:string[]}} Candidate
 * @typedef {{id:string,candidateCode:string,kind:"initial"|"followup",
 * state:"draft"|"approved"|"sent"|"cancelled"|"delivery_unknown",
 * body:string,createdAt:string,approvedAt:string|null,sentAt:string|null,
 * scheduledFor:string|null}} OutreachMessage
 * @typedef {{businessDomain:string,createdAt:string,reason:"recipient_request"}} Suppression
 * @typedef {{version:1,candidates:Candidate[],messages:OutreachMessage[],
 * suppressions:Suppression[]}} OutreachState
 */
```

- [ ] **Step 1: Write failing domain tests**

Cover exact invariants:

```js
import { describe, expect, it } from "vitest";
import {
  approveMessage, createCandidate, createDueFollowups, createInitialDraft,
  normalizeBusinessDomain, recordReply, recordSent, summary,
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
  expect(normalizeBusinessDomain(candidateInput.storeDomain)).toBe("inventory-lab.test");
});

it("creates one draft per business and requires approval before sent", () => {
  let state = createCandidate(EMPTY_STATE, candidateInput, now);
  state = createInitialDraft(state, "P01", now);
  const [draft] = state.messages;
  expect(draft).toMatchObject({ id: "P01-initial", kind: "initial", state: "draft" });
  expect(() => recordSent(state, draft.id, now))
    .toThrow(/must be approved/i);
});

it("blocks a fourth initial approval on the same local date", () => {
  let state = EMPTY_STATE;
  for (let index = 1; index <= 4; index += 1) {
    const code = `P0${index}`;
    state = createCandidate(state, {
      ...candidateInput, code, businessName: `Store ${index}`,
      storeDomain: `https://store-${index}.test`,
    }, now);
    state = createInitialDraft(state, code, now);
    if (index <= 3) state = approveMessage(state, `${code}-initial`, now);
  }
  expect(() => approveMessage(state, "P04-initial", now)).toThrow(/daily limit/i);
});

it("creates one follow-up after five business days", () => {
  let state = createCandidate(EMPTY_STATE, candidateInput, new Date("2026-09-04T09:00:00Z"));
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
  expect(state.suppressions).toEqual([{
    businessDomain: "inventory-lab.test",
    createdAt: now.toISOString(),
    reason: "recipient_request",
  }]);
  expect(() => createInitialDraft(state, "P01", now)).toThrow(/suppressed/i);
});

it("counts approved, sent, replies, demo requests, pilot requests and price statements separately", () => {
  let state = createCandidate(EMPTY_STATE, candidateInput, now);
  state = createInitialDraft(state, "P01", now);
  state = approveMessage(state, "P01-initial", now);
  state = recordSent(state, "P01-initial", now);
  state = recordReply(state, "P01", ["meaningful_reply", "problem_confirmed", "demo_requested"], now);
  expect(summary(state)).toEqual({
    candidates: 1, drafts: 0, approved: 0, sent: 1,
    meaningfulReplies: 1, problemsConfirmed: 1, demosRequested: 1,
    demoFeedback: 0, pilotsRequested: 0, pricesStated: 0, optedOut: 0,
  });
});
```

- [ ] **Step 2: Run domain tests and verify RED**

Run: `npm test -- scripts/outreach/outreach-domain.test.mjs`  
Expected: FAIL because `outreach-domain.mjs` does not exist.

- [ ] **Step 3: Implement explicit types-by-shape and pure state functions**

Use JSDoc typedefs, immutable returned objects, fixed allowed enums, cloned arrays, and errors with stable phrases tested above. Compute business-day due dates with a loop that skips Saturday/Sunday. Compare daily approvals using a `localDateKey(date)` helper and count only `kind === "initial"` with `approvedAt` on that key. Validate codes with `/^P\d{2}$/`, URLs with `new URL()`, non-empty target/rationale, and unique normalized domains.

```js
export const EMPTY_STATE = Object.freeze({
  version: 1, candidates: [], messages: [], suppressions: [],
});
export const REPLY_LABELS = new Set([
  "meaningful_reply", "problem_confirmed", "demo_requested",
  "demo_feedback", "pilot_requested", "price_stated", "opt_out", "other",
]);
```

`recordReply` stores labels and timestamp but no raw reply. `opt_out` adds `{ businessDomain, createdAt, reason: "recipient_request" }`, changes the candidate status to `opted_out`, and cancels unsent drafts.

- [ ] **Step 4: Write failing template tests**

```js
it("asks permission before exposing the demo and includes an opt-out", () => {
  const body = initialMessage(candidate);
  expect(body).toContain("örnek verili demoyu göndermemi ister misiniz?");
  expect(body).toContain("tekrar mesaj göndermem");
  expect(body).not.toContain("http");
  expect(body).not.toContain("15 dakika");
});

it("personalizes with only the stored verified rationale", () => {
  expect(initialMessage(candidate)).toContain(candidate.rationale);
});

it("follow-up promises there will be no further message", () => {
  expect(followupMessage(candidate)).toContain("bundan sonra tekrar yazmayacağım");
});
```

- [ ] **Step 5: Run template tests and verify RED**

Run: `npm test -- scripts/outreach/message-templates.test.mjs`  
Expected: FAIL because `message-templates.mjs` does not exist.

- [ ] **Step 6: Implement Turkish initial and follow-up templates**

Export only `initialMessage(candidate)` and `followupMessage(candidate)`. Escape no HTML because output is plain text. Trim and cap the verified rationale at 180 characters; reject line breaks to prevent header/body injection in a future adapter. Do not include a demo URL in the initial template.

- [ ] **Step 7: Run Task 1 tests**

Run: `npm test -- scripts/outreach/outreach-domain.test.mjs scripts/outreach/message-templates.test.mjs`  
Expected: both files PASS with all listed invariant tests.

- [ ] **Step 8: Commit Task 1**

```bash
git add scripts/outreach/outreach-domain.mjs scripts/outreach/outreach-domain.test.mjs scripts/outreach/message-templates.mjs scripts/outreach/message-templates.test.mjs
git commit -m "feat: add outreach approval domain"
```

---

### Task 2: Atomic local state store

**Files:**
- Modify: `.gitignore`
- Create: `scripts/outreach/outreach-store.mjs`
- Create: `scripts/outreach/outreach-store.test.mjs`

**Interfaces:**
- Consumes: `EMPTY_STATE` from Task 1.
- Produces `resolveStatePath(cwd): string`.
- Produces `loadState(filePath): Promise<OutreachState>`.
- Produces `saveState(filePath, state): Promise<void>`.
- Produces `updateState(filePath, transform): Promise<OutreachState>`.

- [ ] **Step 1: Add a failing ignore assertion and store tests**

```js
it("defaults inside the gitignored local outreach directory", () => {
  expect(resolveStatePath("C:/workspace")).toBe(
    path.join("C:/workspace", ".stockpulse-outreach", "state.json"),
  );
});

it("returns a fresh empty state when the file does not exist", async () => {
  expect(await loadState(path.join(temp, "missing.json"))).toEqual(EMPTY_STATE);
});

it("writes valid versioned JSON atomically and reloads it", async () => {
  await saveState(file, state);
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual(state);
  expect(await loadState(file)).toEqual(state);
});

it("rejects corrupt JSON and unsupported schema versions without overwriting", async () => {
  const corrupt = "{not-json";
  await writeFile(file, corrupt);
  await expect(loadState(file)).rejects.toThrow(/corrupt/i);
  expect(await readFile(file, "utf8")).toBe(corrupt);

  const unsupported = JSON.stringify({
    version: 2, candidates: [], messages: [], suppressions: [],
  });
  await writeFile(file, unsupported);
  await expect(loadState(file)).rejects.toThrow(/unsupported version/i);
  expect(await readFile(file, "utf8")).toBe(unsupported);
});
```

Also read `.gitignore` and assert it contains exactly `/.stockpulse-outreach/`.

- [ ] **Step 2: Run store tests and verify RED**

Run: `npm test -- scripts/outreach/outreach-store.test.mjs`  
Expected: FAIL because store module and ignore entry do not exist.

- [ ] **Step 3: Implement atomic persistence and ignore rule**

Add:

```gitignore
# Local StockPulse outreach queue (may contain real addresses/messages)
/.stockpulse-outreach/
```

`saveState` must create the parent directory with mode `0o700`, write `state.json.tmp-<pid>` with mode `0o600`, then rename it over the destination. Use `try/finally` to remove only the exact temp path after failed writes. Validate `version === 1` and that the three collections are arrays before returning loaded data.

- [ ] **Step 4: Run Task 2 tests**

Run: `npm test -- scripts/outreach/outreach-store.test.mjs`  
Expected: PASS, including corrupt-file preservation and ignore assertions.

- [ ] **Step 5: Commit Task 2**

```bash
git add .gitignore scripts/outreach/outreach-store.mjs scripts/outreach/outreach-store.test.mjs
git commit -m "feat: persist outreach queue locally"
```

---

### Task 3: Dry-run CLI and individually approved preview

**Files:**
- Create: `scripts/outreach/outreach-cli.mjs`
- Create: `scripts/outreach/outreach-cli.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes domain, templates, and store interfaces from Tasks 1–2.
- Produces CLI commands:
  - `npm run outreach -- candidate add --input <json-file>`
  - `npm run outreach -- draft initial --candidate P01`
  - `npm run outreach -- approve --message P01-initial`
  - `npm run outreach -- preview --message P01-initial`
  - `npm run outreach -- record-sent --message P01-initial`
  - `npm run outreach -- reply --candidate P01 --labels problem_confirmed,demo_requested`
  - `npm run outreach -- followups create`
  - `npm run outreach -- list`
  - `npm run outreach -- summary`

- [ ] **Step 1: Write failing CLI integration tests**

Spawn Node with a temporary cwd and `OUTREACH_STATE_PATH` pointing inside the temp directory. Assert:

```js
it("adds a candidate from a JSON file without echoing contact data", async () => {
  const result = await cli(["candidate", "add", "--input", inputPath]);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("P01");
  expect(result.stdout).not.toContain("not-stored@contact.example.test");
});

it("refuses preview and record-sent before individual approval", async () => {
  expect((await cli(["preview", "--message", "P01-initial"])).stderr)
    .toMatch(/must be approved/i);
});

it("prints a dry-run envelope after approval and never performs network I/O", async () => {
  const result = await cli(["preview", "--message", "P01-initial"]);
  expect(result.stdout).toContain("DRY RUN — NOTHING SENT");
  expect(result.stdout).toContain("Message: P01-initial");
});

it("records labels but never stores the raw reply", async () => {
  await cli(["reply", "--candidate", "P01", "--labels", "problem_confirmed,demo_requested"]);
  expect(await readFile(statePath, "utf8")).not.toContain("raw reply");
});

it("renders zero denominators as not measured", async () => {
  expect((await cli(["summary"])).stdout).toContain("Response rate: not measured");
});
```

Before invoking tests, monkey-patch/fail if `fetch`, `http.request`, `https.request`, `net.connect`, or `tls.connect` is called in the child preload module. This proves dry-run behavior rather than trusting naming.

- [ ] **Step 2: Run CLI tests and verify RED**

Run: `npm test -- scripts/outreach/outreach-cli.test.mjs`  
Expected: FAIL because CLI and package script do not exist.

- [ ] **Step 3: Implement the CLI**

Use `parseArgs({ allowPositionals: true, options: { input, candidate, message, labels } })`. Inject `now = new Date()` only at the CLI boundary. Exit code `2` for invalid input/state transitions and `1` for unreadable/corrupt storage; never print a stack trace or state file contents by default.

`preview` prints only:

```text
DRY RUN — NOTHING SENT
Candidate: P01 — Fictional Inventory Lab
Channel source: https://contact.example.test/business
Message: P01-initial
--- body ---
...
--- end ---
```

`record-sent` is a manual ledger action, not a sender. Its confirmation text must say `Recorded as manually sent; no message was transmitted by this tool.`

- [ ] **Step 4: Add the package script**

```json
"outreach": "node scripts/outreach/outreach-cli.mjs"
```

- [ ] **Step 5: Run Task 3 tests and a manual smoke workflow**

Run: `npm test -- scripts/outreach/outreach-cli.test.mjs`  
Expected: PASS.

Run with a temp state path:

```powershell
$env:OUTREACH_STATE_PATH = Join-Path $env:TEMP "stockpulse-outreach-smoke.json"
npm run outreach -- summary
Remove-Item -LiteralPath $env:OUTREACH_STATE_PATH
```

Expected first command includes `Response rate: not measured`. Remove only the exact temporary file created by this smoke test.

- [ ] **Step 6: Commit Task 3**

```bash
git add package.json scripts/outreach/outreach-cli.mjs scripts/outreach/outreach-cli.test.mjs
git commit -m "feat: add dry-run outreach CLI"
```

---

### Task 4: Operator runbook, seed examples, and complete verification

**Files:**
- Create: `docs/outreach-operator-runbook.md`
- Create: `examples/outreach/candidate.example.json`
- Modify: `outputs/StockPulse-Ucretsiz-Pilot.md`

**Interfaces:**
- Consumes all CLI commands from Task 3.
- Produces a no-secrets operator workflow and a fictional candidate input example.

- [ ] **Step 1: Write the fictional candidate example**

```json
{
  "code": "P99",
  "businessName": "Example Inventory Store",
  "storeDomain": "https://example-inventory-store.test",
  "sourceUrl": "https://example.test/shopify-evidence",
  "rationale": "Public catalogue shows multiple physical variants and stock states.",
  "targetRole": "Inventory owner",
  "channelSourceUrl": "https://example.test/business-contact"
}
```

Use only reserved `.test` domains and no real address.

- [ ] **Step 2: Write the operator runbook**

Document exact commands for:

1. Copying the fictional JSON outside the repo and replacing business-only fields.
2. Adding P01, creating a draft, listing the queue.
3. Reviewing sources/body, approving exactly one message, and previewing.
4. Manually sending outside the tool only after action-time approval and legal gates.
5. Recording sent state, classified reply labels, and opt-out.
6. Creating/approving one due follow-up.
7. Reading the summary.
8. Recovering safely from corrupt storage by preserving the file and restoring a backup; never deleting it automatically.

Add a prominent block: `No live sender exists. preview and record-sent never contact anyone.`

- [ ] **Step 3: Link the runbook from the pilot document**

In `Onaylı otomasyon sınırı`, add: `Kuru çalışma komutları ve operatör adımları için docs/outreach-operator-runbook.md dosyasını kullanın.` Do not change the existing zero-evidence counters.

- [ ] **Step 4: Run full verification**

Run: `npm test`  
Expected: every existing and new test passes.

Run: `npm run typecheck`  
Expected: exit 0.

Run: `npm run lint`  
Expected: exit 0.

Run: `npm run build`  
Expected: exit 0.

Run: `git diff --check`  
Expected: exit 0 with no whitespace errors.

Run: `git status --short`  
Expected: only intended Task 4 files before commit; no `.stockpulse-outreach` state and no real addresses/messages.

- [ ] **Step 5: Request code review**

Dispatch a read-only reviewer against the implementation commits and the design/plan. Require explicit checks for bypassable approval, duplicate/follow-up limits, opt-out terminal behavior, network calls, secret/PII leakage, atomic persistence, CLI test realism, and false claims about message transmission.

- [ ] **Step 6: Fix all Critical/Important findings and rerun full verification**

Use `superpowers:receiving-code-review` before applying reviewer feedback. Repeat Step 4 after changes; do not weaken assertions to silence findings.

- [ ] **Step 7: Commit Task 4**

```bash
git add docs/outreach-operator-runbook.md examples/outreach/candidate.example.json outputs/StockPulse-Ucretsiz-Pilot.md
git commit -m "docs: add outreach operator workflow"
```

- [ ] **Step 8: Stop before live sending**

Report dry-run capability, exact verification evidence, local state location, and remaining live-send blockers. Do not configure Gmail/SMTP, create credentials, register IYS data, send a test email, or contact a prospect in this plan.
