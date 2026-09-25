import { denied, hasAccess } from "@/lib/access";
import { ndjson } from "@/lib/ndjson";
import { scan } from "@/lib/scan";
import { assertPublicUrl, BlockedUrlError } from "@/lib/ssrf";

export const runtime = "nodejs";
export const maxDuration = 120;

/** POST { url, cookie? } -> NDJSON: status events, then one `result`. */
export async function POST(req: Request) {
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
    const result = await scan(target.toString(), { cookie, status: (text) => emit({ type: "status", text }) });
    // The pasted cookie is never echoed: it only survives inside sealed feed tokens.
    emit({ type: "result", ...result });
  });
}
