# Scraper build plan (lead system for a digital publishing company)

**Goal.** The user gives only an exhibitor-marketplace URL (first target: event.buchmesse.de, plus two similar sites). The app returns one row per company with decision-makers (name, role, email, phone, LinkedIn). The listing site has company details only, so the app looks each company up itself. Blank means "not found"; nothing is ever guessed.

**AI.** Groq free tier only: `GROQ_API_KEY` env var, `openai/gpt-oss-20b`, fallback `openai/gpt-oss-120b`. 429s are shown to the user with the reset time. The key is never logged.

## Pipeline (per company)
1. **Listing** – scan the marketplace, follow pagination (existing scan/replay/crawl), read exhibitor detail pages.
2. **Website** – the website listed on the exhibitor page; else a verified domain match (country-specific endings); else Groq `browser_search` (budgeted per run). Public search engines answer bots with a challenge, so they are not scraped.
3. **People, deterministic first** – fetch imprint/team/contact/about pages (max 3 per company), read JSON-LD, `mailto:`/`tel:`, German imprint lines ("Geschäftsführer: …"), team cards, LinkedIn links present on the page.
4. **Groq, only for hard cases** – role found but no isolable name. About 700 characters per company, 10 companies per request.
5. **Guards** – a name, email or LinkedIn URL is kept only if it appears verbatim in a fetched page; a role must be near the name; generic mailboxes (info@, office@) are labelled company contact, not a person. Each value carries source URL + confidence (high / medium / low).

## AI providers and the AI queue
- Order: Groq `openai/gpt-oss-20b` → Groq `openai/gpt-oss-120b` → OpenRouter free models (`OPENROUTER_API_KEY`, default `google/gemma-4-31b-it:free`, `openrouter/free`). OpenRouter covers reading requests and names only: its web search is paid even on free models, so AI website search stays on Groq.
- Every company is looked up at once without waiting for AI. Companies that still need AI (website search, name reading) are marked `needsAi` and queued in the job's `ai` stage, which runs whenever the free limits allow: on a daily 429 it saves the reset time, waits, and continues by itself while any tab of the app is open (or when it is next opened), across days, until the queue is empty. The file can be downloaded at any time.

## Free-tier budget
~200K tokens/day per model, 30 requests/min. Target: ≤ 20 requests and ≤ 70K tokens for 300 companies. Per-minute 429: wait ≤ 20 s and retry once; daily 429: switch model; both exhausted: show the error and continue without AI.

## Features
- **A. Plain-words columns** – user types "company, CEO name, email, booth"; exactly those columns are shown/exported (CSV, XLSX) plus `source` and `confidence` per field (toggle).
- **B. Decision-makers** – one row per company, columns for name, role, email, phone, LinkedIn.
- **C. Sign-in** – user enters her own ID/password; used once in an incognito browser context, kept in memory only, never persisted/logged/exported. SSO/MFA/CAPTCHA fall back to cookie paste.

## Vercel
Every long step is batched (≤ 40 s per call) and streamed as NDJSON by a client-driven resumable loop; `maxDuration` ≤ 300 s (≤ 90 s for people batches).

## Milestones (commit each; `tsc` and `build` green; branch `cloud/scraper-build`; never `main`; never deploy)
- **M0 ✅** Groq layer (`lib/groq.ts`), redaction (`lib/redact.ts`), signed-in jobs never written to IndexedDB.
- **M1 ✅** Buchmesse: feed `POST /api/v1/search/exhibitors`, 4,207 exhibitors, 36 per page; full export of all 4,207 rows verified.
- **B ✅** Decision-maker lookup: `lib/roles.ts`, `lib/people.ts`, `lib/company.ts`, `lib/leads.ts`, `/api/people`, `/api/ai-status`, job stage `people`, Decision-makers panel in the UI with a 5-company trial. Measured on the 36 exhibitors of page 1 without AI: 28 websites, 9 named decision-makers, 13 company emails, 9 company LinkedIn pages.
- **A ✅** Chat-style requests (`components/Chat.tsx`, `lib/wishes.ts`, `/api/plan`): link + plain words (EN/DE) -> exactly those columns with source/confidence, follow-up edits, limit and country filter; Groq reads the request when available, rules otherwise.
- **C ✅** Sign-in with login ID and password (`lib/login.ts`, `lib/session.ts`): incognito context, password guard, sealed 2-hour session in memory only; verified on public practice sites.
- **Final** Generic check on two other marketplaces; summary.

## Local testing
`SS_DEV_PROXY=1 NODE_USE_ENV_PROXY=1 CHROME_PATH=… npx next dev` behind an egress proxy without local DNS (never active in production). `GROQ_BASE_URL` (non-production only) points the AI at a fake Groq for tests.

## Known constraints
Live tests need outbound access to event.buchmesse.de, api.groq.com and company sites, and a `GROQ_API_KEY`. Without them only mocked tests run, and the summary will say so.
