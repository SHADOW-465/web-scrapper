import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { scan } from "../lib/scan";
import { hasAccess, accessToken } from "../lib/access";
import { prepareItemHtml, extractStatic } from "../lib/items";
import { detectPagination, findPagingCap, findTotal } from "../lib/records";
import { pageRequest, type Replay } from "../lib/replay";
import { parseRequest, resolvePlan } from "../lib/wishes";
import { safeFetch } from "../lib/safe-fetch";
import { crawlPages, scanPage, readItemBatch, HttpError } from "../lib/client-api";
import { replayPages } from "../lib/replay";
import { newJob, runJob } from "../lib/job";
import { openFeedWorkspace, type PageList } from "../lib/model";
import { urlsFor } from "../lib/items-client";

/** Static prose in a component: string literals and JSX text, without code inside ${}. */
function staticCopy(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  const skipString = (q: string) => {
    i++;
    while (i < src.length && src[i] !== q) {
      if (src[i] === "\\") i++;
      i++;
    }
    i++;
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") {
      const q = c;
      const start = i + 1;
      skipString(q);
      out.push(src.slice(start, i - 1).replace(/\\n/g, "\n"));
      continue;
    }
    if (c === "`") {
      i++;
      let body = "";
      while (i < src.length) {
        if (src[i] === "\\") { body += src[i + 1] ?? ""; i += 2; continue; }
        if (src[i] === "`") { out.push(body); i++; break; }
        if (src[i] === "$" && src[i + 1] === "{") {
          out.push(body);
          body = "";
          i += 2;
          let depth = 1;
          while (i < src.length && depth) {
            if (src[i] === '"' || src[i] === "'" || src[i] === "`") skipString(src[i]);
            else {
              if (src[i] === "{") depth++;
              else if (src[i] === "}") depth--;
              i++;
            }
          }
          continue;
        }
        body += src[i++];
      }
      continue;
    }
    i++;
  }
  const jsx = />([^<>{}]+)</g;
  let m: RegExpExecArray | null;
  while ((m = jsx.exec(src))) out.push(m[1]);
  return out;
}

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

  const algoliaUrl = "https://xd0u5m6y4r-dsn.algolia.net/1/indexes/prod_exhibitor/query?x-algolia-agent=test&x-algolia-application-id=APP&x-algolia-api-key=search";
  const params = "query=&page=0&filters=recordType%3Aexhibitor%20AND%20locale%3Aen-gb%20AND%20eventEditionId%3Aeve-1&facetFilters=&optionalFilters=%5B%5D";
  const algolia = detectPagination(algoliaUrl, { params });
  assert.equal(algolia?.style, "body_params_page");
  assert.equal(algolia && "first" in algolia ? algolia.first : null, 0);
  assert.equal(algolia?.pageSize, 1000);
  const missingPage = detectPagination(algoliaUrl, { params: "query=&filters=recordType%3Aexhibitor" });
  assert.equal(missingPage?.style, "body_params_page");
  assert.equal(missingPage && "first" in missingPage ? missingPage.first : null, 0);
  const multi = detectPagination(algoliaUrl, { requests: [{ indexName: "prod", params: "query=&page=0&filters=recordType%3Aexhibitor" }] });
  assert.equal(multi?.style, "body_params_page");
  assert.equal(multi && multi.style === "body_params_page" ? multi.paramsPath : "", "requests.0.params");
  assert.equal(findTotal({ hits: [{ name: "A" }, { name: "B" }], nbHits: 1043, nbPages: 11, hitsPerPage: 100, page: 0 }), 1043);
  assert.equal(findTotal({ results: [{ hits: [], nbHits: 980, nbPages: 1 }] }), 980);
  assert.equal(findPagingCap({ nbHits: 1500, paginationLimitedTo: 1000 }), 1000);
  assert.equal(detectPagination("https://event.buchmesse.de/api", { page: 1, limit: 36 })?.style, "body_page");
  const nested = detectPagination("https://x.test/gql", { query: "query", variables: { page: 1, first: 24 } });
  assert.equal(nested?.style, "body_nested_page");
  assert.equal(nested && nested.style === "body_nested_page" ? nested.path : "", "variables.page");
  const nestedFrom = detectPagination("https://x.test/search", { query: { from: 0, size: 50 } });
  assert.equal(nestedFrom?.style, "body_nested_offset");
  assert.ok(algolia && algolia.style === "body_params_page");
  const replay: Replay = {
    url: algoliaUrl, method: "POST", headers: {}, body: { params }, jsonPath: "hits", pagination: algolia,
  };
  const page2 = new URLSearchParams(String((pageRequest(replay, 2).body as { params: string }).params));
  assert.equal(page2.get("page"), "2");
  assert.equal(page2.get("hitsPerPage"), "1000");
  assert.match(page2.get("filters") ?? "", /recordType:exhibitor/);
  assert.equal(new URLSearchParams(params).get("hitsPerPage"), null);
  assert.ok(nested && nested.style === "body_nested_page");
  const gql: Replay = { url: "https://x.test/gql", method: "POST", headers: {}, body: { query: "query", variables: { page: 1, first: 24 } }, jsonPath: "data.items", pagination: nested };
  assert.equal((pageRequest(gql, 3).body as { variables: { page: number; first: number } }).variables.page, 4);
  assert.equal(parseRequest("can you give me all the list of exhibitors?").limit, null);
  assert.equal(parseRequest("the first 50 exhibitors").limit, 50);
  // "All the list of exhibitors" names no field: it means the list's usual columns, not a column called that.
  const allReq = parseRequest("can you give me all the list of exhibitors?");
  assert.equal(allReq.all, true);
  assert.equal(allReq.wishes.length, 0);
  const allPlan = resolvePlan(allReq, [
    { id: "c1", name: "Exhibitor name", samples: ["2 Seas Literary Agency", "23 First"], on: true },
    { id: "c2", name: "Country name", samples: ["United States", "Australia"], on: true },
    { id: "c3", name: "Email", samples: ["contact@2seasagency.com"], on: true },
    { id: "c4", name: "Stand reference", samples: ["N.G30S"], on: true },
    { id: "c5", name: "Organisation guid", samples: ["org-10b0"], on: true },
  ]);
  assert.deepEqual(allPlan.items.map((i) => i.label), ["Company", "Country", "Stand", "Email"]);
  assert.equal(parseRequest("company, CEO name, email").all, undefined);
  console.log("pass algolia params-string pagination, nbHits, and nested body pages");

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
  await assert.rejects(scanPage("https://8.8.8.8/",{},()=>{}), (e: unknown) => e instanceof HttpError && /Scrape Studio's server/.test(e.message));
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

  const banned = [
    /\bAI\b/,
    /\bGroq\b/i,
    /\bOpenRouter\b/i,
    /gpt-oss/i,
    /\bgemma\b/i,
    /\bllama\b/i,
    /\bHTTP\b/,
    /\b429\b/,
    /rate limit/i,
    /\blimits?\b/i,
    /\bquota\b/i,
    /\breset\b/i,
    /\btokens?\b/i,
    /\brequests\b/i,
  ];
  const hits: string[] = [];
  for (const name of readdirSync("components")) {
    if (!name.endsWith(".tsx")) continue;
    const src = readFileSync(join("components", name), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    const bits = staticCopy(src);
    for (const bit of bits) {
      const text = bit.replace(/https?:\/\/\S+/g, " ");
      if (!/\s/.test(text)) continue;
      const hit = banned.find((b) => b.test(text));
      if (hit) hits.push(`${name}: ${hit} in ${JSON.stringify(text.slice(0, 180))}`);
    }
  }
  assert.deepEqual(hits, [], "client copy");
  console.log("pass client copy has no provider or quota wording");
} finally {
  globalThis.fetch = nativeFetch;
  if (originalPassword === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = originalPassword;
}
