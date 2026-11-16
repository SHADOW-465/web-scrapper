/**
 * Pure JSON helpers: find record lists inside API responses, flatten them into
 * pickable columns, and work out how the endpoint paginates.
 *
 * Ported from legacy/python-app/app/discovery.py, where these were proven
 * against the Buchmesse exhibitors API (3,332 rows, {page, limit} pagination).
 */

export type Flat = Record<string, string | number | boolean | null>;

export type Pagination =
  | { style: "body_page"; key: string; limitKey?: string; pageSize?: number; first: number }
  | { style: "body_offset"; key: string; limitKey?: string; pageSize?: number; first: number }
  | { style: "query_page"; key: string; limitKey?: string; pageSize?: number; first: number }
  | { style: "query_offset"; key: string; limitKey?: string; pageSize?: number; first: number }
  /** Algolia: page lives inside a URL-encoded `params` string, not as a JSON number. */
  | { style: "body_params_page"; key: "page"; paramsPath: string; limitKey: "hitsPerPage"; pageSize: number; first: number }
  /** `{"query":{"page":1}}`, GraphQL `variables.page`, and the same one level deeper. */
  | { style: "body_nested_page"; key: string; path: string; limitKey?: string; pageSize?: number; first: number }
  | { style: "body_nested_offset"; key: string; path: string; limitKey?: string; pageSize?: number; first: number };

const PAGE_KEYS = ["page", "pageNumber", "pageNo", "page_num", "pageIndex", "p"];
const OFFSET_KEYS = ["offset", "start", "from", "skip"];
const LIMIT_KEYS = ["limit", "pageSize", "per_page", "perPage", "size", "rows", "hitsPerPage", "first", "count"];
const TOTAL_KEYS = ["total", "totalCount", "total_count", "totalResults", "totalRows",
  "numFound", "recordsTotal", "totalElements", "totalItems", "count"];
/** Algolia's largest `hitsPerPage`. Replays ask for this so one call covers a default 100-hit page. */
export const ALGOLIA_PAGE_SIZE = 1000;

type Json = unknown;

const isObj = (v: Json): v is Record<string, Json> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Every path in `payload` that holds a list of similarly shaped objects. */
export function findRecordSets(payload: Json, path = ""): Array<{ path: string; records: Record<string, Json>[] }> {
  const found: Array<{ path: string; records: Record<string, Json>[] }> = [];
  if (Array.isArray(payload)) {
    const objs = payload.filter(isObj);
    if (objs.length >= 2 && objs.length >= payload.length * 0.5) {
      const sets = objs.slice(0, 10).map((o) => new Set(Object.keys(o)));
      const shared = [...sets[0]].filter((k) => sets.every((s) => s.has(k)));
      if (shared.length >= 2) found.push({ path, records: objs });
    }
    if (payload.length && (isObj(payload[0]) || Array.isArray(payload[0]))) {
      found.push(...findRecordSets(payload[0], path ? `${path}.0` : "0"));
    }
  } else if (isObj(payload)) {
    for (const [k, v] of Object.entries(payload)) {
      found.push(...findRecordSets(v, path ? `${path}.${k}` : k));
    }
  }
  return found;
}

/** Nested JSON -> dotted-path columns. Lists of scalars collapse to one cell. */
export function flatten(obj: Json, prefix = "", depth = 0, out: Flat = {}): Flat {
  if (depth > 4) {
    out[prefix || "value"] = JSON.stringify(obj);
    return out;
  }
  if (isObj(obj)) {
    for (const [k, v] of Object.entries(obj)) flatten(v, prefix ? `${prefix}.${k}` : k, depth + 1, out);
  } else if (Array.isArray(obj)) {
    if (!obj.length) out[prefix] = "";
    else if (obj.every((x) => !isObj(x) && !Array.isArray(x))) {
      out[prefix] = obj.map((x) => (x == null ? "" : String(x))).join(", ");
    } else {
      obj.slice(0, 3).forEach((v, i) => flatten(v, `${prefix}.${i}`, depth + 1, out));
    }
  } else {
    out[prefix || "value"] = (obj as Flat[string]) ?? null;
  }
  return out;
}

/** Walk a dotted path, tolerating list indices. */
export function dig(payload: Json, path: string): Json {
  if (!path) return payload;
  let cur: Json = payload;
  for (const part of path.split(".")) {
    if (Array.isArray(cur)) cur = cur[Number(part)];
    else if (isObj(cur)) cur = cur[part];
    else return undefined;
  }
  return cur;
}

const whole = (v: Json): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/**
 * First non-negative integer under `keys`. Walks objects and arrays.
 * Skips `hits` so a field inside an Algolia record is not mistaken for the dataset total.
 */
function findNumber(payload: Json, keys: string[]): number | null {
  const seen = new Set<Json>();
  const walk = (node: Json): number | null => {
    if (!node || typeof node !== "object" || seen.has(node)) return null;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) {
        const t = walk(item);
        if (t !== null) return t;
      }
      return null;
    }
    const obj = node as Record<string, Json>;
    for (const k of keys) if (whole(obj[k])) return obj[k];
    for (const [k, v] of Object.entries(obj)) {
      if (k === "hits") continue;
      const t = walk(v);
      if (t !== null) return t;
    }
    return null;
  };
  return walk(payload);
}

/** A server-reported total row count, wherever it hides. Algolia `nbHits` wins. */
export function findTotal(payload: Json): number | null {
  const nbHits = findNumber(payload, ["nbHits"]);
  if (nbHits !== null) return nbHits;
  if (!isObj(payload)) return null;
  const search = (obj: Record<string, Json>, keys: string[]): number | null => {
    for (const k of keys) {
      const v = obj[k];
      if (whole(v)) return v;
    }
    for (const v of Object.values(obj)) {
      if (isObj(v)) {
        const t = search(v, keys);
        if (t !== null) return t;
      }
    }
    return null;
  };
  // `count` often describes this page, while `data.total` describes the dataset.
  const classic = search(payload, TOTAL_KEYS.filter((k) => k !== "count")) ?? search(payload, ["count"]);
  if (classic !== null) return classic;
  // `nbPages` is a page count. Only use it when `nbHits` is missing and the page size is known.
  const pages = findNumber(payload, ["nbPages"]);
  const per = findNumber(payload, ["hitsPerPage"]);
  if (pages !== null && per !== null && per > 0) return pages * per;
  return null;
}

/** Algolia refuses offsets past this (default 1,000). Null when the payload doesn't say. */
export function findPagingCap(payload: Json): number | null {
  return findNumber(payload, ["paginationLimitedTo"]);
}

/** Write `value` at a dotted path (`requests.0.params`, `variables.page`). */
export function setAt(root: unknown, path: string, value: unknown): void {
  const parts = path.split(".").filter(Boolean);
  if (!parts.length || root == null || typeof root !== "object") return;
  let cur: Record<string, unknown> | unknown[] = root as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    const next = parts[i + 1];
    const box = /^\d+$/.test(next) ? [] : {};
    if (Array.isArray(cur)) {
      const idx = Number(p);
      if (cur[idx] == null || typeof cur[idx] !== "object") cur[idx] = box;
      cur = cur[idx] as Record<string, unknown> | unknown[];
    } else {
      const rec = cur as Record<string, unknown>;
      if (rec[p] == null || typeof rec[p] !== "object") rec[p] = box;
      cur = rec[p] as Record<string, unknown> | unknown[];
    }
  }
  const last = parts[parts.length - 1];
  if (Array.isArray(cur)) cur[Number(last)] = value;
  else (cur as Record<string, unknown>)[last] = value;
}

export function deleteAt(root: unknown, path: string): void {
  const parts = path.split(".").filter(Boolean);
  if (!parts.length || root == null || typeof root !== "object") return;
  let cur: unknown = root;
  for (let i = 0; i < parts.length - 1; i++) {
    if (Array.isArray(cur)) cur = cur[Number(parts[i])];
    else if (isObj(cur)) cur = cur[parts[i]];
    else return;
  }
  const last = parts[parts.length - 1];
  if (Array.isArray(cur)) cur.splice(Number(last), 1);
  else if (isObj(cur)) delete cur[last];
}

/** Body with the page number removed, so two pages of one feed share a dataset key. */
export function paginationKeyBody(body: unknown, p: Pagination | null): unknown {
  if (!p || body == null || typeof body !== "object") return body;
  const b = structuredClone(body);
  if (p.style === "body_params_page") {
    const cur = dig(b, p.paramsPath);
    if (typeof cur === "string") {
      const sp = new URLSearchParams(cur);
      sp.delete("page");
      setAt(b, p.paramsPath, sp.toString());
    }
    return b;
  }
  if (p.style === "body_nested_page" || p.style === "body_nested_offset") {
    deleteAt(b, p.path);
    return b;
  }
  if (p.style.startsWith("body")) {
    const { [p.key]: _drop, ...rest } = b as Record<string, unknown>;
    return rest;
  }
  return b;
}

function pickLimit(source: Record<string, Json>): { limitKey?: string; pageSize?: number } {
  const limitKey = LIMIT_KEYS.find((k) => Number.isInteger(Number(source[k])) && source[k] !== "" && source[k] != null);
  return limitKey ? { limitKey, pageSize: Number(source[limitKey]) } : {};
}

function looksLikeAlgoliaParams(s: string): boolean {
  return /(?:^|&)(?:query|filters|facetFilters|optionalFilters|hitsPerPage|page)=/i.test(s);
}

/** Algolia puts `page` inside `params` or `requests[n].params`, URL-encoded. Missing `page` means page 0. */
function algoliaParams(body: Record<string, Json>): Pagination | null {
  const found: Array<{ path: string; raw: string }> = [];
  if (typeof body.params === "string") found.push({ path: "params", raw: body.params });
  if (Array.isArray(body.requests)) {
    body.requests.forEach((r, i) => {
      if (isObj(r) && typeof r.params === "string") found.push({ path: `requests.${i}.params`, raw: r.params });
    });
  }
  for (const c of found) {
    if (!looksLikeAlgoliaParams(c.raw)) continue;
    const q = new URLSearchParams(c.raw);
    const page = q.get("page");
    const first = page != null && /^\d+$/.test(page) ? Number(page) : 0;
    return { style: "body_params_page", key: "page", paramsPath: c.path, limitKey: "hitsPerPage", pageSize: ALGOLIA_PAGE_SIZE, first };
  }
  return null;
}

/** Page or offset nested under the request body (`query.page`, `variables.offset`). Top-level keys are handled first. */
function nestedPaging(body: Record<string, Json>, path = ""): Pagination | null {
  if (path) {
    for (const k of PAGE_KEYS) {
      if (whole(body[k])) return { style: "body_nested_page", key: k, path: `${path}.${k}`, first: body[k], ...pickLimit(body) };
    }
    for (const k of OFFSET_KEYS) {
      if (whole(body[k])) return { style: "body_nested_offset", key: k, path: `${path}.${k}`, first: body[k], ...pickLimit(body) };
    }
  }
  for (const [k, v] of Object.entries(body)) {
    if (k === "requests" || !isObj(v)) continue;
    const hit = nestedPaging(v, path ? `${path}.${k}` : k);
    if (hit) return hit;
  }
  return null;
}

/** How to ask this endpoint for the next page, from its body or query string. */
export function detectPagination(url: string, body: Json): Pagination | null {
  if (isObj(body)) {
    for (const k of PAGE_KEYS) if (whole(body[k])) return { style: "body_page", key: k, first: body[k], ...pickLimit(body) };
    for (const k of OFFSET_KEYS) if (whole(body[k])) return { style: "body_offset", key: k, first: body[k], ...pickLimit(body) };
    const algolia = algoliaParams(body);
    if (algolia) return algolia;
    const nested = nestedPaging(body);
    if (nested) return nested;
  }
  let q: Record<string, string> = {};
  try {
    q = Object.fromEntries(new URL(url).searchParams);
  } catch {
    return null;
  }
  const digits = (v?: string) => v != null && /^\d+$/.test(v);
  for (const k of PAGE_KEYS) if (digits(q[k])) return { style: "query_page", key: k, first: Number(q[k]), ...pickLimit(q) };
  for (const k of OFFSET_KEYS) if (digits(q[k])) return { style: "query_offset", key: k, first: Number(q[k]), ...pickLimit(q) };
  return null;
}

/**
 * Turn a JSON path into a label a person would say.
 * `stands.0.hall` -> "Hall", `company_name` -> "Company name", `isNew` -> "Is new".
 */
export function humanizeKey(path: string): string {
  const parts = path.split(".").filter((p) => !/^\d+$/.test(p));
  let leaf = parts[parts.length - 1] ?? path;
  // "stands.0.name" is a stand's name, not the row's name.
  if (parts.length > 1 && /^(name|value|title|label|text|type|code|id)$/i.test(leaf)) {
    const parent = parts[parts.length - 2].replace(/ies$/i, "y").replace(/([^s])s$/i, "$1");
    leaf = `${parent}_${leaf}`;
  }
  const words = leaf
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : path;
}

/** Fields that are plumbing, not information a person reads. */
export function isPlumbing(path: string, sample: unknown): boolean {
  const leaf = path.split(".").pop()!.toLowerCase();
  if (/(^|_)(id|uuid|guid|hash|key|token|order_num|sort|index)$/.test(leaf) || /Id$/.test(path.split(".").pop()!)) return true;
  if (/^(is|has|show|can)[A-Z_]/.test(path.split(".").pop()!)) return true;
  if (/(_count|\.count)$/.test(path)) return true;
  if (typeof sample === "boolean") return true;
  return false;
}

export function selfCheck(): string {
  const payload = {
    code: 200,
    data: {
      total: 3332,
      list: [
        { id: 1, name: "A Publisher", country: "UK", stands: [{ hall: "4.2", stand: "C96" }], tags: ["x", "y"] },
        { id: 2, name: "B Verlag", country: "Germany", stands: [{ hall: "3.1", stand: "F139" }], tags: [] },
      ],
    },
  };
  const sets = findRecordSets(payload);
  if (!sets.some((s) => s.path === "data.list")) throw new Error("record set not found");
  const row = flatten(dig(payload, "data.list.0"));
  if (row["stands.0.hall"] !== "4.2") throw new Error("flatten nested failed");
  if (row["tags"] !== "x, y") throw new Error("scalar list collapse failed");
  if (findTotal(payload) !== 3332) throw new Error("total failed");
  if (findTotal({ hits: [{ name: "A" }], nbHits: 1043, nbPages: 11, hitsPerPage: 100 }) !== 1043) throw new Error("nbHits failed");
  if (findTotal({ results: [{ hits: [], nbHits: 999, nbPages: 1 }] }) !== 999) throw new Error("multi-query nbHits failed");
  if (findPagingCap({ nbHits: 5000, paginationLimitedTo: 1000 }) !== 1000) throw new Error("paging cap failed");
  const p = detectPagination("https://x.test/api", { page: 1, limit: 36 });
  if (!p || p.style !== "body_page" || p.pageSize !== 36) throw new Error("body pagination failed");
  const q = detectPagination("https://x.test/a?pageNumber=2&limit=36", null);
  if (!q || q.style !== "query_page" || q.first !== 2) throw new Error("query pagination failed");
  const params = "query=&page=0&filters=recordType%3Aexhibitor%20AND%20locale%3Aen-gb&facetFilters=&optionalFilters=%5B%5D";
  const a = detectPagination("https://xd0u5m6y4r-dsn.algolia.net/1/indexes/prod/query", { params });
  if (!a || a.style !== "body_params_page" || a.first !== 0 || a.pageSize !== ALGOLIA_PAGE_SIZE || a.paramsPath !== "params") throw new Error("algolia params failed");
  const bare = detectPagination("https://xd0u5m6y4r-dsn.algolia.net/1/indexes/prod/query", { params: "query=&filters=recordType%3Aexhibitor" });
  if (!bare || bare.style !== "body_params_page" || bare.first !== 0) throw new Error("algolia missing page failed");
  const multi = detectPagination("https://xd0u5m6y4r-dsn.algolia.net/1/indexes/*/queries", { requests: [{ indexName: "prod", params: "query=&page=1" }] });
  if (!multi || multi.style !== "body_params_page" || multi.paramsPath !== "requests.0.params" || multi.first !== 1) throw new Error("algolia multi-query failed");
  const nested = detectPagination("https://x.test/gql", { query: "q", variables: { page: 2, first: 20 } });
  if (!nested || nested.style !== "body_nested_page" || nested.path !== "variables.page" || nested.first !== 2) throw new Error("nested page failed");
  const off = detectPagination("https://x.test/search", { query: { from: 40, size: 20 } });
  if (!off || off.style !== "body_nested_offset" || off.path !== "query.from" || off.first !== 40 || off.pageSize !== 20) throw new Error("nested offset failed");
  if (humanizeKey("stands.0.hall") !== "Hall") throw new Error("humanize failed");
  if (humanizeKey("stands.0.stands.0.name") !== "Stand name") throw new Error(`humanize nested failed: ${humanizeKey("stands.0.stands.0.name")}`);
  if (humanizeKey("name") !== "Name") throw new Error("humanize top-level failed");
  if (humanizeKey("company_name") !== "Company name") throw new Error("humanize snake failed");
  if (!isPlumbing("category_id", 531) || isPlumbing("country", "UK")) throw new Error("plumbing check failed");
  return "records ok";
}
