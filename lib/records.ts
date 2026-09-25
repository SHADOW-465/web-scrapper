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
  | { style: "query_offset"; key: string; limitKey?: string; pageSize?: number; first: number };

const PAGE_KEYS = ["page", "pageNumber", "pageNo", "page_num", "pageIndex", "p"];
const OFFSET_KEYS = ["offset", "start", "from", "skip"];
const LIMIT_KEYS = ["limit", "pageSize", "per_page", "perPage", "size", "rows", "count"];
const TOTAL_KEYS = ["total", "totalCount", "total_count", "totalResults", "totalRows",
  "numFound", "recordsTotal", "totalElements", "totalItems", "count"];

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

/** A server-reported total row count, wherever it hides. */
export function findTotal(payload: Json): number | null {
  if (!isObj(payload)) return null;
  for (const k of TOTAL_KEYS) {
    const v = payload[k];
    if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  }
  for (const v of Object.values(payload)) {
    if (isObj(v)) {
      const t = findTotal(v);
      if (t) return t;
    }
  }
  return null;
}

function pickLimit(source: Record<string, Json>): { limitKey?: string; pageSize?: number } {
  const limitKey = LIMIT_KEYS.find((k) => Number.isInteger(Number(source[k])) && source[k] !== "" && source[k] != null);
  return limitKey ? { limitKey, pageSize: Number(source[limitKey]) } : {};
}

/** How to ask this endpoint for the next page, from its body or query string. */
export function detectPagination(url: string, body: Json): Pagination | null {
  if (isObj(body)) {
    for (const k of PAGE_KEYS) if (Number.isInteger(body[k])) return { style: "body_page", key: k, first: body[k] as number, ...pickLimit(body) };
    for (const k of OFFSET_KEYS) if (Number.isInteger(body[k])) return { style: "body_offset", key: k, first: body[k] as number, ...pickLimit(body) };
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
  const leaf = parts[parts.length - 1] ?? path;
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
  const p = detectPagination("https://x.test/api", { page: 1, limit: 36 });
  if (!p || p.style !== "body_page" || p.pageSize !== 36) throw new Error("body pagination failed");
  const q = detectPagination("https://x.test/a?pageNumber=2&limit=36", null);
  if (!q || q.style !== "query_page" || q.first !== 2) throw new Error("query pagination failed");
  if (humanizeKey("stands.0.hall") !== "Hall") throw new Error("humanize failed");
  if (humanizeKey("company_name") !== "Company name") throw new Error("humanize snake failed");
  if (!isPlumbing("category_id", 531) || isPlumbing("country", "UK")) throw new Error("plumbing check failed");
  return "records ok";
}
