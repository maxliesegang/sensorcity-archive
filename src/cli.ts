import path from "node:path";

/** Default archive location: `SENSORCITY_DATA_DIR` env var, else `./data`. */
export function defaultDataDir(): string {
  return process.env.SENSORCITY_DATA_DIR ?? path.resolve("data");
}

/**
 * Pull `--data-dir <path>` out of argv, returning the resolved directory and
 * the arguments that were left untouched (so callers can parse their own
 * flags and reject anything unexpected).
 */
export function takeDataDir(argv: string[]): { dataDir: string; rest: string[] } {
  const rest: string[] = [];
  let dataDir = defaultDataDir();

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--data-dir") {
      const value = argv[i + 1];
      if (!value) throw new Error("--data-dir requires a value");
      dataDir = path.resolve(value);
      i += 1;
    } else {
      rest.push(argv[i]!);
    }
  }

  return { dataDir, rest };
}
