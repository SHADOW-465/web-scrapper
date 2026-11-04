/**
 * Keeps secrets out of logs, errors and events.
 *
 * Passwords, cookies and API keys must never reach a log line, an NDJSON event,
 * a file name or an export. Every error message that leaves the server goes
 * through scrub() first.
 */

const PATTERNS: RegExp[] = [
  /gsk_[A-Za-z0-9]{8,}/g,                       // Groq API keys
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,         // authorization headers
  /\b(password|passwd|pwd|pass)=([^&\s"']+)/gi,  // password=... in a URL or form body
  /\b(cookie|set-cookie):\s*[^\n]+/gi,           // cookie headers
];

/** Replace known secrets and anything that looks like one. */
export function scrub(text: unknown, secrets: Array<string | undefined | null> = []): string {
  let out = typeof text === "string" ? text : text instanceof Error ? text.message : String(text ?? "");
  for (const s of secrets) {
    if (typeof s === "string" && s.length >= 1) out = out.split(s).join("•••");
  }
  for (const re of PATTERNS) out = out.replace(re, (m, k) => (typeof k === "string" && /^(password|passwd|pwd|pass)$/i.test(k) ? `${k}=•••` : "•••"));
  return out;
}

/** A safe message from anything thrown. */
export const safeMessage = (err: unknown, secrets: Array<string | undefined | null> = []) =>
  scrub(err instanceof Error ? err.message : String(err), [process.env.GROQ_API_KEY, process.env.SCRAPE_SECRET, ...secrets]);

export function selfCheck(): string {
  const eq = (a: unknown, b: unknown, m: string) => {
    if (a !== b) throw new Error(`redact: ${m}: ${String(a)} != ${String(b)}`);
  };
  eq(scrub("login failed for hunter2 at x", ["hunter2"]), "login failed for ••• at x", "explicit secret");
  eq(scrub("key gsk_abcdefgh12345678 bad"), "key ••• bad", "groq key shape");
  eq(scrub("https://a.b/?password=abc&u=1"), "https://a.b/?password=•••&u=1", "password in url");
  eq(scrub("Authorization: Bearer abcdefghijkl"), "Authorization: •••", "bearer");
  eq(scrub("Cookie: sid=abc; t=1"), "•••", "cookie header");
  eq(scrub("nothing secret"), "nothing secret", "untouched");
  return "redact ok (6 checks)";
}
