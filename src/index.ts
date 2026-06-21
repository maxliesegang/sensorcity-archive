import { updateSensorArchive, writeRegistry, writeRunSummary } from "./archive.js";
import { takeDataDir } from "./cli.js";
import { categoryFor, primaryFields } from "./registry.js";
import { fetchLiveSensors, liveSampleFor } from "./sensorcity.js";
import type { Field, LiveSensor, RegistryEntry, Sample } from "./types.js";

interface CliOptions {
  allFields: boolean;
  dataDir: string;
}

function parseCli(argv: string[]): CliOptions {
  const { dataDir, rest } = takeDataDir(argv);
  let allFields = process.env.ARCHIVE_ALL_FIELDS === "true";

  for (const arg of rest) {
    if (arg === "--all-fields") allFields = true;
    else if (arg === "--primary") allFields = false;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return { allFields, dataDir };
}

/** One live sample per measured field for this run's snapshot. */
function collectSamples(sensor: LiveSensor, fields: Field[]): Map<string, Sample> {
  const samplesByField = new Map<string, Sample>();

  for (const field of fields) {
    const sample = liveSampleFor(sensor, field.name);
    if (sample) samplesByField.set(field.name, sample);
  }

  return samplesByField;
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  const observedAt = new Date().toISOString();
  const sensors = await fetchLiveSensors();
  const entries: RegistryEntry[] = [];
  let changedArchives = 0;
  let skippedSensors = 0;

  for (const sensor of sensors) {
    const category = categoryFor(sensor.category);
    if (!category) {
      skippedSensors += 1;
      continue;
    }

    const fields = options.allFields ? category.fields : primaryFields(category);
    const samplesByField = collectSamples(sensor, fields);

    const result = await updateSensorArchive({
      dataDir: options.dataDir,
      sensor,
      fields,
      samplesByField,
      observedAt,
    });
    if (result.changed) changedArchives += 1;
    entries.push(result.entry);
  }

  const registryChanged = await writeRegistry(options.dataDir, entries, observedAt);
  const summaryChanged = await writeRunSummary(options.dataDir, {
    observedAt,
    mode: options.allFields ? "all-fields" : "primary",
    liveSensorCount: sensors.length,
    archivedSensorCount: entries.length,
    skippedSensors,
    changedArchives,
    registryChanged,
  });

  console.log(
    [
      `Archived ${entries.length}/${sensors.length} live sensors`,
      `${changedArchives} sensor files changed`,
      registryChanged ? "registry changed" : "registry unchanged",
      summaryChanged ? "summary changed" : "summary unchanged",
    ].join("; "),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
