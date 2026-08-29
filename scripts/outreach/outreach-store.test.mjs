import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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

afterEach(async () => {
  await rm(temp, { recursive: true, force: true });
});

it("defaults inside the gitignored local outreach directory", async () => {
  expect(resolveStatePath("C:/workspace")).toBe(
    path.join("C:/workspace", ".stockpulse-outreach", "state.json"),
  );
  expect(await readFile(".gitignore", "utf8")).toContain("/.stockpulse-outreach/");
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

it("updates persisted state through the supplied transform", async () => {
  const updated = await updateState(file, (current) => ({
    ...current,
    candidates: [{ code: "P01" }],
  }));

  expect(updated.candidates).toEqual([{ code: "P01" }]);
  expect(await loadState(file)).toEqual(updated);
});
