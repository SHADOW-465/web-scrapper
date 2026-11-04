/**
 * Exports as resumable jobs.
 *
 * An export of thousands of rows (plus a page visit per row for item data)
 * takes minutes. It runs here, in the browser, as a series of short server
 * calls. Each step is retried with backoff, progress is saved to IndexedDB
 * after every step, and an interrupted job resumes where it stopped instead
 * of starting over or silently truncating.
 */
import { crawlPages, fetchChunk, HttpError, LockedError, lookupBatch, readItemBatch, type CrawlRequest } from "./client-api";
import type { Format } from "./exporters";
import { assemble, specFor, urlsFor, type ItemResult } from "./items-client";
import { companiesFrom, companyKey, joinLeads, leadFieldNames, type CompanyRef, type LeadsState } from "./leads";
import { planFilter, planHeaders, planRows, type Plan } from "./wishes";
import { feedRows, hasPageContent, pageRows, type Feed, type PageList, type Row, type Workspace } from "./model";

export type Scope = "page" | "feed" | "crawl";

export interface JobInput {
  title: string;
  format: Format;
  scanUrl: string;
  scope: Scope;
  ws: Workspace;
  list?: PageList;
  feed?: Feed;
  crawl?: CrawlRequest;
  /** Signed in with a cookie or session: never written to disk. */
  gated?: boolean;
  /** Look up each company's decision-makers after the rows (and item pages) are in. */
  leads?: LeadsState;
  /** A plain-words request: the file has exactly these columns (see lib/wishes.ts). */
  plan?: Plan;
  /** Stop fetching rows once this many are in (a limit with no filter needs no more). */
  stopAfter?: number;
}

export interface Job extends JobInput {
  id: string;
  createdAt: number;
  updatedAt: number;
  stage: "rows" | "items" | "people" | "done" | "failed";
  raw: Row[];                           // feed rows fetched, or captured rows
  nextIndex: number;                    // feed page to resume from
  total: number | null;
  pages: number;
  results: Record<string, ItemResult>;  // item page address -> what was read there
  error?: string;
  note?: string;
}

export interface Progress {
  stage: Job["stage"];
  label: string;
  done: number;
  of: number | null;
}

export function newJob(input: JobInput): Job {
  const now = Date.now();
  return { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now, stage: "rows", raw: [], nextIndex: 0, total: null, pages: 0, results: {} };
}

/* ------------------------------------------------------------ rows */

/** Rows before item data, plus each row's item page address. */
export function baseRows(job: Pick<Job, "scope" | "ws" | "list" | "feed" | "raw">): { rows: Row[]; urls: Array<string | undefined> } {
  const { ws, list, feed } = job;
  const source = ws.items?.source;
  if (job.scope === "feed" && feed) {
    const raw = feed.token && feed.paginated ? job.raw : feed.rows;
    return { rows: feedRows(ws, list, raw), urls: urlsFor(source, list, raw, true) };
  }
  if (job.scope === "crawl") {
    const rows = job.raw.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "__url")));
    return { rows, urls: urlsFor(source, list, job.raw, false) };
  }
  // Just this page.
  const rows = pageRows(ws, list, feed);
  if (list) {
    const urls = urlsFor(source, list, rows, false);
    const keep = rows.map(hasPageContent(ws));
    return { rows: rows.filter((_, i) => keep[i]), urls: urls.filter((_, i) => keep[i]) };
  }
  return { rows, urls: urlsFor(source, undefined, feed?.rows ?? [], true) };
}

/** The finished table: base rows with item-page columns, then lead columns, joined in. */
export function finalRows(job: Job): Row[] {
  const { rows, urls } = baseRows(job);
  const out = assemble(rows, urls, job.ws.columns, job.results);
  if (job.plan) return planOutput(job, out);
  return job.leads?.config.on ? joinLeads(out, job.leads.config, job.leads.results, leadNames(job)) : out;
}

/** The rows of a plain-words export: her columns only, one row per company. */
export function planOutput(job: Pick<Job, "plan" | "leads" | "ws" | "scanUrl">, rows: Row[]): Row[] {
  const L = job.leads;
  const leadOf = (r: Row) => {
    if (!L) return undefined;
    const name = String(r[L.config.nameCol] ?? "").trim();
    return name ? L.results[companyKey(name, L.config.countryCol ? String(r[L.config.countryCol] ?? "").trim() || undefined : undefined)] : undefined;
  };
  let host = "the directory";
  try {
    host = new URL(job.scanUrl).hostname.replace(/^www\./, "");
  } catch {
    /* keep the generic name */
  }
  return planRows(rows, job.plan!, job.ws.columns, leadOf, `Listed on ${host}`);
}

/** The lead column names for this job (renamed where they clash with the user's columns). */
export const leadNames = (job: Pick<Job, "ws">) => leadFieldNames(job.ws.columns.filter((c) => c.on).map((c) => c.name));

/** Column names written to the file: the user's columns, then the lead columns. */
export function exportFields(job: Job): string[] {
  if (job.plan) return planHeaders(job.plan);
  const own = job.ws.columns.filter((c) => c.on).map((c) => c.name);
  return job.leads?.config.on ? [...own, ...Object.values(leadNames(job))] : own;
}

/** The companies this job looks up (one per company, in row order). */
export function companiesOf(job: Job): CompanyRef[] {
  if (!job.leads) return [];
  const { rows, urls } = baseRows(job);
  if (job.plan) {
    // Only companies the plan keeps (country filter), in row order, up to its limit.
    const keep = new Set(planFilter(rows, job.plan, job.ws.columns));
    const idx = rows.map((r, i) => (keep.has(r) ? i : -1)).filter((i) => i >= 0);
    return companiesFrom(idx.map((i) => rows[i]), idx.map((i) => urls[i]), job.leads.config);
  }
  return companiesFrom(rows, urls, job.leads.config);
}

export function itemUrls(job: Job): string[] {
  const { urls } = baseRows(job);
  return [...new Set(urls.filter((u): u is string => !!u))];
}

/* ------------------------------------------------------------ persistence */

const DB = "scrape-studio";
const STORE = "jobs";

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null); // private mode or blocked storage: jobs still run, they just can't resume
    }
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Signed-in jobs are never persisted: their feed token seals session cookies,
 * and nothing about a login may reach IndexedDB. They live in memory only
 * (so they cannot be resumed after the tab closes).
 */
export const saveJob = (job: Job) => (job.gated ? Promise.resolve(null) : tx("readwrite", (s) => s.put({ ...job, updatedAt: Date.now() })));
export const deleteJob = (id: string) => tx("readwrite", (s) => s.delete(id));
export async function loadJobs(): Promise<Job[]> {
  const all = ((await tx("readonly", (s) => s.getAll())) as Job[] | null) ?? [];
  const week = Date.now() - 7 * 24 * 3600 * 1000;
  for (const j of all) if (j.updatedAt < week) void deleteJob(j.id);
  return all.filter((j) => !j.gated && j.updatedAt >= week).sort((a, b) => b.updatedAt - a.updatedAt);
}

/* ------------------------------------------------------------ running */

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });

/** Retry a step with growing waits; permanent failures (bad token, 4xx) are not retried. */
async function withRetry<T>(what: string, fn: () => Promise<T>, signal: AbortSignal, onWait: (msg: string) => void, attempts = 6): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      if (signal.aborted || e instanceof LockedError) throw e;
      if (e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) throw e;
      lastErr = e;
      const wait = [2, 5, 10, 20, 30, 45][i] * 1000;
      onWait(`${what} didn't go through (${e instanceof Error ? e.message : e}). Trying again in ${wait / 1000}s`);
      await sleep(wait, signal);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export interface RunOptions {
  signal: AbortSignal;
  cookie?: string;
  session?: string;
  onUpdate: (job: Job, progress: Progress) => void;
}

export async function runJob(job: Job, opts: RunOptions): Promise<Job> {
  const { signal } = opts;
  let status = "";
  const report = () => opts.onUpdate({ ...job }, progressOf(job, status));
  const wait = (msg: string) => {
    status = msg;
    report();
  };

  try {
    if (job.stage === "rows") {
      if (job.scope === "feed" && job.feed?.token && job.feed.paginated) {
        let stalled = 0;
        for (;;) {
          status = "";
          const chunk = await withRetry(`Page ${job.nextIndex + 1}`, () => fetchChunk(job.feed!.token, job.nextIndex, signal), signal, wait);
          const noProgress = !chunk.rows.length && (chunk.next === job.nextIndex || chunk.failedAt === job.nextIndex);
          stalled = noProgress ? stalled + 1 : 0;
          job.raw.push(...chunk.rows);
          job.total = chunk.total ?? job.total;
          job.pages += chunk.pages;
          if (stalled >= 3) throw new Error(chunk.error || "The website repeatedly returned no progress. Your rows are saved; retry this export later.");
          if (chunk.failedAt != null) {
            // The server retried a page and gave up; keep what arrived and retry from that page.
            job.nextIndex = chunk.failedAt;
            await saveJob(job);
            wait(`${String(chunk.error).replace(/\.$/, "")}. Trying again in 10s`);
            await sleep(10_000, signal);
            continue;
          }
          job.nextIndex = chunk.next ?? job.nextIndex;
          await saveJob(job);
          report();
          if (chunk.next == null) break;
          if (job.stopAfter && job.raw.length >= job.stopAfter) {
            job.note = job.plan?.limit
              ? `Only the first ${job.raw.length.toLocaleString()} rows were fetched: enough for the ${job.plan.limit.toLocaleString()} you asked for.`
              : `Stopped after ${job.raw.length.toLocaleString()} rows.`;
            break;
          }
        }
      } else if (job.scope === "crawl" && job.crawl) {
        job.raw = [];
        const summary = await crawlPages(job.crawl, {
          rows: (rows, page) => {
            job.raw.push(...rows);
            job.pages = page;
            report();
          },
          status: (s) => wait(s),
        }, signal);
        if (summary.stoppedBy === "limit") job.note = `Stopped at your ${job.crawl.maxPages}-page limit.`;
        if (summary.stoppedBy === "time") job.note = `Stopped after ${summary.pages} pages at the 5-minute limit for page-by-page capture.`;
      }
      job.stage = specFor(job.ws) ? "items" : job.leads?.config.on ? "people" : "done";
      await saveJob(job);
      report();
    }

    if (job.stage === "items") {
      const spec = specFor(job.ws)!;
      const batchSize = spec.mode === "browser" ? 6 : 30;
      const lanes = spec.mode === "browser" ? 1 : 2;
      for (let pass = 0; pass < 2; pass++) {
        // Second pass: one more try for pages that failed the first time.
        const queue = itemUrls(job).filter((u) => (pass === 0 ? !job.results[u] : !job.results[u]?.ok));
        if (!queue.length) continue;
        await Promise.all(Array.from({ length: lanes }, async () => {
          while (queue.length) {
            const batch = queue.splice(0, batchSize);
            status = "";
            const out = await withRetry("Reading item pages", () => readItemBatch({ scanUrl: job.scanUrl, cookie: opts.cookie, session: opts.session, urls: batch, spec }, signal), signal, wait);
            for (const r of out.results) job.results[r.url] = r;
            queue.push(...out.pending); // not reached in that call's time: back in line
            await saveJob(job);
            report();
          }
        }));
      }
      job.stage = job.leads?.config.on ? "people" : "done";
      await saveJob(job);
    }

    if (job.stage === "people" && job.leads) {
      const L = job.leads;
      const companies = companiesOf(job);
      L.companyCount = companies.length;
      let fairHost: string | undefined;
      try {
        fairHost = new URL(job.scanUrl).hostname;
      } catch {
        fairHost = undefined;
      }
      const queue = companies.filter((c) => !L.results[c.id]);
      const lanes = 2;
      await Promise.all(Array.from({ length: lanes }, async () => {
        while (queue.length) {
          const batch = queue.splice(0, 12);
          // Reserve this batch's share of the run's AI web-search budget up front (two lanes share it).
          const grant = L.quotaMessage ? 0 : Math.max(0, Math.min(3, L.config.aiSearch - L.aiSearchesUsed));
          L.aiSearchesUsed += grant;
          status = "";
          let out;
          try {
            out = await withRetry("Looking up companies", () => lookupBatch({ companies: batch, fairHost, useAi: !L.quotaMessage, aiSearch: grant }, signal), signal, wait);
          } catch (e) {
            L.aiSearchesUsed -= grant;
            queue.unshift(...batch);
            throw e;
          }
          L.aiSearchesUsed -= grant - Math.min(grant, out.ai.searches);
          L.aiRequests += out.ai.requests;
          L.aiTokens += out.ai.tokens;
          if (out.ai.quotaMessage) L.quotaMessage = out.ai.quotaMessage; // shown to the user; AI is not used again this run
          for (const n of out.notices) if (!L.notices.includes(n) && L.notices.length < 5) L.notices.push(n);
          for (const r of out.results) L.results[r.id] = r;
          for (const id of out.pending) {
            const c = batch.find((b) => b.id === id);
            if (!c) continue;
            L.attempts[id] = (L.attempts[id] ?? 0) + 1;
            if (L.attempts[id] >= 3) {
              L.results[id] = { id, name: c.name, people: [], pages: [], notes: ["The lookup took too long three times and was skipped."] };
            } else queue.push(c); // not finished in that call's time: back in line
          }
          await saveJob(job);
          report();
        }
      }));
      job.stage = "done";
      await saveJob(job);
    }
    report();
    return job;
  } catch (e) {
    if (signal.aborted) {
      await saveJob(job);
      throw e;
    }
    job.error = e instanceof Error ? e.message : String(e);
    await saveJob(job);
    report();
    throw e;
  }
}

export function progressOf(job: Job, status = ""): Progress {
  if (job.stage === "rows") {
    const label = status || (job.scope === "crawl" ? `Page ${job.pages || 1}` : `Fetching rows, page ${job.nextIndex + 1}`);
    return { stage: "rows", label, done: job.raw.length, of: job.total };
  }
  if (job.stage === "items") {
    const all = itemUrls(job);
    const done = all.filter((u) => job.results[u]).length;
    return { stage: "items", label: status || "Reading each item's page", done, of: all.length };
  }
  if (job.stage === "people" && job.leads) {
    const companies = companiesOf(job);
    const done = companies.filter((c) => job.leads!.results[c.id]).length;
    return { stage: "people", label: status || "Looking up each company's decision-makers", done, of: companies.length };
  }
  return { stage: job.stage, label: status, done: 0, of: null };
}

export function failedItems(job: Job): string[] {
  return itemUrls(job).filter((u) => job.results[u] && !job.results[u].ok);
}
