/**
 * Replay a site's own API endpoint page by page.
 *
 * The scan captured one real request the page made (URL, method, body,
 * headers, cookies). Re-sending it with the page number bumped gets every
 * remaining page without paying for a browser per page.
 */
import { dig, findTotal, flatten, type Flat, type Pagination } from "./records";
import { resolvesPublic } from "./ssrf";

export interface Replay {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  jsonPath: string;
  pagination: Pagination | null;
}

// fetch() sets these itself; stale copies corrupt the request.
const STRIP = new Set(["content-length", "host", "connection", "accept-encoding", "transfer-encoding",
  "keep-alive", "upgrade", "te", "trailer", "priority"]);

export function cleanHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h ?? {})) {
    if (!k.startsWith(":") && !STRIP.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

/** The request for page `index` (0-based from the page the scan saw). */
export function pageRequest(r: Replay, index: number): { url: string; body: unknown } {
  const p = r.pagination;
  let url = r.url;
  let body = r.body == null ? null : structuredClone(r.body);
  if (!p) return { url, body };
  const size = p.pageSize || 0;
  const value = p.style.endsWith("page") ? p.first + index : p.first + index * (size || 1);
  if (p.style.startsWith("body")) {
    body = { ...((body as object) ?? {}), [p.key]: value };
  } else {
    const u = new URL(url);
    u.searchParams.set(p.key, String(value));
    url = u.toString();
  }
  return { url, body };
}

export interface PageResult {
  rows: Flat[];
  total: number | null;
  done: boolean;
  nextIndex: number;
}

/**
 * Fetch pages starting at `startIndex` until done or out of time.
 * Returns where to resume, so a client can chain calls past the function time limit.
 */
export async function* replayPages(
  r: Replay,
  opts: { startIndex?: number; maxRows?: number; deadline: number; delayMs?: number },
): AsyncGenerator<PageResult> {
  const headers = cleanHeaders(r.headers);
  const method = (r.method || "GET").toUpperCase();
  let index = opts.startIndex ?? 0;
  let fetched = 0;
  let total: number | null = null;

  while (true) {
    const { url, body } = pageRequest(r, index);
    if (!(await resolvesPublic(new URL(url).hostname))) throw new Error("The data source points at a private network.");

    const res = await fetch(url, {
      method,
      headers: body != null && method !== "GET" ? { "content-type": "application/json", ...headers } : headers,
      body: body != null && method !== "GET" ? JSON.stringify(body) : undefined,
      redirect: "manual", // a public host must not bounce us into a private one
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status >= 300) {
      if (index === (opts.startIndex ?? 0)) throw new Error(`The site answered ${res.status} for its own data request.`);
      yield { rows: [], total, done: true, nextIndex: index };
      return;
    }
    const payload = await res.json();
    total ??= findTotal(payload);
    const records = dig(payload, r.jsonPath);
    const rows = Array.isArray(records) ? records.filter((x) => x && typeof x === "object").map((x) => flatten(x)) : [];
    index += 1;
    fetched += rows.length;

    const cappedRows = opts.maxRows && fetched > opts.maxRows ? rows.slice(0, rows.length - (fetched - opts.maxRows)) : rows;
    const shortPage = !!r.pagination?.pageSize && rows.length < r.pagination.pageSize;
    const reachedTotal = total != null && (r.pagination?.pageSize ?? rows.length) * index >= total;
    const done = !r.pagination || !rows.length || shortPage || reachedTotal ||
      (!!opts.maxRows && fetched >= opts.maxRows) || index >= 1000;

    yield { rows: cappedRows, total, done, nextIndex: index };
    if (done) return;
    if (Date.now() > opts.deadline) return; // caller resumes from nextIndex
    await new Promise((res) => setTimeout(res, opts.delayMs ?? 120));
  }
}

export function selfCheck(): string {
  const r: Replay = { url: "https://x.test/api", method: "POST", headers: {}, body: { page: 1, limit: 36, full: true }, jsonPath: "data.list",
    pagination: { style: "body_page", key: "page", limitKey: "limit", pageSize: 36, first: 1 } };
  const p3 = pageRequest(r, 3).body as Record<string, unknown>;
  if (p3.page !== 4 || p3.full !== true) throw new Error("body page math failed");
  if ((r.body as Record<string, unknown>).page !== 1) throw new Error("replay mutated");
  const q: Replay = { ...r, url: "https://x.test/a?pageNumber=1&limit=36", body: null,
    pagination: { style: "query_page", key: "pageNumber", pageSize: 36, first: 1 } };
  if (!pageRequest(q, 2).url.includes("pageNumber=3")) throw new Error("query page failed");
  const o: Replay = { ...r, body: { offset: 0, limit: 50 }, pagination: { style: "body_offset", key: "offset", pageSize: 50, first: 0 } };
  if ((pageRequest(o, 2).body as Record<string, number>).offset !== 100) throw new Error("offset failed");
  const h = cleanHeaders({ "Content-Length": "5", ":path": "/", "X-Auth": "k" });
  if (h["Content-Length"] || h[":path"] || h["X-Auth"] !== "k") throw new Error("header hygiene failed");
  return "replay ok";
}
