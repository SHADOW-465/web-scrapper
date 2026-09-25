# Troubleshooting

**"That page couldn't be read."** The site refused the server's browser, timed
out, or needs a login. Try again once; use **Signed-in page** for pages behind
a login. Sites with aggressive bot protection won't work, by design.

**The page loaded but no list was found.** The content may still have been
loading. Read the page again. Otherwise click the things you want directly on
the page; the picker finds the repeating level itself.

**The wrong list is selected.** Pick the right one under **Found on this page**.

**A column is named oddly.** Rename it in the tray; the export uses your name.

**"Every page, from the site's data" isn't offered.** None of the site's data
responses matched what's on screen. Use **Every page, one at a time** instead.

**Some cells are empty in a full export.** Those columns are marked
"on-screen only": they exist on the page but not in the site's data, so they
fill only rows that were visible. Turn them off, or use page-by-page capture.

**Page-by-page capture stopped early.** It stops at your page limit, when no
"Next" control remains, when two pages bring nothing new, or at the function
time limit (the message says which). Export again to continue.

**"That scan has expired."** Feed tokens last six hours. Read the page again.

**Locally: "No Chrome found."** Install Chrome, or set `CHROME_PATH` in
`.env.local`.

**On Vercel: "SCRAPE_SECRET is not set."** Add it in the project settings and
redeploy.

**Accents look wrong in Excel.** Use the Excel format, or open the CSV with
Data → From Text and choose UTF-8.
