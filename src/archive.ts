import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ARCGIS_BASE_URL, LIVE_LAYER_ID } from "./registry.js";
import type {
  Field,
  LiveSensor,
  ReadingRow,
  RegistryEntry,
  Sample,
  SensorArchive,
} from "./types.js";

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function relativeSensorPath(sensor: LiveSensor): string {
  const category = slug(sensor.category || "unknown");
  const id = slug(sensor.deviceId || `object-${sensor.objectId}`);
  return `sensors/${category}/${id}.json`;
}

async function readFileOrNull(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Pretty-prints the archive but keeps each reading on a single line, so the
 * file stays human-scannable (timestamp next to its values) and an hourly
 * append shows up as a one-line git diff.
 */
function serializeArchive(archive: SensorArchive): string {
  const cell = (x: number | null): string => (x === null ? "null" : JSON.stringify(x));
  const rows = archive.readings.map((row) => `    [${row.map(cell).join(", ")}]`);
  const readingsJson = rows.length > 0 ? `[\n${rows.join(",\n")}\n  ]` : "[]";
  const withPlaceholder = { ...archive, readings: "__READINGS__" };
  return `${JSON.stringify(withPlaceholder, null, 2).replace('"__READINGS__"', readingsJson)}\n`;
}

async function writeTextIfChanged(
  file: string,
  next: string,
  current: string | null,
): Promise<boolean> {
  if (current === next) return false;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, next, "utf8");
  return true;
}

async function writeJsonIfChanged(file: string, value: unknown): Promise<boolean> {
  return writeTextIfChanged(file, serialize(value), await readFileOrNull(file));
}

/** Per-field timestamp -> value, the in-memory form we merge into. */
type ValuesByField = Map<string, Map<number, number>>;

/** Normalize a field so a falsy `primary` is omitted, keeping serialization stable. */
function normalizeField(field: Field): Field {
  return {
    name: field.name,
    unit: field.unit,
    ...(field.primary ? { primary: true } : {}),
  };
}

/** A stored archive with its readings exploded into the per-field merge form. */
type ParsedArchive = Omit<SensorArchive, "readings"> & { values: ValuesByField };

/** Read a stored archive into the per-field merge form. */
function parseArchive(raw: string | null): ParsedArchive | null {
  if (!raw) return null;
  const { readings, ...rest } = JSON.parse(raw) as SensorArchive;
  const values: ValuesByField = new Map(rest.fields.map((field) => [field.name, new Map()]));
  for (const row of readings) {
    const timestamp = row[0];
    for (let i = 0; i < rest.fields.length; i += 1) {
      const value = row[i + 1];
      if (value != null) values.get(rest.fields[i]!.name)!.set(timestamp, value);
    }
  }
  return { ...rest, values };
}

/** True when two field lists are identical in order, name, unit, and primary flag. */
function fieldsEqual(a: Field[], b: Field[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (field, i) =>
        field.name === b[i]!.name &&
        field.unit === b[i]!.unit &&
        Boolean(field.primary) === Boolean(b[i]!.primary),
    )
  );
}

/** Most recent non-null value of the primary field (or first field), for the registry. */
function latestPrimaryReading(
  fields: Field[],
  readings: ReadingRow[],
): { timestamp: number | null; value: number | null } {
  const primaryIndex = fields.findIndex((field) => field.primary);
  const index = primaryIndex >= 0 ? primaryIndex : fields.length > 0 ? 0 : -1;
  for (let i = readings.length - 1; index >= 0 && i >= 0; i -= 1) {
    const value = readings[i]![index + 1];
    if (value != null) return { timestamp: readings[i]![0], value };
  }
  return { timestamp: null, value: null };
}

/**
 * Keeps existing field order stable (positional integrity of readings) and
 * appends any field new to this run at the end.
 */
function mergeFields(existing: Field[], incoming: Field[]): Field[] {
  const fields = existing.map((field) => ({ ...field }));
  const indexByName = new Map(fields.map((field, index) => [field.name, index]));
  for (const incomingField of incoming) {
    const next = normalizeField(incomingField);
    const index = indexByName.get(incomingField.name);
    if (index === undefined) {
      indexByName.set(incomingField.name, fields.length);
      fields.push(next);
    } else {
      fields[index] = next;
    }
  }
  return fields;
}

/** Rebuild reading rows from the merged per-field values, trimming trailing nulls. */
function buildReadings(fields: Field[], values: ValuesByField): ReadingRow[] {
  const timestamps = new Set<number>();
  for (const byTimestamp of values.values()) {
    for (const timestamp of byTimestamp.keys()) timestamps.add(timestamp);
  }

  return [...timestamps]
    .sort((a, b) => a - b)
    .map((timestamp) => {
      const row: Array<number | null> = [timestamp];
      for (const field of fields) row.push(values.get(field.name)?.get(timestamp) ?? null);
      while (row.length > 1 && row[row.length - 1] === null) row.pop();
      return row as ReadingRow;
    });
}

export async function updateSensorArchive(options: {
  dataDir: string;
  sensor: LiveSensor;
  fields: Field[];
  samplesByField: Map<string, Sample>;
  observedAt: string;
}): Promise<{ changed: boolean; entry: RegistryEntry }> {
  const relativePath = relativeSensorPath(options.sensor);
  const absolutePath = path.join(options.dataDir, relativePath);
  const rawExisting = await readFileOrNull(absolutePath);
  const existing = parseArchive(rawExisting);

  const fields = mergeFields(existing?.fields ?? [], options.fields);
  // `existing` is a fresh parse we own, so we can merge new samples into its
  // value maps in place rather than deep-copying them.
  const values: ValuesByField = existing?.values ?? new Map();
  for (const field of fields) if (!values.has(field.name)) values.set(field.name, new Map());

  // Bump updatedAt only when the data actually changes — a field added/redefined
  // or a sample whose value differs from what we stored. A formatting-only
  // rewrite must not touch updatedAt (keeps hourly commits a no-op).
  let dataChanged = !existing || !fieldsEqual(existing.fields, fields);
  for (const [fieldName, sample] of options.samplesByField) {
    const byTimestamp = values.get(fieldName)!;
    if (byTimestamp.get(sample.timestamp) !== sample.value) dataChanged = true;
    byTimestamp.set(sample.timestamp, sample.value); // newest run wins on conflict
  }

  const next: SensorArchive = {
    sensor: {
      objectId: options.sensor.objectId,
      deviceId: options.sensor.deviceId,
      name: options.sensor.name,
      category: options.sensor.category,
      lat: options.sensor.lat,
      lon: options.sensor.lon,
    },
    source: { liveLayerId: LIVE_LAYER_ID, apiUrl: ARCGIS_BASE_URL },
    fields,
    readings: buildReadings(fields, values),
    createdAt: existing?.createdAt ?? options.observedAt,
    updatedAt: existing && !dataChanged ? existing.updatedAt : options.observedAt,
  };

  const changed = await writeTextIfChanged(absolutePath, serializeArchive(next), rawExisting);
  const latest = latestPrimaryReading(fields, next.readings);

  return {
    changed,
    entry: {
      deviceId: options.sensor.deviceId,
      objectId: options.sensor.objectId,
      name: options.sensor.name,
      category: options.sensor.category,
      path: `data/${relativePath}`,
      fields: fields.map((field) => field.name).sort(),
      latestTimestamp: latest.timestamp,
      latestValue: latest.value,
      updatedAt: options.observedAt,
    },
  };
}

/**
 * Re-serialize an archive file to its canonical form. Returns the rebuilt text,
 * or `null` if the input is already byte-identical (nothing to write).
 */
export function rebuildArchiveText(raw: string): string | null {
  const parsed = parseArchive(raw);
  if (!parsed) return null;
  const { sensor, source, fields, values, createdAt, updatedAt } = parsed;
  const next = serializeArchive({
    sensor,
    source,
    fields,
    readings: buildReadings(fields, values),
    createdAt,
    updatedAt,
  });
  return next === raw ? null : next;
}

export async function writeRegistry(
  dataDir: string,
  entries: RegistryEntry[],
  observedAt: string,
): Promise<boolean> {
  return writeJsonIfChanged(path.join(dataDir, "registry.json"), {
    updatedAt: observedAt,
    sensorCount: entries.length,
    sensors: entries.sort((a, b) => a.name.localeCompare(b.name)),
  });
}

export async function writeRunSummary(
  dataDir: string,
  summary: Record<string, unknown>,
): Promise<boolean> {
  return writeJsonIfChanged(path.join(dataDir, "latest-run.json"), summary);
}
