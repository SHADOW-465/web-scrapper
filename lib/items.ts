/**
 * Information from each item's own page.
 *
 * A directory row (an exhibitor, a product, a speaker) usually links to a page
 * with more about it: team members, website, description. This module:
 *   1. works out each row's page address (a link on the row, or a pattern
 *      such as /exhibitor/{slug} discovered and verified against the site);
 *   2. samples one such page in a real browser and lists what it offers;
 *   3. reads that same information from every item page, from plain HTML
 *      when the page is server-rendered (fast, no browser), or with the
 *      browser when it isn't.
 */
import { parseHTML } from "linkedom";
import { nameFields } from "./ai";
import { extractorJs, launch, nudge, openPage } from "./browser";
import { fetchHtml } from "./safe-fetch";
import { sanitizeStatic } from "./snapshot";
import { within } from "./within";

/* ------------------------------------------------------------ types */

export interface ItemList { id: string; name: string; itemSelector: string; count: number; people?: boolean }

export interface ItemField {
  key: string;        // stable id: selector + attribute
  sel: string;        // absolute (single) or relative to the list item (list)
  attr: string;       // own | text | href | src
  multi?: boolean;
  listId?: string;    // set when the field belongs to a repeating list on the item page
  name: string;
  sample: string;
  staticOK: boolean;  // readable from plain HTML
  suggested: boolean; // worth ticking by default
}

export interface ItemCatalogue {
  sampleUrl: string;
  title: string;
  lists: ItemList[];
  fields: ItemField[];
  mode: "static" | "browser";
}

export interface ItemSpec {
  lists: Array<{ id: string; itemSelector: string }>;
  fields: Array<{ key: string; sel: string; attr: string; multi?: boolean; listId?: string }>;
  mode: "static" | "browser";
}

/** Item pages too heavy to analyse (whole articles, not records). */
export class HeavyPagesError extends Error {}

/** Budget the markup we actually analyse, not embedded hydration scripts. */
export function prepareItemHtml(html: string, url: string): string {
  // Drop large script payloads before constructing a DOM. sanitizeStatic remains
  // the security boundary and removes all other active content afterwards.
  return sanitizeStatic(html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ""), url);
}

export interface ItemResult {
  url: string;
  ok: boolean;
  error?: string;
  values?: Record<string, string>;
  lists?: Record<string, Array<Record<string, string>>>;
}

/* ------------------------------------------------------------ static reading */

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

function ownText(el: Element): string {
  let t = "";
  el.childNodes.forEach((n) => {
    if (n.nodeType === 3) t += n.nodeValue ?? "";
  });
  return clean(t);
}

function readValue(el: Element | null, attr: string, base: string): string {
  if (!el) return "";
  if (attr === "href") {
    const h = el.getAttribute("href");
    if (!h) return "";
    if (/^(mailto|tel):/i.test(h)) return h.replace(/^(mailto|tel):/i, "").split("?")[0];
    try {
      return new URL(h, base).href;
    } catch {
      return h;
    }
  }
  if (attr === "src") {
    const s = el.getAttribute("src") || el.getAttribute("data-src") || "";
    if (!s || s.startsWith("data:")) return "";
    try {
      return new URL(s, base).href;
    } catch {
      return s;
    }
  }
  if (attr === "own") return ownText(el) || (el.children.length ? "" : clean(el.textContent));
  return clean(el.textContent);
}

/**
 * Browsers insert <tbody> into every table; HTML parsers without a browser
 * often don't. Selectors learned in a browser mention it, so try without.
 */
const noTbody = (sel: string) => sel.replace(/ > tbody(?= >)/g, "");

function one(root: ParentNode, sel: string): Element | null {
  try {
    return root.querySelector(sel) ?? (sel.includes("tbody") ? root.querySelector(noTbody(sel)) : null);
  } catch {
    return null;
  }
}

function many(root: ParentNode, sel: string): Element[] {
  try {
    const got = Array.from(root.querySelectorAll(sel));
    return got.length || !sel.includes("tbody") ? got : Array.from(root.querySelectorAll(noTbody(sel)));
  } catch {
    return [];
  }
}

function query(root: Element, sel: string): Element | null {
  return sel ? one(root, `:scope > ${sel}`) : root;
}

function queryAll(root: Element, sel: string): Element[] {
  return sel ? many(root, `:scope > ${sel}`) : [root];
}

/** Apply an item spec to a page's plain HTML. */
export function extractStatic(html: string, url: string, spec: ItemSpec): Pick<ItemResult, "values" | "lists"> {
  const { document } = parseHTML(html);
  const values: Record<string, string> = {};
  for (const f of spec.fields) {
    if (f.listId) continue;
    values[f.key] = readValue(one(document, f.sel), f.attr, url);
  }
  const lists: Record<string, Array<Record<string, string>>> = {};
  for (const l of spec.lists) {
    const items = many(document, l.itemSelector);
    const fields = spec.fields.filter((f) => f.listId === l.id);
    lists[l.id] = items
      .map((it) => Object.fromEntries(fields.map((f) => [
        f.key,
        f.multi ? queryAll(it, f.sel).map((e) => readValue(e, f.attr, url)).filter(Boolean).join(", ") : readValue(query(it, f.sel), f.attr, url),
      ])))
      .filter((r) => Object.values(r).some(Boolean));
  }
  return { values, lists };
}

/* ------------------------------------------------------------ finding item pages */

const norm = (s: unknown) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const SLUGISH = /^[\p{L}\p{N}][\p{L}\p{N}._~%-]{1,150}$/u;
const COMMON = ["item", "items", "detail", "details", "profile", "profiles", "company", "companies", "exhibitor", "exhibitors",
  "product", "products", "p", "people", "person", "member", "members", "speaker", "speakers", "event", "events", "listing", "listings"];
const NOISE_SEG = /^(api|v\d+|search|list|lists|query|graphql|index|marketplace|directory|output|data|en|de|fr|es|it)$/i;

function singular(w: string) {
  if (/ies$/i.test(w)) return w.slice(0, -3) + "y";
  if (/ses$/i.test(w)) return w.slice(0, -2);
  if (/s$/i.test(w) && !/ss$/i.test(w)) return w.slice(0, -1);
  return w;
}

/** Page-address patterns worth trying, most likely first. */
export function candidatePatterns(origin: string, hintPaths: string[]): string[] {
  const words: string[] = [];
  for (const p of hintPaths) {
    const segs = p.split("/").filter((s) => s && !NOISE_SEG.test(s) && !/^\d+$/.test(s) && /^[a-z-]+$/i.test(s));
    for (const s of segs.reverse()) for (const w of [singular(s), s]) if (!words.includes(w)) words.push(w);
  }
  for (const w of COMMON) if (!words.includes(w)) words.push(w);
  const locales = [""];
  for (const p of hintPaths) {
    const m = p.match(/^\/([a-z]{2})(\/|$)/i);
    if (m && !locales.includes(`/${m[1]}`)) locales.push(`/${m[1]}`);
  }
  const out: string[] = [];
  for (const w of words.slice(0, 8)) for (const l of locales) out.push(`${origin}${l}/${w}/{v}`);
  return out;
}

export interface Discovery { key: string; pattern: string }

/**
 * Work out how a row's value maps to its page, e.g. "/exhibitor/{url}".
 * A pattern only counts when the page it produces mentions the row it's for.
 */
export async function discoverPattern(input: {
  origin: string;
  hintPaths: string[];
  candidates: Array<{ key: string; values: string[] }>; // row values, same row order
  verify: string[];                                     // per row: text the page should contain (a name)
  cookie?: string;
}): Promise<Discovery | null> {
  const patterns = candidatePatterns(input.origin, input.hintPaths);
  const keys = input.candidates.filter((c) => c.values[0] && SLUGISH.test(c.values[0])).slice(0, 4);
  let probes = 0;
  for (const c of keys) {
    for (const pattern of patterns) {
      if (++probes > 28) return null;
      const url = pattern.replace("{v}", encodeURIComponent(c.values[0]).replace(/%2F/gi, "/"));
      try {
        const { status, html } = await fetchHtml(url, input.cookie, 8000);
        if (status !== 200 || !html) continue;
        const text = norm(html);
        const want = norm(input.verify[0]).slice(0, 40);
        if ((want && text.includes(want)) || (!want && text.includes(norm(c.values[0])))) {
          // Negative control: some sites answer every address with the same page.
          // If a made-up item passes the same test, the pattern proves nothing.
          const fake = await fetchHtml(pattern.replace("{v}", "zz-no-such-item-7f3a9"), input.cookie, 8000).catch(() => null);
          if (fake && fake.status === 200 && ((want && norm(fake.html).includes(want)) || norm(fake.html) === text)) continue;
          // Confirm on a second row so a catch-all page can't pass.
          if (c.values[1] && input.verify[1]) {
            const second = await fetchHtml(pattern.replace("{v}", encodeURIComponent(c.values[1])), input.cookie, 8000).catch(() => null);
            if (!second || second.status !== 200 || !norm(second.html).includes(norm(input.verify[1]).slice(0, 40))) continue;
          }
          return { key: c.key, pattern };
        }
      } catch {
        /* blocked or unreachable: try the next pattern */
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------ sampling */

interface EngineList { id: string; name: string; count: number; itemSelector: string; chrome?: boolean; people?: boolean; columns: Array<{ key: string; sel: string; attr: string; multi?: boolean; name: string; values: string[] }> }
interface EngineSingle { key: string; sel: string; attr: string; name: string; value: string }

const JUNK_TEXT = /^(sign in|log ?in|register|register now|show (all|more)|read more|see (all|more)|more|back|next|previous|share|follow|menu|close|accept|cookie|home|marketplace|search|filters?)$/i;

/**
 * What kinds of content a page has, and how many of each.
 *
 * Read by scanning the markup as text rather than building a document: a
 * 2.4 MB article costs hundreds of megabytes as a DOM, and this runs over
 * every fetched page.
 */
function features(html: string): { set: Set<string>; counts: Map<string, number>; text: number } {
  const set = new Set<string>();
  const counts = new Map<string, number>();
  for (const m of html.matchAll(/\sdata-testid=["']([^"']{1,60})["']/g)) {
    set.add(`t:${m[1]}`);
    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  for (const m of html.matchAll(/\sdata-styleid=["']([^"']{1,60})["']/g)) set.add(`s:${m[1]}`);
  for (const m of html.matchAll(/\sclass=["']([^"']{0,300})["']/g)) {
    for (const c of m[1].split(/\s+/)) if (c && c.length < 60) set.add(`c:${c}`);
  }
  // Rough size of the words on the page, ignoring tags.
  const text = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").length;
  return { set, counts, text };
}

/**
 * Pick which pages to analyse.
 *
 * Two things matter. Coverage: pages that between them show every kind of
 * content. Depth: for each kind of card, the page that shows the MOST of them,
 * because a field only some cards carry (a job title on one person in three)
 * is only discovered where there are enough cards to carry it.
 */
function diverse(pages: Array<{ url: string; html: string }>, min: number, max: number): Array<{ url: string; html: string }> {
  const scored = pages.filter((p) => p.html).map((p) => ({ ...p, f: features(p.html) }));
  if (!scored.length) return pages.slice(0, min);
  const chosen: typeof scored = [];
  const take = (p: (typeof scored)[number]) => {
    if (!chosen.includes(p)) chosen.push(p);
  };

  // Depth first: the page with the most of each repeated card kind.
  const hooks = new Map<string, number>();
  for (const p of scored) p.f.counts.forEach((n, h) => { if (n >= 2) hooks.set(h, Math.max(hooks.get(h) ?? 0, n)); });
  const deepest = [...hooks.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([h]) => scored.reduce((best, p) => ((p.f.counts.get(h) ?? 0) > (best.f.counts.get(h) ?? 0) ? p : best), scored[0]));
  // One page usually holds the most of several kinds, so this stays small.
  for (const p of deepest) {
    if (chosen.length >= max) break;
    take(p);
  }

  // Then coverage: pages adding kinds nothing chosen has yet.
  const covered = new Set<string>();
  chosen.forEach((p) => p.f.set.forEach((x) => covered.add(x)));
  const rest = scored.filter((p) => !chosen.includes(p));
  while (chosen.length < max && rest.length) {
    let best = 0;
    let bestGain = -1;
    let bestScore = -1;
    rest.forEach((p, i) => {
      let gain = 0;
      let styling = 0;
      p.f.set.forEach((x) => {
        if (covered.has(x)) return;
        if (x.startsWith("c:")) styling++;
        else gain++;
      });
      const score = gain * 1000 + styling + p.f.text / 1000;
      if (score > bestScore) { bestScore = score; bestGain = gain; best = i; }
    });
    if (chosen.length >= min && bestGain < 3) break;
    const [pick] = rest.splice(best, 1);
    pick.f.set.forEach((x) => covered.add(x));
    take(pick);
  }
  return chosen.map(({ url, html }) => ({ url, html }));
}

/**
 * Open item pages and list everything they offer. The first row's page is
 * often a sparse one (no team, no description), and a section only some items
 * have (a team) may sit on one page in six. So up to 40 pages are fetched
 * cheaply, up to 12 are analysed (the richest of each card kind, then the
 * widest coverage), and their fields are merged.
 */
export async function sampleItemPage(urls: string[], cookie?: string): Promise<ItemCatalogue> {
  const deadline = Date.now() + 75_000; // the route has 300 s; leave room for naming and the reply
  // Page weight varies hugely (an exhibitor profile is ~200 KB, a Wikipedia
  // article 2.4 MB). Budget bytes, not just page counts, or 40 heavy pages
  // exhaust memory and take the process down.
  const PAGE_CAP = 3_000_000;
  const FETCH_BUDGET = 30_000_000;
  let bytes = 0;
  const queue = urls.slice(0, 40);
  const fetched: Array<{ url: string; html: string }> = [];
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (queue.length && Date.now() < deadline - 40_000 && bytes < FETCH_BUDGET) {
      const u = queue.shift()!;
      const r = await fetchHtml(u, cookie, 10_000).catch(() => null);
      bytes += r?.html.length ?? 0;
      const html = r?.status === 200 && r.html.length <= PAGE_CAP ? prepareItemHtml(r.html, r.finalUrl || u) : "";
      fetched.push({ url: u, html });
    }
  }));
  // Whole-article pages (a 2.4 MB encyclopedia entry per row) cost far more to
  // lay out than they are worth, and rows on such pages are rarely what anyone
  // wants in a spreadsheet. Say so instead of grinding through them.
  const PAGE_LIMIT = 800_000;
  const usable = fetched.filter((f) => f.html && f.html.length <= PAGE_LIMIT);
  if (!usable.length) {
    const sizes = fetched.map((f) => f.html.length).filter(Boolean).sort((x, y) => x - y);
    const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
    throw new HeavyPagesError(
      median
        ? `Each item's page is a whole document (about ${Math.round(median / 100_000) / 10} MB), too heavy to read for every row. The rows above still export.`
        : "None of the item pages could be read. The rows above still export.",
    );
  }

  // Laying out a page costs time and memory in proportion to its size, so cap
  // the analysed set by weight as well as by count.
  const ANALYSE_BUDGET = 4_000_000;
  let spent = 0;
  const chosen = diverse(usable, 4, 12).filter((c, i) => {
    spent += c.html.length;
    return i < 3 || spent <= ANALYSE_BUDGET;
  });
  if (process.env.SS_DEBUG) console.log("[sample] fetched", fetched.filter((f) => f.html).length, "| team pages fetched:", fetched.filter((f) => f.html.includes('data-testid="teamMember"')).map((f) => f.url.split("/").pop()).join(","), "| chosen:", chosen.map((c) => c.url.split("/").pop()).join(","));

  type Found = { lists: EngineList[]; singles: EngineSingle[] };
  const useful = (f: Found | null) => !!f && (f.lists.some((l) => !l.chrome && l.columns.length > 0) || f.singles.length >= 3);
  const pages: Array<{ url: string; html: string; found: Found; title: string }> = [];
  const browser = await launch();
  try {
    for (const c of chosen) {
      if (Date.now() > deadline && pages.length) break;
      const page = await openPage(browser, c.url, cookie);
      try {
        // Detect on the plain HTML first, laid out with its stylesheets but no
        // scripts: selectors found there work for the fast no-browser reader
        // by construction. Only an empty shell falls back to the live page.
        let found: Found | null = null;
        if (c.html) {
          const inert = sanitizeStatic(c.html, c.url).replace(/<head(\s[^>]*)?>/i, (m) => `${m}<base href="${c.url.replace(/"/g, "&quot;")}">`);
          await page.setContent(inert, { waitUntil: "load", timeout: 12_000 }).catch(() => undefined);
          await within(page.addScriptTag({ content: extractorJs() }).then(() => undefined), 5_000, undefined);
          found = await within(page.evaluate("window.__ss ? (window.__SS_LAX__ = true, window.__ss.detectItemPage()) : null") as Promise<Found | null>, 15_000, null);
          if (!useful(found)) found = null;
        }
        if (!found) {
          await page.goto(c.url, { waitUntil: "domcontentloaded", timeout: 35_000 });
          await page.waitForNetworkIdle({ idleTime: 800, timeout: 9_000 }).catch(() => undefined);
          await nudge(page, 2);
          await page.addScriptTag({ content: extractorJs() });
          found = (await page.evaluate("window.__ss.detectItemPage()")) as Found;
        }
        pages.push({ url: c.url, html: c.html, found, title: await page.title().catch(() => "") });
      } catch {
        /* one sample failing is fine as long as another works */
      } finally {
        await page.close().catch(() => undefined);
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
  if (!pages.length) throw new Error("The item pages couldn't be opened.");

  // Merge: lists match across pages by their selector, fields by selector + attribute.
  const MAX_FIELDS = 600;   // while merging: a long article yields thousands
  const OFFER_LIMIT = 80;   // what a person can actually look through
  const listIds = new Map<string, string>();
  const lists: ItemList[] = [];
  const people = new Set<string>();
  const fields = new Map<string, ItemField & { hits: number; from: string; values: string[] }>();
  for (const pg of pages) {
    for (const l of pg.found.lists.slice(0, 30)) {
      if (l.chrome) continue;
      const cols = l.columns.filter((c) => c.values.some(Boolean) && !JUNK_TEXT.test(c.values.find(Boolean) ?? ""));
      if (!cols.length) continue;
      let id = listIds.get(l.itemSelector);
      if (!id) {
        id = `L${listIds.size + 1}`;
        listIds.set(l.itemSelector, id);
        lists.push({ id, name: l.name, itemSelector: l.itemSelector, count: l.count });
      } else {
        const known = lists.find((x) => x.id === id)!;
        known.count = Math.max(known.count, l.count);
      }
      if (l.people) people.add(id);
      for (const c of cols) {
        const key = `${id}|${c.key}`;
        const f = fields.get(key);
        if (!f && fields.size >= MAX_FIELDS) continue;
        const joined = c.values.join("\u0001");
        if (f) {
          f.hits++;
          f.values.push(joined);
        } else fields.set(key, { key, sel: c.sel, attr: c.attr, multi: c.multi, listId: id, name: c.name,
          sample: c.values.find(Boolean) ?? "", staticOK: false, suggested: c.attr === "own" || c.attr === "text", hits: 1, from: pg.url, values: [joined] });
      }
    }
    for (const sg of pg.found.singles) {
      if (JUNK_TEXT.test(sg.value)) continue;
      const f = fields.get(sg.key);
      if (!f && fields.size >= MAX_FIELDS) continue;
      if (f) {
        f.hits++;
        f.values.push(sg.value);
      } else fields.set(sg.key, { key: sg.key, sel: sg.sel, attr: sg.attr, name: sg.name, sample: sg.value, staticOK: false, suggested: true, hits: 1, from: pg.url, values: [sg.value] });
    }
  }

  // A "list" that never shows more than one entry is just a section, unless
  // it holds people (a team of one is still where the contact is).
  for (const l of lists) {
    if (l.count < 2 && !people.has(l.id)) for (const [k, f] of fields) if (f.listId === l.id) fields.delete(k);
  }

  // Identical on two different items' pages means site furniture (footer,
  // menus, fixed headings), not information about the item: drop it.
  for (const [key, f] of fields) {
    if (f.values.length > 1 && f.values.every((v) => v === f.values[0])) fields.delete(key);
  }

  // Readable from plain HTML? Check each field against the page it was seen on.
  const all = [...fields.values()];
  const spec: ItemSpec = { lists: lists.map((l) => ({ id: l.id, itemSelector: l.itemSelector })), fields: all, mode: "static" };
  const staticRead = new Map(pages.filter((pg) => pg.html).map((pg) => [pg.url, extractStatic(pg.html, pg.url, spec)]));
  for (const f of all) {
    const r = staticRead.get(f.from);
    // For a list, any entry may be the one the sample came from.
    f.staticOK = f.listId
      ? !!r?.lists?.[f.listId]?.some((row) => !!row[f.key] && norm(row[f.key]) === norm(f.sample))
      : !!r?.values?.[f.key] && norm(r.values[f.key]) === norm(f.sample);
    // A single field seen on only one of several pages is usually page-specific noise.
    if (!f.listId && pages.length >= 3 && f.hits < 2) f.suggested = false;
  }

  const title = pages[0].title;
  const named = await nameFields(title, all.map((f) => ({ key: f.key, current: f.name, samples: [f.sample] })));
  if (named) {
    for (const f of all) {
      const n = named[f.key];
      if (n) {
        f.name = n.label;
        if (!n.keep) f.suggested = false;
      }
    }
  }

  // Lists first (they are usually why item pages matter), then the rest.
  const rank = (f: ItemField) => (f.listId ? (people.has(f.listId) ? 0 : 2) : 1);
  const ordered = all
    .sort((x, y) => rank(x) - rank(y) || Number(y.suggested) - Number(x.suggested) || y.hits - x.hits)
    .slice(0, OFFER_LIMIT);
  const readable = ordered.filter((f) => f.suggested);
  const staticShare = readable.length ? readable.filter((f) => f.staticOK).length / readable.length : 1;
  return {
    sampleUrl: pages[0].url,
    title,
    lists: lists.filter((l) => ordered.some((f) => f.listId === l.id)).map((l) => ({ ...l, people: people.has(l.id) }))
      .sort((a, b) => Number(!!b.people) - Number(!!a.people)),
    fields: ordered.map(({ hits: _h, from: _f, values: _v, ...f }) => f),
    mode: staticShare >= 0.6 ? "static" : "browser",
  };
}

/* ------------------------------------------------------------ bulk reading */

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

async function readOneStatic(url: string, spec: ItemSpec, cookie?: string): Promise<ItemResult> {
  for (let attempt = 0; ; attempt++) {
    let status = 0;
    try {
      const r = await fetchHtml(url, cookie, 20_000);
      status = r.status;
      if (r.status === 200 && r.html) return { url, ok: true, ...extractStatic(r.html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ""), r.finalUrl || url, spec) };
    } catch {
      /* network error: retry */
    }
    if (attempt >= 2 || (status && !RETRYABLE.has(status))) {
      return { url, ok: false, error: status ? `answered ${status}` : "did not respond" };
    }
    await new Promise((res) => setTimeout(res, 1000 * 3 ** attempt));
  }
}

/** Read many item pages; stops at the deadline and reports what's left. */
export async function readItems(
  urls: string[],
  spec: ItemSpec,
  opts: { cookie?: (url: string) => string | undefined; deadline: number; concurrency?: number; onResult: (r: ItemResult) => void },
): Promise<string[]> {
  const queue = [...urls];
  if (spec.mode === "browser") {
    const browser = await launch();
    try {
      while (queue.length && Date.now() < opts.deadline) {
        const url = queue.shift()!;
        try {
          const page = await openPage(browser, url, opts.cookie?.(url));
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
          await page.waitForNetworkIdle({ idleTime: 700, timeout: 8_000 }).catch(() => undefined);
          const html = await page.content();
          await page.close().catch(() => undefined);
          opts.onResult({ url, ok: true, ...extractStatic(html, url, spec) });
        } catch (e) {
          opts.onResult({ url, ok: false, error: e instanceof Error ? e.message.split("\n")[0] : "failed" });
        }
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
    return queue;
  }

  const workers = Array.from({ length: Math.min(opts.concurrency ?? 6, queue.length) }, async () => {
    while (queue.length && Date.now() < opts.deadline) {
      const url = queue.shift()!;
      opts.onResult(await readOneStatic(url, spec, opts.cookie?.(url)));
    }
  });
  await Promise.all(workers);
  return queue;
}

/* ------------------------------------------------------------ self-check */

export function selfCheck(): string {
  const html = `<html><body><h1>Acme GmbH</h1>
    <div data-testid="country">Germany</div>
    <div class="team"><div class="m"><b>Anna Roth</b><i>CEO</i></div><div class="m"><b>Ben Kurz</b><i>CTO</i></div></div>
    <a href="mailto:hi@acme.test">mail</a></body></html>`;
  const spec: ItemSpec = {
    mode: "static",
    lists: [{ id: "l1", itemSelector: "body > div.team > div.m" }],
    fields: [
      { key: "h", sel: "body > h1", attr: "text" },
      { key: "c", sel: '[data-testid="country"]', attr: "own" },
      { key: "e", sel: "body > a", attr: "href" },
      { key: "n", sel: "b", attr: "own", listId: "l1" },
      { key: "d", sel: "i", attr: "own", listId: "l1" },
    ],
  };
  const r = extractStatic(html, "https://acme.test/x", spec);
  if (r.values?.h !== "Acme GmbH" || r.values?.c !== "Germany") throw new Error(`singles wrong ${JSON.stringify(r.values)}`);
  if (r.values?.e !== "hi@acme.test") throw new Error("mailto not stripped");
  if (r.lists?.l1?.length !== 2 || r.lists.l1[1].n !== "Ben Kurz" || r.lists.l1[1].d !== "CTO") throw new Error(`list wrong ${JSON.stringify(r.lists)}`);
  const table = extractStatic("<html><body><table><tr><th>UPC</th><td>abc123</td></tr></table></body></html>", "https://a.test/", {
    mode: "static", lists: [], fields: [{ key: "u", sel: "body > table > tbody > tr > td", attr: "text" }],
  });
  if (table.values?.u !== "abc123") throw new Error(`tbody fallback failed: ${JSON.stringify(table.values)}`);
  const pats = candidatePatterns("https://e.test", ["/api/v1/search/exhibitors", "/en/marketplace/exhibitors"]);
  if (pats[0] !== "https://e.test/exhibitor/{v}") throw new Error(`pattern order wrong: ${pats[0]}`);
  if (!pats.includes("https://e.test/en/exhibitor/{v}")) throw new Error("locale pattern missing");
  return "items ok";
}
