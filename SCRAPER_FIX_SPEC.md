# Scraper Fix Specification (`SCRAPER_FIX_SPEC.md`)

## Persona & Goal
As a **non-technical trade-fair researcher**, I want to paste a trade fair exhibitor page (such as Frankfurter Buchmesse) or catalogue demo, immediately see a clean table of companies with real column names, and export complete, untruncated company lists along with their decision-makers—without ever reading HTML jargon, guessing why row counts don't match, or accidentally exporting a website's navigation bar.

---

## Phase 1: Immediate UX & Extraction Fixes (Build Now)

Each task below is ordered, self-contained, verified with `npm test` and `npm run build`, and committed locally.

### Task 1: Make the results table the main view with real column names and a collapsible website preview (`'Table only'` toggle)
**Problem:**
The frozen website preview takes ~70% of the screen and cannot be collapsed, while the results table is squeezed into the bottom (`34vh`) with generic headers (`Title`, `Text`, `Link`).

**Implementation:**
1. **Results Table as Main View (`components/Studio.tsx`, `components/Preview.tsx`, `app/globals.css`)**:
   - Promote the results table (`Preview`) to the primary workspace view so users see their spreadsheet rows and columns first.
   - Give the results table the primary flexible space in `.deskcol` and size the website preview compactly beneath or beside it when open.
2. **Collapsible Website Preview with `'Table only'` Toggle (`components/Studio.tsx`, `app/globals.css`)**:
   - Add a `'Table only'` toggle button (`aria-pressed={tableOnly}`) in the workspace bar / table header.
   - When `'Table only'` is active, collapse the `.desk` website preview container (`display: none` / `.collapsed` while keeping the `<Sheet>` iframe mounted in the DOM) so the results table fills 100% of the main area.
   - When `'Table only'` is off, the website preview is visible and clicking elements on the page continues to add/remove columns and highlight them with marker ink.
3. **Real Column Names (`lib/extractor.js`, `lib/model.ts`)**:
   - Enhance semantic column naming in `lib/extractor.js` and `lib/model.ts` to infer human-meaningful column names from attributes, class names, link targets, and cell values (e.g., `Title`, `Price`, `Availability`, `Rating`, `Page link`, `Website`, `Company`, `Country`, `Hall`, `Stand`).

**Acceptance Criteria:**
- [ ] The results table is the main view in the workspace and displays real, human-readable column headers.
- [ ] A `'Table only'` toggle button collapses and expands the website preview without breaking the iframe state.
- [ ] Column picking by clicking elements inside the website preview still works when the preview is expanded.
- [ ] `npm test` and `npm run build` succeed.

---

### Task 2: Show one consistent row count everywhere
**Problem:**
Row counts disagree across the UI (e.g., the export button says `4`, the preview header says `3 of 4`, and the completion toast says `3 saved`) because empty/placeholder DOM items are counted in `list.count` (`onPage`) but filtered out by `hasPageContent(ws)` when rendering the preview and exporting.

**Implementation:**
1. **Filter Empty DOM Siblings at Detection Time (`lib/extractor.js`)**:
   - In `makeList` / `buildColumns`, drop candidate child elements that have no extracted text, link, or image values across the list's columns so `list.count` reflects real rows.
2. **Single Canonical Row Count (`lib/model.ts`, `components/Studio.tsx`, `components/Preview.tsx`, `components/Tray.tsx`)**:
   - Add a helper `countPageRows(ws, list, feed)` in `lib/model.ts` that returns `pageRows(ws, list, feed).filter(hasPageContent(ws)).length`.
   - Use this exact count for `onPage`, `expectedRows` (in page scope), `ListsFound` per-list counts, `ScopePicker` ("Just this page"), `Preview` (`total` when viewing the current page), and the export button label (`Export N rows`).
   - In `Preview.tsx`, when showing page rows where `rows.length === total` and `rows.length <= SHOW`, render the count consistently so it never says `3 of 4 rows`.

**Acceptance Criteria:**
- [ ] The list selector, scope picker, results table header, export button, and saved toast all display the exact same row count.
- [ ] Empty or ad-slot DOM elements inside a repeating container do not create a discrepancy between `onPage` and exported rows.
- [ ] Unit self-checks in `lib/model.ts` verify row count consistency.
- [ ] `npm test` and `npm run build` succeed.

---

### Task 3: Prevent silent failure on landing pages, detect directory links, and warn when rows look like navigation
**Problem:**
On `https://www.buchmesse.de/en/visit/exhibitor-directory`, the page is a visitor info page with no exhibitor list on it—only a call-to-action link to open the exhibitor directory. The scraper silently picked the top navigation menu as the active list and exported menu labels.

**Implementation:**
1. **Navigation List Detection (`lib/extractor.js`, `lib/model.ts`, `lib/studio-state.ts`)**:
   - Flag lists that sit in site chrome (`nav`, `header`, `footer`, `[role=navigation]`, menu classes) or whose items look like navigation menus (short link-only items, ≤ 2 columns where values are short menu labels and internal section links) with `nav: true`.
   - In `lib/studio-state.ts`, do not auto-activate a `nav: true` or `chrome: true` list when `ready` fires if no real data list or feed was found.
2. **Directory CTA Link Detection (`lib/extractor.js`, `lib/studio-state.ts`, `components/Studio.tsx`)**:
   - Scan the page for prominent links/buttons pointing to an exhibitor or company directory (e.g., text matching `"Open exhibitor directory"`, `"Exhibitor directory"`, `"Go to exhibitor directory"`, `"Search exhibitors"`, `"All exhibitors"`, `"Company directory"`, `"Ausstellerverzeichnis"`, or URLs matching `/marketplace/exhibitors`, `/exhibitors`, `/exhibitor-directory`, `event.*`).
   - Surface these detected directory links in the UI so the user can follow/scan them with one click.
3. **Plain Empty State & Navigation Warning (`components/Studio.tsx`, `components/Preview.tsx`, `components/Tray.tsx`)**:
   - When a page has no real company/data list (only navigation menus or nothing at all), display a clear message: **`No company list found on this page`** along with any detected directory links (e.g., **`Open exhibitor directory`**) to follow.
   - If the user selects or views a list flagged as navigation (`nav: true` or `looksLikeNavigation`), show an explicit warning banner: **`These rows look like site navigation links, not a company list.`**

**Acceptance Criteria:**
- [ ] Scanning a page that only has navigation menus and a directory link shows `"No company list found on this page"` instead of auto-selecting the nav menu.
- [ ] Links like `"Open exhibitor directory"` are detected and offered as one-click buttons that scan the target directory URL.
- [ ] Selecting a list that looks like navigation displays a clear warning banner in both the table and side panel.
- [ ] `npm test` and `npm run build` succeed.

---

### Task 4: Rewrite the side panel in plain words and hide advanced options
**Problem:**
The side panel exposes confusing jargon (`'Link 2'`, `'Title 3'`, `'6 of 44 picked'`, `'paste an item's address'`, `'on-screen only'`) and shows advanced controls inline.

**Implementation:**
1. **Eliminate `'Link 2'` / `'Title 3'` Jargon (`lib/extractor.js`, `lib/model.ts`)**:
   - Improve column naming so links, titles, and text fields get meaningful names from context, URL path segments, or content (e.g., `Page link`, `Website`, `Profile link`, `Book title`, `Availability`, `Price`, `Rating`, `Subtitle`, `Summary`, `Details`).
   - Update `uniqueNames` in `lib/extractor.js` and `lib/model.ts` so collisions are disambiguated with plain descriptive labels or sample hints rather than raw numbers like `Link 2` or `Title 3`.
2. **Plain-Language Side Panel Copy (`components/Studio.tsx`, `components/Tray.tsx`)**:
   - Change `"6 of 44 picked"` to `"6 selected"` (or `"6 columns selected"`).
   - Replace technical source badges (`on-screen only`, `every page`, `on page`, `site data`) with unobtrusive plain-English tooltips/labels or hide them when redundant.
   - Rewrite section headings and hints in plain everyday language while keeping DOM structure compatible with existing workflows.
3. **Hide Advanced Options (`components/Tray.tsx`, `components/Studio.tsx`)**:
   - When a workspace or detail page has many unselected fields, show the active/recommended columns first and group unselected extra fields under a collapsed `<details>` (`"Show more fields"`).
   - Move manual detail-page URL entry (rewritten in plain words without `"paste an item's address"`) and extra raw API fields into collapsed `<details>` (`"Advanced options"`).

**Acceptance Criteria:**
- [ ] `'Link 2'`, `'Title 3'`, `'6 of 44 picked'`, and `'paste an item's address'` never appear in the UI.
- [ ] Column names and side-panel headings use plain, non-technical words.
- [ ] Advanced controls (custom detail page sample link, extra raw fields) are hidden inside collapsed `<details>` disclosures by default.
- [ ] `npm test` and `npm run build` succeed.

---

### Task 5: Fix truncated text (`'A Light in the ...'`) using `title` attributes and detail pages
**Problem:**
On catalogue and directory pages (such as the books demo `books.toscrape.com`), long titles are truncated in the visible text (`"A Light in the ..."`) even though the full title (`"A Light in the Attic"`) is present in the element's `title` attribute or on its linked detail page.

**Implementation:**
1. **Prefer Full Text from `title` / `aria-label` / `data-*` Attributes (`lib/extractor.js`, `lib/items.ts`)**:
   - In `extractor.js` (`ownText` / `fullText` / `readValue` / `collectLeaves`) and `lib/items.ts` (`readValue`), inspect `title`, `data-title`, `data-full-text`, and `aria-label` on the element (or its closest `<a>` / child with `title`).
   - When visible text is truncated (ends with `...` or `…`) or when the `title` attribute starts with the visible text's prefix and is longer, return the full `title` attribute text instead of the truncated string.
2. **Recover Full Text from Detail Pages (`lib/items-client.ts`, `lib/model.ts`)**:
   - When detail pages (`item` pages) are sampled or read during export (`assemble` in `lib/items-client.ts` and `catalogue` in `lib/studio-state.ts`), check if any base row cell ends with `...` or `…`.
   - If a detail page for that row was read and has a matching full field (such as `Name` / `Title` / `<h1>` whose normalized text starts with the truncated prefix), automatically replace the truncated cell value with the full detail-page value.
3. **Readable Table Cells (`app/globals.css`, `components/Preview.tsx`)**:
   - Widen the maximum cell width and allow clean text display in the main results table so full company names and book titles are easy to read.

**Acceptance Criteria:**
- [ ] `<a title="A Light in the Attic">A Light in the ...</a>` extracts as `"A Light in the Attic"` in both the preview table and exported files.
- [ ] Truncated values without a `title` attribute are expanded when their detail page is read and contains the full heading/text.
- [ ] Self-checks in `lib/items.ts` and `lib/items-client.ts` verify both `title`-attribute and detail-page de-truncation.
- [ ] `npm test` and `npm run build` succeed.

---

## Phase 2: Goal-Driven Extraction & Decision-Maker Enrichment (Spec Only — Do Not Build Yet)

> **Note:** Phase 2 is specified below for review and architecture alignment. It is **not** implemented in Phase 1.

### 1. Goal Box (`"company name, website, decision-maker"`)

#### User Experience
- Above or beside the URL bar, provide a plain-language **Goal Box**:
  - Label: *"What do you want to collect?"*
  - Placeholder / quick chips: `"company name, website, decision-maker"`, `"exhibitors, country, hall/stand"`, `"book title, price, availability"`.
- The user can leave it blank (standard auto-detection) or type/select what they need in plain words.

#### Automatic List & Column Selection
1. **Intent Parsing**:
   - Parse the goal string into requested field intents (e.g., `company` -> organization name; `website` -> external company URL; `decision-maker` -> person name + role/designation from detail page or company site; `email` / `phone` -> contact details).
2. **Candidate List Ranking**:
   - Score every detected DOM list and captured API feed against the requested intents (semantic match on column names, sample values, and detail-page availability).
   - Automatically reject navigation lists (`nav: true`) and pick the dataset that best satisfies the goal.
3. **Column Auto-Picking**:
   - Turn on (`on: true`) only the columns that match the user's stated goal (plus the primary identifier column), and automatically enable relevant detail-page (`item`) or enrichment columns when `"decision-maker"`, `"CEO"`, `"contact"`, or `"Impressum"` is requested.
4. **Self-Verification Check**:
   - After extracting a sample of rows, run a deterministic + optional lightweight LLM check on the resulting table:
     - Are at least 80% of `"company name"` cells non-empty and non-navigation strings?
     - Are `"website"` cells valid external URLs (not internal trade-fair links)?
     - If any requested field is missing on the listing page, automatically trigger detail-page / Impressum enrichment or show a plain status banner explaining what was found and what will be fetched from company websites.

---

### 2. Decision-Maker Enrichment from Company Websites (Impressum & Team Pages)

#### Why Impressum & Team Pages Matter for Trade Fairs
German and European trade fair exhibitors (like Frankfurter Buchmesse) are legally required under § 5 DDG (formerly TMG) to publish an **Impressum** (*Legal Notice*) on their company website naming their authorized representatives (*Vertretungsberechtigte Geschäftsführer*, *Vorstand*, *Inhaber*, *Verlagsleitung*). Combining each exhibitor's external website with `/impressum` and `/team` page discovery yields high-accuracy decision-maker names and roles even when the trade fair directory itself lists no staff.

#### Open-Source Library Stack (MIT / Apache-2.0 Only — No AGPL)
To keep the codebase permissive and SaaS-ready, **only MIT, ISC, BSD, or Apache-2.0 licensed libraries** may be used (explicitly excluding AGPL-3.0 tools such as Firecrawl or ScrapeGraphAI):
- **Crawler & Markdown/DOM Extraction**:
  - **Crawl4AI** (`Apache-2.0`, Python microservice/worker) or **Stagehand** (`MIT`, `@browserbasehq/stagehand` on Node/Playwright) or **LLM Scraper** (`MIT`, `llm-scraper` on Node) alongside the existing `puppeteer-core` (`Apache-2.0`) + `linkedom` (`ISC`) + `@mozilla/readability` (`Apache-2.0`).
- **LLM Provider (Free Tier)**:
  - **Groq API** (`llama-3.3-70b-versatile` or `llama-3.1-8b-instant`) or **OpenRouter** free models (`meta-llama/llama-3.3-70b-instruct:free`, `qwen/qwen-2.5-72b-instruct:free`) via standard OpenAI-compatible REST calls with `response_format: { type: "json_object" }`.

#### Enrichment Pipeline Architecture
1. **Step 1 — Resolve Company Website**:
   - Take the company's external website URL from the directory feed or exhibitor detail page (filtering out social media domains and the trade fair's own host, and validating via `assertPublicUrl` SSRF guard).
2. **Step 2 — Discover Legal & Team Pages**:
   - Fetch the company homepage (static `safeFetch` first; fallback to headless Chromium only if empty).
   - Scan `<a href>` links for high-signal targets:
     - **Impressum / Legal**: `/impressum`, `/imprint`, `/legal-notice`, `/mentions-legales`, `/rechtliches`, link text matching `Impressum|Imprint|Legal Notice`.
     - **Team / Leadership / About**: `/team`, `/about`, `/about-us`, `/ueber-uns`, `/uber-uns`, `/management`, `/leadership`, `/verlag`, `/kontakt`, `/contact`.
   - Fetch the top 1–3 matched pages per company (prioritizing Impressum first, then Team/About), stripping scripts/styles and converting main content to clean text.
3. **Step 3 — Structured LLM Extraction**:
   - Send the cleaned text (truncated to 12,000 chars per page) to Groq / OpenRouter with a strict system prompt:
     ```json
     {
       "decisionMakers": [
         {
           "name": "Exact full name as written on the page",
           "role": "Exact role or title (e.g., Geschäftsführer, CEO, Publishing Director, Inhaber)",
           "sourceUrl": "https://company.example/impressum",
           "evidence": "Verbatim sentence or line from the page containing the name and role"
         }
       ]
     }
     ```
4. **Step 4 — Strict Verbatim Hallucination Guard (Word-for-Word Verification)**:
   - Before accepting any extracted person:
     - Normalize whitespace on both the source page's visible text and the extracted `name` (`text.replace(/\s+/g, " ").trim()`).
     - **Rule**: `sourcePageText.includes(extractedName)` **must be `true` word for word** (case-sensitive or exact Unicode token match), and `extractedName` must contain at least two name tokens (no single-word placeholders or company names).
     - Any extracted record whose `name` does not appear word for word on the fetched page is **immediately discarded**.
5. **Step 5 — Output Columns & Provenance**:
   - Append `Decision-maker name`, `Decision-maker role`, and `Decision-maker source URL` to the company row (expanding multiple verified decision-makers into rows or semicolon-separated values based on user preference), so every contact in the exported spreadsheet has a clickable source URL proving where their name was found.
