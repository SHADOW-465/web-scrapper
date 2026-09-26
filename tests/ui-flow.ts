/**
 * Drive the real UI the way a person would, then check the downloaded file.
 *
 *   APP_URL=http://localhost:3005 npx tsx tests/ui-flow.ts <url> [xlsx|pdf|csv] [people]
 *
 * With "people", ticks the team-member fields found on item pages.
 * Writes screenshots and the downloaded file under .impeccable/ui/.
 */
import { mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const APP = process.env.APP_URL ?? "http://localhost:3005";
const TARGET = process.argv[2] ?? "https://event.buchmesse.de/en/marketplace/exhibitors";
const FORMAT = (process.argv[3] ?? "xlsx").toLowerCase();
const PEOPLE = process.argv.includes("people");
const OUT = path.resolve(".impeccable/ui");
mkdirSync(OUT, { recursive: true });

const exe = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await puppeteer.launch({ executablePath: exe, headless: true, protocolTimeout: 0 });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGE ERROR", String(e).slice(0, 300)));
await page.setViewport({ width: 1440, height: 900 });
const cdp = await page.createCDPSession();
await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: OUT });

const t0 = Date.now();
const at = () => `[${((Date.now() - t0) / 1000).toFixed(0)}s]`;

await page.goto(APP, { waitUntil: "networkidle2", timeout: 60000 });
await page.click(".urlform input");
await page.keyboard.type(TARGET);
await page.keyboard.press("Enter");
await page.waitForSelector(".sheet iframe", { timeout: 180000 });
console.log(at(), "page read");

// Wait for the item-page checklist to settle.
await page.waitForFunction(() => {
  const sec = [...document.querySelectorAll(".section")].find((s) => s.textContent?.includes("From each item"));
  return !!sec && !sec.querySelector(".note .spin, .note svg.spin");
}, { timeout: 180000, polling: 1000 }).catch(() => console.log("item section never settled"));
await page.screenshot({ path: `${OUT}/1-checklist.png` });

const summary = await page.evaluate(() => {
  const lists = [...document.querySelectorAll(".listrow")].map((b) => (b as HTMLElement).innerText.replace(/\s+/g, " ").slice(0, 90));
  const rowCols = [...document.querySelectorAll(".col:not(.item)")].map((c) => `${(c.querySelector(".cap") as HTMLElement).getAttribute("aria-pressed") === "true" ? "[x]" : "[ ]"} ${(c.querySelector(".cname") as HTMLInputElement).value}`);
  const sec = [...document.querySelectorAll(".section")].find((s) => s.textContent?.includes("From each item"));
  const itemText = (sec as HTMLElement | undefined)?.innerText.replace(/\n+/g, " | ").slice(0, 700);
  return { lists, rowCols, itemText };
});
console.log(at(), "datasets:", summary.lists.join(" || "));
console.log("   row columns:", summary.rowCols.join(", "));
console.log("   item section:", summary.itemText);

if (PEOPLE) {
  const ticked = await page.evaluate(() => {
    const sec = [...document.querySelectorAll(".section")].find((s) => s.textContent?.includes("From each item"))!;
    const firstGroup = sec.querySelector("ul.cols");
    const names: string[] = [];
    firstGroup?.querySelectorAll("li.col").forEach((li) => {
      const name = (li.querySelector(".cname") as HTMLInputElement).value;
      if (/^(name|designation|company)$/i.test(name)) {
        (li.querySelector(".cap") as HTMLButtonElement).click();
        names.push(name);
      }
    });
    return names;
  });
  console.log(at(), "ticked item fields:", ticked.join(", "));
}

await page.evaluate((fmt) => {
  const want = { xlsx: "Excel", csv: "CSV", json: "JSON", pdf: "PDF" }[fmt as "xlsx"];
  const label = [...document.querySelectorAll(".formats label")].find((l) => (l as HTMLElement).innerText.trim() === want);
  (label?.querySelector("input") as HTMLInputElement)?.click();
}, FORMAT);
const label = await page.$eval(".exportrow .btn-primary", (b) => (b as HTMLElement).innerText);
console.log(at(), "export button:", label);
await page.screenshot({ path: `${OUT}/2-before-export.png` });
if (process.env.NOEXPORT) {
  await page.evaluate(() => { const s = [...document.querySelectorAll(".section")].find((x) => x.textContent?.includes("From each item")); s?.scrollIntoView(); });
  await page.screenshot({ path: `${OUT}/2b-item-fields.png` });
  await browser.close();
  process.exit(0);
}
const before = new Set(readdirSync(OUT));
await page.click(".exportrow .btn-primary");

// Follow progress until a file lands.
let file = "";
let lastLog = 0;
while (Date.now() - t0 < 45 * 60 * 1000) {
  const f = readdirSync(OUT).find((x) => !before.has(x) && x.endsWith(`.${FORMAT}`));
  if (f) { file = path.join(OUT, f); break; }
  if (Date.now() - lastLog > 30000) {
    lastLog = Date.now();
    const p = await page.evaluate(() => (document.querySelector(".progress .ptext") as HTMLElement | null)?.innerText.replace(/\n/g, " ") ?? (document.querySelector(".exportbar .note") as HTMLElement | null)?.innerText ?? "");
    console.log(at(), "progress:", p);
    if (lastLog - t0 > 60000 && !p) await page.screenshot({ path: `${OUT}/progress.png` });
  }
  await new Promise((r) => setTimeout(r, 2000));
}
if (!file) {
  console.log(at(), "NO FILE");
  await page.screenshot({ path: `${OUT}/3-failed.png` });
  process.exit(1);
}
await new Promise((r) => setTimeout(r, 1500));
const done = await page.evaluate(() => (document.querySelector(".exportbar .note") as HTMLElement | null)?.innerText ?? "");
console.log(at(), "downloaded", path.basename(file), `${(statSync(file).size / 1024).toFixed(0)} KB`, "|", done);
await page.screenshot({ path: `${OUT}/3-done.png` });
await browser.close();
