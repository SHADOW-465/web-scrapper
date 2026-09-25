/**
 * Page-by-page capture for sites with no usable data feed.
 *
 * Re-runs the user's recipe (item selector + field selectors, recorded by
 * clicking in the snapshot) on each page, following the "Next" or
 * "Load more" control, or scrolling for infinite lists.
 */
import type { Browser, Page } from "puppeteer-core";
import { extractorJs, launch, nudge, openPage } from "./browser";

export interface Recipe {
  itemSelector: string;
  fields: Array<{ name: string; sel: string; attr: string; multi?: boolean }>;
}

export interface CrawlPlan {
  url: string;
  cookie?: string;
  recipe: Recipe;
  mode: "next" | "more" | "scroll";
  nextSelector?: string;
  maxPages: number;
}

type Row = Record<string, string>;

// Evaluated as strings, not functions: see the note in snapshot.ts.
async function ensureEngine(page: Page) {
  const has = await page.evaluate("!!window.__ss").catch(() => false);
  if (!has) await page.addScriptTag({ content: extractorJs() });
}

async function extract(page: Page, recipe: Recipe): Promise<Row[]> {
  await ensureEngine(page);
  return (await page.evaluate(`window.__ss.extract(${JSON.stringify(recipe)})`)) as Row[];
}

const fingerprint = (rows: Row[]) => rows.slice(0, 3).map((r) => Object.values(r).join("|")).join("||");

export async function crawl(
  plan: CrawlPlan,
  on: { page: (n: number, rows: Row[]) => void; status: (text: string) => void },
  deadline: number,
): Promise<{ pages: number; stoppedBy: "end" | "limit" | "time" | "stuck" }> {
  let browser: Browser | null = null;
  const seen = new Set<string>();
  const fresh = (rows: Row[]) =>
    rows.filter((r) => {
      const k = JSON.stringify(r);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  try {
    browser = await launch();
    const page = await openPage(browser, plan.url, plan.cookie);
    on.status("Opening the page");
    await page.goto(plan.url, { waitUntil: "domcontentloaded", timeout: 35_000 });
    await page.waitForNetworkIdle({ idleTime: 800, timeout: 9_000 }).catch(() => undefined);
    await nudge(page, 2);

    let pages = 0;
    let stale = 0;
    while (pages < plan.maxPages) {
      const rows = fresh(await extract(page, plan.recipe));
      pages++;
      on.page(pages, rows);
      stale = rows.length ? 0 : stale + 1;
      if (stale >= 2) return { pages, stoppedBy: pages === 1 ? "stuck" : "end" };
      if (pages >= plan.maxPages) return { pages, stoppedBy: "limit" };
      if (Date.now() > deadline) return { pages, stoppedBy: "time" };

      if (plan.mode === "scroll") {
        await nudge(page, 3);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => undefined);
        await page.waitForNetworkIdle({ idleTime: 700, timeout: 6_000 }).catch(() => undefined);
        continue;
      }

      const before = fingerprint(await extract(page, plan.recipe));
      const control = plan.nextSelector ? await page.$(plan.nextSelector) : null;
      if (!control) return { pages, stoppedBy: "end" };
      on.status(plan.mode === "more" ? "Loading more" : `Going to page ${pages + 1}`);
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 12_000 }).catch(() => undefined),
        control.click().catch(() => undefined),
      ]);
      await page.waitForNetworkIdle({ idleTime: 700, timeout: 8_000 }).catch(() => undefined);
      if (plan.mode === "next") {
        // Single-page apps swap content without navigating; wait for it to change.
        for (let i = 0; i < 20 && fingerprint(await extract(page, plan.recipe)) === before; i++) {
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    }
    return { pages, stoppedBy: "limit" };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
