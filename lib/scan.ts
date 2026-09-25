/**
 * Scan: load a page in real Chromium, keep a frozen snapshot of what it shows,
 * and remember every JSON data response it fetched on the way.
 *
 * The snapshot is what the user points at. The captured responses are how we
 * get past the first page: once the user's picks are matched to one of them,
 * we replay that request for every page (see replay.ts and correlate.ts).
 */
import type { Browser, HTTPResponse } from "puppeteer-core";
import { extractorJs, launch, nudge, openPage } from "./browser";
import { detectPagination, findRecordSets, findTotal, flatten, humanizeKey, isPlumbing, type Flat } from "./records";
import type { Replay } from "./replay";
import { captureSnapshot } from "./snapshot";
import { seal } from "./token";

export interface ApiField {
  key: string;      // dotted JSON path; never shown as the primary label
  label: string;    // what a person would call it
  sample: string;
  fill: number;     // share of sampled rows with a value
  plumbing: boolean; // ids, flags, counters: hidden unless asked for
}

export interface ApiSource {
  id: string;
  token: string;          // sealed Replay; opaque to the client
  endpoint: string;       // "POST /api/v1/search/exhibitors" for the technical-details drawer
  jsonPath: string;
  rows: Flat[];           // the rows this one response held, for matching against the page
  total: number | null;   // what the server says exists across all pages
  paginated: boolean;
  fields: ApiField[];
}

export interface ScanResult {
  url: string;
  finalUrl: string;
  title: string;
  snapshot: string;
  snapshotBytes: number;
  apis: ApiSource[];
  notes: string[];
}

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string;
  payload: unknown;
}

const MAX_CAPTURES = 80;
const SAMPLE_ROWS = 80;

function profile(rows: Flat[]): ApiField[] {
  const keys: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  return keys.map((key) => {
    const vals = rows.map((r) => r[key]).filter((v) => v !== null && v !== undefined && v !== "");
    const first = vals[0];
    const sample = first == null ? "" : String(first).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
    return { key, label: humanizeKey(key), sample, fill: rows.length ? vals.length / rows.length : 0, plumbing: isPlumbing(key, first) };
  });
}

function cookieHeaderFor(cookies: Array<{ name: string; value: string; domain: string }>, url: string): string {
  const host = new URL(url).hostname;
  return cookies
    .filter((c) => {
      const d = c.domain.replace(/^\./, "");
      return host === d || host.endsWith("." + d);
    })
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

/** Same endpoint, same query, same body, ignoring only the page number. */
function datasetKey(method: string, url: string, body: unknown, jsonPath: string, p: ReturnType<typeof detectPagination>): string {
  const u = new URL(url);
  if (p && p.style.startsWith("query")) u.searchParams.delete(p.key);
  let b = body;
  if (p && p.style.startsWith("body") && b && typeof b === "object") {
    const { [p.key]: _drop, ...rest } = b as Record<string, unknown>;
    b = rest;
  }
  return `${method} ${u.origin}${u.pathname}?${[...u.searchParams].sort().join("&")} ${JSON.stringify(b)} ${jsonPath}`;
}

export async function scan(
  url: string,
  opts: { cookie?: string; status?: (text: string) => void } = {},
): Promise<ScanResult> {
  const say = opts.status ?? (() => undefined);
  const notes: string[] = [];
  const captured: Captured[] = [];
  let browser: Browser | null = null;

  try {
    say("Starting a browser");
    browser = await launch();
    const page = await openPage(browser, url, opts.cookie);

    page.on("response", (res: HTTPResponse) => {
      void (async () => {
        if (captured.length >= MAX_CAPTURES || res.status() >= 400) return;
        const type = (res.headers()["content-type"] || "").toLowerCase();
        if (!type.includes("json")) return;
        const req = res.request();
        if (!["xhr", "fetch", "other"].includes(req.resourceType())) return;
        try {
          const payload = await res.json();
          captured.push({ url: req.url(), method: req.method(), headers: req.headers(), postData: req.postData(), payload });
        } catch {
          /* unreadable body: not a data source */
        }
      })();
    });

    say("Opening the page");
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35_000 });
    } catch (e) {
      notes.push("The page was slow to load, so this shows whatever had arrived.");
      if (!page.url() || page.url() === "about:blank") throw new Error(`Couldn't open that page (${e instanceof Error ? e.message.split("\n")[0] : e}).`);
    }

    say("Waiting for the content to appear");
    await page.waitForNetworkIdle({ idleTime: 900, timeout: 9_000 }).catch(() => undefined);
    await nudge(page, 3);
    await page.waitForNetworkIdle({ idleTime: 700, timeout: 6_000 }).catch(() => undefined);

    say("Reading what the page shows");
    const title = await page.title().catch(() => "");
    const finalUrl = page.url();
    const snap = await captureSnapshot(page, extractorJs());
    const cookies = await browser.cookies().catch(() => [] as Array<{ name: string; value: string; domain: string }>);

    say("Matching it to the site's own data");
    const apis: ApiSource[] = [];
    const seen = new Set<string>();
    // Infinite scroll and "load more" fetch page 1, 2, 3 of the same endpoint.
    // Those are one dataset: fold later pages into the first so the page's 30
    // visible rows can match a feed that returns 10 at a time.
    const byEndpoint = new Map<string, ApiSource>();
    let n = 0;
    for (const cap of captured) {
      let body: unknown = null;
      if (cap.postData) {
        try {
          body = JSON.parse(cap.postData);
        } catch {
          continue; // form-encoded bodies are not replayable as JSON
        }
      }
      for (const set of findRecordSets(cap.payload)) {
        const rows = set.records.slice(0, SAMPLE_ROWS).map((r) => flatten(r));
        if (rows.length < 2) continue;
        const signature = `${Object.keys(rows[0]).slice(0, 20).sort().join(",")}|${rows.length}|${JSON.stringify(rows[0]).slice(0, 200)}`;
        if (seen.has(signature)) continue;
        seen.add(signature);
        const pagination = detectPagination(cap.url, body);
        const endpointKey = datasetKey(cap.method, cap.url, body, set.path, pagination);
        const sibling = pagination ? byEndpoint.get(endpointKey) : undefined;
        if (sibling) {
          sibling.rows.push(...rows.slice(0, Math.max(0, SAMPLE_ROWS * 3 - sibling.rows.length)));
          sibling.fields = profile(sibling.rows);
          continue;
        }
        const headers = { ...cap.headers };
        const jar = cookieHeaderFor(cookies, cap.url);
        if (jar) headers.cookie = jar;
        const replay: Replay = { url: cap.url, method: cap.method, headers, body, jsonPath: set.path, pagination };
        const u = new URL(cap.url);
        const source: ApiSource = {
          id: `api${++n}`,
          token: seal(replay),
          endpoint: `${cap.method} ${u.host}${u.pathname}`,
          jsonPath: set.path,
          rows,
          total: findTotal(cap.payload),
          paginated: !!pagination,
          fields: profile(rows),
        };
        apis.push(source);
        if (pagination) byEndpoint.set(endpointKey, source);
      }
    }

    if (!apis.length) notes.push("No data feed found behind this page, so results come from what's on screen. Page-by-page capture is still available.");
    return { url, finalUrl, title, snapshot: snap.html, snapshotBytes: snap.bytes, apis, notes };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
