/**
 * Browser-side half of "information from each item's own page":
 * where each row's page is, what to ask the server for, and how the answers
 * join back into rows. Pure functions; tested by selfCheck().
 */
import type { Column, Feed, ItemCatalogue, ItemSource, PageList, Row, Workspace } from "./model";

export interface ItemResult {
  url: string;
  ok: boolean;
  error?: string;
  values?: Record<string, string>;
  lists?: Record<string, Array<Record<string, string>>>;
}

export interface ItemSpec {
  lists: Array<{ id: string; itemSelector: string }>;
  fields: Array<{ key: string; sel: string; attr: string; multi?: boolean; listId?: string }>;
  mode: "static" | "browser";
}

const SLUGISH = /^[\p{L}\p{N}][\p{L}\p{N}._~%-]{1,150}$/u;

function sameSite(a: string, b: string): boolean {
  try {
    const x = new URL(a).hostname.replace(/^www\./, "");
    const y = new URL(b).hostname.replace(/^www\./, "");
    return x === y || x.endsWith("." + y) || y.endsWith("." + x);
  } catch {
    return false;
  }
}

function distinctShare(values: string[]): number {
  const v = values.filter(Boolean);
  return v.length ? new Set(v).size / v.length : 0;
}

/** Put a row's value into an address pattern. */
export function fillPattern(pattern: string, value: unknown): string {
  const v = String(value ?? "");
  if (!v) return "";
  if (pattern === "{v}") return /^https?:\/\//i.test(v) ? v : "";
  return pattern.replace("{v}", encodeURIComponent(v).replace(/%2F/gi, "/"));
}

/** The address pattern that turns `value` into `href`, if `href` contains it. */
export function patternFrom(href: string, value: unknown): string | null {
  const v = String(value ?? "");
  if (!v || v.length < 2 || !SLUGISH.test(v)) return null;
  for (const form of [v, encodeURIComponent(v)]) {
    const i = href.lastIndexOf(form);
    if (i < 0) continue;
    const after = href[i + form.length];
    const before = href[i - 1];
    if ((before === "/" || before === "=") && (after === undefined || after === "/" || after === "?" || after === "#" || after === "&")) {
      return href.slice(0, i) + "{v}" + href.slice(i + form.length);
    }
  }
  return null;
}

/**
 * Work out where each row's page is, without asking the server when possible.
 * Returns null when the server has to discover it (see /api/items/sample).
 */
export function findItemSource(scanUrl: string, list: PageList | undefined, feed: Feed | undefined, ws: Workspace, snapshotHtml: string): ItemSource | null {
  const src: ItemSource = {};

  // 1. A link column on the page whose links go to distinct pages on this site.
  if (list) {
    const links = list.columns
      .filter((c) => c.attr === "href")
      .map((c) => ({ c, share: distinctShare(c.values), same: c.values.filter((v) => v && sameSite(v, scanUrl) && v.split("#")[0] !== scanUrl.split("#")[0]).length / Math.max(1, c.values.filter(Boolean).length) }))
      .filter((x) => x.share >= 0.8 && x.same >= 0.8 && x.c.fill >= 0.5)
      .sort((a, b) => b.c.fill - a.c.fill);
    if (links[0]) {
      src.columnKey = links[0].c.key;
      // With a matched feed, learn the pattern too, so rows beyond the screen get pages.
      const pair = ws.match?.pairs.find((p) => p.columnKey === src.columnKey);
      if (pair && feed) {
        const href = links[0].c.values.find(Boolean)!;
        const row = feed.rows.find((r) => href.includes(String(r[pair.apiKey] ?? "\u0000")));
        const pattern = row ? patternFrom(href, row[pair.apiKey]) : null;
        if (pattern) Object.assign(src, { key: pair.apiKey, pattern });
      }
      return src;
    }
  }

  if (!feed) return null;

  // 2. A feed field that already holds each item's full address.
  const absolute = feed.fields.find((f) => {
    const vals = feed.rows.map((r) => String(r[f.key] ?? "")).filter(Boolean);
    return vals.length >= feed.rows.length * 0.7 && vals.every((v) => /^https?:\/\//i.test(v) && sameSite(v, scanUrl)) && distinctShare(vals) >= 0.9;
  });
  if (absolute) return { key: absolute.key, pattern: "{v}" };

  // 3. A link somewhere on the page that contains one row's slug.
  const hrefs = anchorsIn(snapshotHtml).filter((h) => sameSite(h, scanUrl));
  const slugFields = feed.fields.filter((f) => {
    const vals = feed.rows.slice(0, 20).map((r) => String(r[f.key] ?? ""));
    return vals.filter((v) => SLUGISH.test(v)).length >= vals.length * 0.8 && distinctShare(vals) >= 0.9;
  });
  for (const f of slugFields) {
    for (const r of feed.rows.slice(0, 40)) {
      const v = r[f.key];
      for (const h of hrefs) {
        const pattern = patternFrom(h, v);
        if (pattern) return { key: f.key, pattern };
      }
    }
  }
  return null;
}

function anchorsIn(html: string): string[] {
  if (typeof DOMParser === "undefined" || !html) return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll("a[href]")).map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? "").filter((h) => /^https?:\/\//i.test(h));
}

/** `n` rows spread evenly from first to last: item pages differ a lot along a directory. */
export function spread<T>(rows: T[], n: number): T[] {
  if (rows.length <= n) return rows;
  return Array.from({ length: n }, (_, i) => rows[Math.round((i * (rows.length - 1)) / (n - 1))]);
}

/**
 * Rows from the middle and end of a long feed, not just its first page.
 * Items near the start of an alphabetical directory can all be sparse, and a
 * field that only some items have (a team list) would never be sampled.
 */
export async function widerRows(
  feed: Feed,
  fetchPage: (startIndex: number, maxRows: number) => Promise<Row[]>,
): Promise<Row[]> {
  if (!feed.token || !feed.paginated || !feed.total) return [];
  const size = Math.max(1, feed.rows.length);
  const pages = Math.ceil(feed.total / size);
  if (pages < 3) return [];
  const picks = [...new Set([Math.floor(pages * 0.33), Math.floor(pages * 0.66), pages - 1])];
  const got = await Promise.all(picks.map((i) => fetchPage(i, size).catch(() => [] as Row[])));
  return got.flat();
}

/** What the server needs to find item pages itself. */
export function discoveryRequest(scanUrl: string, feed: Feed, extra: Row[] = []) {
  // The first rows go first: they're the ones used to test address patterns.
  const rows = [...feed.rows.slice(0, 2), ...spread([...feed.rows.slice(2), ...extra], 22)];
  const slugFields = feed.fields.filter((f) => {
    const vals = feed.rows.slice(0, 20).map((r) => String(r[f.key] ?? ""));
    return vals.filter((v) => SLUGISH.test(v)).length >= vals.length * 0.8 && distinctShare(vals) >= 0.9 && !/^\d{1,3}$/.test(vals[0]);
  });
  // The field a person would recognise on the page: usually the first named text field.
  const nameField = feed.fields.find((f) => !f.plumbing && /name|title|company/i.test(f.key + f.label)) ??
    feed.fields.find((f) => !f.plumbing && typeof feed.rows[0]?.[f.key] === "string" && !SLUGISH.test(String(feed.rows[0][f.key])));
  let endpointPath = "";
  try {
    endpointPath = new URL("https://" + feed.endpoint.split(" ").pop()).pathname;
  } catch {
    endpointPath = "";
  }
  return {
    hintPaths: [endpointPath, new URL(scanUrl).pathname],
    candidates: slugFields.slice(0, 4).map((f) => ({ key: f.key, values: rows.map((r) => String(r[f.key] ?? "")) })),
    verify: rows.slice(0, 3).map((r) => (nameField ? String(r[nameField.key] ?? "") : "")),
  };
}

/** A user pasted one item's page address: learn the pattern from it. */
export function sourceFromPastedUrl(url: string, feed: Feed | undefined): ItemSource | null {
  if (!feed) return null;
  for (const f of feed.fields) {
    for (const r of feed.rows) {
      const pattern = patternFrom(url, r[f.key]);
      if (pattern) return { key: f.key, pattern };
    }
  }
  return null;
}

/** The page address for base row `i`. */
export function urlsFor(source: ItemSource | undefined, list: PageList | undefined, raw: Array<Record<string, unknown>>, fromFeed: boolean): Array<string | undefined> {
  if (!source) return raw.map(() => undefined);
  const col = source.columnKey && list ? list.columns.find((c) => c.key === source.columnKey) : undefined;
  return raw.map((r, i) => {
    if (fromFeed && source.key && source.pattern) return fillPattern(source.pattern, r[source.key]) || undefined;
    if (!fromFeed && col) return col.values[i] || undefined;
    if (source.key && source.pattern && r[source.key] != null) return fillPattern(source.pattern, r[source.key]) || undefined;
    if (typeof r["__url"] === "string") return r["__url"] as string;
    return undefined;
  });
}

/** The server request describing which item-page fields to read. */
export function specFor(ws: Workspace): ItemSpec | null {
  const cat: ItemCatalogue | undefined = ws.items?.catalogue;
  const cols = ws.columns.filter((c) => c.on && c.item);
  if (!cat || !cols.length) return null;
  const listIds = [...new Set(cols.map((c) => c.item!.listId).filter(Boolean))] as string[];
  return {
    mode: cat.mode,
    lists: cat.lists.filter((l) => listIds.includes(l.id)).map((l) => ({ id: l.id, itemSelector: l.itemSelector })),
    fields: cols.map((c) => ({ key: c.item!.key, sel: c.item!.sel, attr: c.item!.attr, multi: c.item!.multi, listId: c.item!.listId })),
  };
}

/**
 * Add item-page columns to base rows. When a column comes from a list on the
 * item page (team members), each list entry becomes its own row, with the
 * row's other columns repeated, as in the original Buchmesse spreadsheets.
 */
export function assemble(base: Row[], urls: Array<string | undefined>, columns: Column[], results: Record<string, ItemResult>): Row[] {
  const itemCols = columns.filter((c) => c.on && c.item);
  if (!itemCols.length) return base;
  const expandList = itemCols.find((c) => c.item!.listId)?.item!.listId;
  const out: Row[] = [];
  base.forEach((row, i) => {
    const url = urls[i];
    const res = url ? results[url] : undefined;
    const singles: Row = {};
    for (const c of itemCols) {
      const it = c.item!;
      if (!it.listId) singles[c.name] = res?.values?.[it.key] ?? "";
      else if (it.listId !== expandList) {
        singles[c.name] = (res?.lists?.[it.listId] ?? []).map((m) => m[it.key]).filter(Boolean).join("; ");
      }
    }
    const members = expandList ? res?.lists?.[expandList] ?? [] : [];
    if (!expandList || !members.length) {
      const blank = expandList ? Object.fromEntries(itemCols.filter((c) => c.item!.listId === expandList).map((c) => [c.name, ""])) : {};
      out.push({ ...row, ...singles, ...blank });
      return;
    }
    for (const m of members) {
      out.push({ ...row, ...singles, ...Object.fromEntries(itemCols.filter((c) => c.item!.listId === expandList).map((c) => [c.name, m[c.item!.key] ?? ""])) });
    }
  });
  // Keep the user's column order.
  const order = columns.filter((c) => c.on).map((c) => c.name);
  return out.map((r) => Object.fromEntries(order.map((k) => [k, r[k] ?? ""])));
}

export function selfCheck(): string {
  if (patternFrom("https://e.test/exhibitor/11-x-17", "11-x-17") !== "https://e.test/exhibitor/{v}") throw new Error("patternFrom failed");
  if (patternFrom("https://e.test/exhibitor/11-x-170", "11-x-17") !== null) throw new Error("patternFrom matched a partial slug");
  if (fillPattern("https://e.test/exhibitor/{v}", "a b") !== "https://e.test/exhibitor/a%20b") throw new Error("fillPattern encode failed");
  if (fillPattern("{v}", "https://e.test/x") !== "https://e.test/x") throw new Error("fillPattern absolute failed");

  const cols: Column[] = [
    { id: "a", name: "Company", ink: "", on: true, feedKey: "name", sample: "" },
    { id: "b", name: "Person", ink: "", on: true, sample: "", item: { key: "n", sel: "b", attr: "own", listId: "l1" } },
    { id: "c", name: "Designation", ink: "", on: true, sample: "", item: { key: "d", sel: "i", attr: "own", listId: "l1" } },
    { id: "d", name: "Website", ink: "", on: true, sample: "", item: { key: "w", sel: "a", attr: "href" } },
  ];
  const results: Record<string, ItemResult> = {
    "u1": { url: "u1", ok: true, values: { w: "https://acme.test" }, lists: { l1: [{ n: "Anna", d: "CEO" }, { n: "Ben", d: "CTO" }] } },
    "u2": { url: "u2", ok: true, values: { w: "" }, lists: { l1: [] } },
  };
  const rows = assemble([{ Company: "Acme" }, { Company: "Solo" }, { Company: "Nolink" }], ["u1", "u2", undefined], cols, results);
  if (rows.length !== 4) throw new Error(`expected 4 rows, got ${rows.length}`);
  if (rows[1].Person !== "Ben" || rows[1].Company !== "Acme" || rows[1].Website !== "https://acme.test") throw new Error(`expansion wrong ${JSON.stringify(rows[1])}`);
  if (rows[2].Company !== "Solo" || rows[2].Person !== "") throw new Error("row without members lost");
  if (Object.keys(rows[0]).join() !== "Company,Person,Designation,Website") throw new Error("column order lost");
  return "items-client ok";
}
