/**
 * Optional access gate for the private phase.
 *
 * Every scan launches a browser on the owner's Vercel account, so a public URL
 * with no gate is an open bill. Set APP_PASSWORD to require it; leave it unset
 * for local development. Accounts replace this when the app goes SaaS.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const ACCESS_COOKIE = "ss_access";

function expected(): string | null {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return null;
  return createHmac("sha256", process.env.SCRAPE_SECRET || "scrape-studio").update(pw).digest("base64url");
}

export function accessToken(password: string): string | null {
  const want = expected();
  if (!want) return "open";
  const got = createHmac("sha256", process.env.SCRAPE_SECRET || "scrape-studio").update(password).digest("base64url");
  return got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want)) ? got : null;
}

export function hasAccess(req: Request): boolean {
  const want = expected();
  if (!want) return true;
  const cookie = req.headers.get("cookie") ?? "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${ACCESS_COOKIE}=([^;]+)`));
  const got = m ? decodeURIComponent(m[1]) : "";
  return got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export function denied(): Response {
  return Response.json({ error: "locked", message: "Enter the access password to use Scrape Studio." }, { status: 401 });
}

export const accessRequired = () => !!process.env.APP_PASSWORD;
