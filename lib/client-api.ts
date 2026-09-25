/** Browser-side calls to the three streaming endpoints. */
import { readNdjson } from "./ndjson";
import type { Feed, Row } from "./model";

export class LockedError extends Error {}

async function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (res.status === 401) throw new LockedError("locked");
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(data.message || `The server answered ${res.status}.`);
  }
  return res;
}

export interface ScanResult {
  url: string; finalUrl: string; title: string; snapshot: string; snapshotBytes: number; apis: Feed[]; notes: string[];
}

export async function scanPage(url: string, cookie: string | undefined, onStatus: (s: string) => void, signal?: AbortSignal): Promise<ScanResult> {
  const res = await post("/api/scan", { url, cookie }, signal);
  let result: ScanResult | null = null;
  let error: string | null = null;
  await readNdjson(res, (e) => {
    if (e.type === "status") onStatus(String(e.text));
    else if (e.type === "result") result = e as unknown as ScanResult;
    else if (e.type === "error") error = String(e.message);
  });
  if (error) throw new Error(error);
  if (!result) throw new Error("The scan ended without a result. Try again.");
  return result;
}

/** Pull every page of a feed, chaining calls past the per-request time limit. */
export async function fetchAll(
  token: string,
  opts: { maxRows?: number; enrichTeam?: boolean; onRows: (rows: Row[], total: number | null) => void; signal?: AbortSignal },
): Promise<void> {
  let startIndex = 0;
  for (let hop = 0; hop < 40; hop++) {
    const res = await post("/api/fetch", { token, startIndex, maxRows: opts.maxRows, enrichTeam: opts.enrichTeam }, opts.signal);
    let next: number | null = null;
    let error: string | null = null;
    await readNdjson(res, (e) => {
      if (e.type === "rows") opts.onRows(e.rows as Row[], (e.total as number | null) ?? null);
      else if (e.type === "continue") next = e.nextIndex as number;
      else if (e.type === "error") error = String(e.message);
    });
    if (error) throw new Error(error);
    if (next == null) return;
    startIndex = next;
  }
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
  let summary = { pages: 0, stoppedBy: "end" };
  let error: string | null = null;
  await readNdjson(res, (e) => {
    if (e.type === "rows") on.rows(e.rows as Row[], e.page as number);
    else if (e.type === "status") on.status(String(e.text));
    else if (e.type === "done") summary = { pages: e.pages as number, stoppedBy: String(e.stoppedBy) };
    else if (e.type === "error") error = String(e.message);
  });
  if (error) throw new Error(error);
  return summary;
}

export async function unlock(password: string): Promise<boolean> {
  const res = await fetch("/api/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
  return res.ok;
}
