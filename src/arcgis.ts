import { ARCGIS_BASE_URL, MAX_RECORD_COUNT } from "./registry.js";
import type { Feature, QueryResponse } from "./types.js";

export interface QueryParams {
  where?: string;
  outFields?: string;
  orderByFields?: string;
  resultOffset?: number;
  resultRecordCount?: number;
  returnGeometry?: boolean;
}

export function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

export function queryUrl(layerId: number, params: QueryParams): string {
  const url = new URL(`${ARCGIS_BASE_URL}/${layerId}/query`);
  url.searchParams.set("where", params.where ?? "1=1");
  if (params.outFields) url.searchParams.set("outFields", params.outFields);
  if (params.orderByFields) url.searchParams.set("orderByFields", params.orderByFields);
  if (params.resultOffset != null) {
    url.searchParams.set("resultOffset", String(params.resultOffset));
  }
  if (params.resultRecordCount != null) {
    url.searchParams.set("resultRecordCount", String(params.resultRecordCount));
  }
  if (params.returnGeometry != null) {
    url.searchParams.set("returnGeometry", String(params.returnGeometry));
  }
  url.searchParams.set("f", "json");
  return url.toString();
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: HTTP ${res.status}`);

  const body = (await res.json()) as T & { error?: { message: string } };
  if (body?.error) throw new Error(body.error.message);
  return body;
}

export async function query(layerId: number, params: QueryParams): Promise<QueryResponse> {
  return fetchJson<QueryResponse>(queryUrl(layerId, { returnGeometry: false, ...params }));
}

export async function queryAll(layerId: number, params: QueryParams = {}): Promise<Feature[]> {
  const out: Feature[] = [];
  const pageSize = Math.min(params.resultRecordCount ?? MAX_RECORD_COUNT, MAX_RECORD_COUNT);
  const orderByFields = params.orderByFields ?? "objectid ASC";
  let offset = 0;

  for (;;) {
    const res = await query(layerId, {
      ...params,
      orderByFields,
      resultOffset: offset,
      resultRecordCount: pageSize,
    });
    const features = res.features ?? [];
    out.push(...features);
    offset += features.length;
    if (features.length < pageSize) break;
  }

  return out;
}
