"use client";

import { AlertTriangle, ArrowRight, ChevronRight, Database, ExternalLink, Eye, FileText, GripVertical, Loader2, Plus, RotateCcw, ScanLine, Sparkles } from "lucide-react";
import { useState } from "react";
import type { Column, DirectoryLink, Feed, FeedField, PageList, Workspace } from "@/lib/model";
import { feedTitle, looksLikeNavigation } from "@/lib/model";
import type { NextControl } from "@/lib/studio-state";

const fmt = (n: number) => n.toLocaleString();

export type Scope = "page" | "feed" | "crawl";
export type CrawlMode = "next" | "more" | "scroll";

/* ------------------------------------------------------------ lists */

export function ListsFound(props: {
  lists: PageList[];
  otherFeeds: Feed[];
  active: string | null;
  totals: Record<string, number | "many" | null>;
  counts?: Record<string, number>;
  directoryLinks?: DirectoryLink[];
  onFollowLink?: (url: string) => void;
  onPick: (id: string) => void;
}) {
  const { lists, otherFeeds, active, totals, counts, directoryLinks, onFollowLink, onPick } = props;
  const rowCountOf = (l: PageList) => counts?.[l.id] ?? l.count;
  const dataLists = lists.filter((l) => !looksLikeNavigation(l));
  const navLists = lists.filter((l) => looksLikeNavigation(l));

  const size = (f: Feed) => f.total ?? f.rows.length;
  const primaryFeeds = otherFeeds
    .filter((f) => (f.total && f.total > 15) || active === `feed:${f.id}` || !!f.ai)
    .sort((x, y) => size(y) - size(x));
  const remainingFeeds = otherFeeds.filter((f) => !primaryFeeds.includes(f));

  // Two lists often share the nearest heading; tell them apart by what they hold.
  const names = new Map<string, number>();
  lists.forEach((l) => names.set(l.name, (names.get(l.name) ?? 0) + 1));
  const label = (l: PageList) => {
    if ((names.get(l.name) ?? 0) < 2) return l.name;
    return `${l.name} · ${fmt(rowCountOf(l))} items`;
  };

  const renderListRow = (l: PageList, isNav: boolean) => {
    const t = totals[l.id];
    return (
      <button key={l.id} role="listitem" className="listrow" aria-pressed={active === l.id} onClick={() => onPick(l.id)}>
        <span style={{ minWidth: 0 }}>
          <span className="lname"><span>{label(l)}</span></span>
          <span className="lmeta">
            {l.columns.slice(0, 3).map((c) => c.values.find(Boolean)).filter(Boolean).join(" · ") || `${l.columns.length} fields`}
          </span>
        </span>
        <span style={{ display: "grid", justifyItems: "end", gap: 3 }}>
          <span className="count"><span className="num">{fmt(rowCountOf(l))}</span> on page</span>
          {isNav ? (
            <span className="badge" style={{ color: "#7a4a00", borderColor: "#e2c08d" }}>Menu / nav</span>
          ) : t ? (
            <span className="badge badge-feed"><Database size={11} aria-hidden="true" />{t === "many" ? "all pages" : <><span className="num">{fmt(t)}</span> total</>}</span>
          ) : null}
        </span>
      </button>
    );
  };

  const noCompanyList = !active || (!dataLists.length && !otherFeeds.length);

  return (
    <>
      {noCompanyList && (
        <div style={{ marginBottom: 10 }}>
          <p className="note warn">
            <ScanLine size={15} aria-hidden="true" />
            <span>No company list found on this page.</span>
          </p>
          {directoryLinks && directoryLinks.length > 0 && onFollowLink && (
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
              <span style={{ fontSize: 12.5, color: "var(--graphite-2)" }}>Follow a directory link found on this page:</span>
              {directoryLinks.map((d) => (
                <button key={d.url} type="button" className="btn btn-primary btn-sm" style={{ justifyContent: "space-between" }} onClick={() => onFollowLink(d.url)}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{d.label}</span>
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!noCompanyList && (dataLists.length > 0 || otherFeeds.length > 0) && directoryLinks && directoryLinks.length > 0 && onFollowLink && (
        <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
          {directoryLinks.map((d) => (
            <button key={d.url} type="button" className="btn btn-quiet btn-sm" style={{ justifyContent: "space-between" }} onClick={() => onFollowLink(d.url)}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{d.label}</span>
              <ArrowRight size={13} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      {primaryFeeds.length > 0 && (
        <div className="lists" role="list" style={{ marginBottom: 12 }}>
          {primaryFeeds.map((f) => (
            <button
              key={f.id}
              role="listitem"
              className="listrow"
              aria-pressed={active === `feed:${f.id}`}
              onClick={() => onPick(`feed:${f.id}`)}
            >
              <span style={{ minWidth: 0 }}>
                <span className="lname">
                  <span>{feedTitle(f)}</span>
                </span>
                <span className="lmeta">
                  {f.fields.filter((x) => !x.plumbing).slice(0, 4).map((x) => x.label).join(" · ")}
                </span>
              </span>
              <span style={{ display: "grid", justifyItems: "end", gap: 3 }}>
                <span className="count">
                  <span className="num">{fmt(f.rows.length)}</span> on page
                </span>
                <span className="badge badge-feed">
                  {f.ai ? <Sparkles size={11} aria-hidden="true" /> : <Database size={11} aria-hidden="true" />}
                  {f.ai ? "Read by AI" : f.total ? <><span className="num">{fmt(f.total)}</span> total</> : f.paginated ? "all pages" : "Full list"}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {dataLists.length > 0 && (
        <>
          {primaryFeeds.length > 0 && <div className="subhead">Lists on this page</div>}
          <div className="lists" role="list">
            {dataLists.map((l) => renderListRow(l, false))}
          </div>
        </>
      )}

      {remainingFeeds.length > 0 && (
        <>
          <div className="subhead">More lists on this page</div>
          <div className="lists" role="list">
            {remainingFeeds.map((f) => (
              <button key={f.id} role="listitem" className="listrow" aria-pressed={active === `feed:${f.id}`} onClick={() => onPick(`feed:${f.id}`)}>
                <span style={{ minWidth: 0 }}>
                  <span className="lname"><span>{feedTitle(f)}</span></span>
                  <span className="lmeta">{f.fields.filter((x) => !x.plumbing).slice(0, 4).map((x) => x.label).join(" · ")}</span>
                </span>
                <span className="count">{f.total ? <><span className="num">{fmt(f.total)}</span> total</> : f.paginated ? "all pages" : <><span className="num">{fmt(f.rows.length)}</span> rows</>}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {navLists.length > 0 && (
        <details className="extra" open={navLists.some((l) => l.id === active)}>
          <summary><ChevronRight size={14} aria-hidden="true" />Site navigation menus ({navLists.length})</summary>
          <p className="note warn" style={{ margin: "4px 0 6px" }}>
            <AlertTriangle size={13} aria-hidden="true" />
            <span>These look like site navigation links, not a company list.</span>
          </p>
          <div className="lists" role="list">
            {navLists.map((l) => renderListRow(l, true))}
          </div>
        </details>
      )}
    </>
  );
}

/* ------------------------------------------------------------ columns */

function sourceTag(c: Column, hasFeed: boolean) {
  if (c.page && c.feedKey) return <span className="tag" title="Available across all pages"><Database size={11} aria-hidden="true" />all pages</span>;
  if (c.page && hasFeed) return <span className="tag warn" title="Available only for rows visible on this page"><Eye size={11} aria-hidden="true" />this page only</span>;
  if (c.page) return <span className="tag" title="Read from this page"><Eye size={11} aria-hidden="true" />on page</span>;
  return <span className="tag" title="Available across all pages"><Database size={11} aria-hidden="true" />all pages</span>;
}

export function ColumnTray(props: {
  ws: Workspace;
  hasFeed: boolean;
  extras: FeedField[];
  dispatch: (a: { type: "toggle" | "rename" | "move"; id: string; name?: string; to?: number } | { type: "addFeedField"; field: FeedField }) => void;
  onFlash: (key: string) => void;
}) {
  const { ws, hasFeed, extras, dispatch, onFlash } = props;
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const indexed = ws.columns.map((c, i) => ({ c, i })).filter(({ c }) => !c.item);
  const visibleLimit = Math.max(8, indexed.filter(({ c }) => c.on).length);
  const primaryCols: Array<{ c: Column; i: number }> = [];
  const extraCols: Array<{ c: Column; i: number }> = [];
  for (const entry of indexed) {
    if (entry.c.on || primaryCols.length < visibleLimit) primaryCols.push(entry);
    else extraCols.push(entry);
  }

  const renderCol = ({ c, i }: { c: Column; i: number }) => (
    <li
      key={c.id}
      className={`col${c.on ? "" : " off"}${drag === c.id ? " dragging" : ""}${over === c.id && drag && drag !== c.id ? " over" : ""}`}
      style={{ ["--ink" as string]: c.ink }}
      draggable
      onDragStart={(e) => { setDrag(c.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c.id); }}
      onDragEnd={() => { setDrag(null); setOver(null); }}
      onDragOver={(e) => { e.preventDefault(); setOver(c.id); }}
      onDrop={(e) => { e.preventDefault(); if (drag) dispatch({ type: "move", id: drag, to: i }); setDrag(null); setOver(null); }}
      onMouseEnter={() => c.page && c.on && onFlash(c.page.key)}
    >
      <span className="grip" aria-hidden="true"><GripVertical size={14} /></span>
      <button
        className="cap"
        aria-pressed={c.on}
        aria-label={`${c.on ? "Remove" : "Include"} ${c.name}`}
        title={c.on ? "Selected. Click to remove" : "Not selected. Click to include"}
        onClick={() => dispatch({ type: "toggle", id: c.id })}
      />
      <div className="cbody">
        <input
          className="cname"
          value={c.name}
          aria-label="Column name"
          onChange={(e) => dispatch({ type: "rename", id: c.id, name: e.target.value })}
          onKeyDown={(e) => {
            if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
              e.preventDefault();
              dispatch({ type: "move", id: c.id, to: i + (e.key === "ArrowUp" ? -1 : 1) });
            }
          }}
        />
        <div className="csample" title={c.sample}>{c.sample || <i>empty on this page</i>}</div>
      </div>
      <span className="csrc">{sourceTag(c, hasFeed)}</span>
    </li>
  );

  return (
    <>
      <ul className="cols" aria-label="Columns">
        {primaryCols.map(renderCol)}
      </ul>
      {extraCols.length > 0 && (
        <details className="extra">
          <summary><ChevronRight size={14} aria-hidden="true" />Show more columns ({extraCols.length})</summary>
          <ul className="cols" aria-label="More columns">
            {extraCols.map(renderCol)}
          </ul>
        </details>
      )}
      {extras.length > 0 && (
        <details className="extra">
          <summary><ChevronRight size={14} aria-hidden="true" />More columns available ({extras.length})</summary>
          <p>Extra columns available for these rows. Click Add to include any of them.</p>
          {extras.map((f) => (
            <div className="extrarow" key={f.key}>
              <div style={{ minWidth: 0 }}>
                <div className="ename">{f.label}</div>
                <div className="esample" title={f.sample}>{f.sample}</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => dispatch({ type: "addFeedField", field: f })} aria-label={`Add ${f.label}`}>
                <Plus size={14} aria-hidden="true" />Add
              </button>
            </div>
          ))}
        </details>
      )}
    </>
  );
}

/* ------------------------------------------------------------ scope */

export function ScopePicker(props: {
  scope: Scope;
  setScope: (s: Scope) => void;
  onPage: number;
  feed: { available: boolean; total: number | null; paginated: boolean; pageOnly: string[] };
  crawl: { available: boolean; next: NextControl | null; mode: CrawlMode; setMode: (m: CrawlMode) => void; maxPages: number; setMaxPages: (n: number) => void };
}) {
  const { scope, setScope, onPage, feed, crawl } = props;
  return (
    <div className="scopes" role="radiogroup" aria-label="How much to capture">
      {feed.available && (
        <label className="scope">
          <input type="radio" name="scope" checked={scope === "feed"} onChange={() => setScope("feed")} />
          <span>
            <span className="sname">Every page, from the site&rsquo;s data <span className="count">{feed.total ? <span className="num">{fmt(feed.total)}</span> : feed.paginated ? "all of it" : ""}</span></span>
            <span className="sdesc">Fastest and most complete. Reads the full directory across all pages.</span>
            {scope === "feed" && feed.pageOnly.length > 0 && (
              <span className="sdesc" style={{ display: "block", marginTop: 6, color: "#7a4a00" }}>
                {feed.pageOnly.join(", ")} {feed.pageOnly.length > 1 ? "are" : "is"} only visible on the current page, so {feed.pageOnly.length > 1 ? "they fill" : "it fills"} just the rows shown right now.
              </span>
            )}
          </span>
        </label>
      )}
      {crawl.available && (
        <label className="scope">
          <input type="radio" name="scope" checked={scope === "crawl"} onChange={() => setScope("crawl")} />
          <span>
            <span className="sname">Every page, one at a time</span>
            <span className="sdesc">
              {crawl.next ? <>Opens the page and follows &ldquo;{crawl.next.label}&rdquo; until the end.</> : <>Opens the page and keeps scrolling for more.</>}
            </span>
            {scope === "crawl" && (
              <span className="sopts">
                <select className="mini" value={crawl.mode} onChange={(e) => crawl.setMode(e.target.value as CrawlMode)} aria-label="How to reach more rows">
                  {crawl.next && <option value={crawl.next.kind}>{crawl.next.kind === "more" ? `Click “${crawl.next.label}”` : `Click “${crawl.next.label}”`}</option>}
                  <option value="scroll">Scroll down</option>
                </select>
                up to
                <input className="mini" type="number" min={1} max={200} value={crawl.maxPages} onChange={(e) => crawl.setMaxPages(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} aria-label="Maximum pages" />
                pages
              </span>
            )}
          </span>
        </label>
      )}
      <label className="scope">
        <input type="radio" name="scope" checked={scope === "page"} onChange={() => setScope("page")} />
        <span>
          <span className="sname">Just this page <span className="count"><span className="num">{fmt(onPage)}</span></span></span>
          <span className="sdesc">Only the rows shown right now. Instant.</span>
        </span>
      </label>
    </div>
  );
}

/* ------------------------------------------------------------ item pages */

function estimate(n: number, mode: "static" | "browser"): string {
  const secs = mode === "browser" ? n * 4 : n / 5;
  if (secs < 90) return "under 2 minutes";
  const mins = Math.round(secs / 60);
  return mins < 60 ? `about ${mins} minutes` : `about ${Math.round(mins / 6) / 10} hours`;
}

export function ItemFields(props: {
  ws: Workspace;
  rowCount: number | null;
  dispatch: (a: { type: "toggle" | "rename"; id: string; name?: string }) => void;
  onRetry: () => void;
  onPaste: (url: string) => void;
}) {
  const { ws, rowCount, dispatch, onRetry, onPaste } = props;
  const [pasted, setPasted] = useState("");
  const info = ws.items;
  if (!info) return null;
  const cols = ws.columns.filter((c) => c.item);
  const on = cols.filter((c) => c.on);
  const cat = info.catalogue;

  const row = (c: Column) => (
    <li key={c.id} className={`col item${c.on ? "" : " off"}`} style={{ ["--ink" as string]: c.ink }}>
      <span />
      <button className="cap" aria-pressed={c.on} aria-label={`${c.on ? "Remove" : "Include"} ${c.name}`}
        title={c.on ? "Selected. Click to remove" : "Not selected. Click to include"} onClick={() => dispatch({ type: "toggle", id: c.id })} />
      <div className="cbody">
        <input className="cname" value={c.name} aria-label="Column name" onChange={(e) => dispatch({ type: "rename", id: c.id, name: e.target.value })} />
        <div className="csample" title={c.sample}>{c.sample || <i>empty on the sample page</i>}</div>
      </div>
      <span />
    </li>
  );

  const singleCols = cols.filter((c) => !c.item!.listId);
  const singleLimit = Math.max(6, singleCols.filter((c) => c.on).length);
  const primarySingles: Column[] = [];
  const extraSingles: Column[] = [];
  for (const c of singleCols) {
    if (c.on || primarySingles.length < singleLimit) primarySingles.push(c);
    else extraSingles.push(c);
  }

  return (
    <section className="section">
      <div className="section-head">
        <h2>From each item&rsquo;s own page</h2>
        {cat ? <span className="aside">{on.length} selected</span> : null}
      </div>

      {info.status === "looking" && (
        <p className="note" aria-live="polite"><Loader2 size={14} className="spin" aria-hidden="true" />{info.message ?? "Checking what each item's detail page offers"}</p>
      )}

      {info.status === "error" && (
        <div>
          <p className="note err" role="alert">{info.message ?? "The detail page couldn't be read."}</p>
          <button className="btn btn-quiet btn-sm" onClick={onRetry}><RotateCcw size={13} aria-hidden="true" />Try again</button>
        </div>
      )}

      {info.status === "none" && (
        <div>
          <p className="note">{info.message ?? "No detail pages were found automatically for these rows."}</p>
          <details className="extra">
            <summary><ChevronRight size={14} aria-hidden="true" />Advanced options</summary>
            <p>Have an example detail page link? Enter it below to look for extra fields.</p>
            <form className="exportrow" onSubmit={(e) => { e.preventDefault(); if (pasted.trim()) onPaste(pasted.trim()); }}>
              <input className="fname" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="https://…/company-profile" aria-label="Example page link" inputMode="url" />
              <button className="btn btn-quiet">Use example</button>
            </form>
          </details>
        </div>
      )}

      {info.status === "ready" && cat && (
        <>
          <p className="note">
            <FileText size={14} aria-hidden="true" />
            <span>Extra details found on pages like{" "}
              <a href={cat.sampleUrl} target="_blank" rel="noreferrer noopener">{cat.title || "this example"}<ExternalLink size={11} aria-hidden="true" style={{ marginLeft: 3, verticalAlign: -1 }} /></a>.
              {cat.mode === "browser" ? " These pages require full browser loading, so exporting them takes longer." : ""}
            </span>
          </p>
          {(() => {
            const nonEmptyLists = cat.lists
              .map((l) => ({ l, lc: cols.filter((c) => c.item!.listId === l.id) }))
              .filter(({ lc }) => lc.length > 0);
            const primaryLists = nonEmptyLists.filter(({ lc }, idx) => idx === 0 || lc.some((c) => c.on));
            const extraLists = nonEmptyLists.filter((entry) => !primaryLists.includes(entry));
            const extraFieldCount = extraSingles.length + extraLists.reduce((acc, { lc }) => acc + lc.length, 0);
            const renderItemList = ({ l, lc }: { l: typeof cat.lists[number]; lc: Column[] }) => (
              <div key={l.id}>
                <div className="subhead">{l.name && l.name !== cat.title ? l.name : "Repeating list"} · {l.count} on the sample page</div>
                <p className="hint-line" style={{ marginTop: 0 }}>Selecting any of these creates one row per person or entry.</p>
                <ul className="cols">{lc.map(row)}</ul>
              </div>
            );
            return (
              <>
                {primaryLists.map(renderItemList)}
                {primarySingles.length > 0 && (
                  <>
                    <div className="subhead">About each item</div>
                    <ul className="cols">{primarySingles.map(row)}</ul>
                  </>
                )}
                {extraFieldCount > 0 && (
                  <details className="extra">
                    <summary><ChevronRight size={14} aria-hidden="true" />Show more fields ({extraFieldCount})</summary>
                    {extraSingles.length > 0 && <ul className="cols">{extraSingles.map(row)}</ul>}
                    {extraLists.map(renderItemList)}
                  </details>
                )}
              </>
            );
          })()}
          {!cols.length && <p className="note">Nothing extra was found on the sample page.</p>}
          <details className="extra">
            <summary><ChevronRight size={14} aria-hidden="true" />Advanced options</summary>
            <p>Try a different example page if some companies show extra details (like team members or contact info).</p>
            <form className="exportrow" onSubmit={(e) => { e.preventDefault(); if (pasted.trim()) onPaste(pasted.trim()); }}>
              <input className="fname" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="https://…/company-profile" aria-label="Example page link" inputMode="url" />
              <button className="btn btn-quiet">Use example</button>
            </form>
          </details>
          {on.length > 0 && rowCount ? (
            <p className="note warn" style={{ marginTop: 10 }}>
              Visits {rowCount.toLocaleString()} pages, {estimate(rowCount, cat.mode)}. You can leave it running; progress is saved.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
