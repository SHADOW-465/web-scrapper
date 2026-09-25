# Using Scrape Studio

## 1. Read a page

Paste a link into the bar at the top and press **Read page**. The server opens
it in Chromium, waits for the content to arrive, scrolls a little so lazy lists
load, and hands back a frozen copy of the page. The steps print on the sheet
while it works; most pages take 5 to 20 seconds.

The copy is inert: links, buttons, and the site's own scripts don't run in it.
Clicking only ever means "capture this".

## 2. Pick the list

**Found on this page** lists every repeating structure: cards, rows, results,
table lines. Each shows how many are on the page and, when the site's own data
backs it, a badge with the total ("3,913 total" or "every page"). The strongest
one is selected for you. Pick another to switch; the page scrolls to it.

**Other data behind this page** lists data the site loaded that isn't shown as
a list on screen. It is often the most complete source.

## 3. Choose the columns

Every column has an ink, and the page is marked up with it, so you can see
exactly what each column will contain.

- **Click something on the page** to add it as a column. Clicking one tag in a
  row of tags captures all of them as one column.
- **Click an inked thing** to take that column off.
- **Click something outside any list** to capture it on its own ("Details on
  this page"), for profile or product pages that show one record.
- In the tray, the **marker cap** switches a column on or off, the **name** is
  editable, and the grip (or Alt + Up/Down) reorders. Order and names are what
  the export uses.
- **Also in the site's data** offers fields the site sends but doesn't show,
  such as descriptions or IDs.

Each column says where it comes from:

| Tag | Meaning |
|---|---|
| every page | matched to the site's data; fills on every page |
| on-screen only | seen on the page but not in the site's data; fills only rows that were on screen |
| on page | read from the page (no data feed involved) |
| site data | in the site's data, not shown on the page |

## 4. Choose how much

- **Every page, from the site's data.** Offered when your list matched a feed.
  Reads the same data the page loads, page after page. Fastest and most
  complete.
- **Every page, one at a time.** Opens the page on the server and follows the
  "Next" or "Load more" control it found, or keeps scrolling. Set a page limit.
- **Just this page.** Exactly what's on screen, instantly.

## 5. Export

Choose Excel, CSV, JSON, or PDF, optionally name the file, and press the export
button. Its label says what will happen ("Get all 3,913 rows"). Progress shows
row counts as pages arrive; **Stop** keeps what's fetched so far. After a full
fetch you can download again in another format without fetching again.

CSV is UTF-8 with a byte-order mark so Excel shows accents correctly, and cells
starting with `=`, `+`, `-`, or `@` are escaped so they can't run as formulas.

## Recipes

**Save as recipe** remembers the page, the list, your columns (names, order,
on/off), how much, and the format. **Recipes** in the top bar runs one: the page
is scanned fresh and your setup is re-applied. Recipes are kept in this browser.
They never contain a cookie.

## Signed-in pages

For pages you can only see when logged in:

1. Sign in to the site in your own browser.
2. Open DevTools, **Network** tab, reload the page, click the first request.
3. Copy the **Cookie** request header value.
4. In Scrape Studio press **Signed-in page**, paste it, then read the page.

The cookie goes only to that site's address, only for that scan (and a
page-by-page capture started from it). It is never saved, never logged, and
never sent back to your browser.
