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

export function buildSyntheticSnapshot(
  baseUrl: string,
  title: string,
  rows: Array<Record<string, unknown>>,
  extractor: string,
): Snapshot {
  const esc = (s: unknown) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const colKeys: Array<{ key: string; label: string }> = [
    { key: "name", label: "Company Name" },
    { key: "person_name", label: "Representative Name" },
    { key: "designation", label: "Designation" },
    { key: "country", label: "Country" },
    { key: "stands.0.hall", label: "Hall" },
    { key: "stands.0.stand", label: "Stand" },
    { key: "url", label: "Profile" },
  ];

  if (rows.length > 0) {
    const existing = new Set(colKeys.map((c) => c.key));
    for (const k of Object.keys(rows[0])) {
      if (!existing.has(k) && !k.startsWith("_") && !k.endsWith("id") && !k.endsWith("Id") && colKeys.length < 12) {
        colKeys.push({ key: k, label: k.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) });
      }
    }
  }

  const ths = colKeys.map((c) => `<th>${esc(c.label)}</th>`).join("");
  const trs = rows
    .map((r) => {
      const tds = colKeys
        .map((c) => {
          let val = r[c.key];
          if (c.key === "stands.0.hall" && !val && r["hall"]) val = r["hall"];
          if (c.key === "stands.0.stand" && !val && r["stand"]) val = r["stand"];
          if (c.key === "name" && !val && (r["company"] || r["title"])) val = r["company"] || r["title"];
          if (c.key === "url" && val) {
            const href = String(val).startsWith("http")
              ? String(val)
              : baseUrl.includes("buchmesse.de")
              ? `https://event.buchmesse.de/exhibitor/${val}`
              : String(val);
            return `<td><a href="${esc(href)}">${esc(val)}</a></td>`;
          }
          return `<td>${esc(val ?? "")}</td>`;
        })
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("\n");

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${esc(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 24px; background: #ffffff; color: #0f172a; }
    .catalog-header { margin-bottom: 20px; padding-bottom: 12px; border-bottom: 1px solid #e2e8f0; }
    .catalog-header h1 { margin: 0 0 6px 0; font-size: 22px; font-weight: 700; color: #0f172a; }
    .catalog-header p { margin: 0; font-size: 13px; color: #64748b; }
    .table-wrap { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; }
    thead th { background: #f8fafc; color: #475569; font-weight: 600; padding: 10px 14px; border-bottom: 1px solid #cbd5e1; white-space: nowrap; }
    tbody td { padding: 10px 14px; border-bottom: 1px solid #f1f5f9; color: #1e293b; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    tbody tr:hover { background: #f8fafc; }
    a { color: #2563eb; text-decoration: none; }
  </style>
</head>
<body>
  <div class="catalog-header">
    <h1>${esc(title)}</h1>
    <p>Direct API Fast-Path &bull; ${rows.length} rows loaded on this page</p>
  </div>
  <div class="table-wrap">
    <table>
      <thead><tr>${ths}</tr></thead>
      <tbody>
        ${trs}
      </tbody>
    </table>
  </div>
</body>
</html>`;

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
  const headTag = /<head(\s[^>]*)?>/i;
  html = headTag.test(html) ? html.replace(headTag, (m) => m + head) : head + html;
  return { html, bytes: Buffer.byteLength(html) };
}
