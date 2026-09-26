/**
 * Drive the real UI end to end and capture review screenshots.
 * Run with the dev server up: npx tsx tests/shots.ts [url]
 * Writes .impeccable/review/{welcome,desktop,picked,mobile}.png
 */
import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const TARGET = process.argv[2] ?? "https://quotes.toscrape.com/scroll";
const OUT = ".impeccable/review";
mkdirSync(OUT, { recursive: true });

const exe = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await puppeteer.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGE ERROR", String(e).slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text().slice(0, 200)); });

const MOBILE = process.env.MOBILE === "1";
await page.setViewport(MOBILE ? { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { width: 1440, height: 900 });
await page.goto(APP, { waitUntil: "networkidle2", timeout: 60000 });
await page.screenshot({ path: `${OUT}/welcome.png` });
console.log("welcome captured");

await page.click(".urlform input");
await page.keyboard.type(TARGET);
await page.keyboard.press("Enter");
const t0 = Date.now();
await page.waitForSelector(".sheet iframe", { timeout: 120000 });
await page.waitForSelector(".col", { timeout: 30000 }).catch(() => console.log("no columns appeared"));
console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: `${OUT}/${MOBILE ? "mobile" : "desktop"}.png`, fullPage: MOBILE });
if (MOBILE) { await browser.close(); process.exit(0); }

const report = await page.evaluate(() => ({
  lists: [...document.querySelectorAll(".listrow")].map((b) => (b as HTMLElement).innerText.replace(/\s+/g, " ").trim()),
  columns: [...document.querySelectorAll(".col")].map((c) => ({
    name: (c.querySelector(".cname") as HTMLInputElement).value,
    on: c.querySelector(".cap")?.getAttribute("aria-pressed"),
    sample: (c.querySelector(".csample") as HTMLElement)?.innerText.slice(0, 40),
    src: (c.querySelector(".csrc") as HTMLElement)?.innerText,
  })),
  scopes: [...document.querySelectorAll(".scope")].map((s) => ({ text: (s as HTMLElement).innerText.split("\n")[0], checked: (s.querySelector("input") as HTMLInputElement).checked })),
  exportLabel: (document.querySelector(".exportrow .btn-primary") as HTMLElement)?.innerText,
  previewHead: (document.querySelector(".preview-head .aside") as HTMLElement)?.innerText,
}));
console.log(JSON.stringify(report, null, 1));

// Point-and-click: click an element inside the sandboxed snapshot.
const frame = page.frames().find((f) => f !== page.mainFrame());
if (frame) {
  const marks = await frame.evaluate("document.querySelectorAll('[data-ss-mark]').length");
  console.log("inked elements in snapshot:", marks);
  const target = await frame.$("a[href*='goodreads'], a[href*='/author/'], .keywords, h1 a, h1");
  if (target) {
    await target.click();
    await new Promise((r) => setTimeout(r, 900));
    const after = await page.evaluate(() => [...document.querySelectorAll(".col .cname")].map((i) => (i as HTMLInputElement).value));
    console.log("columns after click:", after.join(" | "));
    await page.screenshot({ path: `${OUT}/picked.png` });
  }
} else console.log("snapshot frame not found");

// Export every page as CSV and check the file really holds more than the screen showed.
if (process.env.EXPORT !== "0") {
  const { mkdtempSync, readdirSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "ss-dl-"));
  const cdp = await page.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dir });
  // Reload the quotes list so the tray is back on the detected list, not the one the click created.
  await page.evaluate(() => (document.querySelector(".listrow") as HTMLElement)?.click());
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(() => {
    const csv = [...document.querySelectorAll(".formats label")].find((l) => (l as HTMLElement).innerText.trim() === "CSV");
    (csv?.querySelector("input") as HTMLInputElement)?.click();
  });
  const label = await page.$eval(".exportrow .btn-primary", (b) => (b as HTMLElement).innerText);
  console.log("export button:", label);
  await page.click(".exportrow .btn-primary");
  const t1 = Date.now();
  let file = "";
  while (Date.now() - t1 < 120000) {
    const f = readdirSync(dir).find((x) => x.endsWith(".csv"));
    if (f) { file = join(dir, f); break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!file) console.log("NO DOWNLOAD");
  else {
    await new Promise((r) => setTimeout(r, 500));
    const lines = readFileSync(file, "utf8").split(/\r\n/).filter(Boolean);
    console.log(`downloaded ${file.split(/[\\/]/).pop()} in ${((Date.now() - t1) / 1000).toFixed(1)}s: ${lines.length - 1} rows`);
    console.log("  header:", lines[0].replace("﻿", ""));
    console.log("  last  :", lines[lines.length - 1].slice(0, 110));
  }
  await page.screenshot({ path: `${OUT}/exported.png` });
}

await browser.close();
