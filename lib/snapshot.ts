/**
 * Freeze a page into static HTML the user can point at.
 *
 * The snapshot is what the page looked like after its JavaScript ran, minus
 * the JavaScript. It renders inside a sandboxed iframe with only our picker
 * script allowed, so the target site's code never runs on our origin and our
 * script cannot phone anywhere (connect-src 'none').
 *
 * In-browser work lives in extractor.js (`__ss.sanitize`) and is invoked as a
 * string: TypeScript toolchains inject helpers such as `__name` into compiled
 * functions, and those helpers do not exist inside the target page.
 */
import { randomBytes } from "node:crypto";
import { parseHTML } from "linkedom";
import type { Page } from "puppeteer-core";

export interface Snapshot {
  html: string;
  bytes: number;
}

/** Add the CSP, base URL, and picker engine to already-inert HTML. */
export function wrapSnapshot(html: string, baseUrl: string, extractor: string): Snapshot {
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
  const out = headTag.test(html) ? html.replace(headTag, (m) => m + head) : head + html;
  return { html: out, bytes: Buffer.byteLength(out) };
}

/** Snapshot a live page in the server's browser. */
export async function captureSnapshot(page: Page, extractor: string): Promise<Snapshot> {
  const baseUrl = page.url();
  await page.addScriptTag({ content: extractor });
  const html = (await page.evaluate("window.__ss.sanitize()")) as string;
  return wrapSnapshot(html, baseUrl, extractor);
}

/**
 * Make fetched (unrendered) HTML inert without a browser. Used when Chromium is
 * unavailable: server-rendered pages still show their content this way.
 */
export function sanitizeStatic(html: string, baseUrl: string): string {
  const { document } = parseHTML(html);
  const abs = (v: string) => {
    try {
      return new URL(v, baseUrl).href;
    } catch {
      return v;
    }
  };
  document
    .querySelectorAll("script, noscript, iframe, object, embed, frame, frameset, link[rel=preload], link[rel=modulepreload], link[rel=prefetch], meta[http-equiv], base")
    .forEach((el: Element) => el.remove());
  document.querySelectorAll("img").forEach((img: Element) => {
    const lazy = img.getAttribute("data-src") || img.getAttribute("data-lazy-src") || img.getAttribute("data-original");
    const src = img.getAttribute("src") || "";
    if (lazy && (!src || src.startsWith("data:"))) img.setAttribute("src", lazy);
    img.removeAttribute("srcset");
    img.removeAttribute("loading");
  });
  document.querySelectorAll("*").forEach((el: Element) => {
    for (const a of Array.from(el.attributes)) {
      const n = a.name.toLowerCase();
      if (n.startsWith("on") || n === "srcdoc" || n === "formaction" || n === "ping") el.removeAttribute(a.name);
      else if (/^(href|src|poster)$/.test(n)) {
        if (/^\s*(javascript|vbscript):/i.test(a.value)) el.removeAttribute(a.name);
        else if (a.value) el.setAttribute(a.name, abs(a.value));
      }
    }
  });
  return "<!doctype html>" + document.documentElement.outerHTML;
}

export function selfCheck(): string {
  const out = sanitizeStatic(
    `<html><head><script>alert(1)</script></head><body><a href="/x" onclick="evil()">x</a><img data-src="/i.png"><a href="javascript:bad()">y</a></body></html>`,
    "https://site.test/list/",
  );
  if (/script|onclick|javascript:/i.test(out)) throw new Error("static sanitize left behaviour behind");
  if (!out.includes('href="https://site.test/x"') || !out.includes('src="https://site.test/i.png"')) throw new Error("static sanitize did not absolutize");
  const wrapped = wrapSnapshot("<html><head></head><header>h</header></html>", "https://a.test/", "/*e*/");
  if (!/<head><meta http-equiv="Content-Security-Policy"/.test(wrapped.html)) throw new Error("CSP not injected into <head>");
  if (/<header><meta/.test(wrapped.html)) throw new Error("CSP injected into <header>");
  return "snapshot ok";
}
