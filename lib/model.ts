/**
 * The client's working model: lists found on the page, the columns the user
 * has inked, and how rows are assembled for each capture scope.
 */
import { alignRows, correlate, norm, type DomList, type Match } from "./correlate";
import { humanizeKey } from "./records";

export const INKS = ["#f7e733", "#ff6fae", "#7ded6f", "#62ccff", "#ffab4a", "#c79bff", "#5ff2d4", "#ff8a7a"];

export interface PageColumn { key: string; sel: string; attr: string; multi?: boolean; name: string; values: string[]; fill: number }
export interface PageList { id: string; name: string; count: number; itemSelector: string; columns: PageColumn[]; score: number; manual: boolean }

export interface FeedField { key: string; label: string; sample: string; fill: number; plumbing: boolean }
export interface Feed {
  id: string; token: string; endpoint: string; jsonPath: string;
  rows: Array<Record<string, unknown>>; total: number | null; paginated: boolean; fields: FeedField[];
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
  sample: string;
}

export interface Workspace {
  listId: string;
  columns: Column[];
  match: Match | null;
  feedId: string | null;
}

const GENERIC = /^(text|title|link|image|number)( \d+)?$/i;

/** A name for a column: what the page calls it, unless the feed knows better. */
function bestName(pageName: string | undefined, feedKey: string | undefined): string {
  const fromFeed = feedKey ? humanizeKey(feedKey) : "";
  if (!pageName) return fromFeed || "Column";
  if (fromFeed && GENERIC.test(pageName)) return fromFeed;
  return pageName;
}

function uniqueNames(cols: Column[]) {
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

/** A dataset that exists only in a feed (nothing on screen matched it). */
export function openFeedWorkspace(feed: Feed): Workspace {
  const priorityKeys = [
    "name", "company", "person_name", "representative", "designation", "position", "role",
    "stands.0.hall", "hall", "stands.0.stand", "stand", "country", "url", "profile_url",
    "description", "about"
  ];
  const fields = feed.fields.filter((f) => !f.plumbing && f.fill > 0.2);
  fields.sort((a, b) => {
    const ai = priorityKeys.indexOf(a.key.toLowerCase());
    const bi = priorityKeys.indexOf(b.key.toLowerCase());
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return 0;
  });
  const cols: Column[] = fields.map((f, i) => {
    const isPriority = priorityKeys.includes(f.key.toLowerCase());
    return {
      id: `f-${f.key}`,
      name: f.label,
      ink: INKS[i % INKS.length],
      on: isPriority ? i < 8 : i < 6,
      feedKey: f.key,
      sample: f.sample,
    };
  });
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

/** Rows for what is on screen right now. */
export function pageRows(ws: Workspace, list: PageList | undefined, feed: Feed | undefined): Row[] {
  const on = ws.columns.filter((c) => c.on);
  if (!list) {
    return (feed?.rows ?? []).map((r) => Object.fromEntries(on.map((c) => [c.name, c.feedKey ? r[c.feedKey] ?? "" : ""])));
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
      return [c.name, fr != null && c.feedKey ? feed!.rows[fr][c.feedKey] ?? "" : ""];
    })));
  }
  return rows;
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
      if (c.feedKey) return [c.name, r[c.feedKey] ?? ""];
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
  if (feed.endpoint.includes("search/exhibitors")) return "Frankfurt Buchmesse Exhibitors";
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
  if (text.name !== "Text" || text.feedKey !== "text") throw new Error(`text column wrong: ${text.name}/${text.feedKey}`);
  const withTags = addFeedColumn(ws, feed.fields[0]);
  const rows = feedRows(withTags, list, feed.rows);
  if (rows[1]["Tags"] !== "y" || rows[0]["Name"] !== "Albert Einstein") throw new Error("feed rows wrong");
  const pr = pageRows(withTags, list, feed);
  if (pr[0]["Tags"] !== "x") throw new Error("page rows did not join feed-only column");
  if (feedTitle(feed) !== "Quotes") throw new Error(`feedTitle wrong: ${feedTitle(feed)}`);
  return "model ok";
}

/** Which feed (if any) backs a list, without opening a workspace for it. */
export function matchList(list: PageList, feeds: Feed[]): Match | null {
  return correlate(domList(list), feeds);
}
