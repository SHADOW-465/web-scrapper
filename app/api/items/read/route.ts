import { denied, hasAccess } from "@/lib/access";
import { readItems, type ItemSpec } from "@/lib/items";
import { ndjson } from "@/lib/ndjson";
import { cookieFrom, SessionError } from "@/lib/session";
import { assertPublicUrl } from "@/lib/ssrf";

export const runtime = "nodejs";
export const maxDuration = 90;

const MAX_URLS = 40;

/**
 * POST { scanUrl, cookie?, urls, spec } -> NDJSON `item` results, then
 * `done` { pending } listing any addresses not reached in this call's time.
 * The browser sends small batches, so a dropped call costs seconds, not the run.
 */
export async function POST(req: Request) {
  if (!hasAccess(req)) return denied();
  const body = (await req.json().catch(() => ({}))) as { scanUrl?: string; cookie?: string; urls?: string[]; spec?: ItemSpec };
  let scan: URL;
  try {
    scan = await assertPublicUrl(String(body.scanUrl ?? ""));
  } catch {
    return Response.json({ error: "bad_url", message: "Scan a page first." }, { status: 400 });
  }
  const spec = body.spec;
  if (!spec || !Array.isArray(spec.fields) || !spec.fields.length) {
    return Response.json({ error: "bad_spec", message: "Pick at least one field from the item pages." }, { status: 400 });
  }
  const safeSpec: ItemSpec = {
    mode: spec.mode === "browser" ? "browser" : "static",
    lists: (spec.lists ?? []).slice(0, 5).map((l) => ({ id: String(l.id), itemSelector: String(l.itemSelector).slice(0, 2000) })),
    fields: spec.fields.slice(0, 60).map((f) => ({ key: String(f.key), sel: String(f.sel ?? "").slice(0, 2000), attr: String(f.attr ?? "text"), multi: !!f.multi, listId: f.listId ? String(f.listId) : undefined })),
  };
  const urls = (body.urls ?? []).filter((u) => typeof u === "string" && /^https?:\/\//i.test(u)).slice(0, safeSpec.mode === "browser" ? 8 : MAX_URLS);
  let cookie: string | undefined;
  try {
    cookie = cookieFrom(body as { cookie?: unknown; session?: unknown }, scan.toString());
  } catch (e) {
    return Response.json({ error: "session", message: e instanceof SessionError ? e.message : "Sign in again." }, { status: 400 });
  }
  const cookieFor = (u: string) => {
    try {
      const h = new URL(u).hostname;
      return h === scan.hostname || h.endsWith("." + scan.hostname) ? cookie : undefined;
    } catch {
      return undefined;
    }
  };

  return ndjson(async (emit) => {
    const pending = await readItems(urls, safeSpec, {
      cookie: cookieFor,
      deadline: Date.now() + (safeSpec.mode === "browser" ? 60_000 : 40_000),
      concurrency: 8,
      onResult: (r) => emit({ type: "item", ...r }),
    });
    emit({ type: "done", pending });
  });
}
