/**
 * Sealed tokens: the server hands the browser an opaque blob instead of the
 * raw replay config.
 *
 * A replay config holds the target site's request headers and cookies,
 * sometimes including a cookie the user pasted. The server is stateless on
 * Vercel, so the config has to travel with the client, but it must be
 * unreadable (no leaking the cookie back) and untamperable (no pointing the
 * server's fetcher at a different host). AES-256-GCM gives both.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

let warned = false;

function key(): Buffer {
  const secret = process.env.SCRAPE_SECRET;
  if (!secret) {
    if (process.env.VERCEL_ENV === "production") {
      throw new Error("SCRAPE_SECRET is not set. Add it in the Vercel project settings (any long random string).");
    }
    if (!warned) {
      console.warn("[scrape-studio] SCRAPE_SECRET not set; using an insecure development key.");
      warned = true;
    }
    return createHash("sha256").update("scrape-studio-dev-only-key").digest();
  }
  return createHash("sha256").update(secret).digest();
}

const b64u = (b: Buffer) => b.toString("base64url");

export function seal(value: unknown, ttlSeconds = 60 * 60 * 6): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = JSON.stringify({ v: value, exp: Date.now() + ttlSeconds * 1000 });
  const enc = Buffer.concat([cipher.update(body, "utf8"), cipher.final()]);
  return [b64u(iv), b64u(cipher.getAuthTag()), b64u(enc)].join(".");
}

export class TokenError extends Error {}

export function open<T>(token: string): T {
  const [iv, tag, enc] = String(token).split(".");
  if (!iv || !tag || !enc) throw new TokenError("That data source reference is malformed. Scan the page again.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const body = Buffer.concat([decipher.update(Buffer.from(enc, "base64url")), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(body) as { v: T; exp: number };
    if (Date.now() > parsed.exp) throw new TokenError("That scan has expired. Scan the page again.");
    return parsed.v;
  } catch (e) {
    if (e instanceof TokenError) throw e;
    throw new TokenError("That data source reference is invalid. Scan the page again.");
  }
}

export function selfCheck(): string {
  const t = seal({ url: "https://x.test", cookie: "secret=1" });
  if (t.includes("secret")) throw new Error("token leaks plaintext");
  const back = open<{ url: string }>(t);
  if (back.url !== "https://x.test") throw new Error("roundtrip failed");
  const parts = t.split(".");
  const flipped = parts[2].slice(0, -2) + (parts[2].endsWith("AA") ? "BB" : "AA");
  let rejected = false;
  try {
    open([parts[0], parts[1], flipped].join("."));
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("tampered token accepted");
  return "token ok";
}
