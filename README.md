# Scrape Studio

Paste a link. See everything that can be extracted. Tick what you want. Get
all of it as Excel or PDF (or CSV, JSON).

Scrape Studio opens the page in a real browser and lists what it can take:
every list on the page, the site's own data behind it (often thousands of rows
where the page shows 36), and what's on each item's own page: people with
their designations, websites, emails, social links, descriptions. Tick fields,
rename them, and export. Big exports run as resumable jobs.

The latest repair and verification results are recorded in
[docs/verification-2026-10-05.md](docs/verification-2026-10-05.md).
Site contents and response times change; successful local checks do not
confirm that a separately deployed server is configured correctly.

```bash
npm install
npm run dev          # http://localhost:3000
```

Local development uses the Chrome (or Edge) already installed on your machine.
Deploying runs Chromium inside Vercel Functions. See [docs/deploying.md](docs/deploying.md).

## Why it's different

Point-and-click scrapers (Instant Data Scraper, Web Scraper.io, Octoparse)
read the page you see, then turn pages one at a time. API tools read the site's
data directly but hand you raw endpoints and field paths like `stands.0.hall`.

Scrape Studio does both and joins them. While the page loads, it records the
JSON data the site fetches for itself. Once it has found the lists on screen,
it matches the values you can see against those responses. When they line up,
your columns keep the names the page uses ("Company", "Country"), and the
export reads every page of the site's own data instead of clicking through.

On the practice site `quotes.toscrape.com/scroll`, the page shows 30 quotes;
"Get every page" downloads all 100 in about 8 seconds.

When no data feed matches, it falls back to what the others do: it opens the
page on the server and follows "Next" or keeps scrolling, re-running your
columns on each page.

## Layout

```
app/
  page.tsx, layout.tsx, globals.css    the interface
  api/scan/route.ts                    load a page, snapshot it, record its data feeds
  api/fetch/route.ts                   replay a feed page by page (short, resumable steps)
  api/items/sample/route.ts            find item pages, sample them, list their fields
  api/items/read/route.ts              read many item pages (fast path: no browser)
  api/crawl/route.ts                   page-by-page capture when there is no feed
  api/access/route.ts                  optional password gate
components/                            Studio, Sheet (snapshot), Tray, Preview, ...
lib/
  extractor.js       in-page engine: list detection, column naming, picker, crawling
  scan.ts            browser session: snapshot + captured feeds (+ reload on empty shells)
  items.ts           item pages: address discovery, sampling, fast reading
  items-client.ts    item pages, browser side: row addresses, joining, one row per person
  job.ts             resumable export jobs (IndexedDB), retries, progress
  ai.ts              optional Groq helpers: field names, reading unstructured pages
  safe-fetch.ts      every server request, redirect hops included, stays public
  correlate.ts       match what's on screen to a data feed
  records.ts         JSON record finding, flattening, pagination detection
  replay.ts          replay a feed across pages
  crawl.ts           follow Next / Load more / scroll
  snapshot.ts        freeze the page into a sandboxed, script-free copy
  ssrf.ts            keep the server off private networks
  token.ts           seal feed configs the browser holds
  model.ts           columns, names, and rows for each capture scope
  exporters.ts       CSV / Excel / JSON / PDF, built in the browser
tests/               self-checks, live end-to-end check, UI driver
docs/                documentation
legacy/              the original Python scrapers and Python app
data/                exports from the original Buchmesse scrapes
```

## Docs

- [Using it](docs/using-it.md): the workflow, columns, scopes, recipes, signed-in pages
- [How it works](docs/how-it-works.md): detection, naming, feed matching, pagination
- [Deploying to Vercel](docs/deploying.md): environment, limits, costs
- [Security](docs/security.md): what the app protects against and how
- [Development](docs/development.md): running, testing, the engine file
- [Troubleshooting](docs/troubleshooting.md)
- [Design](DESIGN.md) and [product](PRODUCT.md) records

## Tests

```bash
npm test                                   # offline self-checks for every engine module
npm run test:live                          # scan a real page, detect, match, replay
npx tsx tests/shots.ts                     # drive the UI (dev server running) and export
npx tsx tests/verified-ui.ts output/proof  # actual UI: selected fields and all four formats
```

## Limits, plainly

- Sites that block automated browsers, or render only into a canvas, won't work.
- Field discovery is based on the page, its data feeds, and sampled item pages.
  It cannot promise every field on every possible page. Use an example item
  page when the automatic sample misses a field.
- A column that exists only on the page (not in the site's data) fills just the
  rows that were on screen when you export "every page from the site's data".
  The tray marks these "on-screen only".
- Saved recipes live in your browser until accounts exist.
- Check a site's terms before taking large amounts of its data.
