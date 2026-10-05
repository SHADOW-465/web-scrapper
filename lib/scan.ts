/**
 * Scan: load a page in real Chromium, keep a frozen snapshot of what it shows,
 * and remember every JSON data response it fetched on the way.
 *
 * The snapshot is what the user points at. The captured responses are how we
 * get past the first page: once the user's picks are matched to one of them,
 * we replay that request for every page (see replay.ts and correlate.ts).
 *
 * Fallbacks, in order: a pasted JSON API address is read directly; if Chromium
 * can't start, the page's plain HTML is used; if nothing structured is found
 * and a Groq key is set, AI reads records from the page text.
 */
import type { Browser, HTTPResponse } from "puppeteer-core";
import { parseHTML } from "linkedom";
import { aiEnabled, extractRecords, nameFields } from "./ai";
import { extractorJs, launch, nudge, openPage } from "./browser";
import { detectPagination, findRecordSets, findTotal, flatten, humanizeKey, isPlumbing, type Flat } from "./records";
import type { Replay } from "./replay";
import { fetchHtml, safeFetch, UA } from "./safe-fetch";
import { captureSnapshot, sanitizeStatic, wrapSnapshot } from "./snapshot";
import { seal } from "./token";
import { within } from "./within";

export interface ApiField {
  key: string;       // dotted JSON path; never shown as the primary label
  label: string;     // what a person would call it
  sample: string;
  fill: number;      // share of sampled rows with a value
  plumbing: boolean; // ids, flags, counters: hidden unless asked for
}

export interface ApiSource {
  id: string;
  token: string;        // sealed Replay; opaque to the client ("" when rows are complete)
  endpoint: string;     // for the technical-details line only
  jsonPath: string;
  rows: Flat[];         // the rows this response held (all of them when not paginated)
  total: number | null; // what the server says exists across all pages
  paginated: boolean;
  fields: ApiField[];
  ai?: boolean;         // read by AI from page text, not from the site's data
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

/** A complete response must not become an 80-row export. Only paged feeds are sampled. */
export function sourceRows(records: Record<string, unknown>[], paginated: boolean): Flat[] {
  return (paginated ? records.slice(0, SAMPLE_ROWS) : records).map((r) => flatten(r));
}

export class SiteReadError extends Error {}

export function profile(rows: Flat[]): ApiField[] {
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

/** Give feed fields human names (and hide junk) with AI, when a key is set. */
async function polishNames(title: string, apis: ApiSource[]) {
  if (!aiEnabled()) return;
  const worth = [...apis].sort((a, b) => (b.total ?? b.rows.length) - (a.total ?? a.rows.length)).slice(0, 3);
  await Promise.all(worth.map(async (api) => {
    const visible = api.fields.filter((f) => !f.plumbing && f.fill > 0.1);
    const named = await nameFields(`${title} (${api.endpoint})`, visible.map((f) => ({
      key: f.key,
      current: f.label,
      samples: api.rows.map((r) => String(r[f.key] ?? "")).filter(Boolean).slice(0, 3),
    })));
    if (!named) return;
    for (const f of api.fields) {
      const n = named[f.key];
      if (n) {
        f.label = n.label;
        if (!n.keep) f.plumbing = true;
      }
    }
  }));
}

function aiSource(rows: Array<Record<string, string>>): ApiSource {
  return {
    id: "ai1", token: "", endpoint: "Read by AI from the page text", jsonPath: "", rows,
    total: rows.length, paginated: false, ai: true, fields: profile(rows).map((f) => ({ ...f, plumbing: false })),
  };
}

/** The user pasted an API address itself: read it directly, no browser. */
async function readJsonAddress(url: string, cookie?: string): Promise<ScanResult | null> {
  let res: Response;
  try {
    res = await safeFetch(url, {
      headers: { accept: "application/json, text/plain, */*", "user-agent": UA, ...(cookie ? { cookie } : {}) },
      timeoutMs: 12_000,
    });
  } catch {
    return null;
  }
  if (!res.ok || !(res.headers.get("content-type") ?? "").toLowerCase().includes("json")) {
    await res.body?.cancel();
    return null;
  }
  const payload = await res.json().catch(() => null);
  const sets = payload ? findRecordSets(payload) : [];
  const best = sets.sort((a, b) => b.records.length - a.records.length)[0];
  if (!best || best.records.length < 2) return null;
  const pagination = detectPagination(url, null);
  const rows = sourceRows(best.records, !!pagination);
  const replay: Replay = { url, method: "GET", headers: { accept: "application/json", "user-agent": UA, ...(cookie ? { cookie } : {}) }, body: null, jsonPath: best.path, pagination };
  const u = new URL(url);
  const title = `Data from ${u.hostname}`;
  const snap = wrapSnapshot(
    `<!doctype html><html><head><title>${title}</title></head><body style="font:15px system-ui;padding:32px;color:#222"><h1 style="font-size:20px">${title}</h1><p>This address returns data directly, so there is no page to show. Pick the fields you want on the right.</p></body></html>`,
    url, extractorJs(),
  );
  const apis: ApiSource[] = [{
    id: "api1", token: seal(replay), endpoint: `GET ${u.host}${u.pathname}`, jsonPath: best.path, rows,
    total: pagination ? findTotal(payload) : rows.length, paginated: !!pagination, fields: profile(rows),
  }];
  await polishNames(title, apis);
  return { url, finalUrl: url, title, snapshot: snap.html, snapshotBytes: snap.bytes, apis, notes: [] };
}

/** Chromium couldn't start: use the page's plain HTML (fine for server-rendered sites). */
async function scanWithoutBrowser(url: string, cookie: string | undefined, say: (t: string) => void): Promise<ScanResult> {
  say("Reading the page without a browser");
  const { status, html, finalUrl } = await fetchHtml(url, cookie, 20_000);
  if (status !== 200 || !html) throw new SiteReadError(`The website answered HTTP ${status || "nothing"} for that page.`);
  const inert = sanitizeStatic(html, finalUrl);
  const { document } = parseHTML(inert);
  const title = document.title ?? "";
  const snap = wrapSnapshot(inert, finalUrl, extractorJs());
  const notes = ["Read without a browser, so content that only appears after the page's scripts run may be missing."];
  const apis: ApiSource[] = [];
  const records = await extractRecords(title, (document.body?.textContent ?? "").replace(/\s+/g, " "));
  if (records) apis.push(aiSource(records));
  return { url, finalUrl, title, snapshot: snap.html, snapshotBytes: snap.bytes, apis, notes };
}

export async function scan(
  url: string,
  opts: { cookie?: string; status?: (text: string) => void } = {},
): Promise<ScanResult> {
  const say = opts.status ?? (() => undefined);

  // Data endpoints need not contain /api/ or end in .json. Inspect the response
  // type and release HTML bodies immediately before opening the browser.
  say("Checking the page address");
  const direct = await readJsonAddress(url, opts.cookie);
  if (direct) return direct;

  const notes: string[] = [];
  const captured: Captured[] = [];
  let browser: Browser | null = null;

  try {
    say("Starting a browser");
    try {
      browser = await launch();
    } catch (e) {
      console.error("[scan] browser launch failed:", e);
      return await scanWithoutBrowser(url, opts.cookie, say);
    }
    const page = await openPage(browser, url, opts.cookie);
    const pending = new Set<Promise<void>>();

    page.on("response", (res: HTTPResponse) => {
      if (captured.length >= MAX_CAPTURES || res.status() >= 400) return;
      if (!(res.headers()["content-type"] || "").toLowerCase().includes("json")) return;
      const req = res.request();
      if (!["xhr", "fetch", "other"].includes(req.resourceType())) return;
      const p = (async () => {
        try {
          const payload = await res.json();
          captured.push({ url: req.url(), method: req.method(), headers: req.headers(), postData: req.postData(), payload });
        } catch {
          /* unreadable body: not a data source */
        }
      })();
      pending.add(p);
      void p.finally(() => pending.delete(p));
    });

    say("Opening the page");
    let response: HTTPResponse | null = null;
    try {
      response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35_000 });
    } catch (e) {
      notes.push("The page was slow to load, so this shows whatever had arrived.");
      if (!page.url() || page.url() === "about:blank" || page.url().startsWith("chrome-error:")) throw new SiteReadError(`Couldn't open that page (${e instanceof Error ? e.message.split("\n")[0] : e}).`);
    }
    if (response && response.status() >= 400) throw new SiteReadError(`The website answered HTTP ${response.status()} for that page. Check the address${[401, 403].includes(response.status()) ? " or use Signed-in page if it requires a login" : " and try again later"}.`);

    // Some single-page apps (Frankfurter Buchmesse among them) only fetch their
    // data on some visits and otherwise render an empty shell. When a visit
    // comes back empty, reload, up to twice.
    let listCount = 0;
    const started = Date.now();
    for (let attempt = 0; attempt < 3; attempt++) {
      // Stay well inside the function's time limit, whatever the site does.
      if (attempt > 0 && Date.now() - started > 55_000) break;
      if (attempt > 0) {
        say("The page didn't load its content; trying again");
        await page.reload({ waitUntil: "domcontentloaded", timeout: 35_000 }).catch(() => undefined);
      } else {
        say("Waiting for the content to appear");
      }
      await page.waitForResponse((r) => (r.headers()["content-type"] || "").includes("json"), { timeout: 8_000 }).catch(() => undefined);
      await page.waitForNetworkIdle({ idleTime: 900, timeout: 9_000 }).catch(() => undefined);
      await nudge(page, 3);
      await page.waitForNetworkIdle({ idleTime: 700, timeout: 6_000 }).catch(() => undefined);
      // Some responses never finish (long polling, streams): don't wait on them forever.
      await within(Promise.allSettled([...pending]), 5_000, []);

      await within(page.addScriptTag({ content: extractorJs() }).then(() => undefined), 5_000, undefined);
      const shape = await within(page.evaluate(
        "(() => { const l = window.__ss ? window.__ss.detect() : []; return { lists: l.length, rich: l.some((x) => x.count >= 5 && x.columns.length >= 2), text: document.body.innerText.length }; })()",
      ) as Promise<{ lists: number; rich: boolean; text: number }>, 10_000, { lists: 0, rich: false, text: 0 });
      listCount = shape.lists;
      // Small lookup lists (countries, halls, filter options) load even when the
      // main data doesn't; only a paginated or wide record set counts as the data.
      const feedFound = captured.some((c) => {
        let body: unknown = null;
        try { body = c.postData ? JSON.parse(c.postData) : null; } catch { body = null; }
        const paged = !!detectPagination(c.url, body);
        return findRecordSets(c.payload).some((set) => set.records.length >= 3 && (paged || Object.keys(set.records[0] ?? {}).length >= 6));
      });
      // An app shell still has menus that look like lists, but almost no text.
      if (feedFound || (shape.rich && shape.text > 1200) || shape.text > 2500) break;
    }

    say("Reading what the page shows");
    const title = await within(page.title(), 5_000, "");
    const finalUrl = page.url();
    const pageText = aiEnabled() ? await within(page.evaluate("document.body.innerText") as Promise<string>, 5_000, "") : "";
    const snap = await within(captureSnapshot(page, extractorJs()), 20_000, null);
    if (!snap) throw new Error("The page took too long to freeze into a snapshot. Try again.");
    const cookies = await within(browser.cookies(), 5_000, [] as Array<{ name: string; value: string; domain: string }>);

    say("Matching it to the site's own data");
    const apis: ApiSource[] = [];
    const seen = new Set<string>();
    // Infinite scroll and "load more" fetch page 1, 2, 3 of the same endpoint:
    // one dataset. Fold later pages into the first.
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
        const pagination = detectPagination(cap.url, body);
        const rows = sourceRows(set.records, !!pagination);
        if (rows.length < 2) continue;
        const signature = `${Object.keys(rows[0]).slice(0, 20).sort().join(",")}|${rows.length}|${JSON.stringify(rows[0]).slice(0, 200)}`;
        if (seen.has(signature)) continue;
        seen.add(signature);
        const key = datasetKey(cap.method, cap.url, body, set.path, pagination);
        const sibling = pagination ? byEndpoint.get(key) : undefined;
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
          id: `api${++n}`, token: seal(replay), endpoint: `${cap.method} ${u.host}${u.pathname}`, jsonPath: set.path,
          rows, total: pagination ? findTotal(cap.payload) : rows.length, paginated: !!pagination, fields: profile(rows),
        };
        apis.push(source);
        if (pagination) byEndpoint.set(key, source);
      }
    }

    await polishNames(title, apis);

    const usefulFeed = apis.some((a) => a.rows.length >= 3 && a.fields.filter((f) => !f.plumbing && f.fill > 0.3).length >= 2);
    if (!listCount && !usefulFeed && aiEnabled()) {
      say("Reading the page text with AI");
      const records = await extractRecords(title, pageText);
      if (records) apis.push(aiSource(records));
    }
    if (!apis.length && !listCount) {
      notes.push(aiEnabled()
        ? "No list or data was found on this page. Click the things you want on the page to capture them."
        : "No list or data was found on this page. Click the things you want on the page to capture them, or add a Groq key to let AI read the page.");
    }
    return { url, finalUrl, title, snapshot: snap.html, snapshotBytes: snap.bytes, apis, notes };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
