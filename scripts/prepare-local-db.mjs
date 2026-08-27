import { open } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export async function ensureLocalDatabase(filePath) {
  const file = await open(filePath, "a");
  await file.close();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await ensureLocalDatabase(new URL("../prisma/dev.sqlite", import.meta.url));
}
