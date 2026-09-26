# Using Scrape Studio

## 1. Read a page

Paste a link into the bar at the top and press **Read page**. The server opens
it in a real browser, waits for its content, scrolls so lazy lists load, and
shows you a frozen copy of the page. Most pages take 10 to 40 seconds.

Some sites only load their data on some visits (Frankfurter Buchmesse does
this about half the time). When a visit comes back as an empty shell, the app
reloads it, up to twice, and says so on screen.

You can also paste a data address (one that returns JSON) instead of a page.

## 2. See what can be extracted

The tray on the right lists everything that can be taken, in three places:

**Found on this page.** Every list on the page (cards, rows, results, tables)
and every dataset the site loaded behind it. The biggest one is selected. A
badge such as **4,043 total** means the site's own data holds that many, even
though the page shows only a few.

**On each row.** The fields each row has, named the way the page shows them.
Tick the ones you want (the marker cap), rename them, drag to reorder. Click
anything on the page to add it as a column; click a highlighted thing to take
it off. **Also in the site's data** lists fields the site sends but doesn't show.

**From each item's own page.** When rows link to pages of their own (an
exhibitor's profile, a product page), the app opens several of those pages,
spread across the list, and lists what they hold: people (name, designation,
company), website, email, phone, social links, description, and so on. Tick
what you want. Picking fields from a people list gives **one row per person**,
with the row's other columns repeated, the way lead lists are usually laid out.

If a field you expect isn't there (only some items show a team, for example),
open **Missing something?**, paste the address of one item page that shows
it, and it becomes the example.

## 3. Choose how much

- **Every page, from the site's data**: all rows the site holds. Fastest.
- **Every page, one at a time**: opens the page and follows "Next" or scrolls.
- **Just this page**: what's on screen now.

## 4. Export

Choose **Excel**, **PDF**, CSV or JSON and press the export button. It says
what will happen ("Get all 4,043 rows").

Big exports run as a job in your browser: rows are fetched in short steps,
then each item's page is read, about 8 pages per second. Every step is
retried if it fails, and progress is saved as it goes:

- **Pause** stops and keeps everything fetched so far.
- If the tab closes or the connection drops, open the app again: an
  **Unfinished** card offers **Resume** from where it stopped (within 6 hours).
- Item pages that still fail after retries are counted in the final message;
  their columns are left empty rather than stopping the export.

Afterwards, pick another format to download the same rows again instantly.

For scale: the Frankfurter Buchmesse directory, 4,043 exhibitors with each
exhibitor's team members read from their own pages, takes about 10 minutes.

## Recipes

**Save as recipe** remembers the page, the dataset, your columns (including
item-page fields), how much, and the format. **Recipes** in the top bar runs one
again from a fresh read. Recipes are kept in this browser and never include a
cookie.

## Signed-in pages

1. Sign in to the site in your own browser.
2. Open DevTools, **Network**, reload, click the first request.
3. Copy the **Cookie** request header value.
4. Press **Signed-in page** in Scrape Studio, paste it, then read the page.

The cookie is only ever sent to that site, for that session's reads and
exports. It is never saved, logged, or shown again.

## AI (optional)

With a free Groq API key set on the server (`GROQ_API_KEY`), the app also:

- gives fields cleaner names and hides junk fields (ids, flags), and
- reads records from pages that have no list or data structure at all.

Everything works without it. AI is never used for the bulk extraction itself:
the free tier's limits couldn't carry thousands of pages, and reading pages
with exact selectors is faster and never invents values.
