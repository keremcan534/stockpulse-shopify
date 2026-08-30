import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  EMPTY_STATE,
  REPLY_LABELS,
  canonicalizeBusinessHostname,
  normalizeCandidateText,
  normalizeCandidateUrl,
} from "./outreach-domain.mjs";

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
const CANDIDATE_STATUSES = new Set([
  "active",
  "replied",
  "opted_out",
  "closed",
]);
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
  return (
    keys.length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field))
  );
}

function isText(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function isTimestamp(value) {
  return isText(value) && !Number.isNaN(new Date(value).getTime());
}

function timestamp(value) {
  return new Date(value).getTime();
}

function isNullableTimestamp(value) {
  return value === null || isTimestamp(value);
}

function isUrl(value) {
  if (!isText(value)) return false;
  try {
    return normalizeCandidateUrl(value, "candidate URL") === value;
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

function canonicalizeStateDomains(state) {
  try {
    return {
      ...state,
      candidates: state.candidates.map((candidate) => ({
        ...candidate,
        businessName: normalizeCandidateText(
          candidate?.businessName,
          "businessName",
        ),
        businessDomain: canonicalizeBusinessHostname(candidate?.businessDomain),
        sourceUrl: normalizeCandidateUrl(candidate?.sourceUrl, "sourceUrl"),
        rationale: normalizeCandidateText(candidate?.rationale, "rationale"),
        targetRole: normalizeCandidateText(candidate?.targetRole, "targetRole"),
        channelSourceUrl: normalizeCandidateUrl(
          candidate?.channelSourceUrl,
          "channelSourceUrl",
        ),
      })),
      suppressions: state.suppressions.map((suppression) =>
        isRecord(suppression) && isText(suppression.businessDomain)
          ? {
              ...suppression,
              businessDomain: canonicalizeBusinessHostname(
                suppression.businessDomain,
              ),
            }
          : suppression,
      ),
    };
  } catch {
    throw new Error("corrupt state data");
  }
}

function hasCoherentMessageState(message) {
  if (message.state === "draft") {
    return message.approvedAt === null && message.sentAt === null;
  }
  if (message.state === "approved" || message.state === "delivery_unknown") {
    return message.approvedAt !== null && message.sentAt === null;
  }
  if (message.state === "sent") {
    return message.approvedAt !== null && message.sentAt !== null;
  }
  return message.state === "cancelled" && message.sentAt === null;
}

function isChronological(...values) {
  const present = values.filter((value) => value !== null);
  return present.every(
    (value, index) =>
      index === 0 || timestamp(present[index - 1]) <= timestamp(value),
  );
}

function hasValidAuditTrail(state) {
  const candidatesByCode = new Map(
    state.candidates.map((candidate) => [candidate.code, candidate]),
  );
  const suppressionsByDomain = new Map(
    state.suppressions.map((suppression) => [
      suppression.businessDomain,
      suppression,
    ]),
  );
  const messagesByCandidate = new Map(
    state.candidates.map((candidate) => [candidate.code, []]),
  );

  for (const candidate of state.candidates) {
    if (!isChronological(candidate.createdAt, candidate.updatedAt))
      return false;
  }

  for (const message of state.messages) {
    const candidate = candidatesByCode.get(message.candidateCode);
    if (!candidate) return false;
    messagesByCandidate.get(message.candidateCode).push(message);
    if (message.id !== `${message.candidateCode}-${message.kind}`) return false;
    if (!hasCoherentMessageState(message)) return false;
    if (
      !isChronological(
        candidate.createdAt,
        message.createdAt,
        message.approvedAt,
        message.sentAt,
        candidate.updatedAt,
      )
    ) {
      return false;
    }
    if (message.kind === "initial" && message.scheduledFor !== null)
      return false;
    if (message.kind === "followup" && message.scheduledFor === null)
      return false;
  }

  for (const suppression of state.suppressions) {
    const candidate = state.candidates.find(
      (item) => item.businessDomain === suppression.businessDomain,
    );
    if (
      !candidate ||
      candidate.status !== "opted_out" ||
      !isChronological(
        candidate.createdAt,
        suppression.createdAt,
        candidate.updatedAt,
      )
    ) {
      return false;
    }
  }

  for (const candidate of state.candidates) {
    const candidateMessages = messagesByCandidate.get(candidate.code);
    const kinds = candidateMessages.map((message) => message.kind);
    if (new Set(kinds).size !== kinds.length) return false;

    const sentMessage = candidateMessages.some(
      (message) => message.state === "sent",
    );
    const hasOptOut = candidate.replyLabels.includes("opt_out");
    const suppression = suppressionsByDomain.get(candidate.businessDomain);
    if (hasOptOut && candidate.replyLabels.length !== 1) return false;

    if (
      candidate.status === "active" &&
      (candidate.replyLabels.length > 0 || suppression)
    ) {
      return false;
    }
    if (
      candidate.status === "replied" &&
      (candidate.replyLabels.length === 0 ||
        hasOptOut ||
        suppression ||
        !sentMessage)
    ) {
      return false;
    }
    if (candidate.status === "opted_out" && (!hasOptOut || !suppression)) {
      return false;
    }
    if (candidate.status === "closed" && (hasOptOut || suppression))
      return false;
    if (candidate.replyLabels.length > 0 && !hasOptOut && !sentMessage) {
      return false;
    }
    if (candidate.status !== "opted_out" && (hasOptOut || suppression)) {
      return false;
    }

    const initial = candidateMessages.find(
      (message) => message.kind === "initial",
    );
    const followup = candidateMessages.find(
      (message) => message.kind === "followup",
    );
    if (followup) {
      if (!initial || initial.state !== "sent" || initial.sentAt === null)
        return false;
      if (
        !isChronological(
          initial.sentAt,
          followup.scheduledFor,
          followup.createdAt,
        )
      ) {
        return false;
      }
    }
    if (
      candidate.status !== "active" &&
      candidateMessages.some(
        (message) =>
          message.kind === "followup" &&
          ["draft", "approved"].includes(message.state),
      )
    ) {
      return false;
    }
    if (
      candidate.status === "opted_out" &&
      candidateMessages.some((message) =>
        ["draft", "approved"].includes(message.state),
      )
    ) {
      return false;
    }
  }

  return true;
}

function validateState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("state must be an object");
  }
  if (value.version !== 1) throw new Error("unsupported version");
  for (const collection of ["candidates", "messages", "suppressions"]) {
    if (!Array.isArray(value[collection])) {
      throw new Error(`${collection} must be an array`);
    }
  }
  const state = canonicalizeStateDomains(value);
  const candidateCodes = new Set(
    state.candidates.map((candidate) => candidate?.code),
  );
  const validEntities =
    state.candidates.every(isCandidate) &&
    hasUniqueValues(state.candidates, (candidate) => candidate.code) &&
    hasUniqueValues(
      state.candidates,
      (candidate) => candidate.businessDomain,
    ) &&
    state.messages.every((message) => isMessage(message, candidateCodes)) &&
    hasUniqueValues(state.messages, (message) => message.id) &&
    state.suppressions.every(isSuppression) &&
    hasUniqueValues(
      state.suppressions,
      (suppression) => suppression.businessDomain,
    ) &&
    hasValidAuditTrail(state);
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
  const validated = validateState(state);
  const directory = path.dirname(filePath);
  const tempPath = `${filePath}.tmp-${process.pid}`;
  let renamed = false;

  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(tempPath, `${JSON.stringify(validated, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(tempPath, filePath);
    renamed = true;
  } finally {
    if (!renamed) await rm(tempPath, { force: true });
  }
}

export async function updateState(filePath, transform) {
  const next = validateState(await transform(await loadState(filePath)));
  await saveState(filePath, next);
  return next;
}
