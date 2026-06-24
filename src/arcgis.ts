import { Agent, fetch } from "undici";
import { ARCGIS_BASE_URL, MAX_RECORD_COUNT } from "./registry.js";
import type { Feature, QueryResponse } from "./types.js";

// The Karlsruhe geoportal can be slow to accept connections (or briefly
// throttle cloud IPs), so give the connect/headers/body phases a generous
// budget instead of undici's 10s connect-timeout default, which is what
// failed in CI (UND_ERR_CONNECT_TIMEOUT).
const dispatcher = new Agent({
  connect: { timeout: 30_000 },
  headersTimeout: 30_000,
  bodyTimeout: 30_000,
});

const MAX_ATTEMPTS = 4;

function isRetryable(err: unknown): boolean {
  // Network-level failures surface as a TypeError ("fetch failed") whose
  // cause carries the undici error code; HTTP 5xx are thrown below as Errors.
  const code = (err as { cause?: { code?: string } })?.cause?.code;
  if (code) {
    return [
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_BODY_TIMEOUT",
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "EAI_AGAIN",
      "ENETUNREACH",
    ].includes(code);
  }
  return /HTTP 5\d\d/.test((err as Error)?.message ?? "");
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function fetchJsonOnce<T>(url: string): Promise<T> {
  const res = await fetch(url, { dispatcher });
  if (!res.ok) throw new Error(`Request failed: HTTP ${res.status}`);

  const body = (await res.json()) as T & { error?: { message: string } };
  if (body?.error) throw new Error(body.error.message);
  return body;
}

async function fetchJson<T>(url: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetchJsonOnce<T>(url);
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS || !isRetryable(err)) throw err;
      const backoff = 1_000 * 2 ** (attempt - 1); // 1s, 2s, 4s
      console.warn(
        `ArcGIS request failed (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${backoff}ms:`,
        (err as Error)?.message ?? err,
      );
      await delay(backoff);
    }
  }
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
