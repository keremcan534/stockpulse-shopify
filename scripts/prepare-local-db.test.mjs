// @vitest-environment node
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureLocalDatabase } from "./prepare-local-db.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function databasePath() {
  const directory = await mkdtemp(join(tmpdir(), "stockpulse-db-test-"));
  temporaryDirectories.push(directory);
  return join(directory, "dev.sqlite");
}

describe("ensureLocalDatabase", () => {
  it("creates a zero-byte SQLite file when it is missing", async () => {
    const filePath = await databasePath();

    await ensureLocalDatabase(filePath);

    expect((await stat(filePath)).size).toBe(0);
  });

  it("preserves an existing database exactly", async () => {
    const filePath = await databasePath();
    const existingContent = Buffer.from("existing-database-content");
    await writeFile(filePath, existingContent);

    await ensureLocalDatabase(filePath);

    expect(await readFile(filePath)).toEqual(existingContent);
  });
});
