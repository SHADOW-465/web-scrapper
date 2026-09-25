# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js (App Router) + TypeScript, deployed on Vercel. Headless Chromium runs in
Vercel Functions via `puppeteer-core` + `@sparticuz/chromium`. Chosen by the user
over "keep Python and rent a remote browser". The earlier Python/FastAPI app is
kept, unmodified, in `legacy/python-app/` for local use.

## Users

Primary: the owner and their team, doing lead and contact research. The founding
job was pulling every exhibitor, speaker, and visitor (company, person,
designation) out of the Frankfurter Buchmesse event platform into spreadsheets.
They are comfortable pasting URLs and reading spreadsheets; they should never
need devtools, selectors, or API knowledge.

Later audience (confirmed intent, not built): the public, as a SaaS. Build
private-first, structured so accounts, quotas, and billing can be added.

## Product Purpose

Paste a link, see the information the page actually shows, choose which pieces
you want, and get all of it (every page, not just the first) as CSV, Excel,
JSON, or PDF. Success is a complete, correctly encoded spreadsheet of the data a
person could see on screen, without writing a scraper.

## Positioning

It works from what is displayed, not from how the site is built. Fields are
named after what the page shows ("Company", "Country", "Hall"), never raw API
paths like `stands.0.hall`. Underneath, it quietly matches what is visible on
screen to the site's own JSON API, so a user who points at 36 cards gets all
3,332 rows the API holds. Point-and-click tools see only the DOM; API tools
expose raw endpoints; this joins the two.

## Operating Context

- Desktop browser, usually a wide screen, alongside a spreadsheet app.
- Targets are listing pages: event exhibitor directories, speaker lists, member
  directories, catalogues, tables, search results.
- Reference tools the user wants it to learn from: Instant Data Scraper
  (auto-detect lists, "try another table"), Web Scraper.io (selectors,
  pagination), Octoparse / ParseHub / Browse AI (point-and-click training).
- Pages needing a login: the user logs in in their own browser and pastes the
  Cookie header for that scan.

## Capabilities and Constraints

- Renders pages in real Chromium on Vercel Functions (300 s default max
  duration, Linux only, function size limit).
- Stateless server: no in-memory jobs, no local database, no local files.
  Exports are generated in the browser. Saved recipes live in the browser for
  now; a database is deferred until accounts exist.
- Pagination: replays the site's own API when found; otherwise follows a
  "next page" control or scroll.
- Security floor: block requests to private/internal networks (SSRF), never
  echo a pasted cookie back to the client, sign any replay config the client
  holds so it cannot be tampered with, sandbox the page snapshot so site
  scripts never run.
- Access: an optional app password gate for the private phase.
- Undecided: per-row detail-page enrichment (open each result and extract more),
  scheduling, accounts, quotas.

## Evidence on Hand

- Real exports in `data/`: Buchmesse exhibitors (3,254 rows), speakers (574),
  visitors (948).
- Proven engine behaviour from the Python app: auto-discovered the Buchmesse
  exhibitors API (3,332 total, `{page, limit}` pagination), Wikipedia tables,
  Hacker News posts.
- No customers, testimonials, pricing, or usage numbers exist. Do not invent any.

## Product Principles

1. Show what the page shows. Name and order data the way a person reads it.
2. All of it, not a sample. The visible page is the example; the export is the whole set.
3. Never make the user think in selectors, endpoints, or JSON paths.
4. Say plainly what was and was not captured. A silent half-empty export is the worst outcome.
5. Private-first, SaaS-ready: no shortcut that blocks adding accounts later.

## Accessibility & Inclusion

No product-specific requirement established; meet WCAG 2.2 AA as the default floor.
