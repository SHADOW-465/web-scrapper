import { denied, hasAccess } from "@/lib/access";
import { ndjson } from "@/lib/ndjson";
import { SignInError } from "@/lib/login";
import { safeMessage } from "@/lib/redact";
import { cookieFrom, sealSession, SessionError } from "@/lib/session";
import { scan, SiteReadError } from "@/lib/scan";
import { assertPublicUrl, BlockedUrlError } from "@/lib/ssrf";

export const runtime = "nodejs";
export const maxDuration = 300; // slow sites plus up to two reloads

/**
 * POST { url, cookie? | session? | login? } -> NDJSON: status events, then one `result`.
 * With `login` ({ username, password }) the site is signed in to first; a `session`
 * event then carries a sealed token (the site's cookies, never the password).
 */
export async function POST(req: Request) {
  try {
    if (!hasAccess(req)) return denied();
    const body = (await req.json().catch(() => ({}))) as { url?: string; cookie?: string; session?: string; login?: { username?: unknown; password?: unknown } };
    let target: URL;
    try {
      target = await assertPublicUrl(String(body.url ?? ""));
    } catch (e) {
      const message = e instanceof BlockedUrlError ? e.message : "That doesn't look like a web address.";
      return Response.json({ error: "bad_url", message }, { status: 400 });
    }
    let cookie: string | undefined;
    try {
      cookie = cookieFrom(body, target.toString());
    } catch (e) {
      return Response.json({ error: "session", message: e instanceof SessionError ? e.message : "Sign in again." }, { status: 400 });
    }
    // The password lives only in this request: never logged, stored or echoed.
    const login = body.login && typeof body.login.username === "string" && typeof body.login.password === "string" && body.login.username && body.login.password
      ? { username: body.login.username.slice(0, 300), password: body.login.password.slice(0, 500) }
      : undefined;
    if (login && target.protocol !== "https:") {
      return Response.json({ error: "bad_url", message: "Signing in only works on https pages, so your password is never sent unencrypted." }, { status: 400 });
    }
    const secrets = [login?.username, login?.password, cookie];

    return ndjson(async (emit) => {
      try {
        const result = await scan(target.toString(), {
          cookie, login, status: (text) => emit({ type: "status", text }),
          onSession: (jar) => emit({ type: "session", session: sealSession(jar, target.toString()) }),
        });
        // The pasted cookie is never echoed: it only survives inside sealed feed tokens.
        emit({ type: "result", ...result });
      } catch (err: unknown) {
        const message = safeMessage(err, secrets);
        const kind = err instanceof SiteReadError || err instanceof SignInError ? "site" : "server";
        console.error("[scan] request failed", { kind, message: login ? "(sign-in request; details withheld)" : message });
        emit({ type: "error", message, kind });
      }
    });
  } catch (err: unknown) {
    const message = safeMessage(err);
    return Response.json({ error: "scan_error", message }, { status: 500 });
  }
}
