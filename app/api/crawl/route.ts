import { denied, hasAccess } from "@/lib/access";
import { crawl, type CrawlPlan } from "@/lib/crawl";
import { ndjson } from "@/lib/ndjson";
import { assertPublicUrl, BlockedUrlError } from "@/lib/ssrf";

export const runtime = "nodejs";
export const maxDuration = 300;

/** POST CrawlPlan -> NDJSON `rows` per page, then `done` with why it stopped. */
export async function POST(req: Request) {
  if (!hasAccess(req)) return denied();
  const plan = (await req.json().catch(() => ({}))) as Partial<CrawlPlan>;
  try {
    plan.url = (await assertPublicUrl(String(plan.url ?? ""))).toString();
  } catch (e) {
    return Response.json({ error: "bad_url", message: e instanceof BlockedUrlError ? e.message : "Bad address." }, { status: 400 });
  }
  const recipe = plan.recipe;
  if (!recipe?.itemSelector || !Array.isArray(recipe.fields) || !recipe.fields.length) {
    return Response.json({ error: "bad_recipe", message: "Pick at least one column first." }, { status: 400 });
  }
  const safe: CrawlPlan = {
    url: plan.url,
    cookie: typeof plan.cookie === "string" && plan.cookie.trim() ? plan.cookie.slice(0, 8000) : undefined,
    recipe: {
      itemSelector: String(recipe.itemSelector).slice(0, 2000),
      fields: recipe.fields.slice(0, 60).map((f) => ({ name: String(f.name).slice(0, 80), sel: String(f.sel ?? "").slice(0, 2000), attr: String(f.attr ?? "text"), multi: !!f.multi })),
    },
    mode: plan.mode === "more" || plan.mode === "scroll" ? plan.mode : "next",
    nextSelector: plan.nextSelector ? String(plan.nextSelector).slice(0, 2000) : undefined,
    maxPages: Math.min(Math.max(1, Math.floor(Number(plan.maxPages) || 10)), 200),
  };

  return ndjson(async (emit) => {
    const deadline = Date.now() + (maxDuration - 50) * 1000;
    const summary = await crawl(safe, {
      page: (n, rows) => emit({ type: "rows", page: n, rows }),
      status: (text) => emit({ type: "status", text }),
    }, deadline);
    emit({ type: "done", ...summary });
  });
}
