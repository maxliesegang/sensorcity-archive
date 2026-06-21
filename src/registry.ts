import type { Category, Field } from "./types.js";

export const ARCGIS_BASE_URL =
  "https://geoportal.karlsruhe.de/ags04/rest/services/Hosted/Sensordaten_NodeRED/FeatureServer";

export const LIVE_LAYER_ID = 1;
export const MAX_RECORD_COUNT = 2000;

export const CATEGORIES: Category[] = [
  {
    key: "Temperatur",
    fields: [
      { name: "temp", unit: "degC", primary: true },
      { name: "luftfeuchte", unit: "%" },
      { name: "press", unit: "Pa" },
      { name: "pm10", unit: "ug/m3" },
      { name: "pm25", unit: "ug/m3" },
      { name: "sonnenstrahlung", unit: "W/m2" },
      { name: "niederschlag", unit: "mm" },
      { name: "windgeschwindigkeit", unit: "m/s" },
    ],
  },
  {
    key: "TSK-Container",
    fields: [{ name: "fillinglvl_percent", unit: "%", primary: true }],
  },
  {
    key: "Regenschreiber",
    fields: [{ name: "clicks", unit: "count", primary: true }],
  },
  {
    key: "Boden-Sensor",
    fields: [
      { name: "bodenfeuchte", unit: "%", primary: true },
      { name: "bodentemperatur", unit: "degC" },
    ],
  },
  {
    key: "Wasserpegel-Sensor",
    fields: [{ name: "pegel", unit: "cm", primary: true }],
  },
];

const CATEGORY_BY_KEY = new Map(CATEGORIES.map((category) => [category.key, category]));

export function categoryFor(key: string): Category | undefined {
  return CATEGORY_BY_KEY.get(key);
}

export function primaryFields(category: Category): Field[] {
  const primaries = category.fields.filter((field) => field.primary);
  return primaries.length > 0 ? primaries : category.fields.slice(0, 1);
}
