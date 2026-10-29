/**
 * The client's working model: lists found on the page, the columns the user
 * has inked, and how rows are assembled for each capture scope.
 */
import { alignRows, correlate, norm, type DomList, type Match } from "./correlate";
import { humanizeKey } from "./records";

export const INKS = ["#f7e733", "#ff6fae", "#7ded6f", "#62ccff", "#ffab4a", "#c79bff", "#5ff2d4", "#ff8a7a"];

export interface PageColumn { key: string; sel: string; attr: string; multi?: boolean; name: string; values: string[]; fill: number }
export interface PageList { id: string; name: string; count: number; itemSelector: string; columns: PageColumn[]; score: number; manual: boolean; chrome?: boolean; nav?: boolean }
export interface DirectoryLink { label: string; url: string }

export interface FeedField { key: string; label: string; sample: string; fill: number; plumbing: boolean }
export interface Feed {
  id: string; token: string; endpoint: string; jsonPath: string;
  rows: Array<Record<string, unknown>>; total: number | null; paginated: boolean; fields: FeedField[]; ai?: boolean;
}

export interface Column {
  id: string;
  name: string;
  ink: string;
  on: boolean;
  /** Where it sits on the page, if it is visible there. */
  page?: { key: string; sel: string; attr: string; multi?: boolean };
  /** The matching field in the site's data feed, if one was found. */
  feedKey?: string;
  /** Read from each item's own page (see lib/items.ts). */
  item?: { key: string; sel: string; attr: string; multi?: boolean; listId?: string };
  sample: string;
}

/** Where each row's own page is. */
export interface ItemSource {
  columnKey?: string; // a link column on the page list
  key?: string;       // a field in the feed ...
  pattern?: string;   // ... placed into this address ("{v}" alone: the field is the address)
}

export interface ItemCatalogueList { id: string; name: string; itemSelector: string; count: number; people?: boolean }
export interface ItemCatalogueField {
  key: string; sel: string; attr: string; multi?: boolean; listId?: string;
  name: string; sample: string; staticOK: boolean; suggested: boolean;
}
export interface ItemCatalogue {
  sampleUrl: string; title: string; lists: ItemCatalogueList[]; fields: ItemCatalogueField[]; mode: "static" | "browser";
}

export interface ItemsInfo {
  status: "looking" | "ready" | "none" | "error";
  message?: string;
  source?: ItemSource;
  catalogue?: ItemCatalogue;
}

export interface Workspace {
  listId: string;
  columns: Column[];
  match: Match | null;
  feedId: string | null;
  items?: ItemsInfo;
}

const GENERIC = /^(text|title|link|image|number)( \d+)?$/i;
const NAV_WORDS = /^(home|visit|visitors?|exhibit|exhibitors?|press|news|media|about|about us|contact|contact us|login|log in|sign in|register|search|events?|programme|program|calendar|tickets?|tickets?\s*&\s*prices?|prices?|pricing|services?|faq|help|imprint|impressum|privacy|privacy policy|terms|careers?|jobs?|blog|shop|store|partners?|de|en|fr|es|besuchen|ausstellen|aussteller|presse|kontakt|über uns|anmelden|tickets?\s*&\s*preise|hallenplan|service|agb|datenschutz)$/i;
const DIR_TEXT = /\b(open|go to|view|search|browse|explore|show|see|find|launch|to the|zum|zur)\s+(the\s+)?(exhibitor|company|vendor|publisher|member|participant|speaker)s?\s*(directory|list|search|catalogue|catalog|database|marketplace|finder|overview|verzeichnis|suche|liste|katalog)?\b|\b(exhibitor|company|vendor|publisher|member|participant)\s+(directory|search|database|catalogue|catalog|marketplace|finder)\b|\b(ausstellerverzeichnis|ausstellersuche|ausstellerkatalog|firmenverzeichnis)\b/i;
const DIR_HREF = /\/(marketplace\/)?(exhibitors?|exhibitor-directory|exhibitor-search|company-directory|companies)(\/|\?|$)/i;

/** Whether a detected list looks like site navigation (menus, headers, footers) rather than a company/data list. */
export function looksLikeNavigation(list: PageList | undefined): boolean {
  if (!list) return false;
  if (list.nav || list.chrome) return true;
  if (/\b(nav|menu|header|footer|breadcrumb)\b/i.test(list.itemSelector)) return true;
  const cols = list.columns;
  if (!cols.length || cols.length > 2) return false;
  const textCols = cols.filter((c) => c.attr === "own" || c.attr === "text");
  const linkCols = cols.filter((c) => c.attr === "href");
  if (textCols.length !== 1 || textCols.length + linkCols.length !== cols.length) return false;
  const vals = textCols[0].values.map((v) => v.trim()).filter(Boolean);
  if (!vals.length) return false;
  const avg = vals.reduce((a, v) => a + v.length, 0) / vals.length;
  const navHits = vals.filter((v) => NAV_WORDS.test(v)).length;
  return avg <= 26 && vals.every((v) => v.length <= 55) && (navHits >= Math.max(2, Math.ceil(vals.length * 0.3)) || (linkCols.length === 1 && avg <= 18));
}

/** Detect links on a landing page (such as "Open exhibitor directory") that lead to the actual directory. */
export function findDirectoryLinksInHtml(html: string, baseUrl: string): DirectoryLink[] {
  if (!html) return [];
  const here = baseUrl.split("#")[0];
  const out: Array<DirectoryLink & { priority: number }> = [];
  const seen = new Set<string>();
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const hrefMatch = attrs.match(/\bhref=["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    const rawHref = hrefMatch[1].trim();
    if (!rawHref || /^(#|javascript:|mailto:|tel:)/i.test(rawHref)) continue;
    let url = "";
    try {
      url = new URL(rawHref, baseUrl).href;
    } catch {
      continue;
    }
    if (!/^https?:/i.test(url) || url.split("#")[0] === here || seen.has(url)) continue;
    const titleAttr = attrs.match(/\b(?:title|aria-label)=["']([^"']+)["']/i)?.[1] ?? "";
    const innerText = m[2].replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/[→›»>←‹«<]+/g, " ").replace(/\s+/g, " ").trim();
    const text = innerText || titleAttr.trim();
    const textHit = DIR_TEXT.test(text);
    const hrefHit = DIR_HREF.test(url);
    if (!textHit && !hrefHit) continue;
    seen.add(url);
    const label = text && text.length <= 70 ? text : "Open exhibitor directory";
    out.push({ label, url, priority: textHit ? 2 : 1 });
  }
  return out.sort((a, b) => b.priority - a.priority).slice(0, 4).map(({ label, url }) => ({ label, url }));
}

/** A name for a column: what the page calls it, unless the feed knows better. */
function bestName(pageName: string | undefined, feedKey: string | undefined): string {
  const fromFeed = feedKey ? humanizeKey(feedKey) : "";
  if (!pageName) return fromFeed || "Column";
  // "Company 2" is the page's guess repeated; the site's own field name ("Country") knows better.
  if (fromFeed && (GENERIC.test(pageName) || /\s\d+$/.test(pageName))) return fromFeed;
  return pageName;
}

export function uniqueNames(cols: Column[]) {
  const seen = new Map<string, number>();
  for (const c of cols) {
    const n = seen.get(c.name.toLowerCase()) ?? 0;
    seen.set(c.name.toLowerCase(), n + 1);
    if (n) c.name = `${c.name} ${n + 1}`;
  }
}

export function nextInk(cols: Column[]): string {
  const used = new Set(cols.map((c) => c.ink));
  return INKS.find((i) => !used.has(i)) ?? INKS[cols.length % INKS.length];
}

function domList(list: PageList): DomList {
  return { id: list.id, count: list.count, columns: list.columns.map((c) => ({ key: c.key, name: c.name, attr: c.attr, values: c.values })) };
}

/** First look at a list: ink the useful columns, name them, join them to a feed. */
export function openWorkspace(list: PageList, feeds: Feed[]): Workspace {
  const match = correlate(domList(list), feeds);
  const byKey = new Map(match?.pairs.map((p) => [p.columnKey, p.apiKey]) ?? []);
  const cols: Column[] = [];
  list.columns.forEach((c, i) => {
    const feedKey = byKey.get(c.key);
    // Well-filled text columns start inked; links and images wait to be asked for,
    // unless the list has little else.
    const useful = c.fill >= 0.5 && (c.attr === "own" || c.attr === "text" || list.columns.length <= 3);
    cols.push({
      id: `c${i}-${c.key}`,
      name: bestName(c.name, feedKey),
      ink: "",
      on: useful && cols.filter((x) => x.on).length < 6,
      page: { key: c.key, sel: c.sel, attr: c.attr, multi: c.multi },
      feedKey,
      sample: c.values.find(Boolean) ?? "",
    });
  });
  if (!cols.some((c) => c.on) && cols[0]) cols[0].on = true;
  uniqueNames(cols);
  cols.forEach((c, i) => (c.ink = INKS[i % INKS.length]));
  return { listId: list.id, columns: cols, match, feedId: match?.apiId ?? null };
}

/** Addresses, images, blobs, constants and repeats are rarely wanted by default. */
function wantedByDefault(f: FeedField, feed: Feed): boolean {
  if (f.plumbing || f.fill < 0.5) return false;
  if (/^(https?:)?\/\//i.test(f.sample) || /\.(png|jpe?g|gif|svg|webp)(\?|$)/i.test(f.sample)) return false;
  if (f.sample.length > 180) return false;
  const cell = (k: string, r: Record<string, unknown>) => String(r[k] ?? "").trim().replace(/^["']|["']$/g, "").toLowerCase();
  // The same value on every row (a role, a counter) tells the reader nothing.
  if (feed.rows.length >= 3 && new Set(feed.rows.map((r) => cell(f.key, r))).size < 2) return false;
  // A field repeating another field's values (Stand name beside Stand) adds nothing.
  const vals = (k: string) => feed.rows.map((r) => cell(k, r)).join("\u0001");
  const mine = vals(f.key);
  return !feed.fields.some((o) => o.key !== f.key && o.key.length < f.key.length && vals(o.key) === mine);
}

/** A dataset that exists only in a feed (nothing on screen matched it). */
export function openFeedWorkspace(feed: Feed): Workspace {
  const fields = feed.fields.filter((f) => !f.plumbing && f.fill > 0.2);
  let budget = 8;
  const cols: Column[] = fields.map((f, i) => {
    const on = budget > 0 && wantedByDefault(f, feed);
    if (on) budget--;
    return { id: `f-${f.key}`, name: f.label, ink: INKS[i % INKS.length], on, feedKey: f.key, sample: f.sample };
  });
  if (!cols.some((c) => c.on) && cols[0]) cols[0].on = true;
  uniqueNames(cols);
  return { listId: `feed:${feed.id}`, columns: cols, match: null, feedId: feed.id };
}

/** Add a column the user clicked, or re-ink one they had turned off. */
export function addPageColumn(ws: Workspace, list: PageList, col: PageColumn, feeds: Feed[]): Workspace {
  const existing = ws.columns.find((c) => c.page?.key === col.key);
  if (existing) return { ...ws, columns: ws.columns.map((c) => (c === existing ? { ...c, on: true } : c)) };
  const lists = { ...list, columns: [...list.columns.filter((c) => c.key !== col.key), col] };
  const match = correlate(domList(lists), feeds) ?? ws.match;
  const feedKey = match?.pairs.find((p) => p.columnKey === col.key)?.apiKey;
  const next: Column = {
    id: `c${Date.now()}-${col.key}`, name: bestName(col.name, feedKey), ink: nextInk(ws.columns), on: true,
    page: { key: col.key, sel: col.sel, attr: col.attr, multi: col.multi }, feedKey, sample: col.values.find(Boolean) ?? "",
  };
  const columns = [...ws.columns, next];
  uniqueNames(columns);
  return { ...ws, columns, match, feedId: match?.apiId ?? ws.feedId };
}

export function addFeedColumn(ws: Workspace, field: FeedField): Workspace {
  if (ws.columns.some((c) => c.feedKey === field.key && !c.page)) {
    return { ...ws, columns: ws.columns.map((c) => (c.feedKey === field.key ? { ...c, on: true } : c)) };
  }
  const columns = [...ws.columns, { id: `f-${field.key}`, name: field.label, ink: nextInk(ws.columns), on: true, feedKey: field.key, sample: field.sample }];
  uniqueNames(columns);
  return { ...ws, columns };
}

/** Feed fields not already a column, worth offering: "also in the site's data". */
export function extraFields(ws: Workspace, feed: Feed | undefined): FeedField[] {
  if (!feed) return [];
  const used = new Set(ws.columns.map((c) => c.feedKey).filter(Boolean));
  return feed.fields.filter((f) => !used.has(f.key) && f.fill > 0.15 && f.sample);
}

export type Row = Record<string, unknown>;

/** Feed values sometimes carry HTML ("<p><strong>11x17</strong> is…"); a spreadsheet wants the words. */
export function plain(v: unknown): unknown {
  if (typeof v !== "string" || !/<[a-z/][^>]*>/i.test(v)) return v;
  return v
    .replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

/** Rows for what is on screen right now. */
export function pageRows(ws: Workspace, list: PageList | undefined, feed: Feed | undefined): Row[] {
  const on = ws.columns.filter((c) => c.on);
  if (!list) {
    return (feed?.rows ?? []).map((r) => Object.fromEntries(on.map((c) => [c.name, c.feedKey ? plain(r[c.feedKey]) ?? "" : ""])));
  }
  const byKey = new Map(list.columns.map((c) => [c.key, c.values]));
  // feed row index -> page row index, so feed-only columns can fill on-screen rows
  const feedRowFor = new Map<number, number>();
  if (feed && ws.match) for (const [f, p] of alignRows(domList(list), feed, ws.match)) feedRowFor.set(p, f);
  const rows: Row[] = [];
  for (let i = 0; i < list.count; i++) {
    const fr = feedRowFor.get(i);
    rows.push(Object.fromEntries(on.map((c) => {
      if (c.page) return [c.name, byKey.get(c.page.key)?.[i] ?? ""];
      return [c.name, fr != null && c.feedKey ? plain(feed!.rows[fr][c.feedKey]) ?? "" : ""];
    })));
  }
  return rows;
}

/**
 * An ad slot or placeholder inside a list has nothing in any chosen page
 * column. Filter after pairing rows with anything matched by position.
 */
export function hasPageContent(ws: Workspace): (r: Row) => boolean {
  const pageCols = ws.columns.filter((c) => c.on && c.page);
  return (r) => !pageCols.length || pageCols.some((c) => r[c.name] !== "" && r[c.name] != null);
}

/** Non-empty rows on the current page: single source of truth for preview, scope, button, and toast counts. */
export function visiblePageRows(ws: Workspace, list: PageList | undefined, feed: Feed | undefined): Row[] {
  return pageRows(ws, list, feed).filter(hasPageContent(ws));
}

/** Canonical on-page row count for a list, accounting for filtered empty slots. */
export function listRowCount(list: PageList, ws?: Workspace, feed?: Feed): number {
  if (ws) return visiblePageRows(ws, list, feed).length;
  const textCols = list.columns.filter((c) => c.fill >= 0.5 && (c.attr === "own" || c.attr === "text" || list.columns.length <= 3));
  const check = textCols.length ? textCols : list.columns;
  if (!check.length) return list.count;
  let count = 0;
  for (let i = 0; i < list.count; i++) {
    if (check.some((c) => c.values[i] != null && String(c.values[i]).trim() !== "")) count++;
  }
  return count;
}

/**
 * Rows for every page, from fetched feed rows. Columns seen only on the page
 * are joined back through the anchor column where the row was on screen.
 */
export function feedRows(ws: Workspace, list: PageList | undefined, fetched: Row[]): Row[] {
  const on = ws.columns.filter((c) => c.on);
  const anchor = ws.match ? [...ws.match.pairs].sort((a, b) => b.score - a.score)[0] : null;
  const pageIndex = new Map<string, number>();
  if (list && anchor) {
    const vals = list.columns.find((c) => c.key === anchor.columnKey)?.values ?? [];
    vals.forEach((v, i) => pageIndex.set(norm(v), i));
  }
  const byKey = new Map(list?.columns.map((c) => [c.key, c.values]) ?? []);
  return fetched.map((r) => {
    const pi = anchor ? pageIndex.get(norm(r[anchor.apiKey])) : undefined;
    return Object.fromEntries(on.map((c) => {
      if (c.feedKey) return [c.name, plain(r[c.feedKey]) ?? ""];
      if (c.page && pi != null) return [c.name, byKey.get(c.page.key)?.[pi] ?? ""];
      return [c.name, ""];
    }));
  });
}

/** Columns that cannot be filled beyond the rows on screen in feed mode. */
export function pageOnly(ws: Workspace): Column[] {
  return ws.columns.filter((c) => c.on && c.page && !c.feedKey);
}

/** What a feed dataset should be called when nothing on screen names it. */
export function feedTitle(feed: Feed): string {
  const segs = [...feed.jsonPath.split("."), ...feed.endpoint.split(/[\s/]/)].filter((s) => s && !/^\d+$/.test(s) && !/^(data|list|items|results|api|v\d+|get|post|search|output|records|rows)$/i.test(s) && !s.includes("."));
  const last = segs[segs.length - 1] ?? "data";
  return humanizeKey(last);
}

export function selfCheck(): string {
  const list: PageList = {
    id: "l1", name: "Quotes", count: 2, itemSelector: "div.quote", score: 1, manual: false,
    columns: [
      { key: "span.text@own", sel: "span.text", attr: "own", name: "Text", values: ["“A”", "“B”"], fill: 1 },
      { key: "small.author@own", sel: "small.author", attr: "own", name: "Name", values: ["Albert Einstein", "J.K. Rowling"], fill: 1 },
      { key: "a@href", sel: "a", attr: "href", name: "Link", values: ["https://q.test/author/Albert-Einstein", "https://q.test/author/J-K-Rowling"], fill: 1 },
    ],
  };
  const feed: Feed = {
    id: "api1", token: "t", endpoint: "GET quotes.toscrape.com/api/quotes", jsonPath: "quotes", total: null, paginated: true,
    rows: [{ text: "“A”", "author.name": "Albert Einstein", "author.slug": "Albert-Einstein", tags: "x" }, { text: "“B”", "author.name": "J.K. Rowling", "author.slug": "J-K-Rowling", tags: "y" }],
    fields: [{ key: "tags", label: "Tags", sample: "x", fill: 1, plumbing: false }],
  };
  const ws = openWorkspace(list, [feed]);
  if (ws.feedId !== "api1") throw new Error("feed not matched");
  const text = ws.columns.find((c) => c.page?.key === "span.text@own")!;
  if (bestName("Company 2", "country") !== "Country") throw new Error("numbered page name should yield to feed name");
  if (text.name !== "Text" || text.feedKey !== "text") throw new Error(`text column wrong: ${text.name}/${text.feedKey}`);
  const withTags = addFeedColumn(ws, feed.fields[0]);
  const rows = feedRows(withTags, list, feed.rows);
  if (rows[1]["Tags"] !== "y" || rows[0]["Name"] !== "Albert Einstein") throw new Error("feed rows wrong");
  const pr = pageRows(withTags, list, feed);
  if (pr[0]["Tags"] !== "x") throw new Error("page rows did not join feed-only column");
  if (feedTitle(feed) !== "Quotes") throw new Error(`feedTitle wrong: ${feedTitle(feed)}`);

  // Row count consistency: 4 DOM items where 1 is an empty placeholder must count as 3 everywhere.
  const paddedList: PageList = {
    id: "l-pad", name: "Exhibitors", count: 4, itemSelector: "div.card", score: 1, manual: false,
    columns: [
      { key: "h3@own", sel: "h3", attr: "own", name: "Company", values: ["Alpha", "Beta", "Gamma", ""], fill: 0.75 },
    ],
  };
  const paddedWs = openWorkspace(paddedList, []);
  if (visiblePageRows(paddedWs, paddedList, undefined).length !== 3) throw new Error("visiblePageRows should exclude empty 4th slot");
  if (listRowCount(paddedList, paddedWs) !== 3 || listRowCount(paddedList) !== 3) throw new Error("listRowCount should match visiblePageRows (3)");

  // Navigation list & directory link detection.
  const navList: PageList = {
    id: "l-nav", name: "Navigation", count: 4, itemSelector: "header > ul > li", score: 1, manual: false,
    columns: [
      { key: "a@own", sel: "a", attr: "own", name: "Title", values: ["Visit", "Exhibit", "Press", "Contact"], fill: 1 },
      { key: "a@href", sel: "a", attr: "href", name: "Link", values: ["https://b.test/visit", "https://b.test/exhibit", "https://b.test/press", "https://b.test/contact"], fill: 1 },
    ],
  };
  if (!looksLikeNavigation(navList)) throw new Error("navList should be flagged as navigation");
  if (looksLikeNavigation(list)) throw new Error("quotes list should not be flagged as navigation");
  const dirLinks = findDirectoryLinksInHtml(
    `<html><body><a href="https://event.buchmesse.de/en/marketplace/exhibitors">Open exhibitor directory</a></body></html>`,
    "https://www.buchmesse.de/en/visit/exhibitor-directory",
  );
  if (dirLinks.length !== 1 || dirLinks[0].label !== "Open exhibitor directory") throw new Error(`directory links wrong: ${JSON.stringify(dirLinks)}`);

  const noisy: Feed = {
    id: "api9", token: "t", endpoint: "GET x/y", jsonPath: "l", total: 9, paginated: true,
    rows: [
      { name: "A", logo: "https://x.test/a.png", stand: "C96", stand_name: '"C96"', about: "x".repeat(200), role: "exhibitor" },
      { name: "B", logo: "https://x.test/b.png", stand: "D11", stand_name: '"D11"', about: "y".repeat(200), role: "exhibitor" },
      { name: "C", logo: "https://x.test/c.png", stand: "E22", stand_name: '"E22"', about: "z".repeat(200), role: "exhibitor" },
    ],
    fields: [
      { key: "name", label: "Name", sample: "A", fill: 1, plumbing: false },
      { key: "logo", label: "Logo", sample: "https://x.test/a.png", fill: 1, plumbing: false },
      { key: "stand", label: "Stand", sample: "C96", fill: 1, plumbing: false },
      { key: "stand_name", label: "Stand name", sample: '"C96"', fill: 1, plumbing: false },
      { key: "about", label: "About", sample: "x".repeat(200), fill: 1, plumbing: false },
      { key: "role", label: "Role", sample: "exhibitor", fill: 1, plumbing: false },
    ],
  };
  const fw = openFeedWorkspace(noisy).columns.filter((c) => c.on).map((c) => c.name);
  if (fw.join() !== "Name,Stand") throw new Error(`feed defaults wrong: ${fw.join()}`);
  return "model ok";
}

/** Which feed (if any) backs a list, without opening a workspace for it. */
export function matchList(list: PageList, feeds: Feed[]): Match | null {
  return correlate(domList(list), feeds);
}
