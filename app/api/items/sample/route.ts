import { denied, hasAccess } from "@/lib/access";
import { discoverPattern, sampleItemPage } from "@/lib/items";
import { ndjson } from "@/lib/ndjson";
import { assertPublicUrl } from "@/lib/ssrf";

export const runtime = "nodejs";
export const maxDuration = 300; // slow sites plus up to two reloads

interface Body {
  scanUrl?: string;
  cookie?: string;
  urls?: string[];                 // known item page addresses (from links on the rows)
  discover?: {                     // or: work the address out from the data
    hintPaths: string[];
    candidates: Array<{ key: string; values: string[] }>;
    verify: string[];
  };
}

/**
 * POST -> NDJSON: `status` events, then `result` { pattern?, catalogue } or `none`.
 * Finds an item's page (if needed), opens one, and lists what it offers.
 */
export async function POST(req: Request) {
  if (!hasAccess(req)) return denied();
  const body = (await req.json().catch(() => ({}))) as Body;
  let scan: URL;
  try {
    scan = await assertPublicUrl(String(body.scanUrl ?? ""));
  } catch {
    return Response.json({ error: "bad_url", message: "Scan a page first." }, { status: 400 });
  }
  // A pasted cookie only ever goes back to the site it came from.
  const cookie = typeof body.cookie === "string" && body.cookie.trim() ? body.cookie.slice(0, 8000) : undefined;
  const cookieFor = (u: string) => {
    try {
      const h = new URL(u).hostname;
      return h === scan.hostname || h.endsWith("." + scan.hostname) ? cookie : undefined;
    } catch {
      return undefined;
    }
  };

  return ndjson(async (emit) => {
    let urls = (body.urls ?? []).filter((u) => typeof u === "string" && /^https?:\/\//i.test(u)).slice(0, 32);
    let pattern: { key: string; pattern: string } | null = null;
    if (!urls.length && body.discover) {
      emit({ type: "status", text: "Looking for each item's own page" });
      pattern = await discoverPattern({
        origin: scan.origin,
        hintPaths: body.discover.hintPaths.slice(0, 6).map(String),
        candidates: body.discover.candidates.slice(0, 6).map((c) => ({ key: String(c.key), values: c.values.slice(0, 32).map(String) })),
        verify: body.discover.verify.slice(0, 3).map(String),
        cookie,
      });
      if (pattern) {
        const c = body.discover.candidates.find((x) => x.key === pattern!.key)!;
        urls = c.values.slice(0, 32).filter(Boolean).map((v) => pattern!.pattern.replace("{v}", encodeURIComponent(String(v))));
      }
    }
    if (!urls.length) {
      emit({ type: "none" });
      return;
    }
    for (const u of urls) await assertPublicUrl(u);
    emit({ type: "status", text: "Reading one item's page" });
    const catalogue = await sampleItemPage(urls, cookieFor(urls[0]));
    emit({ type: "result", pattern, catalogue });
  });
}
