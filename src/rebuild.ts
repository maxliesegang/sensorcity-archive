import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { rebuildArchiveText } from "./archive.js";
import { takeDataDir } from "./cli.js";

async function* jsonFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* jsonFiles(full);
    else if (entry.isFile() && entry.name.endsWith(".json")) yield full;
  }
}

async function main(): Promise<void> {
  const { dataDir, rest } = takeDataDir(process.argv.slice(2));
  if (rest.length > 0) throw new Error(`Unknown argument: ${rest[0]}`);
  const sensorsDir = path.join(dataDir, "sensors");
  let scanned = 0;
  let rewritten = 0;

  for await (const file of jsonFiles(sensorsDir)) {
    scanned += 1;
    const next = rebuildArchiveText(await readFile(file, "utf8"));
    if (next === null) continue;
    await writeFile(file, next, "utf8");
    rewritten += 1;
  }

  console.log(`Scanned ${scanned} sensor files; rewrote ${rewritten}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
