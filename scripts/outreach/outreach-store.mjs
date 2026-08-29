import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { EMPTY_STATE, REPLY_LABELS } from "./outreach-domain.mjs";

const CANDIDATE_FIELDS = [
  "code",
  "businessName",
  "businessDomain",
  "sourceUrl",
  "rationale",
  "targetRole",
  "channelSourceUrl",
  "status",
  "createdAt",
  "updatedAt",
  "replyLabels",
];
const MESSAGE_FIELDS = [
  "id",
  "candidateCode",
  "kind",
  "state",
  "body",
  "createdAt",
  "approvedAt",
  "sentAt",
  "scheduledFor",
];
const SUPPRESSION_FIELDS = ["businessDomain", "createdAt", "reason"];
const CANDIDATE_STATUSES = new Set(["active", "replied", "opted_out", "closed"]);
const MESSAGE_KINDS = new Set(["initial", "followup"]);
const MESSAGE_STATES = new Set([
  "draft",
  "approved",
  "sent",
  "cancelled",
  "delivery_unknown",
]);

function emptyState() {
  return {
    version: EMPTY_STATE.version,
    candidates: [],
    messages: [],
    suppressions: [],
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactFields(value, fields) {
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => Object.hasOwn(value, field));
}

function isText(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function isTimestamp(value) {
  return isText(value) && !Number.isNaN(new Date(value).getTime());
}

function isNullableTimestamp(value) {
  return value === null || isTimestamp(value);
}

function isUrl(value) {
  if (!isText(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isCandidate(candidate) {
  return (
    isRecord(candidate) &&
    hasExactFields(candidate, CANDIDATE_FIELDS) &&
    /^P\d{2}$/.test(candidate.code) &&
    isText(candidate.businessName) &&
    isText(candidate.businessDomain) &&
    isUrl(candidate.sourceUrl) &&
    isText(candidate.rationale) &&
    isText(candidate.targetRole) &&
    isUrl(candidate.channelSourceUrl) &&
    CANDIDATE_STATUSES.has(candidate.status) &&
    isTimestamp(candidate.createdAt) &&
    isTimestamp(candidate.updatedAt) &&
    Array.isArray(candidate.replyLabels) &&
    candidate.replyLabels.every((label) => REPLY_LABELS.has(label)) &&
    new Set(candidate.replyLabels).size === candidate.replyLabels.length
  );
}

function isMessage(message, candidateCodes) {
  return (
    isRecord(message) &&
    hasExactFields(message, MESSAGE_FIELDS) &&
    isText(message.id) &&
    isText(message.candidateCode) &&
    candidateCodes.has(message.candidateCode) &&
    MESSAGE_KINDS.has(message.kind) &&
    MESSAGE_STATES.has(message.state) &&
    typeof message.body === "string" &&
    isTimestamp(message.createdAt) &&
    isNullableTimestamp(message.approvedAt) &&
    isNullableTimestamp(message.sentAt) &&
    isNullableTimestamp(message.scheduledFor)
  );
}

function isSuppression(suppression) {
  return (
    isRecord(suppression) &&
    hasExactFields(suppression, SUPPRESSION_FIELDS) &&
    isText(suppression.businessDomain) &&
    isTimestamp(suppression.createdAt) &&
    suppression.reason === "recipient_request"
  );
}

function hasUniqueValues(items, select) {
  return new Set(items.map(select)).size === items.length;
}

function validateState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("state must be an object");
  }
  if (state.version !== 1) throw new Error("unsupported version");
  for (const collection of ["candidates", "messages", "suppressions"]) {
    if (!Array.isArray(state[collection])) {
      throw new Error(`${collection} must be an array`);
    }
  }
  const candidateCodes = new Set(state.candidates.map((candidate) => candidate?.code));
  const validEntities =
    state.candidates.every(isCandidate) &&
    hasUniqueValues(state.candidates, (candidate) => candidate.code) &&
    hasUniqueValues(state.candidates, (candidate) => candidate.businessDomain) &&
    state.messages.every((message) => isMessage(message, candidateCodes)) &&
    hasUniqueValues(state.messages, (message) => message.id) &&
    state.suppressions.every(isSuppression) &&
    hasUniqueValues(state.suppressions, (suppression) => suppression.businessDomain);
  if (!validEntities) throw new Error("corrupt state data");
  return state;
}

export function resolveStatePath(cwd) {
  return path.join(cwd, ".stockpulse-outreach", "state.json");
}

export async function loadState(filePath) {
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return emptyState();
    throw error;
  }

  let state;
  try {
    state = JSON.parse(content);
  } catch {
    throw new Error("corrupt state JSON");
  }
  return validateState(state);
}

export async function saveState(filePath, state) {
  validateState(state);
  const directory = path.dirname(filePath);
  const tempPath = `${filePath}.tmp-${process.pid}`;
  let renamed = false;

  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(tempPath, filePath);
    renamed = true;
  } finally {
    if (!renamed) await rm(tempPath, { force: true });
  }
}

export async function updateState(filePath, transform) {
  const next = await transform(await loadState(filePath));
  validateState(next);
  await saveState(filePath, next);
  return next;
}
