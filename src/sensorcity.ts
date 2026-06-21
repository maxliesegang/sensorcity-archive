import { queryAll } from "./arcgis.js";
import { LIVE_LAYER_ID } from "./registry.js";
import type { Feature, LiveSensor, Sample } from "./types.js";

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toLiveSensor(feature: Feature): LiveSensor {
  const attributes = feature.attributes;
  return {
    objectId: Number(attributes.objectid),
    deviceId: String(attributes.device_id ?? ""),
    name: String(attributes.name ?? "Unnamed sensor"),
    category: String(attributes.beschreibung ?? "Unknown"),
    lat: finiteNumber(attributes.lat) ?? (feature.geometry ? feature.geometry.y : null),
    lon: finiteNumber(attributes.lon) ?? (feature.geometry ? feature.geometry.x : null),
    measuredAt: finiteNumber(attributes.measured_at),
    attributes,
  };
}

export async function fetchLiveSensors(): Promise<LiveSensor[]> {
  const features = await queryAll(LIVE_LAYER_ID, {
    outFields: "*",
    returnGeometry: true,
  });

  return features
    .map(toLiveSensor)
    .filter((sensor) => sensor.deviceId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function liveSampleFor(sensor: LiveSensor, fieldName: string): Sample | null {
  const value = finiteNumber(sensor.attributes[fieldName]);
  if (sensor.measuredAt == null || value == null) return null;

  return { timestamp: sensor.measuredAt, value };
}
