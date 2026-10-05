# Deploying to Vercel

The app is a standard Next.js project; Vercel detects it with no configuration
file.

Use Node.js **24.x**, as pinned in `package.json`. The browser dependencies
require newer Node versions than the former `>=20` setting guaranteed.

## Steps

1. Push this folder to a Git repository and import it in Vercel, or run
   `npx vercel` from this folder (you'll be asked to log in).
2. Set environment variables (Project → Settings → Environment Variables):

   | Name | Required | Value |
   |---|---|---|
   | `SCRAPE_SECRET` | yes, in production | a long random string, e.g. `openssl rand -base64 32` |
   | `APP_PASSWORD` | strongly recommended | the password people must enter to use it |
   | `GROQ_API_KEY` | optional | free key from console.groq.com: cleaner field names, AI reading of unstructured pages |

   Without `SCRAPE_SECRET` the production app refuses to issue feed tokens,
   rather than using a guessable key.
3. Deploy. The first scan after a deploy takes a few seconds longer while
   Chromium unpacks.

Before pushing, run `npm run build && npm run test:deployment`. The second
check copies only traced dependencies to an isolated temporary directory and
imports them. A successful build alone does not prove a cloud function can
start: Next 16.3.5 omitted Puppeteer's `browser-data` modules from its trace.
`next.config.ts` explicitly includes those files and Chromium's runtime assets.

## What runs where

| Route | Max duration | Work |
|---|---|---|
| `/api/scan` | 300 s | launches Chromium, loads the page (reloading empty shells), snapshots it |
| `/api/items/sample` | 300 s | finds item pages, lays out samples in Chromium |
| `/api/items/read` | 90 s | reads a batch of item pages over plain HTTP |
| `/api/crawl` | 300 s | launches Chromium, follows Next / scrolls |
| `/api/fetch` | 60 s | plain HTTP replay, ~25 s of pages per call |
| `/api/access` | default | password check |

Chromium comes from `@sparticuz/chromium`, the build sized for serverless
functions. `next.config.ts` keeps it out of bundling and traces its `bin/`
folder into the browser-using functions. The legacy Python code, data exports, and
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
