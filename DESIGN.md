---
name: Scrape Studio
description: Paste a link, mark what you want on the page, export every page of it.
colors:
  paper: "#ffffff"
  desk: "#e7e9ec"
  desk-deep: "#dcdfe3"
  chrome: "#f4f5f6"
  graphite: "#1d1f22"
  graphite-2: "#464b53"
  graphite-3: "#62676f"
  rule: "#d4d8dd"
  rule-strong: "#b9bfc6"
  danger: "#b3261e"
  danger-paper: "#fdf0ef"
  ok: "#10703f"
  warn: "#7a4a00"
  ink-yellow: "#f7e733"
  ink-pink: "#ff6fae"
  ink-green: "#7ded6f"
  ink-blue: "#62ccff"
  ink-orange: "#ffab4a"
  ink-violet: "#c79bff"
  ink-mint: "#5ff2d4"
  ink-coral: "#ff8a7a"
typography:
  display:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 700
    letterSpacing: "-0.005em"
  body:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "\"ss01\", \"cv11\""
  label:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, Cascadia Mono, monospace"
    fontSize: "12px"
    fontWeight: 400
    letterSpacing: "-0.01em"
    fontFeature: "\"tnum\""
rounded:
  sheet: "3px"
  r-1: "4px"
  r-2: "7px"
  r-3: "11px"
  pill: "20px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "18px"
  xl: "22px"
components:
  button-primary:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.paper}"
    rounded: "{rounded.r-2}"
    padding: "0 15px"
    height: "38px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.graphite}"
    rounded: "{rounded.r-2}"
    padding: "0 15px"
    height: "38px"
  button-quiet-hover:
    backgroundColor: "{colors.paper}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.graphite-2}"
    rounded: "{rounded.r-2}"
    padding: "0 9px"
    height: "32px"
  field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.r-2}"
    padding: "0 10px 0 12px"
    height: "38px"
  marker-cap:
    rounded: "5px 5px 4px 4px"
    width: "20px"
    height: "26px"
  list-row-active:
    backgroundColor: "{colors.chrome}"
    rounded: "{rounded.r-2}"
    padding: "8px"
  scope-card-checked:
    backgroundColor: "{colors.chrome}"
    rounded: "{rounded.r-2}"
    padding: "10px 11px"
  format-segment-checked:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.paper}"
    height: "34px"
  toast:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.paper}"
    rounded: "{rounded.r-2}"
    padding: "9px 14px"
  popover:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.r-3}"
    padding: "14px"
---

# Design System: Scrape Studio

## Overview

**Creative North Star: "Highlighter on the Printout"**

The page you paste is a sheet of white office paper lying on a cool gray desk. You run a highlighter over what you want; each ink becomes a column. Everything else is graphite: type, rules, the primary button. Color exists only where the user has marked something.

The tool is dense and quiet, like a desk accessory: hairline rules, small type, flat paper surfaces that lift off the desk only where they are sheets. It deliberately refuses the scraper-console default of endpoint lists, selector boxes and dark dashboards. Light by design: the scene is a desk in daylight beside a spreadsheet.

**Key Characteristics:**
- White paper on a cool gray desk, graphite ink for all type.
- Eight fluorescent inks, used only as column identity, multiplied over the words.
- Marker-cap swatches toggle columns; the ink sweeps on when a column is added.
- Hairline graphite rules; paper lifts, chrome stays flat.
- Mono only for counts, numbers and addresses.

## Colors

A graphite-on-paper neutral system with eight fluorescent column inks and nothing else chromatic.

### Primary
- **Graphite** (`graphite`): all primary type, primary button fill, focus ring, checked states (format segment, scope card border). Hover deepens to pure black.

### Neutral
- **Office Paper** (`paper`): the sheet, the tray, fields, popovers, preview table.
- **Cool Desk** (`desk`): the body background the paper sits on. `desk-deep` is its shadowed variant.
- **Chrome** (`chrome`): top bar, hover and selected row fills, meter track, in-table row dividers.
- **Graphite 2 / 3** (`graphite-2` 8.9:1, `graphite-3` 5.6:1 on paper): secondary text and meta/samples respectively.
- **Rule / Rule Strong** (`rule`, `rule-strong`): hairline dividers; field and quiet-button borders.

### Status
- **Danger** (`danger` on `danger-paper`), **Ok** (`ok`), **Warn** (`warn`): notes, error box and tags only; text color, never fills beyond the error box.

### Column inks
Yellow, pink, green, blue, orange, violet, mint, coral (`ink-*`, order as in `INKS`). Assigned in order to columns; the next free ink goes to a newly added column. Yellow doubles as the one "house" highlighter: text selection, the active list name, the progress meter, and the `.hl` marker swipe in the blank-state headline.

**The Ink Means Column Rule.** A fluorescent ink appears only to identify a column (cap, header stripe, marked text on the sheet) or as the yellow house highlighter. Never for buttons, status, decoration or brand.

**The Multiply Rule.** On the sheet, inks are laid as a flat fill with `mix-blend-mode: multiply` and text forced to near-black (#16181b), so the words stay legible under any ink.

## Typography

**Body Font:** Hanken Grotesk (ui-sans-serif, system-ui fallback), stylistic sets ss01 and cv11 on.
**Mono Font:** JetBrains Mono 400/500, tabular numerals.

**Character:** A warm, compact grotesk doing all the talking; mono is a measuring tool, not a voice.

### Hierarchy
- **Display** (700, 34px, 1.12, -0.03em; 27px under 920px): blank-state headline only, max 18ch, balanced.
- **Headline** (700, 20px, -0.02em): the scanning "printing" status.
- **Title** (700, 13.5px): section heads in the tray and preview. Brand is 700/15px.
- **Body** (400, 14px/1.45): UI default. Long-form paper copy is 16px/1.6, max 60ch.
- **Label** (400-600, 12-13px): meta, samples, asides, badges (11.5px/600).
- **Mono** (12-13px): URLs in the field, host, row numbers, counts, number inputs, step counters, cookie textarea.

**The Mono Is a Ruler Rule.** JetBrains Mono is for numbers, counts and addresses only. Plain words, labels and headings are never mono; placeholders fall back to sans.

## Layout

App is a two-row grid: 60px top bar, then the workspace. The workspace is the desk column (sheet bar, sheet, preview) plus a fixed tray on the right (392px; 356px under 1180px). Gutters are 22px on the desk, 18px in the tray; spacing moves in 4px steps with 8/12/18/22 as the working values.

**Below 920px** the tray collapses under the sheet: the grid becomes a single flex column, the desk column dissolves (`display: contents`), and the order is page (sheet bar, sheet at 62vh) then tray then preview. The URL form wraps to its own full-width row, gutters tighten to 14px, the sheet hint hides, the tray scrolls with the page, and the cookie panel pins to the bottom. Under 480px the URL button drops its label and format labels shrink to 12px.

## Elevation & Depth

Hybrid: surfaces are flat and separated by hairline rules, except paper, which lifts off the desk.

### Shadow Vocabulary
- **Lift** (`0 1px 1px rgba(20,24,30,.06), 0 6px 18px -6px rgba(20,24,30,.18)`): preview card, example chip hover.
- **Lift High** (`0 2px 3px rgba(20,24,30,.06), 0 22px 44px -18px rgba(20,24,30,.32)`): the sheet, blank-state paper, popover, cookie panel, toast.
- **Export shelf** (`0 -10px 18px -14px rgba(20,24,30,.35)`): the sticky export bar over the tray scroll; removed when stacked.

**The Paper Lifts Rule.** Only sheets of paper and things floating above them cast shadows. Tray, top bar, rows and cards stay flat.

## Shapes

Small, office-supply corners: the sheet and paper are nearly square (3px); controls use 7px; small inputs and icon buttons 4px; floating panels 11px; badges are pills. The marker cap is the one silhouette: a 20x26 cap, slightly rounder at the top (5px 5px 4px 4px) with a glossy highlight bar. Borders are 1px hairlines; dashed borders mean "off" or "optional" (off caps, the extras divider, list-item outlines on the sheet).

## Components

### Buttons
Graphite, compact, 38px (30px small).
- **Primary:** graphite fill, white 600 text; hover to black.
- **Quiet:** transparent with `rule-strong` border; hover fills paper, border darkens to `graphite-3`.
- **Ghost:** 32px, `graphite-2` text, hover 6% graphite wash. **Icon button** 30px square, 4px corners.
- **All:** press nudges down 1px; disabled at 55% opacity, not-allowed cursor; spinner rotates 0.9s. Link-style buttons are underlined `graphite-2` text.

### Fields
Paper, `rule-strong` border, 7px corners, 38px. Hover darkens border to `graphite-3`; focus goes graphite with a 3px 10% graphite halo. URL input text is mono 13px. Mini selects/number inputs are 28px with 4px corners and a graphite border on focus.

### Marker Cap Toggle
The column's on/off switch, filled with its ink. On: ink fill, 1.5px 35% graphite border, white gloss bar. Off (`aria-pressed=false`): paper fill, dashed border, the gloss bar turns ink. Hover tilts it up 1px and -4deg (200ms ease-out). An off column row fades to 62% and strikes its name.

### List Rows
Rows of found lists and columns: 7px corners, transparent, chrome on hover. The active list is chrome with its name swept in yellow highlighter (12-88% band). Column rows carry grip, cap, inline-renamable name (border appears on hover, graphite on focus) and a graphite-3 sample; drag target shows a 2px graphite top rule.

### Scope Cards
Radio cards with a 1px `rule` border, 7px corners, 10x11 padding. Hover strengthens the border; checked goes graphite border on chrome; disabled 55%.

### Format Segmented Control
Four equal segments in one `rule-strong` bordered strip, 34px, hairline dividers. Hover chrome; checked is graphite with white text; focus draws an inset 2px outline.

### Preview Grid
Paper card with Lift, max 34vh (50vh stacked), collapsible head. Sticky 700/12.5px headers each carry a 4px ink stripe for their column; mono row numbers in `graphite-3`; hairline chrome row dividers; cells truncate at 340px; empty cells in `rule-strong`.

### Notes, Toast, Popover
- **Notes:** 12.5px icon + text in `graphite-2`, recolored for warn/err/ok. The error box is `danger-paper` with a pale red border.
- **Progress meter:** 6px chrome track, yellow fill, 300ms ease-out.
- **Toast:** graphite pill-ish (7px) at bottom center, rises 8px in over 260ms.
- **Popover (recipes):** native `[popover]`, paper, 11px corners, Lift High, anchored under the top bar at right.

### Ink Sweep and Hover Flash (signature motion)
On the sheet, a newly inked element sweeps its highlight left to right (background-size 0 to 100%, 440ms `cubic-bezier(.16,1,.3,1)`), the 2px bleed arriving at 60%. Hovering a column in the tray flashes its marks with a 6px ink halo settling to 2px over 900ms. The same sweep (`ink-in`, 700ms) highlights the current step while scanning. While picking, the cursor is a crosshair, a hover box outlines the target in graphite over an 18% yellow wash, and a graphite tip names it. Found list items get a faint dashed outline, the first one darker. All of it stops under reduced motion.

## Do's and Don'ts

### Do:
- **Do** keep every surface graphite, paper, desk or chrome; let inks be the only color.
- **Do** assign inks from the fixed eight in order and show a column's ink everywhere it appears (cap, header stripe, marks).
- **Do** use JetBrains Mono with tabular numerals for counts, numbers, URLs and hosts.
- **Do** lift only paper (Lift / Lift High); separate everything else with 1px hairlines.
- **Do** stack page, tray, preview in that order below 920px.

### Don't:
- **Don't** use a fluorescent ink for a button, status, brand or decoration; inks only mean columns (yellow is the single house highlighter).
- **Don't** set plain words, labels or headings in mono.
- **Don't** add a dark theme; the product is light by design (`color-scheme: light`).
- **Don't** reintroduce scraper-console tropes: selector boxes, endpoint lists, dark dashboards.
- **Don't** let an ink sit under text without multiply and near-black text.
