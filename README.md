# Scrape Studio

Paste a link. Mark what you want on the page. Take all of it.

Scrape Studio opens a page in a real browser, finds the lists on it, and shows
you the page with those lists already highlighted. Each column is an ink: click
anything on the page to add it, click it again to take it off, rename it in the
tray. Then export every page, not just the one on screen, to Excel, CSV, JSON,
or PDF.

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
  api/fetch/route.ts                   replay a feed page by page
  api/crawl/route.ts                   page-by-page capture when there is no feed
  api/access/route.ts                  optional password gate
components/                            Studio, Sheet (snapshot), Tray, Preview, ...
lib/
  extractor.js       in-page engine: list detection, column naming, picker, crawling
  scan.ts            browser session: snapshot + captured feeds
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
```

## Limits, plainly

- Sites that block automated browsers, or render only into a canvas, won't work.
- A column that exists only on the page (not in the site's data) fills just the
  rows that were on screen when you export "every page from the site's data".
  The tray marks these "on-screen only".
- Saved recipes live in your browser until accounts exist.
- Check a site's terms before taking large amounts of its data.
