/**
 * Headless Chromium for Vercel Functions and local development.
 *
 * On Vercel (Linux): puppeteer-core + @sparticuz/chromium, the one Chromium
 * build small enough for a function bundle.
 * Locally: whatever Chrome, Edge, or Playwright Chromium is already installed,
 * or CHROME_PATH. No second 170 MB download.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Browser, HTTPRequest, Page } from "puppeteer-core";
import puppeteer from "puppeteer-core";
import { isObviouslyInternal, resolvesPublic } from "./ssrf";

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
export const VIEWPORT = { width: 1280, height: 900 };

// Dev-only lookups; excluded from tracing so the function bundle stays small.
function localChrome(): string | undefined {
  if (process.env.CHROME_PATH && existsSync(/*turbopackIgnore: true*/ process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  const candidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    path.join(local, "Google/Chrome/Application/chrome.exe"),
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ];
  for (const c of candidates) if (existsSync(/*turbopackIgnore: true*/ c)) return c;
  // Playwright's own Chromium, if the Python app was ever set up on this machine.
  const pw = path.join(local, "ms-playwright");
  if (existsSync(/*turbopackIgnore: true*/ pw)) {
    for (const dir of readdirSync(/*turbopackIgnore: true*/ pw).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
      for (const sub of ["chrome-win64/chrome.exe", "chrome-win/chrome.exe", "chrome-linux/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) {
        const p = path.join(pw, dir, sub);
        if (existsSync(/*turbopackIgnore: true*/ p)) return p;
      }
    }
  }
  return undefined;
}

export async function launch(): Promise<Browser> {
  if (process.platform === "linux" && (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return puppeteer.launch({
      args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
      executablePath: await chromium.executablePath(),
      headless: "shell",
      defaultViewport: VIEWPORT,
    });
  }
  const executablePath = localChrome();
  if (!executablePath) {
    throw new Error("No Chrome found for local development. Install Google Chrome, or set CHROME_PATH to a Chrome/Chromium executable.");
  }
  return puppeteer.launch({ executablePath, headless: true, defaultViewport: VIEWPORT, args: ["--no-first-run", "--disable-dev-shm-usage"] });
}

/** Parse a pasted Cookie header ("a=1; b=2") into puppeteer cookies for one site. */
export function parseCookieHeader(header: string, url: string) {
  const domain = new URL(url).hostname;
  return header
    .replace(/^cookie:\s*/i, "")
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p.includes("="))
    .map((p) => {
      const i = p.indexOf("=");
      return { name: p.slice(0, i).trim(), value: p.slice(i + 1).trim(), domain, path: "/" };
    })
    .filter((c) => c.name);
}

const SKIP_TYPES = new Set(["image", "media", "font"]);
const NOISE = /google-analytics|googletagmanager|doubleclick|facebook\.net|hotjar|segment\.io|sentry|clarity\.ms|cloudflareinsights|onetrust|cookielaw|cookiebot|usercentrics|intercom/i;

/**
 * Open a page with the network guarded: private addresses blocked, heavy
 * assets skipped (the user's own browser loads images in the snapshot).
 */
export async function openPage(browser: Browser, url: string, cookie?: string): Promise<Page> {
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ "accept-language": "en-US,en;q=0.9" });
  if (cookie) {
    const cookies = parseCookieHeader(cookie, url);
    if (cookies.length) await browser.setCookie(...cookies);
  }
  await page.setRequestInterception(true);
  page.on("request", (req: HTTPRequest) => {
    void (async () => {
      if (req.isInterceptResolutionHandled()) return;
      let host = "";
      try {
        const u = new URL(req.url());
        if (u.protocol === "data:" || u.protocol === "blob:") return req.continue();
        host = u.hostname;
      } catch {
        return req.abort();
      }
      if (isObviouslyInternal(host) || NOISE.test(req.url())) return req.abort();
      if (SKIP_TYPES.has(req.resourceType())) return req.abort();
      if (!(await resolvesPublic(host))) return req.abort();
      return req.continue();
    })().catch(() => undefined);
  });
  return page;
}

let extractorSource: string | null = null;
export function extractorJs(): string {
  if (!extractorSource) extractorSource = readFileSync(path.join(process.cwd(), "lib", "extractor.js"), "utf8");
  return extractorSource;
}

/** Scroll in steps so lazy lists and images get requested. */
export async function nudge(page: Page, rounds = 4) {
  for (let i = 0; i < rounds; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.5)).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 500));
  }
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
}
