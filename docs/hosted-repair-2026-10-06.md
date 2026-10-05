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

Cloud validation results will be recorded after the new deployment is ready.
The original cloud runtime logs were not available during the initial
diagnosis; the isolated test establishes the packaging defect independently.
