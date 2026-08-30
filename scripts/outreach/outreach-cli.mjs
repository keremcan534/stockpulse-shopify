import { readFile } from "node:fs/promises";
import process from "node:process";
import { parseArgs } from "node:util";
import {
  approveMessage,
  createCandidate,
  createDueFollowups,
  createInitialDraft,
  recordReply,
  recordSent,
  summary,
} from "./outreach-domain.mjs";
import { loadState, resolveStatePath, saveState } from "./outreach-store.mjs";

class InputError extends Error {}
class StorageError extends Error {}

function statePath() {
  return process.env.OUTREACH_STATE_PATH || resolveStatePath(process.cwd());
}

function requireOption(values, name) {
  const value = values[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new InputError(`--${name} is required`);
  }
  return value.trim();
}

function assertShape(positionals, expected, values, allowedOptions = []) {
  if (
    positionals.length !== expected.length ||
    positionals.some((value, index) => value !== expected[index])
  ) {
    throw new InputError("unknown or incomplete outreach command");
  }
  const allowed = new Set(allowedOptions);
  if (Object.keys(values).some((name) => !allowed.has(name))) {
    throw new InputError("option is not valid for this command");
  }
}

async function readState(filePath) {
  try {
    return await loadState(filePath);
  } catch (error) {
    throw new StorageError(
      error instanceof Error ? error.message : "storage error",
    );
  }
}

async function writeState(filePath, state) {
  try {
    await saveState(filePath, state);
  } catch (error) {
    throw new StorageError(
      error instanceof Error ? error.message : "storage error",
    );
  }
}

async function changeState(filePath, transform) {
  const current = await readState(filePath);
  const next = transform(current);
  await writeState(filePath, next);
  return next;
}

async function readCandidateInput(filePath) {
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    throw new InputError("candidate input could not be read");
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new InputError("candidate input must contain valid JSON");
  }
}

function findMessage(state, messageId) {
  const message = state.messages.find((item) => item.id === messageId);
  if (!message) throw new InputError(`message ${messageId} was not found`);
  return message;
}

function findCandidate(state, candidateCode) {
  const candidate = state.candidates.find(
    (item) => item.code === candidateCode,
  );
  if (!candidate)
    throw new InputError(`candidate ${candidateCode} was not found`);
  return candidate;
}

function printList(state) {
  const candidateLines = state.candidates.length
    ? state.candidates.map(
        (candidate) =>
          `${candidate.code} — ${candidate.businessName} — ${candidate.status}`,
      )
    : ["(none)"];
  const messageLines = state.messages.length
    ? state.messages.map((message) => `${message.id} — ${message.state}`)
    : ["(none)"];
  process.stdout.write(
    ["Candidates:", ...candidateLines, "Messages:", ...messageLines, ""].join(
      "\n",
    ),
  );
}

function printSummary(state) {
  const totals = summary(state);
  const responseRate =
    totals.sent === 0
      ? "not measured"
      : `${((totals.meaningfulReplies / totals.sent) * 100).toFixed(1)}%`;
  process.stdout.write(
    [
      `Candidates: ${totals.candidates}`,
      `Drafts: ${totals.drafts}`,
      `Approved: ${totals.approved}`,
      `Recorded sent: ${totals.sent}`,
      `Meaningful replies: ${totals.meaningfulReplies}`,
      `Problems confirmed: ${totals.problemsConfirmed}`,
      `Demos requested: ${totals.demosRequested}`,
      `Demo feedback: ${totals.demoFeedback}`,
      `Pilots requested: ${totals.pilotsRequested}`,
      `Prices stated: ${totals.pricesStated}`,
      `Opted out: ${totals.optedOut}`,
      `Response rate: ${responseRate}`,
      "",
    ].join("\n"),
  );
}

async function run(args, now) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        input: { type: "string" },
        candidate: { type: "string" },
        message: { type: "string" },
        labels: { type: "string" },
      },
    });
  } catch (error) {
    throw new InputError(
      error instanceof Error ? error.message : "invalid input",
    );
  }

  const { positionals, values } = parsed;
  const filePath = statePath();

  if (positionals[0] === "candidate") {
    assertShape(positionals, ["candidate", "add"], values, ["input"]);
    const input = await readCandidateInput(requireOption(values, "input"));
    const next = await changeState(filePath, (state) =>
      createCandidate(state, input, now),
    );
    process.stdout.write(`Added candidate ${next.candidates.at(-1).code}.\n`);
    return;
  }

  if (positionals[0] === "draft") {
    assertShape(positionals, ["draft", "initial"], values, ["candidate"]);
    const candidateCode = requireOption(values, "candidate");
    await changeState(filePath, (state) =>
      createInitialDraft(state, candidateCode, now),
    );
    process.stdout.write(`Drafted message ${candidateCode}-initial.\n`);
    return;
  }

  if (positionals[0] === "approve") {
    assertShape(positionals, ["approve"], values, ["message"]);
    const messageId = requireOption(values, "message");
    await changeState(filePath, (state) =>
      approveMessage(state, messageId, now),
    );
    process.stdout.write(`Approved message ${messageId}.\n`);
    return;
  }

  if (positionals[0] === "preview") {
    assertShape(positionals, ["preview"], values, ["message"]);
    const messageId = requireOption(values, "message");
    const state = await readState(filePath);
    const message = findMessage(state, messageId);
    const candidate = findCandidate(state, message.candidateCode);
    const suppressed = state.suppressions.some(
      (suppression) => suppression.businessDomain === candidate.businessDomain,
    );
    if (candidate.status !== "active" || suppressed) {
      throw new InputError(
        "candidate must be active and unsuppressed before preview",
      );
    }
    if (message.state !== "approved") {
      throw new InputError("message must be approved before preview");
    }
    process.stdout.write(
      [
        "DRY RUN — NOTHING SENT",
        `Candidate: ${candidate.code} — ${candidate.businessName}`,
        `Channel source: ${candidate.channelSourceUrl}`,
        `Message: ${message.id}`,
        "--- body ---",
        message.body,
        "--- end ---",
        "",
      ].join("\n"),
    );
    return;
  }

  if (positionals[0] === "record-sent") {
    assertShape(positionals, ["record-sent"], values, ["message"]);
    const messageId = requireOption(values, "message");
    await changeState(filePath, (state) => recordSent(state, messageId, now));
    process.stdout.write(
      "Recorded as manually sent; no message was transmitted by this tool.\n",
    );
    return;
  }

  if (positionals[0] === "reply") {
    assertShape(positionals, ["reply"], values, ["candidate", "labels"]);
    const candidateCode = requireOption(values, "candidate");
    const labels = requireOption(values, "labels")
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean);
    await changeState(filePath, (state) =>
      recordReply(state, candidateCode, labels, now),
    );
    process.stdout.write(`Recorded reply labels for ${candidateCode}.\n`);
    return;
  }

  if (positionals[0] === "followups") {
    assertShape(positionals, ["followups", "create"], values);
    const before = await readState(filePath);
    const next = createDueFollowups(before, now);
    await writeState(filePath, next);
    const created = next.messages.length - before.messages.length;
    process.stdout.write(`Created ${created} follow-up draft(s).\n`);
    return;
  }

  if (positionals[0] === "list") {
    assertShape(positionals, ["list"], values);
    printList(await readState(filePath));
    return;
  }

  if (positionals[0] === "summary") {
    assertShape(positionals, ["summary"], values);
    const state = await readState(filePath);
    printSummary(state);
    return;
  }

  throw new InputError("unknown or incomplete outreach command");
}

try {
  await run(process.argv.slice(2), new Date());
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  process.stderr.write(`${message}\n`);
  process.exitCode = error instanceof StorageError ? 1 : 2;
}
