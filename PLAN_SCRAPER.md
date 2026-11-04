# Scraper build plan (lead system for a digital publishing company)

**Goal.** The user gives only an exhibitor-marketplace URL (first target: event.buchmesse.de, plus two similar sites). The app returns one row per company with decision-makers (name, role, email, phone, LinkedIn). The listing site has company details only, so the app looks each company up itself. Blank means "not found"; nothing is ever guessed.

**AI.** Groq free tier only: `GROQ_API_KEY` env var, `openai/gpt-oss-20b`, fallback `openai/gpt-oss-120b`. 429s are shown to the user with the reset time. The key is never logged.

## Pipeline (per company)
1. **Listing** – scan the marketplace, follow pagination (existing scan/replay/crawl), read exhibitor detail pages.
2. **Website** – use the website link on the exhibitor page. Only if missing, run one public web search for the official domain (budgeted).
3. **People, deterministic first** – fetch imprint/team/contact/about pages (max 3 per company), read JSON-LD, `mailto:`/`tel:`, German imprint lines ("Geschäftsführer: …"), team cards, LinkedIn links present on the page.
4. **Groq, only for hard cases** – role found but no isolable name. About 700 characters per company, 10 companies per request.
5. **Guards** – a name, email or LinkedIn URL is kept only if it appears verbatim in a fetched page; a role must be near the name; generic mailboxes (info@, office@) are labelled company contact, not a person. Each value carries source URL + confidence (high / medium / low).

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
- **M1** Probe Buchmesse + pagination, real row count. *(needs network access to event.buchmesse.de)*
- **A** `lib/wishes.ts`, input box, exact columns, per-field source/confidence.
- **B** `lib/roles.ts`, `lib/people.ts`, website discovery, `/api/people`, job stage `people`.
- **C** `lib/login.ts`, `lib/session.ts`, sign-in dialog.
- **Final** Generic check on two other marketplaces; summary.

## Known constraints
Live tests need outbound access to event.buchmesse.de, api.groq.com and company sites, and a `GROQ_API_KEY`. Without them only mocked tests run, and the summary will say so.
