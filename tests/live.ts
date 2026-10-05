/**
 * Live end-to-end check against a real site. Run: npm run test:live [url]
 *
 * Scans the page, runs list detection on the frozen snapshot exactly as the
 * UI's iframe would, correlates the top list with the captured data feeds,
 * then replays two pages of the matched feed.
 */
import { launch } from "../lib/browser";
import { correlate } from "../lib/correlate";
import { open } from "../lib/token";
import { replayPages, type Replay } from "../lib/replay";
import { scan } from "../lib/scan";
import { initial, reducer } from "../lib/studio-state";

const url = process.argv[2] ?? "https://quotes.toscrape.com/scroll";

const t0 = Date.now();
const result = await scan(url, { status: (s) => console.log("  ..", s) });
console.log(`scanned in ${((Date.now() - t0) / 1000).toFixed(1)}s: "${result.title}", snapshot ${(result.snapshotBytes / 1024).toFixed(0)} KB, ${result.apis.length} feeds`);

// Render the snapshot the way the browser iframe does and read what the picker detected.
const browser = await launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("  page error:", String(e).slice(0, 200)));
// setContent uses document.open, which erases window listeners, so ask the engine directly.
await page.setContent(result.snapshot, { waitUntil: "load", timeout: 30_000 }).catch(() => undefined);
await page.waitForFunction("!!window.__ss", { timeout: 10_000 });
const lists = (await page.evaluate("window.__ss.detect()")) as any[];
const next = await page.evaluate("window.__ss.findNext()");
console.log("next control:", JSON.stringify(next));
await browser.close();

console.log(`detected ${lists.length} lists:`);
for (const l of lists.slice(0, 5)) {
  console.log(`  - "${l.name}" x${l.count}: ${l.columns.map((c: any) => `${c.name}=${JSON.stringify(String(c.values[0]).slice(0, 28))}`).join(", ")}`);
}

const state = reducer({ ...initial, feeds: result.apis }, { type: "ready", lists, next: next as never });
const workspace = state.active ? state.ws[state.active] : undefined;
const top = lists.find(l => l.id === state.active);
if (!workspace) throw new Error("no dataset detected");
const match = top ? correlate(top, result.apis) : null;
const api = result.apis.find((a) => a.id === workspace.feedId);
if (!api) {
  console.log("no feed matched the top list (page-by-page capture would be used)");
  process.exit(0);
}
console.log(`matched feed ${api.endpoint} [${api.jsonPath}] total=${api.total} paginated=${api.paginated}`);
for (const p of match?.pairs ?? []) {
  const col = top.columns.find((c: any) => c.key === p.columnKey);
  console.log(`  "${col?.name}" <- ${p.apiKey} (${(p.score * 100).toFixed(0)}%)`);
}

let rows = 0;
for await (const chunk of replayPages(open<Replay>(api.token), { maxRows: 72, deadline: Date.now() + 60_000 })) {
  rows += chunk.rows.length;
  console.log(`  fetched ${rows}/${chunk.total}`);
}
if (rows < Math.min(72, api.total ?? 72)) throw new Error("replay returned too few rows");
console.log("live check passed");
