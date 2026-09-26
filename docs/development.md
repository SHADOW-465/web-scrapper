# Development

## Running

```bash
npm install
npm run dev
```

Scans use your installed Chrome, Edge, or Playwright Chromium. If none is
found, set `CHROME_PATH` in `.env.local`. `SCRAPE_SECRET` falls back to a
development key locally (with a console warning).

## Tests

```bash
npm test          # offline: records, ssrf, token, replay, correlate, exporters, model
npm run test:live # online: scan quotes.toscrape.com/scroll, detect, match, replay
APP_URL=http://localhost:3000 npx tsx tests/e2e.ts <url> [rows]
                  # through the HTTP API: scan, item pages, rows, people, CSV
APP_URL=http://localhost:3000 npx tsx tests/ui-flow.ts <url> xlsx people
                  # drives the real UI, ticks team fields, exports, checks the file
npm run test:live -- https://example.com/some/list
npx tsx tests/shots.ts [url]   # with `npm run dev` running: drives the UI,
                               # clicks in the snapshot, exports every page, checks
                               # the downloaded CSV, writes screenshots to .impeccable/review
MOBILE=1 npx tsx tests/shots.ts   # the same at phone width
npm run typecheck
npm run build
```

Each `lib/*.ts` module ends with a `selfCheck()` that `tests/run.ts` calls.

## The engine file

`lib/extractor.js` is plain browser JavaScript with no build step, used in two
places: inlined into every snapshot (picker mode, `window.__SS_PICKER__`), and
injected into the server's browser for crawling. Keep it dependency-free and
ES2017.

Code that runs inside a target page is passed to puppeteer as a **string**
(`page.evaluate("window.__ss.sanitize()")`), never as a TypeScript function.
TypeScript toolchains inject helpers such as `__name` into compiled functions,
and those helpers don't exist in the page. This broke the first version.

## Message protocol

Snapshot to app (`source: "scrape-studio"`):

- `ready { lists, next, title }` after layout and detection
- `pick { listId, column, created? }` when something is clicked
- `pick { listId, remove: key }` when an inked thing is clicked

App to snapshot (`source: "scrape-studio-host"`):

- `activate { listId, columns, scroll }` on switching list
- `paint { listId, columns }` whenever columns change; `fresh: true` on a
  column plays the highlighter sweep
- `flash { key }` when a column is hovered in the tray

## Practice sites

`quotes.toscrape.com` (static, Next links), `/scroll` (infinite scroll with a
JSON feed), `/js` (script-rendered), and `books.toscrape.com` are built for
scraper testing and make good fixtures.

The Frankfurter Buchmesse directory loads its data on only about half of
visits; use the English address (`/en/marketplace/exhibitors`). The scan
reloads empty loads by itself.

In development the engine file is re-read on every use, so edits apply without
a restart. In production it is cached.
