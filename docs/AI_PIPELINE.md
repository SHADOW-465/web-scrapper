# AI pipeline

How Scrape Studio uses a model, and how it stays invisible to the person using the chat.

The app runs on Vercel. A long export is driven in the browser (`lib/job.ts`), saved in IndexedDB, and resumed as a series of short server calls (`/api/scan`, `/api/fetch`, `/api/plan`, `/api/people`, `/api/items/*`). The server never holds a multi-minute job. This note describes that shape after the client-facing rewrite.

## What never needs a model

Lists come from the site itself:

- JSON the page already requested, replayed page by page (`lib/scan.ts`, `lib/records.ts`, `lib/replay.ts`), including Algolia `params` strings and nested `page` / `offset` bodies
- `__NEXT_DATA__` and other embedded JSON, sitemaps, and DOM selectors (`lib/items.ts`, `lib/crawl.ts`)

A request like “all exhibitors” fetches every page. A number in the request (“the first 50”) is the only reason to stop early. No key is required for this path. Cells the model would have filled stay blank.

## Where a model is allowed

1. **Understand the chat** (`lib/wishes.ts`, `app/api/plan`). Built-in rules map plain words to columns, a country, and a count. A model runs only when those rules cannot resolve the request.
2. **Name fields** (`lib/ai.ts` `nameFields`) on a feed the scan already captured.
3. **Read messy pages** (`extractRecords`, and `lib/company.ts` `resolveHardCases` for a role with no clean name). Several companies go in one JSON call, each with an id. A value is kept only when it appears in the page text.
4. **Website search** (`groqSearch` / browser search on Groq only). OpenRouter web search is paid, so it is not in the chain. A suggested URL is fetched and must name the company.

People, emails, and phones are read by code in `lib/people.ts` and `lib/company.ts` first.

## One provider layer

`lib/groq.ts` is the only place that talks to a model. It builds an ordered list from whichever keys are set (none are required):

1. Groq: `GROQ_MODEL`, `GROQ_FALLBACK_MODEL`, then other free Groq models. `GROQ_MODELS` replaces that list when set.
2. OpenRouter free models: `OPENROUTER_MODELS` (JSON tasks only, not web search).
3. Any other free provider already named in `.env.example`, only when its key is present.

On HTTP 429, 5xx, or a timeout the call rotates to the next candidate. It does not tell the browser which one failed. Each model remembers a cooldown from `retry-after` or reset headers, plus a little jitter, in that server instance only. A short in-process queue caps how many calls run at once so a batch does not stampede the free tier.

If every candidate is cooling down, the function returns a typed busy result `{ busy: true, retryAfter }` (seconds). It does not return a sentence. Logs on the server may name the provider; the browser never receives that text, and secrets are scrubbed.

Results are cached in memory (LRU) by task kind plus a hash of the prompt. The hash does not include the model, so a fallback answer is reused. The browser job already stores finished rows in IndexedDB and does not send those rows again.

## The browser job

`lib/job.ts` still walks rows, then item pages, then contacts. Rows that still need a model stay pending and fill in when a later call returns. On busy, the job waits `retryAfter` and continues by itself. It does not drop rows. After repeated tries, a missing value is an empty cell, not an error string. Pausing and resuming still use IndexedDB (signed-in jobs stay in memory only).

## What the client sees

Chat, progress, the table, and the finished line use plain counts from the data:

- “Got it — getting every exhibitor from this directory.”
- “Finding exhibitors… 312 found”, “Adding details 40 / 312”, “Looking up contacts 18 / 312”, “Almost done…”
- “Done — 1,043 exhibitors with name, country, stand and website. 812 have an email.”

A network hiccup is “Still working…” and retries. A site that cannot be read at all is one sentence: “This site couldn't be read right now. Try again in a few minutes.”

The client UI does not show provider names, the word AI, HTTP status, limits, quotas, tokens, or raw errors. The floating usage panel (`components/AiUsageBar.tsx`) is hidden unless `?debug=1` or a non-production build. Source labels in the sheet say “Web search” or “Company website”. Confidence stays High / Medium / Low.

The preview and the file for the same job contain the same rows. The table says “all N rows” only when the number fetched equals the number the site listed; otherwise “N of M fetched so far”.
