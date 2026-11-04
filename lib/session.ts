/**
 * A signed-in session, held by the browser as an opaque sealed token (2 hours).
 * It carries the site's cookies, never the password. Routes turn it back into a
 * Cookie header, only for the site it was made for.
 */
import { baseDomain } from "./company";
import { open, seal, TokenError } from "./token";

interface SessionData { cookie: string; site: string }

export const sealSession = (cookie: string, siteUrl: string) => seal({ cookie, site: baseDomain(new URL(siteUrl).hostname) } satisfies SessionData, 2 * 60 * 60);

export class SessionError extends Error {}

/** The Cookie header for a request about `targetUrl`: from a sealed session, or a pasted cookie. */
export function cookieFrom(body: { cookie?: unknown; session?: unknown }, targetUrl: string): string | undefined {
  if (typeof body.session === "string" && body.session) {
    let data: SessionData;
    try {
      data = open<SessionData>(body.session);
    } catch (e) {
      throw new SessionError(e instanceof TokenError ? "Your sign-in has expired. Sign in again." : "Your sign-in couldn't be read. Sign in again.");
    }
    // Only ever sent back to the site it came from (and its subdomains).
    return baseDomain(new URL(targetUrl).hostname) === data.site ? data.cookie : undefined;
  }
  return typeof body.cookie === "string" && body.cookie.trim() ? body.cookie.slice(0, 8000) : undefined;
}

export function selfCheck(): string {
  const tok = sealSession("sid=abc", "https://event.buchmesse.de/x");
  if (cookieFrom({ session: tok }, "https://event.buchmesse.de/exhibitor/a") !== "sid=abc") throw new Error("session: same site");
  if (cookieFrom({ session: tok }, "https://www.buchmesse.de/") !== "sid=abc") throw new Error("session: same registrable domain");
  if (cookieFrom({ session: tok }, "https://evil.example/") !== undefined) throw new Error("session: other site gets nothing");
  if (tok.includes("abc")) throw new Error("session: cookie readable in token");
  let threw = false;
  try {
    cookieFrom({ session: tok.slice(0, -4) + "AAAA" }, "https://event.buchmesse.de/");
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("session: tampered token accepted");
  return "session ok (5 checks)";
}
