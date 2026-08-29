import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { EMPTY_STATE } from "./outreach-domain.mjs";

function emptyState() {
  return {
    version: EMPTY_STATE.version,
    candidates: [],
    messages: [],
    suppressions: [],
  };
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
