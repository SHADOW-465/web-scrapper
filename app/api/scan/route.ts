import { denied, hasAccess } from "@/lib/access";
import { ndjson } from "@/lib/ndjson";
import { scan, SiteReadError } from "@/lib/scan";
import { assertPublicUrl, BlockedUrlError } from "@/lib/ssrf";

export const runtime = "nodejs";
export const maxDuration = 300; // slow sites plus up to two reloads

/** POST { url, cookie? } -> NDJSON: status events, then one `result`. */
export async function POST(req: Request) {
  try {
    if (!hasAccess(req)) return denied();
    const body = (await req.json().catch(() => ({}))) as { url?: string; cookie?: string };
    let target: URL;
    try {
      target = await assertPublicUrl(String(body.url ?? ""));
    } catch (e) {
      const message = e instanceof BlockedUrlError ? e.message : "That doesn't look like a web address.";
      return Response.json({ error: "bad_url", message }, { status: 400 });
    }
    const cookie = typeof body.cookie === "string" && body.cookie.trim() ? body.cookie.slice(0, 8000) : undefined;

    return ndjson(async (emit) => {
      try {
        const result = await scan(target.toString(), { cookie, status: (text) => emit({ type: "status", text }) });
        // The pasted cookie is never echoed: it only survives inside sealed feed tokens.
        emit({ type: "result", ...result });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const kind = err instanceof SiteReadError ? "site" : "server";
        console.error("[scan] request failed", { kind, message });
        emit({ type: "error", message, kind });
      }
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "scan_error", message }, { status: 500 });
  }
}
