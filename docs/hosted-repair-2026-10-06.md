# Hosted startup failure

The public app at https://web-scrapper-ten.vercel.app returned an empty HTTP
500 from `/api/scan`, even for `http://localhost/`, which should be rejected
with HTTP 400 before scraping. The homepage and `/api/access` returned 200.
GitHub's production deployment pointed to `bf2c492`; the later local
`06da18c` commit and the workflow repairs had not been published.

An isolated copy of the production trace reproduced a concrete startup error:
`ERR_MODULE_NOT_FOUND` for
`@puppeteer/browsers/lib/browser-data/browser-data.js`. Next's trace included
the importing files but omitted that directory. A normal local build/start
used the complete node_modules directory and hid the defect.

The fix explicitly traces Puppeteer's browser runtime modules and Chromium
assets, imports browser packages inside the launch operation, and pins Node
24.x to satisfy the installed browser packages. Importing both browser
packages before the platform branch makes Windows-built traces verifiable
too. The new build check imports all three external runtime packages from
an isolated directory containing only traced files, and removes it afterward.
The repaired isolated bundle imports successfully (708 dependency files).

Commit `d807f11` was deployed successfully through the existing GitHub
integration. Production then returned HTTP 400 for the private-address probe,
and launched Chromium successfully for public pages. The quotes test exposed
a second, independent blocker: `SCRAPE_SECRET` is absent in production.
Vercel account sign-in is required to configure it and redeploy.

The live browser successfully scanned Books to Scrape, discovered item-page
fields, and captured 40 rows from two pages. That test also exposed a join
bug: item links from the initial snapshot took precedence over each crawled
row's own link. The fix prioritizes the captured link so later-page details
can be read. A regression covers later pages and reordered rows.

Commit `39bbb05` deployed that join fix. A fresh hosted-browser test selected
three columns (renamed Book, Price, and Name from each item's own page),
captured two pages, and downloaded JSON, Excel, CSV, and PDF. Verification
passed for 40 rows and all 40 item-page names. Excel and CSV exactly match
JSON; every value appears in the two-page PDF. Files are retained locally
under `output/hosted-verified-2026-10-06/` and are excluded from Git and uploads.
The production data-feed path remains blocked on configuring SCRAPE_SECRET;
do not interpret the page-capture test as proof that every path is ready.

The original cloud runtime logs were not available during the initial
diagnosis; the isolated test establishes the packaging defect independently.
