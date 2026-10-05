/** Real UI proof: customize columns, export every format, change sites, read contacts. */
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { launch } from "../lib/browser";

const APP = process.env.APP_URL || "http://localhost:3005";
const OUT = path.resolve(process.argv[2] || process.env.PROOF_DIR || "output/verified-2026-10-05");
mkdirSync(OUT, {recursive:true});
const browser = await launch();
const page = await browser.newPage();
const errors: string[] = [];
page.on("pageerror", e => errors.push(String(e)));
await page.setViewport({width:1440,height:1000});
const cdp = await page.createCDPSession();
await cdp.send("Browser.setDownloadBehavior",{behavior:"allow",downloadPath:OUT});
const delay = (ms: number) => new Promise(r=>setTimeout(r,ms));
async function fill(selector: string, text: string) {
  await page.click(selector);
  await page.keyboard.down("Control");
  await page.keyboard.press("A");
  await page.keyboard.up("Control");
  await page.type(selector,text);
  await page.keyboard.press("Tab");
}
async function scan(url: string) {
  await fill(".urlform input",url);
  await page.click(".urlform .btn-primary");
  await page.waitForFunction("!!document.querySelector('.sheet iframe') || !!document.querySelector('.errbox')",{timeout:180000});
  const error = await page.$(".errbox");
  if(error) throw new Error(await error.evaluate(el=>el.textContent));
  await page.waitForSelector(".col .cname",{timeout:20000});
  console.log("scanned",url);
}
async function exportFile(format: string, base: string) {
  await fill('input[aria-label="File name"]',base);
  await page.evaluate((label) => {
    const row = [...document.querySelectorAll(".formats label")].find(el=>el.textContent?.trim()===label);
    (row?.querySelector("input") as HTMLInputElement)?.click();
  }, {xlsx:"Excel",pdf:"PDF",csv:"CSV",json:"JSON"}[format]);
  const before=new Set(readdirSync(OUT));
  await page.click(".exportrow .btn-primary");
  const start=Date.now();
  let lastLog = 0;
  while(Date.now()-start<900000) {
    const name=readdirSync(OUT).find(f=>!before.has(f)&&f.endsWith(`.${format}`));
    if(name) { console.log("downloaded",name); return path.join(OUT,name); }
    const error=await page.$eval("body",el=>el.querySelector(".exportbar .note.err")?.textContent||"");
    if(error) throw new Error(error);
    if (Date.now() - lastLog > 15000) {
      lastLog = Date.now();
      console.log("export progress", await page.$eval("body",el=>el.querySelector(".ptext")?.textContent || "building file"));
    }
    await delay(500);
  }
  throw new Error(`No ${format} download within fifteen minutes`);
}
try {
  await page.goto(APP,{waitUntil:"networkidle2"});
  if (process.argv[3] === "companies") {
    await scan("https://event.buchmesse.de/en/marketplace/exhibitors");
    const file=await exportFile("json","buchmesse-all-companies");
    const companies=JSON.parse(readFileSync(file,"utf8"));
    assert(companies.length>4000);
    await exportFile("xlsx","buchmesse-all-companies");
    await page.screenshot({path:path.join(OUT,"buchmesse-all-companies-ui.png")});
    assert.deepEqual(errors,[]);
    console.log("PASS full directory",companies.length);
  } else {
  await scan("https://quotes.toscrape.com/scroll");
  await fill(".col:not(.item) .cname","Quote");
  await page.evaluate(() => {
    const tags=[...document.querySelectorAll(".col:not(.item)")].find(el=>(el.querySelector(".cname") as HTMLInputElement)?.value==="Tags");
    if(tags?.querySelector('.cap[aria-pressed="true"]')) (tags.querySelector(".cap") as HTMLButtonElement).click();
  });
  const quoteJson=await exportFile("json","quotes-customized");
  const quotes=JSON.parse(readFileSync(quoteJson,"utf8"));
  assert.equal(quotes.length,100);
  assert.deepEqual(Object.keys(quotes[0]),["Quote","Name"]);
  for(const format of ["xlsx","csv","pdf"]) await exportFile(format,"quotes-customized");
  await page.screenshot({path:path.join(OUT,"quotes-ui.png")});

  // A second scan in the same tab must not reuse the completed quotes job.
  await scan("https://books.toscrape.com/");
  assert(!await page.$eval(".exportrow .btn-primary",el=>el.textContent?.includes("Download 100")));
  await fill('input[aria-label="Maximum pages"]',"2");
  const bookJson=await exportFile("json","books-two-pages");
  const books=JSON.parse(readFileSync(bookJson,"utf8"));
  assert.equal(books.length,40);
  assert(!Object.keys(books[0]).includes("Quote"));
  await page.screenshot({path:path.join(OUT,"books-ui.png")});

  await scan("https://event.buchmesse.de/en/marketplace/exhibitors");
  await page.waitForSelector(".col.item",{timeout:180000});
  await page.evaluate(() => {
    // Export the sampled exhibitor rows with the selected team fields.
    const scope=[...document.querySelectorAll(".scope")].find(el=>el.textContent?.includes("Just this page"));
    (scope?.querySelector("input") as HTMLInputElement)?.click();
    const section=[...document.querySelectorAll(".section")].find(el=>el.textContent?.includes("From each item"));
    const heading=[...(section?.querySelectorAll(".subhead")||[])].find(el=>/TEAM MEMBERS/i.test(el.textContent||""));
    const list=heading?.parentElement?.querySelector("ul.cols");
    for(const li of list?.querySelectorAll(".col.item")||[]) {
      const name=(li.querySelector(".cname") as HTMLInputElement).value;
      if(/name|designation|company/i.test(name)) (li.querySelector(".cap") as HTMLButtonElement).click();
    }
  });
  const selected=await page.$$eval('.col.item .cap[aria-pressed="true"]',els=>els.length);
  assert(selected>=2,"Contact fields must be selectable in the UI");
  const exhibitorJson=await exportFile("json","buchmesse-with-contacts-sample");
  const exhibitors=JSON.parse(readFileSync(exhibitorJson,"utf8"));
  assert(exhibitors.length>=36);
  assert(exhibitors.some((r: Record<string,unknown>)=>Object.entries(r).some(([k,v])=>/designation/i.test(k)&&v)));
  for(const format of ["xlsx","csv","pdf"]) await exportFile(format,"buchmesse-with-contacts-sample");
  await page.screenshot({path:path.join(OUT,"buchmesse-ui.png")});

  await page.evaluate(() => {
    for (const cap of document.querySelectorAll('.col.item .cap[aria-pressed="true"]')) (cap as HTMLButtonElement).click();
    const scope=[...document.querySelectorAll(".scope")].find(el=>el.textContent?.includes("Every page, from"));
    (scope?.querySelector("input") as HTMLInputElement)?.click();
  });
  const fullFile=await exportFile("json","buchmesse-all-companies");
  const companies=JSON.parse(readFileSync(fullFile,"utf8"));
  assert(companies.length>4000);
  await exportFile("xlsx","buchmesse-all-companies");
  assert.deepEqual(errors,[],"No browser runtime errors");
  console.log(JSON.stringify({quotes:quotes.length,books:books.length,exhibitorOutputRows:exhibitors.length,allCompanies:companies.length,contactColumns:selected,output:OUT}));
  }
} finally { await browser.close(); }
