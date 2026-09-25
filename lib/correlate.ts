/**
 * Join what the page shows to the data feed behind it.
 *
 * A point-and-click scraper sees 36 cards. The site's API holds 3,332 rows.
 * If the values in a column the user sees (company names, countries) appear in
 * a field of a captured API response, that field IS the column, and every
 * page of it can be fetched. The user never sees the API; they see their
 * columns, named after the page, with "3,332 available" beside them.
 *
 * Pure functions: runs in the browser, tested in Node.
 */

export interface DomColumn { key: string; name: string; attr: string; values: string[] }
export interface DomList { id: string; count: number; columns: DomColumn[] }
export interface ApiLike { id: string; rows: Array<Record<string, unknown>>; total: number | null }

export interface Pair { columnKey: string; apiKey: string; score: number }
export interface Match { apiId: string; pairs: Pair[]; score: number }

export function norm(v: unknown): string {
  return String(v ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&amp;|&#\d+;/g, " ")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s·•|,;:–-]+|[\s·•|,;:–-]+$/g, "")
    .trim();
}

function columnScore(col: DomColumn, apiValues: string[]): number {
  const dom = col.values.map(norm).filter((v) => v.length > 0);
  if (dom.length < 2) return 0;
  const api = apiValues.filter((v) => v.length > 0);
  if (!api.length) return 0;
  const set = new Set(api);
  let hits = 0;
  for (const d of dom) {
    if (set.has(d)) hits++;
    else if (col.attr === "href" && api.some((a) => a.length > 3 && (d.endsWith("/" + a) || d.includes("/" + a + "?") || d.includes("/" + a + "/")))) hits++;
    else if (col.attr === "src" && api.some((a) => a.length > 8 && (d === a || d.endsWith(a.replace(/^https?:/, ""))))) hits++;
  }
  // Short repeated values ("UK", "Germany") match by accident more easily.
  const distinct = new Set(dom).size / dom.length;
  // Judge against whichever side is smaller: a feed holding 10 of the 30 rows
  // on screen that matches all 10 is a perfect match, not a 33% one.
  const denom = Math.min(dom.length, new Set(api).size);
  return Math.min(1, hits / denom) * (0.6 + 0.4 * distinct);
}

/** Best API source for a list, with a column -> field pairing. Null when nothing fits. */
export function correlate(list: DomList, apis: ApiLike[]): Match | null {
  let best: Match | null = null;
  for (const api of apis) {
    if (!api.rows.length) continue;
    const keys = Object.keys(api.rows[0]);
    const valuesByKey = new Map(keys.map((k) => [k, api.rows.map((r) => norm(r[k]))]));
    const pairs: Pair[] = [];
    const usedKeys = new Set<string>();
    for (const col of list.columns) {
      let top: Pair | null = null;
      for (const k of keys) {
        if (usedKeys.has(k)) continue;
        const s = columnScore(col, valuesByKey.get(k)!);
        if (s >= 0.55 && (!top || s > top.score)) top = { columnKey: col.key, apiKey: k, score: s };
      }
      if (top) {
        pairs.push(top);
        usedKeys.add(top.apiKey);
      }
    }
    if (!pairs.length) continue;
    const coverage = pairs.length / Math.max(1, list.columns.length);
    // A feed that holds at least as many rows as the page shows is the stronger claim.
    const sizeFit = api.rows.length >= list.count * 0.8 ? 1 : 0.6;
    const score = pairs.reduce((a, p) => a + p.score, 0) * (0.5 + coverage) * sizeFit;
    const strongEnough = pairs.length >= 2 || (pairs[0].score > 0.85 && list.columns.length <= 2);
    if (strongEnough && (!best || score > best.score)) best = { apiId: api.id, pairs, score };
  }
  return best;
}

/**
 * Line up the page's rows with feed rows through the strongest matched column,
 * so columns that exist only on the page can still be filled for those rows.
 */
export function alignRows(list: DomList, api: ApiLike, match: Match): Map<number, number> {
  const anchor = [...match.pairs].sort((a, b) => b.score - a.score)[0];
  const col = list.columns.find((c) => c.key === anchor.columnKey);
  const map = new Map<number, number>();
  if (!col) return map;
  const index = new Map<string, number>();
  api.rows.forEach((r, i) => {
    const v = norm(r[anchor.apiKey]);
    if (v && !index.has(v)) index.set(v, i);
  });
  col.values.forEach((v, domRow) => {
    const i = index.get(norm(v));
    if (i !== undefined) map.set(i, domRow);
  });
  return map;
}

export function selfCheck(): string {
  const list: DomList = {
    id: "l1", count: 3,
    columns: [
      { key: "a@own", name: "Title", attr: "own", values: ["10ofThose (10Publishing)", "11 x 17", "2 Seas Agency"] },
      { key: "b@own", name: "Text", attr: "own", values: ["United Kingdom", "Portugal", "United States of America"] },
      { key: "c@href", name: "Link", attr: "href", values: ["https://e.test/exhibitor/10ofthose-10publishing", "https://e.test/exhibitor/11-x-17", "https://e.test/exhibitor/2-seas-agency-d2978940"] },
      { key: "d@own", name: "Text 2", attr: "own", values: ["Only on page", "x", "y"] },
    ],
  };
  const feed: ApiLike = {
    id: "api1", total: 3332,
    rows: [
      { id: 1, name: "10ofThose (10Publishing)", country: "United Kingdom", url: "10ofthose-10publishing" },
      { id: 2, name: "11 x 17", country: "Portugal", url: "11-x-17" },
      { id: 3, name: "2 Seas Agency", country: "United States of America", url: "2-seas-agency-d2978940" },
      { id: 4, name: "404 Éditions", country: "France", url: "404-editions" },
    ],
  };
  const filters: ApiLike = { id: "api2", total: null, rows: [{ id: 1, name: "Portugal" }, { id: 2, name: "France" }, { id: 3, name: "Germany" }] };
  const m = correlate(list, [filters, feed]);
  if (!m || m.apiId !== "api1") throw new Error("picked the wrong feed");
  const by = Object.fromEntries(m.pairs.map((p) => [p.columnKey, p.apiKey]));
  if (by["a@own"] !== "name" || by["b@own"] !== "country" || by["c@href"] !== "url") throw new Error(`bad pairing ${JSON.stringify(by)}`);
  if (by["d@own"]) throw new Error("page-only column wrongly matched");
  const align = alignRows(list, feed, m);
  if (align.get(1) !== 1 || align.has(3)) throw new Error("row alignment failed");
  if (correlate({ id: "x", count: 3, columns: [list.columns[3]] }, [feed])) throw new Error("matched unrelated text");
  return "correlate ok";
}
