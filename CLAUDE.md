# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A small TypeScript (ESM, Node >=20) job that builds a long-lived JSON archive of Karlsruhe SensorCity sensor readings. It is run hourly by GitHub Actions (`.github/workflows/archive.yml`, cron `17 * * * *`), which commits any changes under `data/` back to the repo. There is no build step or server — the entry point runs directly via `tsx`.

## Commands

```bash
npm install
npm run archive          # primary field per category (tsx src/index.ts)
npm run archive:all      # all configured fields (--all-fields)
npm run rebuild          # re-serialize every archive to canonical form (tsx src/rebuild.ts)
npm run typecheck        # tsc --noEmit
npm test                 # alias for typecheck (no unit tests exist)
```

`src/index.ts` flags / env vars: `--all-fields`/`--primary` (or `ARCHIVE_ALL_FIELDS=true`), `--data-dir <path>` (or `SENSORCITY_DATA_DIR`, default `./data`). Useful for iterating: `npm run archive -- --data-dir /tmp/out`.

## Architecture

Data flows in one pass per run (`main()` in [src/index.ts](src/index.ts)):

1. **Fetch live sensors** — [src/sensorcity.ts](src/sensorcity.ts) `fetchLiveSensors()` reads the ArcGIS "live" layer (layer 1) and maps each feature to a `LiveSensor`. German attribute names map to typed fields (`beschreibung` → `category`, `device_id` → `deviceId`, etc.).
2. **Per sensor, per field** — produce a live `Sample` from the current snapshot (`liveSampleFor`). Sensors whose category is not in the config are skipped. The long-term history is built entirely from these hourly live snapshots; there is no official-archive backfill.
3. **Merge & write** — [src/archive.ts](src/archive.ts) `updateSensorArchive()` reads the existing per-sensor JSON into a per-field `timestamp → value` map, merges in the new live samples (newest run wins on a timestamp conflict), rebuilds the reading rows, and writes only if content changed.
4. **Index & summary** — `writeRegistry()` writes `data/registry.json` (one entry per sensor with latest reading); `writeRunSummary()` writes `data/latest-run.json`.

### Config is the source of truth: [src/registry.ts](src/registry.ts)

`CATEGORIES` defines every known sensor category, its measurement fields/units, and which field is `primary`. Every category's long-term history is built only from the hourly live snapshots this project commits. `LIVE_LAYER_ID`, `ARCGIS_BASE_URL`, and `MAX_RECORD_COUNT` live here too. Adding a sensor category or field means editing `CATEGORIES`.

### ArcGIS access: [src/arcgis.ts](src/arcgis.ts)

`queryAll()` is the only network primitive — it paginates the ArcGIS Feature Server (page size capped at `MAX_RECORD_COUNT`=2000, looping on `resultOffset` until a short page). Always go through it. SQL `where` values for user/data strings must pass through `escapeSqlString()`.

### Idempotency / change detection (important)

The whole pipeline is designed so an unchanged run produces zero file diffs (so the Actions bot commits nothing):

- `writeJsonIfChanged()` / `writeTextIfChanged()` compare the serialized output to the file on disk before writing.
- Readings are rebuilt deterministically each run (sorted by timestamp), and re-observing a timestamp with the same value yields byte-identical output — so unchanged sensors produce no diff.
- `updateSensorArchive()` only bumps `updatedAt` when the reading data (not just the on-disk shape) actually changed — it compares the previous vs next archive with `updatedAt` blanked. Never write a timestamp-only diff. Preserve this property when modifying archive logic.

### Data layout

- `data/sensors/<category-slug>/<device-id>.json` — per-sensor `SensorArchive` (see [src/types.ts](src/types.ts)). Slugs come from `slug()` in archive.ts. **Row-based format:** `fields` lists each field (`name`/`unit`/`primary`) once, in stable order; `readings` is a sorted array of `[timestamp, ...values]` rows where each value aligns positionally to `fields`. Trailing nulls are trimmed, so a row recorded before a field existed is simply shorter — adding a field later only appends to new rows and never rewrites historical ones. `serializeArchive()` keeps each row on one line for human-scannable, append-friendly diffs.
- `data/registry.json` — index of all sensors. `data/latest-run.json` — last run stats.

The persisted files carry no version field — there is a single archive format. If you change the persisted shape or `serializeArchive()`, run `npm run rebuild` to re-serialize every archive to the new canonical form in one pass.

## Conventions

- Strict TypeScript with `noUncheckedIndexedAccess` — indexed access yields `T | undefined`; handle it.
- ESM with `NodeNext` resolution: **relative imports must use the `.js` extension** even though sources are `.ts` (e.g. `import ... from "./registry.js"`).
- `data/` is committed (it is the product). `node_modules/`, `dist/`, `.env` are gitignored.
