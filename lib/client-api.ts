/** Browser-side calls to the streaming endpoints. */
import { readNdjson } from "./ndjson";
import type { ItemResult, ItemSpec } from "./items-client";
import type { Feed, ItemCatalogue, ItemSource, Row } from "./model";

export class LockedError extends Error {}
/** Item pages exist but were not worth reading (very large pages). */
export class SkippedItemsError extends Error {}
export class HttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export class ScanError extends Error {
  constructor(message: string, public kind: "server" | "site") { super(message); }
}

async function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error("Couldn't reach the Scrape Studio server. Check your connection.");
  }
  if (res.status === 401) throw new LockedError("locked");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = "";
    try {
      const data = JSON.parse(text) as { message?: string; error?: string };
      message = data.message || data.error || "";
    } catch {
      if (res.status === 504 || text.includes("FUNCTION_INVOCATION_TIMEOUT")) message = "The server took too long to answer.";
      else if (text.includes("FUNCTION_INVOCATION_FAILED")) message = "The server crashed while working on that. See the deployment's function logs.";
    }
    throw new HttpError(message || `Scrape Studio's server could not complete the request (HTTP ${res.status}).${res.status >= 500 ? " Check the application server logs; this is not a website login error." : ""}`, res.status);
  }
  return res;
}

export interface ScanResult {
  url: string; finalUrl: string; title: string; snapshot: string; snapshotBytes: number; apis: Feed[]; notes: string[];
}

export async function scanPage(url: string, cookie: string | undefined, onStatus: (s: string) => void, signal?: AbortSignal): Promise<ScanResult> {
  const res = await post("/api/scan", { url, cookie }, signal);
  let result: ScanResult | null = null;
  let error: ScanError | null = null;
  await readNdjson(res, (e) => {
    if (e.type === "status") onStatus(String(e.text));
    else if (e.type === "result") result = e as unknown as ScanResult;
    else if (e.type === "error") error = new ScanError(String(e.message), e.kind === "site" ? "site" : "server");
  });
  if (error) throw error;
  if (!result) throw new Error("The scan ended without a result. Try again.");
  return result;
}

export interface Chunk {
  rows: Row[];
  total: number | null;
  pages: number;
  next: number | null;  // null when every page has been fetched
  failedAt?: number;    // a page failed after the server's own retries
  error?: string;
}

/** One short slice of a feed (about 25 seconds of pages). */
export async function fetchChunk(token: string, startIndex: number, signal?: AbortSignal, maxRows?: number): Promise<Chunk> {
  const res = await post("/api/fetch", { token, startIndex, maxRows }, signal);
  const chunk: Chunk = { rows: [], total: null, pages: 0, next: startIndex };
  let finished = false;
  await readNdjson(res, (e) => {
    if (e.type === "rows") {
      chunk.rows.push(...(e.rows as Row[]));
      chunk.total = (e.total as number | null) ?? chunk.total;
      chunk.pages++;
      chunk.next = e.nextIndex as number;
    } else if (e.type === "continue") {
      chunk.next = e.nextIndex as number;
      finished = true;
    } else if (e.type === "done") {
      chunk.next = null;
      finished = true;
    } else if (e.type === "error") {
      chunk.failedAt = e.nextIndex as number;
      chunk.error = String(e.message);
      finished = true;
    }
  });
  // A stream cut off mid-way (dropped connection, function killed) is a failed step.
  if (!finished) throw new Error("The connection dropped");
  return chunk;
}

export interface CrawlRequest {
  url: string; cookie?: string; mode: "next" | "more" | "scroll"; nextSelector?: string; maxPages: number;
  recipe: { itemSelector: string; fields: Array<{ name: string; sel: string; attr: string; multi?: boolean }> };
}

export async function crawlPages(
  req: CrawlRequest,
  on: { rows: (rows: Row[], page: number) => void; status: (s: string) => void },
  signal?: AbortSignal,
): Promise<{ pages: number; stoppedBy: string }> {
  const res = await post("/api/crawl", req, signal);
  let summary: { pages: number; stoppedBy: string } | null = null;
  let error: string | null = null;
  await readNdjson(res, (e) => {
    if (e.type === "rows") on.rows(e.rows as Row[], e.page as number);
    else if (e.type === "status") on.status(String(e.text));
    else if (e.type === "done") summary = { pages: e.pages as number, stoppedBy: String(e.stoppedBy) };
    else if (e.type === "error") error = String(e.message);
  });
  if (error) throw new Error(error);
  if (!summary) throw new Error("The connection dropped before page capture finished. Run the capture again.");
  return summary;
}

/** Find and sample an item page: what can be read from each row's own page. */
export async function sampleItems(
  body: { scanUrl: string; cookie?: string; urls?: string[]; discover?: { hintPaths: string[]; candidates: Array<{ key: string; values: string[] }>; verify: string[] } },
  onStatus: (s: string) => void,
  signal?: AbortSignal,
): Promise<{ pattern: ItemSource | null; catalogue: ItemCatalogue } | null> {
  const res = await post("/api/items/sample", body, signal);
  let out: { pattern: ItemSource | null; catalogue: ItemCatalogue } | null = null;
  let reason: string | null = null;
  let error: string | null = null;
  await readNdjson(res, (e) => {
    if (e.type === "status") onStatus(String(e.text));
    else if (e.type === "result") out = { pattern: (e.pattern as ItemSource | null) ?? null, catalogue: e.catalogue as ItemCatalogue };
    else if (e.type === "none" && e.message) reason = String(e.message);
    else if (e.type === "error") error = String(e.message);
  });
  if (error) throw new Error(error);
  if (!out && reason) throw new SkippedItemsError(reason);
  return out;
}

/** Read a batch of item pages. Addresses not reached in time come back as `pending`. */
export async function readItemBatch(
  body: { scanUrl: string; cookie?: string; urls: string[]; spec: ItemSpec },
  signal?: AbortSignal,
): Promise<{ results: ItemResult[]; pending: string[] }> {
  const res = await post("/api/items/read", body, signal);
  const results: ItemResult[] = [];
  let pending: string[] | null = null;
  let error: string | null = null;
  await readNdjson(res, (e) => {
    if (e.type === "item") {
      const { type: _t, ...r } = e;
      results.push(r as unknown as ItemResult);
    } else if (e.type === "done") pending = (e.pending as string[]) ?? [];
    else if (e.type === "error") error = String(e.message);
  });
  if (error) throw new Error(error);
  if (pending === null) {
    // Cut off mid-way: keep what arrived, send the rest round again.
    const got = new Set(results.map((r) => r.url));
    pending = body.urls.filter((u) => !got.has(u));
    if (!results.length) throw new Error("The connection dropped");
  }
  if (!results.length && body.urls.length && pending.length === body.urls.length) {
    throw new Error("No item pages were read in this attempt. Try again later.");
  }
  return { results, pending };
}

export async function unlock(password: string): Promise<boolean> {
  const res = await fetch("/api/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
  return res.ok;
}
