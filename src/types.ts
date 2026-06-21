export type AttributeValue = string | number | boolean | null;
export type Attributes = Record<string, AttributeValue>;

export interface Feature {
  attributes: Attributes;
  geometry?: { x: number; y: number } | null;
}

export interface QueryResponse {
  features?: Feature[];
  exceededTransferLimit?: boolean;
  error?: { code: number; message: string };
}

export interface LiveSensor {
  objectId: number;
  deviceId: string;
  name: string;
  category: string;
  lat: number | null;
  lon: number | null;
  measuredAt: number | null;
  attributes: Attributes;
}

/** One measured quantity within a category — the shape used in config and on disk. */
export interface Field {
  name: string;
  unit: string;
  primary?: boolean;
}

/** A class of sensor and the fields it measures. */
export interface Category {
  key: string;
  fields: Field[];
}

/** A single value observed for one field at one time, before it is stored as a reading. */
export interface Sample {
  timestamp: number;
  value: number;
}

/**
 * A single reading: `[timestamp, ...values]`, where values align positionally
 * to `SensorArchive.fields`. Trailing nulls are trimmed, so a row recorded
 * before a field was added is simply shorter than `fields`. An interior field
 * that was absent for that timestamp is `null`.
 */
export type ReadingRow = [number, ...Array<number | null>];

export interface SensorArchive {
  sensor: {
    objectId: number;
    deviceId: string;
    name: string;
    category: string;
    lat: number | null;
    lon: number | null;
  };
  source: {
    liveLayerId: number;
    apiUrl: string;
  };
  fields: Field[];
  readings: ReadingRow[];
  createdAt: string;
  updatedAt: string;
}

export interface RegistryEntry {
  deviceId: string;
  objectId: number;
  name: string;
  category: string;
  path: string;
  fields: string[];
  latestTimestamp: number | null;
  latestValue: number | null;
  updatedAt: string;
}
