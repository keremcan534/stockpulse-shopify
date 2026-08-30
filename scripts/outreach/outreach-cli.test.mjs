import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";

const cliPath = path.resolve("scripts/outreach/outreach-cli.mjs");
const packagePath = path.resolve("package.json");
const candidateInput = {
  code: "P01",
  businessName: "Fictional Inventory Lab",
  storeDomain: "https://WWW.Inventory-Lab.test./products/demo",
  sourceUrl: "https://evidence.example.test/shopify",
  rationale: "Public catalogue shows multiple stock states.",
  targetRole: "Inventory owner",
  channelSourceUrl: "https://contact.example.test/business",
  contactEmail: "not-stored@contact.example.test",
};

let temp;
let inputPath;
let preloadPath;
let statePath;
let tempSequence = 0;

beforeEach(async () => {
  tempSequence += 1;
  temp = path.join(
    tmpdir(),
    `stockpulse-outreach-cli-${process.pid}-${tempSequence}`,
  );
  inputPath = path.join(temp, "candidate.json");
  preloadPath = path.join(temp, "no-network.mjs");
  statePath = path.join(temp, "state.json");

  await mkdir(temp, { recursive: true });
  await writeFile(inputPath, JSON.stringify(candidateInput));
  await writeFile(
    preloadPath,
    [
      'import { syncBuiltinESMExports } from "node:module";',
      'import http from "node:http";',
      'import https from "node:https";',
      'import net from "node:net";',
      'import tls from "node:tls";',
      "const blocked = (api) => () => { throw new Error(`NETWORK I/O BLOCKED: ${api}`); };",
      'globalThis.fetch = blocked("fetch");',
      'http.request = blocked("http.request");',
      'http.get = blocked("http.get");',
      'https.request = blocked("https.request");',
      'https.get = blocked("https.get");',
      'net.connect = blocked("net.connect");',
      'net.createConnection = blocked("net.createConnection");',
      'tls.connect = blocked("tls.connect");',
      "syncBuiltinESMExports();",
    ].join("\n"),
  );
});

afterEach(async () => {
  await rm(temp, { recursive: true, force: true });
});

function nodeChild(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", pathToFileURL(preloadPath).href, ...args],
      {
        cwd: temp,
        env: { ...process.env, OUTREACH_STATE_PATH: statePath },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function cli(args) {
  return nodeChild([cliPath, ...args]);
}

async function addCandidateAndDraft() {
  expect((await cli(["candidate", "add", "--input", inputPath])).status).toBe(
    0,
  );
  expect((await cli(["draft", "initial", "--candidate", "P01"])).status).toBe(
    0,
  );
}

async function backdateRecordedInitial() {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.candidates[0].createdAt = "2020-01-01T08:00:00.000Z";
  state.candidates[0].updatedAt = "2020-01-01T09:00:00.000Z";
  state.messages[0].createdAt = "2020-01-01T08:30:00.000Z";
  state.messages[0].approvedAt = "2020-01-01T08:45:00.000Z";
  state.messages[0].sentAt = "2020-01-01T09:00:00.000Z";
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

it("exposes the outreach CLI through the package script", async () => {
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  expect(packageJson.scripts.outreach).toBe(
    "node scripts/outreach/outreach-cli.mjs",
  );
});

it("blocks network APIs imported as named Node builtin exports", async () => {
  const result = await nodeChild([
    "--input-type=module",
    "--eval",
    'import { request } from "node:http"; request();',
  ]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("NETWORK I/O BLOCKED: http.request");
});

it("adds a candidate from a JSON file without echoing contact data", async () => {
  const result = await cli(["candidate", "add", "--input", inputPath]);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("P01");
  expect(result.stdout).not.toContain("not-stored@contact.example.test");
  expect(await readFile(statePath, "utf8")).not.toContain(
    "not-stored@contact.example.test",
  );
});

it("refuses preview and record-sent before individual approval", async () => {
  await addCandidateAndDraft();

  const preview = await cli(["preview", "--message", "P01-initial"]);
  expect(preview.status).toBe(2);
  expect(preview.stderr).toMatch(/must be approved/i);

  const record = await cli(["record-sent", "--message", "P01-initial"]);
  expect(record.status).toBe(2);
  expect(record.stderr).toMatch(/must be approved/i);
});

it("prints only a dry-run envelope after individual approval", async () => {
  await addCandidateAndDraft();
  expect((await cli(["approve", "--message", "P01-initial"])).status).toBe(0);

  const result = await cli(["preview", "--message", "P01-initial"]);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toBe(
    [
      "DRY RUN — NOTHING SENT",
      "Candidate: P01 — Fictional Inventory Lab",
      "Channel source: https://contact.example.test/business",
      "Message: P01-initial",
      "--- body ---",
      "Merhaba Fictional Inventory Lab,",
      "",
      "Public catalogue shows multiple stock states.",
      "",
      "StockPulse ile fiziksel stok hareketlerini daha görünür kılmaya çalışıyoruz. örnek verili demoyu göndermemi ister misiniz?",
      "",
      "İlgilenmiyorsanız belirtmeniz yeterli; tekrar mesaj göndermem.",
      "--- end ---",
      "",
    ].join("\n"),
  );
});

it("records a manual send only after approval", async () => {
  await addCandidateAndDraft();
  await cli(["approve", "--message", "P01-initial"]);

  const result = await cli(["record-sent", "--message", "P01-initial"]);
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(
    "Recorded as manually sent; no message was transmitted by this tool.\n",
  );
  expect(JSON.parse(await readFile(statePath, "utf8")).messages[0].state).toBe(
    "sent",
  );
});

it("records labels after a send but never stores the raw reply", async () => {
  await addCandidateAndDraft();
  await cli(["approve", "--message", "P01-initial"]);
  await cli(["record-sent", "--message", "P01-initial"]);
  const result = await cli([
    "reply",
    "--candidate",
    "P01",
    "--labels",
    "problem_confirmed,demo_requested",
  ]);
  expect(result.status).toBe(0);
  const stored = await readFile(statePath, "utf8");
  expect(stored).not.toContain("raw reply");
  expect(JSON.parse(stored).candidates[0].replyLabels).toEqual([
    "problem_confirmed",
    "demo_requested",
  ]);
});

it("creates due follow-ups and lists only operational queue fields", async () => {
  await addCandidateAndDraft();
  await cli(["approve", "--message", "P01-initial"]);
  await cli(["record-sent", "--message", "P01-initial"]);
  await backdateRecordedInitial();

  const followups = await cli(["followups", "create"]);
  expect(followups.status).toBe(0);
  expect(followups.stdout).toContain("1");

  const list = await cli(["list"]);
  expect(list.status).toBe(0);
  expect(list.stdout).toContain("P01 — Fictional Inventory Lab — active");
  expect(list.stdout).toContain("P01-followup — draft");
  expect(list.stdout).not.toContain("not-stored@contact.example.test");
});

it("requires separate approval before follow-up preview and record-sent", async () => {
  await addCandidateAndDraft();
  await cli(["approve", "--message", "P01-initial"]);
  await cli(["record-sent", "--message", "P01-initial"]);
  await backdateRecordedInitial();
  expect((await cli(["followups", "create"])).status).toBe(0);

  const preview = await cli(["preview", "--message", "P01-followup"]);
  expect(preview.status).toBe(2);
  expect(preview.stderr).toMatch(/must be approved/i);

  const record = await cli(["record-sent", "--message", "P01-followup"]);
  expect(record.status).toBe(2);
  expect(record.stderr).toMatch(/must be approved/i);
});

it("blocks preview of an approved follow-up after a reply", async () => {
  await addCandidateAndDraft();
  await cli(["approve", "--message", "P01-initial"]);
  await cli(["record-sent", "--message", "P01-initial"]);
  await backdateRecordedInitial();
  await cli(["followups", "create"]);
  await cli(["approve", "--message", "P01-followup"]);

  const reply = await cli([
    "reply",
    "--candidate",
    "P01",
    "--labels",
    "meaningful_reply",
  ]);
  expect(reply.status).toBe(0);
  expect(
    JSON.parse(await readFile(statePath, "utf8")).messages.find(
      (message) => message.id === "P01-followup",
    ).state,
  ).toBe("cancelled");

  const preview = await cli(["preview", "--message", "P01-followup"]);
  expect(preview.status).toBe(2);
  expect(preview.stderr).toMatch(/active and unsuppressed/i);
});

it("renders zero denominators as not measured", async () => {
  const result = await cli(["summary"]);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("Response rate: not measured");
  await expect(readFile(statePath, "utf8")).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("uses safe exit codes and messages for invalid input and corrupt storage", async () => {
  const invalid = await cli(["unknown"]);
  expect(invalid.status).toBe(2);
  expect(invalid.stderr).not.toContain("at ");

  await writeFile(statePath, "{private and corrupt");
  const corrupt = await cli(["summary"]);
  expect(corrupt.status).toBe(1);
  expect(corrupt.stderr).toMatch(/corrupt state json/i);
  expect(corrupt.stderr).not.toContain("private and corrupt");
  expect(corrupt.stderr).not.toContain("at ");
});

it("classifies semantically corrupt persisted state as a sanitized storage failure", async () => {
  await writeFile(
    statePath,
    JSON.stringify({
      version: 1,
      candidates: [
        {
          code: "P01",
          replyLabels: null,
          privateNote: "do not expose this persisted value",
        },
      ],
      messages: [],
      suppressions: [],
    }),
  );

  const result = await cli(["summary"]);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/corrupt state data/i);
  expect(result.stderr).not.toContain("do not expose this persisted value");
  expect(result.stderr).not.toContain("at ");
});
