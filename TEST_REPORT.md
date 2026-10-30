# Scrape Studio — Real-User Playwright Test Report (`buchmesse.de`)

**Date:** 2026-10-30  
**Browser Engine:** Playwright Chromium (`1440×920` viewport, real downloads enabled)  
**Target Site:** `https://www.buchmesse.de` → `https://www.buchmesse.de/en/visit/exhibitor-directory` → `https://event.buchmesse.de/marketplace/exhibitors` (plus `https://books.toscrape.com/` for DOM `title` attribute untruncation verification)  
**Screenshots & Artifacts:** `test-results/ag-playwright/`

---

## Summary of Checks

| # | Check | Status | Key Evidence |
|---|-------|--------|--------------|
| 1 | **Collapsible website preview & `"Table only"` toggle** | **PASS** | `.preview` results table is the primary top view with real column headers (`Name`, `Country`, `Hall`, `Stand`). Clicking `"Table only"` sets `aria-pressed="true"` and collapses `.desk` & `.sheetbar` (`height: 0px`); clicking again restores `.desk` (`height: 325px`). (`04-buchmesse-exhibitors-directory-loaded.png`, `05-buchmesse-table-only-collapsed-preview.png`, `06-buchmesse-preview-expanded-and-column-pick.png`) |
| 2 | **Matching row counts across list picker, scope, results header, export button, and done message** | **PASS** | Verified on Buchmesse Exhibitors (`36 on page` / `4,207 total` → `36 rows · this page` → `Just this page 36` → `Export 36 rows` → `36 rows saved to exhibitors-frankfurter-buchmesse-2026.xlsx`) and Buchmesse homepage list (`5 on page` → `5 rows · this page` → `Just this page 5` → `Export 5 rows` → `5 rows saved to newsletter.xlsx`). (`02-buchmesse-navigation-warning-and-counts.png`, `09-buchmesse-matching-counts-and-export-done.png`) |
| 3 | **`"No company list found"` message, directory buttons, and navigation warnings** | **PASS** | Scanning `https://www.buchmesse.de` and `https://www.buchmesse.de/en/visit/exhibitor-directory` immediately shows `"No company list found on this page."` in both the results table and side panel, with actionable `"Exhibitor Directory"` and `"Open exhibitor directory"` CTA buttons that navigate directly to `https://event.buchmesse.de/marketplace/exhibitors`. Selecting a navigation list under `"Site navigation menus (3)"` shows the warning banner `"These rows look like site navigation links, not a company list."` (`01-buchmesse-home-no-company-list.png`, `02-buchmesse-navigation-warning-and-counts.png`, `03-buchmesse-directory-landing-cta.png`) |
| 4 | **Plain-language side panel & `"Advanced options"` disclosure** | **PASS** | Section headers show `"4 selected"` / `"2 selected"` (zero occurrences of `"picked"`, `"6 of 44 picked"`, or `"paste an item's address"`). Zero numbered column jargon (`Link 2`, `Title 3`, `Company 2`). Excess columns/fields are tucked under collapsed `<details>` (`"Show more columns (3)"`, `"Show more fields (24)"`), and `"Advanced options"` is collapsed by default (`open: false`) and expands on click to show the example detail page URL input. (`08-buchmesse-plain-language-tray-and-advanced-options.png`) |
| 5 | **Untruncated text** | **PASS** | All 36 Buchmesse exhibitor rows preserve full untruncated company names (`0` occurrences of `...` or `…`, e.g., `"100K Characters Proofread, 10 Min, €10 | editorial.app by BOOKEND"`, `"A.C.E.R. Agencia Literaria Elizabeth Atkins"`). Additionally verified against `https://books.toscrape.com/` where DOM `<a title="...">...</a>` ellipsis text is expanded to full titles (`"A Light in the Attic"`, `"Sapiens: A Brief History of Humankind"`, `"The Boys in the Boat: Nine Americans and Their Epic Quest for Gold at the 1936 Berlin Olympics"`). (`09-buchmesse-matching-counts-and-export-done.png`, `10-untruncated-text-verification.png`) |
| 6 | **Export file opens with the exact same row count** | **PASS** | Downloaded `.xlsx`, `.csv`, and `.json` files via Playwright `download` events and parsed their contents. `exhibitors-frankfurter-buchmesse-2026.xlsx` is a valid ZIP/OOXML workbook whose `xl/worksheets/sheet1.xml` has `37` `<row>` elements (`1` header + `36` data rows), matching the `36` rows in the UI and `.json` export (`36` objects). Also verified `newsletter.xlsx` (`6` XML rows = `1` header + `5` data rows) and `all-products.xlsx` (`21` XML rows = `1` header + `20` data rows). |

---

## Detailed Check-by-Check Evidence

### 1. `"No company list found"` Message, Directory CTA Buttons & Navigation Warning
- **Step 1 (`https://www.buchmesse.de`):**
  - Main preview header aside: `"No company list found on this page"`
  - Main preview body: `"No company list found on this page. This page does not contain a directory table or repeating company cards of its own. Make sure you are on the directory listing page, or click a company on the page preview below to mark it manually."`
  - Directory CTA button rendered in both main preview and right-hand `"Found on this page"` section: **`"Exhibitor Directory"`**.
  - Site navigation menus are tucked inside a collapsed `<details>` disclosure: **`"Site navigation menus (3)"`** (`open === false`).
  - **Screenshot:** `test-results/ag-playwright/01-buchmesse-home-no-company-list.png`
- **Step 1B (Selecting a Navigation Menu on `https://www.buchmesse.de`):**
  - Expanding `"Site navigation menus (3)"` and clicking `"Newsletter · 5 items"` (`5 on page`, `Menu / nav` badge) displays:
    - Preview banner: **`"These rows look like site navigation links, not a company list."`** + **`"Exhibitor Directory"`** button.
    - Side panel warning: **`"These rows look like site navigation rather than a company list."`**
    - Clean column names: **`["Page link", "Title"]`** (`2 selected`), with hidden `.header__megaDropdown` sub-menus excluded.
  - **Screenshot:** `test-results/ag-playwright/02-buchmesse-navigation-warning-and-counts.png`
- **Step 2 (Clicking `"Exhibitor Directory"` → `https://www.buchmesse.de/en/visit/exhibitor-directory`):**
  - Clicking `"Exhibitor Directory"` automatically scans `https://www.buchmesse.de/en/visit/exhibitor-directory`.
  - Displays `"No company list found on this page."` and the **`"Open exhibitor directory"`** CTA button in both the main preview and side panel.
  - **Screenshot:** `test-results/ag-playwright/03-buchmesse-directory-landing-cta.png`
- **Step 3 (Clicking `"Open exhibitor directory"` → `https://event.buchmesse.de/marketplace/exhibitors`):**
  - Clicking `"Open exhibitor directory"` follows the link to the live Frankfurt Book Fair exhibitor directory (`https://event.buchmesse.de/marketplace/exhibitors`) and loads the exhibitor dataset (`36 on page`, `4,207 total`) with clean columns: **`Name`**, **`Country`**, **`Hall`**, **`Stand`**.
  - **Screenshot:** `test-results/ag-playwright/04-buchmesse-exhibitors-directory-loaded.png`

---

### 2. Collapsible Website Preview & `"Table only"` Toggle
- **Initial state (`tableOnly = false`):**
  - `.preview` (Results table) is the primary view at the top with column headers `["Row", "Name", "Country", "Hall", "Stand"]`.
  - `"Table only"` toggle button in `.preview-head` has `aria-pressed="false"`.
  - Website preview `.desk` is visible below the table (`height: 324.8px`).
- **Collapsed state (`tableOnly = true`):**
  - Clicking `"Table only"` sets `aria-pressed="true"`.
  - `.desk` and `.sheetbar` both receive class `collapsed` (`getBoundingClientRect().height === 0`), expanding the results table to fill the workspace.
  - **Screenshot:** `test-results/ag-playwright/05-buchmesse-table-only-collapsed-preview.png`
- **Restored state (`tableOnly = false`):**
  - Clicking `"Table only"` again sets `aria-pressed="false"` and restores `.desk` (`height: 324.8px`) and `.sheetbar`.
  - **Screenshot:** `test-results/ag-playwright/06-buchmesse-preview-expanded-and-column-pick.png`

---

### 3. Plain-Language Side Panel & `"Advanced options"` Disclosure
- **Plain-language count badges:**
  - `"On each row"` header aside: **`"4 selected"`** (on Buchmesse Exhibitors) / **`"2 selected"`** (on Buchmesse nav list).
  - Zero occurrences of `"picked"` (e.g. `"6 of 44 picked"`) or `"paste an item's address"` anywhere in `.tray`.
- **Natural column names (no numbered jargon):**
  - Columns on Buchmesse Exhibitors: `["Name", "About", "Url", "Country", "Logo", "Hall", "Stand", "Stand name", "Count child exhibitors", "Role", "Object type"]` (`0` occurrences of `Link 2`, `Title 3`, `Company 2`, etc.).
- **Progressive disclosure (`<details class="extra">`):**
  - `"Show more columns (3)"` and `"Show more fields (24)"` are collapsed by default (`open === false`).
  - `"Advanced options"` in `"From each item's own page"` is collapsed by default (`open === false`). Clicking its summary expands it (`open === true`) to reveal:
    > *"Try a different example page if some companies show extra details (like team members or contact info)."*  
    > Input placeholder: `https://…/company-profile` + button `"Use example"`.
  - **Screenshot:** `test-results/ag-playwright/08-buchmesse-plain-language-tray-and-advanced-options.png`

---

### 4. Matching Row Counts & Export File Verification
- **Buchmesse Exhibitors (`https://event.buchmesse.de/marketplace/exhibitors`):**
  - **List picker (`Found on this page`):** `Exhibitors` — **`36 on page`** · **`4,207 total`**
  - **Scope picker (`How much`):**
    - `Every page, from the site's data`: **`4,207`** (Export button: **`"Get all 4,207 rows"`**)
    - `Just this page`: **`36`**
  - **Results table header (`.preview-head .aside`):** **`"36 rows · this page"`** (and `36` rendered `<tbody><tr>` rows)
  - **Export button (`.exportrow button.btn-primary`):** **`"Export 36 rows"`**
  - **Toast notification (`.toast`):** **`"36 rows saved to exhibitors-frankfurter-buchmesse-2026.xlsx"`**
  - **Persistent done message (`.exportbar .note.ok`):** **`"36 rows saved to exhibitors-frankfurter-buchmesse-2026.xlsx. Pick another format to download again."`**
  - **Downloaded `.xlsx` verification (`exhibitors-frankfurter-buchmesse-2026.xlsx`):**
    - Valid OOXML ZIP archive containing `[Content_Types].xml`, `xl/workbook.xml`, `xl/worksheets/sheet1.xml`, `xl/sharedStrings.xml`, etc.
    - `xl/worksheets/sheet1.xml` contains **`37` `<row>` elements** (`1` header row + **`36` data rows**).
  - **Downloaded `.json` verification (`exhibitors-frankfurter-buchmesse-2026.json`):**
    - Parses cleanly to an array of **`36` objects** with keys `["Name", "Country", "Hall", "Stand"]`.
    - Sample first row:
      ```json
      {
        "Name": "100K Characters Proofread, 10 Min, €10 | editorial.app by BOOKEND",
        "Country": "Republik Korea",
        "Hall": "Halle 5.1",
        "Stand": "A157"
      }
      ```
  - **Screenshot:** `test-results/ag-playwright/09-buchmesse-matching-counts-and-export-done.png`

---

### 5. Untruncated Text Verification
- **Buchmesse Exhibitors (`https://event.buchmesse.de/marketplace/exhibitors`):**
  - All 36 rows contain full company names with `0` ellipsis-truncated values (`"100K Characters Proofread, 10 Min, €10 | editorial.app by BOOKEND"`, `"A.C.E.R. Agencia Literaria Elizabeth Atkins"`, `"Actes Sud Jeunesse (part of Actes Sud)"`).
- **DOM `title` Attribute Expansion (`https://books.toscrape.com/`):**
  - On `https://books.toscrape.com/`, the page's visible link text is truncated with `...` in the HTML (`<a title="A Light in the Attic">A Light in the ...</a>`, `<a title="Sapiens: A Brief History of Humankind">Sapiens: A Brief History ...</a>`).
  - Scrape Studio's extractor reads the full `title` attribute so the results table and exported `.xlsx` file (`all-products.xlsx`, `20` data rows) contain the full untruncated strings (`0` truncated cells out of `20`):
    - `"A Light in the Attic"`
    - `"Sapiens: A Brief History of Humankind"`
    - `"The Dirty Little Secrets of Getting Your Dream Job"`
    - `"The Coming Woman: A Novel Based on the Life of the Infamous Feminist, Victoria Woodhull"`
    - `"The Boys in the Boat: Nine Americans and Their Epic Quest for Gold at the 1936 Berlin Olympics"`
    - `"Mesaerion: The Best Science Fiction Stories 1800-1849"`
  - **Screenshot:** `test-results/ag-playwright/10-untruncated-text-verification.png`

---

## Fixes Applied & Verified During Testing

1. **Hidden Mega-Dropdowns & Carousel Clones ([`lib/extractor.js`](lib/extractor.js)):**
   - Added `hiddenInItem` check in `collectLeaves` to ignore hidden `.header__megaDropdown` / `[hidden]` / `[aria-hidden="true"]` / `display: none` sub-trees inside `<li>` navigation items so site menus don't extract 40+ hidden submenu columns.
   - Ignored `.slick-cloned` carousel clones and image/link-only partner logo carousels with zero text columns.
   - Tightened `DIR_HREF` and `findDirectoryLinks()` so single exhibitor profile links (`/exhibitor/<slug>`), language switchers (`EN`/`DE`), and self-links (ignoring `/en` or `/de` locale prefixes) are not misclassified as directory CTAs.
2. **Row Count & Column Naming Consistency ([`lib/model.ts`](lib/model.ts), [`lib/studio-state.ts`](lib/studio-state.ts)):**
   - Unified `listRowCount` in `lib/model.ts` with `visiblePageRows(ws ?? openWorkspace(list, ...))` so the list picker count always matches the table header, scope picker, and export button before and after clicking any list.
   - Improved `bestName`, `wantedByDefault`, and `uniqueNames` in `lib/model.ts` so matched feed columns (`Country`) replace generic `Company` guesses, internal URL slug fields default to off, and duplicate column names use natural labels without stacking qualifiers.
   - Avoided auto-activating tiny (`<6` row) homepage widgets when a directory link is present so landing pages immediately display `"No company list found on this page."` and the directory CTA button.
3. **Directory Scan Speed & UI Polish ([`lib/scan.ts`](lib/scan.ts), [`components/Studio.tsx`](components/Studio.tsx), [`components/Tray.tsx`](components/Tray.tsx)):**
   - Updated the retry loop in `lib/scan.ts` to stop immediately when a directory landing page (`shape.dir && shape.text > 400`) is detected instead of reloading twice waiting for a JSON feed.
   - Included the active feed in `Found on this page` (`ListsFound`) with both `<N> on page` and `<Total> total` counts while filtering out facet/filter option feeds.
   - Added persistent `.exportbar .note.ok` confirmation on instant page exports alongside the toast notification.
