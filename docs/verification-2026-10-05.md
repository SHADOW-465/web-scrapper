# Scraping repair and verification

Verified on 5 October 2026; results reviewed on 6 October 2026.

## What works in this checkout

Paste a supported public page, inspect the discovered lists and fields, select
and rename columns, and download Excel, PDF, CSV, or JSON. The app uses browser
rendering, captured data feeds, or page-by-page reading. Item-page fields are
discovered from samples and can be supplemented with a supplied example page.

These checks used actual public websites and the running local web interface.
No Groq key was used. Source data was not invented or replaced with fixtures.

| Check | Observed result |
|---|---|
| Quotes, infinite-scroll feed | All 100 quotes; renamed Text to Quote, deselected Tags; all four formats downloaded |
| Books, same browser tab after quotes | 40 books from two pages; previous site's export was not reused |
| Buchmesse full directory | 4,130 companies, JSON and Excel downloaded through the UI |
| Buchmesse contact sample through UI | 42 output rows, 11 named contacts, eight selected fields; all four formats downloaded |
| Buchmesse separate HTTP integration test | 60 exhibitors became 67 rows, 17 named contacts, zero failed profile pages |
| Invalid website path | Explicit website HTTP 404; not a false successful scrape |
| Production-mode local server | Quote scan returned a result over HTTP 200 |
| Automated checks | Ten module checks and eight regression groups passed; type check and final production build passed |

Full company extraction took more than four minutes. A first test timed out
at its own four-minute cutoff; a later run with a fifteen-minute ceiling
completed with 4,130 rows. This was not a server HTTP 500.

Files are under `output/verified-final-2026-10-05/`. The full-company files do
not include contacts. Contact files are explicitly samples, not an assertion
that all 4,130 profile pages have been verified in this run.

## Confirmed defects and repairs

1. **Contact pages rejected by the wrong size measurement.** A live Buchmesse
   profile was 1,129,621 characters including scripts, exceeding the old
   800,000-character analysis limit. Its cleaned markup was 254,680 characters.
   Sampling now removes embedded script payloads before applying the markup
   budget. Limits on raw downloads and analysis remain in place.
2. **Complete JSON feeds silently truncated.** Both direct and captured feeds
   kept only 80 rows even when no pagination existed. Complete feeds now retain
   all rows; only paginated preview data is sampled. A regression checks 125
   records and a field found only in the last record.
3. **JSON addresses recognized by their spelling.** Data endpoints without
   `/api/` or `.json` were missed. Response content type is now inspected first.
4. **PDF cells cut to 300 characters.** This silent truncation is removed. Rows
   stay together when possible; very wide tables repeat their first column
   across horizontal page breaks. Text was compared against the JSON source,
   and first-page renders of both proof PDFs were visually reviewed.
5. **Old work could attach to a new scan.** Dataset identifiers repeat between
   scans. Prior scan/sample requests and jobs are now cancelled or isolated;
   export reuse checks the source URL. Changed crawl columns or limits require
   fresh capture.
6. **Misleading error guidance.** Application HTTP 500 failures were shown with
   advice about website login/bot blocks. Application and website errors are
   now distinguished. Malformed access cookies are denied instead of throwing.
7. **Interrupted or stalled work could appear complete or retry forever.**
   Crawls now require a completion event. Repeated no-progress feed/item
   requests stop with an error. Feed requests and redirects share bounded
   deadlines, and cross-origin redirects drop sign-in credentials.
8. **Page counts could override dataset totals.** Explicit total fields now
   take precedence over a generic `count`, including when nested.

The old live test also blindly selected the first detected list. On Buchmesse
that could mean 36 sponsors instead of the full directory. It now uses the
same dataset selection logic as the app and checks the selected feed's total.

## Earlier-session evidence and the screenshot

The project-local Claude transcript and Git history were inspected. The earlier
session records local extraction successes, a previous port-3000 collision with
another application, and no verified Vercel deployment. A targeted search of
available Antigravity Markdown artifacts found no matching session; its changes
were visible through Git history and the subsequent Claude review.

The supplied screenshot's `The server answered 500` text is the client fallback
for a non-JSON application response. It does not identify the underlying crash.
The failing website address and app/deployment address were requested but were
not supplied. The exact screenshot incident therefore remains unconfirmed.
Do not describe these local checks as proof that that deployment is repaired.

## Repeating the checks

```text
npm test
npm run typecheck
npm run build
node node_modules/next/dist/bin/next dev --port 3005
npx tsx tests/verified-ui.ts output/proof
python tests/verify-files.py output/proof
```

`tests/verify-files.py` requires openpyxl, pypdf and Poppler. Its exact 4,130-row
assertion records this dated capture; update the expected total against the
website for a future run. `tests/refresh-proof-pdfs.ts` rebuilds proof PDFs
from the saved UI JSON using the production exporter, without scraping again.

The machine's global npm launcher was broken during this session, so checks
were invoked with the installed Node entry points directly. `start-studio.cmd`
starts this checkout on port 3005 without that global npm launcher.

## Verification boundaries

This is a tested general scraping workflow, not a guarantee for every website.
Login, bot protection, canvas-only content, uncommon pagination, and fields
absent from sampled pages remain limits. Groq-assisted extraction and a remote
Vercel deployment were not tested. The exact screenshot failure requires its
app URL or server logs. No deployment, Git commit, or push was performed.
