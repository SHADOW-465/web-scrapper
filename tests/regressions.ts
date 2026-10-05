import assert from "node:assert/strict";
import { scan } from "../lib/scan";
import { hasAccess, accessToken } from "../lib/access";
import { prepareItemHtml, extractStatic } from "../lib/items";
import { findTotal } from "../lib/records";
import { safeFetch } from "../lib/safe-fetch";
import { crawlPages, scanPage, readItemBatch, HttpError } from "../lib/client-api";
import { replayPages } from "../lib/replay";
import { newJob, runJob } from "../lib/job";
import { openFeedWorkspace, type PageList } from "../lib/model";
import { urlsFor } from "../lib/items-client";

const nativeFetch = globalThis.fetch;
const originalPassword = process.env.APP_PASSWORD;
try {
  const firstPage = { columns: [{key:"link",values:["https://site.test/a","https://site.test/b"]}] } as PageList;
  assert.deepEqual(urlsFor({columnKey:"link"}, firstPage, [
    {__url:"https://site.test/b"}, {__url:"https://site.test/a"}, {__url:"https://site.test/c"}, {__url:""},
  ], false), ["https://site.test/b","https://site.test/a","https://site.test/c",undefined]);
  assert.deepEqual(urlsFor({columnKey:"link"}, firstPage, [{},{}], false), ["https://site.test/a","https://site.test/b"]);
  console.log("pass item details follow each captured row across pages and reordered results");
  // Actual scan path: complete feeds, including fields first seen after row 80.
  const records = Array.from({ length: 125 }, (_, i) => ({ id: i, name: `Company ${i}`, ...(i === 124 ? { email: "last@example.test" } : {}) }));
  globalThis.fetch = async () => Response.json(records);
  const result = await scan("https://8.8.8.8/companies");
  assert.equal(result.apis[0].rows.length, 125);
  assert.equal(result.apis[0].total, 125);
  assert(result.apis[0].fields.some((f) => f.key === "email"));
  console.log("pass complete feeds preserve all 125 rows and late fields");

  const html = `<html><head><script>${"x".repeat(1_000_000)}</script></head><body><h1>Publisher</h1><div class="team"><b>Anna</b><i>Director</i></div></body></html>`;
  const prepared = prepareItemHtml(html, "https://8.8.8.8/item");
  assert(prepared.length < 1000);
  const extracted = extractStatic(prepared, "https://8.8.8.8/item", { mode: "static", lists: [], fields: [{key:"name",sel:".team > b",attr:"text"},{key:"role",sel:".team > i",attr:"text"}] });
  assert.deepEqual(extracted.values, {name:"Anna",role:"Director"});
  console.log("pass large hydration payload does not reject a small contact page");

  assert.equal(findTotal({count:36,data:{total:4130}}),4130);
  assert.equal(findTotal({count:36,data:{total:0}}),0);
  console.log("pass dataset totals take precedence over page counts");

  process.env.APP_PASSWORD = "test-only";
  assert.equal(hasAccess(new Request("https://app.test", {headers:{cookie:"ss_access=%ZZ"}})),false);
  assert.equal(hasAccess(new Request("https://app.test", {headers:{cookie:`ss_access=${encodeURIComponent("é".repeat(43))}`}})),false);
  assert.equal(hasAccess(new Request("https://app.test", {headers:{cookie:`ss_access=${accessToken("test-only")}`}})),true);
  console.log("pass malformed access cookies return denial instead of HTTP 500");

  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    if (calls++ === 0) return new Response(null,{status:302,headers:{location:"https://1.1.1.1/redirect"}});
    assert.equal(new Headers(init?.headers).get("cookie"),null);
    assert.equal(new Headers(init?.headers).get("authorization"),null);
    return Response.json({ok:true});
  };
  await safeFetch("https://8.8.8.8/", {headers:{cookie:"private=1",authorization:"Bearer test"}});
  assert.equal(calls,2);
  console.log("pass redirects do not forward sign-in credentials to another origin");

  globalThis.fetch = async () => new Response('{"type":"rows","rows":[{"name":"A"}],"page":1}\n');
  await assert.rejects(crawlPages({} as never, {rows:()=>{},status:()=>{}}), /connection dropped/i);
  globalThis.fetch = async () => new Response("internal server error",{status:500});
  await assert.rejects(scanPage("https://8.8.8.8/",undefined,()=>{}), (e: unknown) => e instanceof HttpError && /Scrape Studio's server/.test(e.message));
  console.log("pass interrupted captures and server errors are not reported as success");

  calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json([]); };
  for await (const _page of replayPages({url:"https://8.8.8.8/",method:"GET",headers:{},body:null,jsonPath:"",pagination:null},{deadline:Date.now()-1})) assert.fail("expired replay must yield no rows");
  assert.equal(calls,0);
  console.log("pass replay respects the function deadline before starting a request");

  calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{"type":"continue","nextIndex":0}\n'); };
  const feed = { ...result.apis[0], paginated: true };
  const job = newJob({title:"Stalled feed",format:"json",scanUrl:"https://8.8.8.8/",scope:"feed",feed,ws:openFeedWorkspace(feed)});
  await assert.rejects(runJob(job,{signal:new AbortController().signal,onUpdate:()=>{}}),/repeatedly returned no progress/);
  assert.equal(calls,3);
  assert.equal(job.nextIndex,0);
  globalThis.fetch = async () => new Response('{"type":"done","pending":["https://8.8.8.8/item"]}\n');
  await assert.rejects(readItemBatch({scanUrl:"https://8.8.8.8/",urls:["https://8.8.8.8/item"],spec:{fields:[],lists:[],mode:"static"}}),/No item pages were read/);
  console.log("pass stalled exports stop with their resume position instead of looping forever");
} finally {
  globalThis.fetch = nativeFetch;
  if (originalPassword === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = originalPassword;
}
