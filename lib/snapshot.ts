/**
 * Freeze a rendered page into static HTML the user can point at.
 *
 * The snapshot is what the page looked like after its JavaScript ran, minus
 * the JavaScript. It renders inside a sandboxed iframe with only our picker
 * script allowed, so the target site's code never runs on our origin and our
 * script cannot phone anywhere (connect-src 'none').
 *
 * The in-page work lives in extractor.js (`__ss.sanitize`) and is invoked as a
 * string: TypeScript toolchains inject helpers such as `__name` into compiled
 * functions, and those helpers do not exist inside the target page.
 */
import { randomBytes } from "node:crypto";
import type { Page } from "puppeteer-core";

export interface Snapshot {
  html: string;
  bytes: number;
}

export async function captureSnapshot(page: Page, extractor: string): Promise<Snapshot> {
  const baseUrl = page.url();
  await page.addScriptTag({ content: extractor });
  let html = (await page.evaluate("window.__ss.sanitize()")) as string;
  const nonce = randomBytes(16).toString("base64");
  const csp = [
    "default-src 'none'",
    "img-src * data: blob:",
    "style-src * 'unsafe-inline'",
    "font-src * data:",
    "media-src * data:",
    `script-src 'nonce-${nonce}'`,
    "connect-src 'none'",
    "form-action 'none'",
    "frame-src 'none'",
  ].join("; ");
  const head =
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    `<base href="${baseUrl.replace(/"/g, "&quot;")}">` +
    `<script nonce="${nonce}">window.__SS_PICKER__=true;</script>` +
    `<script nonce="${nonce}">${extractor.replace(/<\/script/gi, "<\\/script")}</script>`;
  // `<head(\s…)?>` and not `<head[^>]*>`, which would also match `<header>`.
  const headTag = /<head(\s[^>]*)?>/i;
  html = headTag.test(html) ? html.replace(headTag, (m) => m + head) : head + html;
  return { html, bytes: Buffer.byteLength(html) };
}
