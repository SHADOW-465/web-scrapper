/**
 * fetch() that stays on the public internet, including across redirects.
 *
 * Every hop is checked: a public site answering "302 -> http://10.0.0.5/" must
 * not walk the server into a private network. All server-side requests to
 * user-chosen or site-chosen addresses go through here.
 */
import { resolvesPublic } from "./ssrf";

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

export class BlockedFetchError extends Error {}

export async function safeFetch(input: string, init: RequestInit & { timeoutMs?: number } = {}, maxRedirects = 4): Promise<Response> {
  let url = input;
  const { timeoutMs = 20_000, ...rest } = init;
  // One deadline covers the whole redirect chain and respects cancellation.
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = rest.signal ? AbortSignal.any([rest.signal, timeout]) : timeout;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new BlockedFetchError("Only web addresses can be fetched.");
    if (!(await resolvesPublic(u.hostname))) throw new BlockedFetchError("That address points at a private network.");
    const res = await fetch(url, { ...rest, redirect: "manual", signal });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      const next = new URL(res.headers.get("location")!, url);
      if (next.origin !== u.origin) {
        const headers = new Headers(rest.headers);
        for (const name of ["cookie", "authorization", "proxy-authorization"]) headers.delete(name);
        rest.headers = headers;
      }
      await res.body?.cancel();
      url = next.toString();
      // A redirected POST becomes a GET, as browsers do.
      if (res.status !== 307 && res.status !== 308) {
        rest.method = "GET";
        delete rest.body;
      }
      continue;
    }
    return res;
  }
  throw new BlockedFetchError("Too many redirects.");
}

/** GET a page's HTML the way a browser would ask for it. */
export async function fetchHtml(url: string, cookie?: string, timeoutMs = 20_000): Promise<{ status: number; html: string; finalUrl: string }> {
  const res = await safeFetch(url, {
    headers: {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      ...(cookie ? { cookie } : {}),
    },
    timeoutMs,
  });
  return { status: res.status, html: res.ok ? await res.text() : "", finalUrl: res.url || url };
}
