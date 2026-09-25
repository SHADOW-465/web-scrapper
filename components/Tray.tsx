"use client";

import { ChevronRight, Database, Eye, GripVertical, Plus, ScanLine } from "lucide-react";
import { useState } from "react";
import type { Column, Feed, FeedField, PageList, Workspace } from "@/lib/model";
import { feedTitle } from "@/lib/model";
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
  onPick: (id: string) => void;
}) {
  const { lists, otherFeeds, active, totals, onPick } = props;
  if (!lists.length && !otherFeeds.length) {
    return (
      <p className="note">
        <ScanLine size={15} aria-hidden="true" />
        No repeating list found. Click anything on the page to capture it.
      </p>
    );
  }
  // Two lists often share the nearest heading; tell them apart by what they hold.
  const names = new Map<string, number>();
  lists.forEach((l) => names.set(l.name, (names.get(l.name) ?? 0) + 1));
  const label = (l: PageList) => {
    if ((names.get(l.name) ?? 0) < 2) return l.name;
    return `${l.name} · ${fmt(l.count)} items`;
  };
  return (
    <>
      <div className="lists" role="list">
        {lists.map((l) => {
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
                <span className="count"><span className="num">{fmt(l.count)}</span> on page</span>
                {t ? <span className="badge badge-feed"><Database size={11} aria-hidden="true" />{t === "many" ? "every page" : <><span className="num">{fmt(t)}</span> total</>}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
      {otherFeeds.length > 0 && (
        <>
          <div className="subhead">Other data behind this page</div>
          <div className="lists" role="list">
            {otherFeeds.map((f) => (
              <button key={f.id} role="listitem" className="listrow" aria-pressed={active === `feed:${f.id}`} onClick={() => onPick(`feed:${f.id}`)}>
                <span style={{ minWidth: 0 }}>
                  <span className="lname"><span>{feedTitle(f)}</span></span>
                  <span className="lmeta">{f.fields.filter((x) => !x.plumbing).slice(0, 4).map((x) => x.label).join(" · ")}</span>
                </span>
                <span className="count">{f.total ? <><span className="num">{fmt(f.total)}</span> total</> : f.paginated ? "every page" : <><span className="num">{fmt(f.rows.length)}</span> rows</>}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------ columns */

function sourceTag(c: Column, hasFeed: boolean) {
  if (c.page && c.feedKey) return <span className="tag" title="Matched to the site's data, so it fills on every page"><Database size={11} aria-hidden="true" />every page</span>;
  if (c.page && hasFeed) return <span className="tag warn" title="Not in the site's data: fills only for rows that were on screen"><Eye size={11} aria-hidden="true" />on-screen only</span>;
  if (c.page) return <span className="tag" title="Read from the page"><Eye size={11} aria-hidden="true" />on page</span>;
  return <span className="tag" title="Not shown on the page, but in the site's data"><Database size={11} aria-hidden="true" />site data</span>;
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

  return (
    <>
      <ul className="cols" aria-label="Columns">
        {ws.columns.map((c, i) => (
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
              title={c.on ? "Included. Click to leave out" : "Left out. Click to include"}
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
        ))}
      </ul>
      {extras.length > 0 && (
        <details className="extra">
          <summary><ChevronRight size={14} aria-hidden="true" />Also in the site&rsquo;s data ({extras.length})</summary>
          <p>Fields the site sends but this page doesn&rsquo;t show. Add any to your columns.</p>
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
            <span className="sdesc">Fastest and most complete. Reads the same data the page loads, page after page.</span>
            {scope === "feed" && feed.pageOnly.length > 0 && (
              <span className="sdesc" style={{ display: "block", marginTop: 6, color: "#7a4a00" }}>
                {feed.pageOnly.join(", ")} {feed.pageOnly.length > 1 ? "exist" : "exists"} only on the page, so {feed.pageOnly.length > 1 ? "they fill" : "it fills"} just the rows that were on screen.
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
          <span className="sdesc">Exactly what&rsquo;s on screen now. Instant.</span>
        </span>
      </label>
    </div>
  );
}
