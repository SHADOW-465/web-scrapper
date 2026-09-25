# Deploying to Vercel

The app is a standard Next.js project; Vercel detects it with no configuration
file.

## Steps

1. Push this folder to a Git repository and import it in Vercel, or run
   `npx vercel` from this folder (you'll be asked to log in).
2. Set environment variables (Project → Settings → Environment Variables):

   | Name | Required | Value |
   |---|---|---|
   | `SCRAPE_SECRET` | yes, in production | a long random string, e.g. `openssl rand -base64 32` |
   | `APP_PASSWORD` | strongly recommended | the password people must enter to use it |

   Without `SCRAPE_SECRET` the production app refuses to issue feed tokens,
   rather than using a guessable key.
3. Deploy. The first scan after a deploy takes a few seconds longer while
   Chromium unpacks.

## What runs where

| Route | Max duration | Work |
|---|---|---|
| `/api/scan` | 120 s | launches Chromium, loads the page, snapshots it |
| `/api/crawl` | 300 s | launches Chromium, follows Next / scrolls |
| `/api/fetch` | 300 s | plain HTTP replay, no browser |
| `/api/access` | default | password check |

Chromium comes from `@sparticuz/chromium`, the build sized for serverless
functions. `next.config.ts` keeps it out of bundling and traces its `bin/`
folder into the scan and crawl functions. The traced scan function is about
74 MB, under Vercel's 250 MB limit. The legacy Python code, data exports, and
docs are excluded from function bundles and from upload (`.vercelignore`).

Functions run on Fluid Compute with Vercel's default 2 GB memory, which
Chromium needs. Fetches that outlast one function call continue in the next:
the browser chains `/api/fetch` requests using the resume index each returns.

## Costs and abuse

Every scan and every page-by-page capture launches a browser and is billed as
function time on your account. Until there are accounts and quotas:

- keep `APP_PASSWORD` set while the URL is public;
- consider Vercel Firewall rate limiting on `/api/scan` and `/api/crawl`;
- preview deployments can use Vercel's Deployment Protection.

## Checking a deployment

Open the deployment, read `https://quotes.toscrape.com/scroll`, and export with
"Every page, from the site's data". You should get 100 rows.
