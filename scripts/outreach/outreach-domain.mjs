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

import { followupMessage, initialMessage } from "./message-templates.mjs";

const CANDIDATE_STATUSES = new Set(["active", "replied", "opted_out", "closed"]);
const MESSAGE_STATES = new Set([
  "draft",
  "approved",
  "sent",
  "cancelled",
  "delivery_unknown",
]);
const MESSAGE_KINDS = new Set(["initial", "followup"]);

export const EMPTY_STATE = Object.freeze({
  version: 1,
  candidates: [],
  messages: [],
  suppressions: [],
});

export const REPLY_LABELS = new Set([
  "meaningful_reply",
  "problem_confirmed",
  "demo_requested",
  "demo_feedback",
  "pilot_requested",
  "price_stated",
  "opt_out",
  "other",
]);

function cloneState(state) {
  return {
    version: 1,
    candidates: state.candidates.map((candidate) => ({
      ...candidate,
      replyLabels: [...candidate.replyLabels],
    })),
    messages: state.messages.map((message) => ({ ...message })),
    suppressions: state.suppressions.map((suppression) => ({ ...suppression })),
  };
}

function nowIso(now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error("now must be a valid Date");
  }
  return now.toISOString();
}

function localDateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error("date must be a valid Date");
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function requireText(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} must be non-empty`);
  }
  return value.trim();
}

function requireUrl(value, field) {
  const text = requireText(value, field);
  try {
    return new URL(text);
  } catch {
    throw new Error(`${field} must be a valid URL`);
  }
}

function candidateFor(state, candidateCode) {
  const candidate = state.candidates.find((item) => item.code === candidateCode);
  if (!candidate) throw new Error(`candidate ${candidateCode} was not found`);
  if (!CANDIDATE_STATUSES.has(candidate.status)) {
    throw new Error("candidate has an invalid status");
  }
  return candidate;
}

function messageFor(state, messageId) {
  const message = state.messages.find((item) => item.id === messageId);
  if (!message) throw new Error(`message ${messageId} was not found`);
  if (!MESSAGE_KINDS.has(message.kind) || !MESSAGE_STATES.has(message.state)) {
    throw new Error("message has an invalid state");
  }
  return message;
}

function isSuppressed(state, businessDomain) {
  return state.suppressions.some(
    (suppression) => suppression.businessDomain === businessDomain,
  );
}

function assertTransitionAllowed(state, candidate) {
  if (candidate.status === "opted_out" || isSuppressed(state, candidate.businessDomain)) {
    throw new Error("candidate is suppressed");
  }
  if (candidate.status !== "active") throw new Error("candidate is not active");
}

function replaceCandidate(state, replacement) {
  return state.candidates.map((candidate) =>
    candidate.code === replacement.code ? replacement : candidate,
  );
}

function replaceMessage(state, replacement) {
  return state.messages.map((message) =>
    message.id === replacement.id ? replacement : message,
  );
}

function dueAfterBusinessDays(sentAt, days) {
  const due = new Date(sentAt.getTime());
  let countedDays = 0;
  while (countedDays < days) {
    due.setDate(due.getDate() + 1);
    const weekday = due.getDay();
    if (weekday !== 0 && weekday !== 6) countedDays += 1;
  }
  return due;
}

export function normalizeBusinessDomain(value) {
  const url = requireUrl(value, "storeDomain");
  if (!url.hostname) throw new Error("storeDomain must include a hostname");
  return url.hostname.toLowerCase();
}

export function createCandidate(state, input, now) {
  const createdAt = nowIso(now);
  const code = requireText(input?.code, "code");
  if (!/^P\d{2}$/.test(code)) throw new Error("code must match P00");

  const businessDomain = normalizeBusinessDomain(input?.storeDomain);
  if (isSuppressed(state, businessDomain)) throw new Error("candidate is suppressed");
  if (state.candidates.some((candidate) => candidate.code === code)) {
    throw new Error("candidate code must be unique");
  }
  if (state.candidates.some((candidate) => candidate.businessDomain === businessDomain)) {
    throw new Error("business domain must be unique");
  }

  requireUrl(input?.sourceUrl, "sourceUrl");
  requireUrl(input?.channelSourceUrl, "channelSourceUrl");
  const next = cloneState(state);
  next.candidates.push({
    code,
    businessName: requireText(input?.businessName, "businessName"),
    businessDomain,
    sourceUrl: requireText(input?.sourceUrl, "sourceUrl"),
    rationale: requireText(input?.rationale, "rationale"),
    targetRole: requireText(input?.targetRole, "targetRole"),
    channelSourceUrl: requireText(input?.channelSourceUrl, "channelSourceUrl"),
    status: "active",
    createdAt,
    updatedAt: createdAt,
    replyLabels: [],
  });
  return next;
}

export function createInitialDraft(state, candidateCode, now) {
  const createdAt = nowIso(now);
  const candidate = candidateFor(state, candidateCode);
  assertTransitionAllowed(state, candidate);
  if (candidate.status !== "active") throw new Error("candidate is not active");
  if (state.messages.some((message) => message.candidateCode === candidateCode && message.kind === "initial")) {
    throw new Error("candidate already has an initial message");
  }

  const next = cloneState(state);
  next.messages.push({
    id: `${candidateCode}-initial`,
    candidateCode,
    kind: "initial",
    state: "draft",
    body: initialMessage(candidate),
    createdAt,
    approvedAt: null,
    sentAt: null,
    scheduledFor: null,
  });
  next.candidates = replaceCandidate(next, { ...candidate, updatedAt: createdAt });
  return next;
}

export function approveMessage(state, messageId, now) {
  const approvedAt = nowIso(now);
  const message = messageFor(state, messageId);
  const candidate = candidateFor(state, message.candidateCode);
  assertTransitionAllowed(state, candidate);
  if (message.state !== "draft") throw new Error("message must be a draft to approve");

  if (message.kind === "initial") {
    const approvalDate = localDateKey(now);
    const approvedInitials = state.messages.filter(
      (item) =>
        item.kind === "initial" &&
        item.approvedAt &&
        localDateKey(new Date(item.approvedAt)) === approvalDate,
    );
    if (approvedInitials.length >= 3) throw new Error("daily limit reached");
  }

  const next = cloneState(state);
  next.messages = replaceMessage(next, {
    ...message,
    state: "approved",
    approvedAt,
  });
  next.candidates = replaceCandidate(next, { ...candidate, updatedAt: approvedAt });
  return next;
}

export function recordSent(state, messageId, now) {
  const sentAt = nowIso(now);
  const message = messageFor(state, messageId);
  const candidate = candidateFor(state, message.candidateCode);
  assertTransitionAllowed(state, candidate);
  if (message.state !== "approved") throw new Error("message must be approved before sent");

  const next = cloneState(state);
  next.messages = replaceMessage(next, { ...message, state: "sent", sentAt });
  next.candidates = replaceCandidate(next, { ...candidate, updatedAt: sentAt });
  return next;
}

export function recordReply(state, candidateCode, labels, now) {
  const updatedAt = nowIso(now);
  const candidate = candidateFor(state, candidateCode);
  if (!Array.isArray(labels) || labels.length === 0) {
    throw new Error("reply labels must be a non-empty array");
  }
  if (candidate.status === "opted_out" || isSuppressed(state, candidate.businessDomain)) {
    throw new Error("candidate is suppressed");
  }
  for (const label of labels) {
    if (!REPLY_LABELS.has(label)) throw new Error("reply label is not allowed");
  }

  const replyLabels = [...new Set([...candidate.replyLabels, ...labels])];
  const optedOut = replyLabels.includes("opt_out");
  const next = cloneState(state);
  next.candidates = replaceCandidate(next, {
    ...candidate,
    status: optedOut ? "opted_out" : "replied",
    updatedAt,
    replyLabels,
  });
  if (optedOut) {
    next.suppressions.push({
      businessDomain: candidate.businessDomain,
      createdAt: updatedAt,
      reason: "recipient_request",
    });
    next.messages = next.messages.map((message) =>
      message.candidateCode === candidateCode && ["draft", "approved"].includes(message.state)
        ? { ...message, state: "cancelled" }
        : message,
    );
  }
  return next;
}

export function createDueFollowups(state, now) {
  const createdAt = nowIso(now);
  const next = cloneState(state);

  for (const candidate of state.candidates) {
    if (candidate.status !== "active" || isSuppressed(state, candidate.businessDomain)) continue;
    if (candidate.replyLabels.length > 0) continue;
    if (state.messages.some((message) => message.candidateCode === candidate.code && message.kind === "followup")) {
      continue;
    }
    const initial = state.messages.find(
      (message) => message.candidateCode === candidate.code && message.kind === "initial" && message.state === "sent",
    );
    if (!initial?.sentAt) continue;

    const scheduledFor = dueAfterBusinessDays(new Date(initial.sentAt), 5);
    if (now.getTime() < scheduledFor.getTime()) continue;
    next.messages.push({
      id: `${candidate.code}-followup`,
      candidateCode: candidate.code,
      kind: "followup",
      state: "draft",
      body: followupMessage(candidate),
      createdAt,
      approvedAt: null,
      sentAt: null,
      scheduledFor: scheduledFor.toISOString(),
    });
    next.candidates = replaceCandidate(next, { ...candidate, updatedAt: createdAt });
  }
  return next;
}

export function summary(state) {
  const candidatesWith = (label) =>
    state.candidates.filter((candidate) => candidate.replyLabels.includes(label)).length;
  return {
    candidates: state.candidates.length,
    drafts: state.messages.filter((message) => message.state === "draft").length,
    approved: state.messages.filter((message) => message.state === "approved").length,
    sent: state.messages.filter((message) => message.state === "sent").length,
    meaningfulReplies: candidatesWith("meaningful_reply"),
    problemsConfirmed: candidatesWith("problem_confirmed"),
    demosRequested: candidatesWith("demo_requested"),
    demoFeedback: candidatesWith("demo_feedback"),
    pilotsRequested: candidatesWith("pilot_requested"),
    pricesStated: candidatesWith("price_stated"),
    optedOut: candidatesWith("opt_out"),
  };
}
