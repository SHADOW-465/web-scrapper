/**
 * End-to-end check through the real HTTP API, the way the browser uses it:
 * scan -> choose the biggest dataset -> find each item's page -> sample it ->
 * fetch rows -> read item pages -> assemble -> write Excel and PDF.
 *
 * Run with the dev server up:
 *   APP_URL=http://localhost:3005 npx tsx tests/e2e.ts <url> [rows=60] [itemFieldPattern]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { readNdjson } from "../lib/ndjson";
import { assemble, discoveryRequest, fillPattern, specFor, widerRows } from "../lib/items-client";
import { openFeedWorkspace, feedRows, type Column, type Feed } from "../lib/model";
import { toCsv } from "../lib/exporters";

const APP = process.env.APP_URL ?? "http://localhost:3005";
const url = process.argv[2] ?? "https://event.buchmesse.de/en/marketplace/exhibitors";
const want = Number(process.argv[3] ?? 60);
const fieldPattern = new RegExp(process.argv[4] ?? "^(name|designation|company)$", "i");

async function call(path: string, body: unknown, on: (e: Record<string, unknown>) => void) {
  const res = await fetch(APP + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  await readNdjson(res, on);
}

const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";

let scan: any = null;
await call("/api/scan", { url }, (e) => { if (e.type === "status") console.log("  ..", e.text); if (e.type === "result") scan = e; if (e.type === "error") throw new Error(String(e.message)); });
console.log(`[${secs()}] scanned "${scan.title}": ${scan.apis.length} feeds, notes=${JSON.stringify(scan.notes)}`);
const feed: Feed = [...scan.apis].sort((a: Feed, b: Feed) => (b.total ?? b.rows.length) - (a.total ?? a.rows.length))[0];
if (!feed) throw new Error("no feed found");
console.log(`  dataset: ${feed.endpoint} total=${feed.total} paginated=${feed.paginated}`);
const ws = openFeedWorkspace(feed);
console.log(`  row fields: ${ws.columns.filter((c) => c.on).map((c) => `${c.name}=${JSON.stringify(c.sample).slice(0, 26)}`).join(" | ")}`);

// Find item pages the way the browser does when no link is on screen.
let result: any = null;
const extra = await widerRows(feed, async (i, n) => {
  const rows: Record<string, unknown>[] = [];
  await call("/api/fetch", { token: feed.token, startIndex: i, maxRows: n }, (e) => { if (e.type === "rows") rows.push(...(e.rows as Record<string, unknown>[])); });
  return rows;
});
console.log(`  wider sample: ${extra.length} rows from later in the list`);
await call("/api/items/sample", { scanUrl: scan.finalUrl, discover: discoveryRequest(scan.finalUrl, feed, extra) }, (e) => {
  if (e.type === "status") console.log(`  .. ${e.text}`);
  if (e.type === "result") result = e;
  if (e.type === "none") console.log("  no item pages found:", e.message ?? "no verified page pattern");
  if (e.type === "error") throw new Error(String(e.message));
});
if (!result) process.exit(1);
console.log(`[${secs()}] item pages: ${result.pattern?.pattern} (key ${result.pattern?.key}), mode=${result.catalogue.mode}`);
for (const l of result.catalogue.lists) console.log(`  list "${l.name}" x${l.count}`);
for (const f of result.catalogue.fields.slice(0, 18)) console.log(`   ${f.listId ? "[list]" : "      "} ${f.name.padEnd(18)} ${f.staticOK ? "static" : "BROWSER"} ${JSON.stringify(f.sample).slice(0, 50)}`);

const listName = (id: string) => result.catalogue.lists.find((l: any) => l.id === id)?.name ?? "";
// Pick fields like a user would: the list fields that look like people, plus a few singles.
const itemCols: Column[] = result.catalogue.fields
  .filter((f: any) => (f.listId && /team|member|people|staff|contact/i.test(listName(f.listId)) && fieldPattern.test(f.name)) || (!f.listId && f.suggested && /website|email|phone|linkedin/i.test(f.name)))
  .map((f: any, i: number) => ({ id: `i${i}`, name: `${f.listId ? "Person " : ""}${f.name}`, ink: "", on: true, sample: f.sample, item: { key: f.key, sel: f.sel, attr: f.attr, multi: f.multi, listId: f.listId } }));
const workspace = { ...ws, columns: [...ws.columns, ...itemCols], items: { status: "ready" as const, source: result.pattern, catalogue: result.catalogue } };
console.log(`  picked item fields: ${itemCols.map((c) => c.name).join(", ")}`);

// Rows: fetch in short chunks, as the job runner does.
const raw: Record<string, unknown>[] = [];
let startIndex = 0;
while (raw.length < want) {
  let next: number | null = null;
  await call("/api/fetch", { token: feed.token, startIndex }, (e) => {
    if (e.type === "rows") raw.push(...(e.rows as Record<string, unknown>[]));
    if (e.type === "continue") next = e.nextIndex as number;
    if (e.type === "error") throw new Error(String(e.message));
  });
  if (next == null || raw.length >= want) break;
  startIndex = next;
}
raw.splice(want);
console.log(`[${secs()}] ${raw.length} rows fetched`);

// Item pages in batches of 30.
const src = result.pattern;
const urls = [...new Set(raw.map((r) => fillPattern(src.pattern, r[src.key])).filter(Boolean))];
const spec = specFor(workspace)!;
const results: Record<string, any> = {};
let failed = 0;
const t1 = Date.now();
for (let i = 0; i < urls.length; i += 30) {
  let pending = urls.slice(i, i + 30);
  while (pending.length) {
    let left: string[] = [];
    await call("/api/items/read", { scanUrl: scan.finalUrl, urls: pending, spec }, (e) => {
      if (e.type === "item") { results[e.url as string] = e; if (!e.ok) failed++; }
      if (e.type === "done") left = e.pending as string[];
    });
    pending = left;
  }
}
const perPage = (Date.now() - t1) / urls.length;
console.log(`[${secs()}] read ${urls.length} item pages (${failed} failed), ${(perPage / 1000).toFixed(2)}s per page effective`);
console.log(`  projection for 4,043 exhibitors: ~${Math.round((perPage * 4043) / 60000)} min for item pages`);

const base = feedRows(workspace, undefined, raw);
const out = assemble(base, raw.map((r) => fillPattern(src.pattern, r[src.key])), workspace.columns, results);
const fields = workspace.columns.filter((c) => c.on).map((c) => c.name);
const withPeople = out.filter((r) => fields.some((f) => f.startsWith("Person") && r[f]));
console.log(`[${secs()}] ${out.length} output rows from ${raw.length} exhibitors; ${withPeople.length} rows have a person`);
for (const r of out.filter((r) => fields.some((f) => f.startsWith("Person") && r[f])).slice(0, 5)) console.log("   ", JSON.stringify(r).slice(0, 220));

mkdirSync(".impeccable/e2e", { recursive: true });
writeFileSync(".impeccable/e2e/out.csv", toCsv(out, fields));
console.log("wrote .impeccable/e2e/out.csv");
