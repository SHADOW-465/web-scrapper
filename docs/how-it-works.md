# How it works

## The pipeline

```
paste URL
   │
   ▼  POST /api/scan  (Vercel Function, Chromium)
 load page ─► record every JSON response ─► scroll ─► freeze DOM (no scripts)
   │                                                        │
   ▼ feeds: record sets found in the JSON, sealed           ▼ snapshot HTML
   │                                                        │
   └──────────────── browser ───────────────────────────────┘
                        │
             sandboxed iframe runs lib/extractor.js
             detects lists, names columns, handles clicks
                        │
             lib/correlate.ts matches on-screen columns to a feed
                        │
      ┌─────────────────┼──────────────────────┐
      ▼                 ▼                      ▼
 just this page   POST /api/fetch         POST /api/crawl
 (in browser)     replay the feed         follow Next / scroll,
                  page by page            re-run the columns
                        │
                        ▼
             lib/exporters.ts builds the file in the browser
```

The server keeps no state. Everything a later request needs travels with it,
and anything sensitive travels sealed (see [security.md](security.md)).

## Finding lists

`lib/extractor.js`, `detect()`. The approach Instant Data Scraper made popular:

1. For every element, group its children by **signature**: tag plus class
   names, ignoring state classes such as `active` or `Mui-selected`.
2. A group of three or more visible siblings is a candidate list.
3. Score each by count, text per item, fields per item, and area on screen.
   Lists inside `nav`, `header`, `footer`, menus, and tab bars score far lower;
   so do lists of short single links (menus, pagers, tag clouds).
4. The same list is often found at two wrapper depths, and small sub-lists
   (a row's tags) sit inside a stronger list. Both are dropped.

## Turning items into columns

`buildColumns()`:

1. Walk each item and collect its **leaves**: elements with their own text,
   images (`src`), and links (`href`).
2. Key each leaf by its path inside the item, e.g. `div.meta > span.country`.
   Leaves with the same path across items are one column.
3. Paths present in at least a quarter of the items survive.
4. Repeated siblings (`a.tag:nth-of-type(1)`, `(2)`, `(3)`) merge into one
   list-valued column: "change, deep-thoughts, thinking".
5. A value identical on every row ("Country:", "by") is a printed label, not
   data. It's dropped, and a label ending in a colon names the next text column.
6. Exact duplicates are removed.

## Naming columns

In order of trust (`nameColumn()`):

1. Table header cells, for rows of a `<table>`.
2. A printed label ending in `:` ("Country:").
3. The site's own hooks: `data-testid`, `itemprop`, then class names, matched
   against a vocabulary (company, designation, name, country, hall, stand,
   price, date, email, phone, description, category, rating, image, website).
4. A weaker printed label (not "by", "from", "at").
5. The values' shape: emails, phone numbers, URLs, prices, dates, numbers.
6. Presentation: a heading or large type is "Title", long text "Description".

Then, when the column matched a feed field and its page name was generic
("Text", "Title"), the feed's field name wins, humanised: `company_name`
becomes "Company name", `stands.0.hall` becomes "Hall".

## Matching the page to a feed

`lib/correlate.ts`. For each on-screen column and each field of each captured
feed, count how many of the column's values appear among the field's values
(after normalising case, whitespace, entities). Links also match when the URL
ends in the field's value (a slug). The score is judged against the smaller
side, so a feed holding 10 of 30 visible rows that matches all 10 scores full.
Short, repeated values ("UK") count for less, since they match by accident.

A feed is accepted when two or more columns pair up (or one very strong one
for a one-column list). The best-scoring feed wins, favouring feeds at least
as large as the list.

Infinite scroll and "load more" fetch the same endpoint several times with a
different page number. The scan folds those into one feed before matching.

Columns that matched keep filling on every page. Columns that didn't are
joined back to feed rows through the strongest matched column, which is how
on-screen-only values still fill the rows that were visible.

## Pagination

`lib/records.ts` finds the page parameter in the request body or query string:
`page`, `pageNumber`, `offset`, `start`, `skip` and similar, with the page size
from `limit`, `pageSize`, `rows`. `lib/replay.ts` bumps it and re-sends the
captured request with its headers and the site's cookies. It stops at the
reported total, an empty or short page, your row cap, or 1,000 pages.

Each `/api/fetch` call stops itself before the function time limit and returns
where to resume; the browser chains calls, so dataset size isn't limited by
function duration.

Without a feed, `/api/crawl` re-runs your columns (as CSS selectors recorded
from your clicks) on each page, clicking the detected "Next" or "Load more"
control, or scrolling. It waits for the content to change, de-duplicates rows,
and stops at the end, your page limit, or the time budget.

## The snapshot

`lib/snapshot.ts` and `sanitize()` in the engine: after the page has rendered,
scripts, event handlers, iframes, and `javascript:` URLs are removed, every URL
is made absolute, lazy images get their real source, and a `<base>` plus a
strict Content-Security-Policy are added. Only the engine script runs, by nonce.
The browser shows it in an `<iframe sandbox="allow-scripts">`, whose opaque
origin can't reach the app. The app and the snapshot talk only by
`postMessage`, and the app accepts messages only from that iframe's window.
