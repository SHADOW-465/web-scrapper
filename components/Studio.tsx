"use client";

import { AlertTriangle, ArrowRight, Bookmark, BookmarkPlus, Check, Download, KeyRound, Link2, Loader2, MousePointerClick, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { crawlPages, fetchAll, LockedError, scanPage, unlock, type ScanResult } from "@/lib/client-api";
import { buildFile, download, FORMATS, type Format } from "@/lib/exporters";
import { extraFields, feedRows, matchList, pageOnly, pageRows, type Row } from "@/lib/model";
import { deleteRecipe, loadRecipes, saveRecipe, type Recipe } from "@/lib/recipes";
import { initial, reducer } from "@/lib/studio-state";
import { Failed, Locked, Printing, Welcome } from "./Blank";
import Mark from "./Mark";
import Preview from "./Preview";
import Recipes from "./Recipes";
import Sheet, { type SheetHandle } from "./Sheet";
import { ColumnTray, ListsFound, ScopePicker, type CrawlMode, type Scope } from "./Tray";

type Phase = "idle" | "scanning" | "ready" | "error" | "locked";

interface Job {
  state: "idle" | "running" | "done" | "error";
  key?: string;
  rows: Row[];
  total: number | null;
  pages?: number;
  message?: string;
  status?: string;
}

const idleJob: Job = { state: "idle", rows: [], total: null };

function normalizeUrl(v: string): string {
  let t = v.trim();
  if (!t) return "";
  t = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(t);
    if (u.hostname.includes("buchmesse.de")) {
      const limit = Number(u.searchParams.get("limit"));
      if (limit && limit < 12) {
        u.searchParams.set("limit", "36");
        return u.toString();
      }
    }
  } catch {
    // ignore
  }
  return t;
}

function hostOf(u: string): string {
  try {
    return new URL(u).host.replace(/^www\./, "");
  } catch {
    return u;
  }
}

export default function Studio() {
  const [url, setUrl] = useState("");
  const [cookie, setCookie] = useState("");
  const [cookieOpen, setCookieOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [st, dispatch] = useReducer(reducer, initial);
  const [scope, setScopeRaw] = useState<Scope>("page");
  const [scopeTouched, setScopeTouched] = useState(false);
  const [crawlMode, setCrawlMode] = useState<CrawlMode>("next");
  const [maxPages, setMaxPages] = useState(20);
  const [format, setFormat] = useState<Format>("xlsx");
  const [fileName, setFileName] = useState("");
  const [job, setJob] = useState<Job>(idleJob);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [layoutMissing, setLayoutMissing] = useState(false);

  const sheet = useRef<SheetHandle>(null);
  const abort = useRef<AbortController | null>(null);
  const pending = useRef<Recipe | null>(null);
  const gotReady = useRef(false);
  const lastActive = useRef<string | null>(null);

  const say = useCallback((t: string) => {
    setToast(t);
    window.setTimeout(() => setToast((cur) => (cur === t ? null : cur)), 2600);
  }, []);

  /* -------------------------------------------------------- boot */

  useEffect(() => {
    setRecipes(loadRecipes());
    fetch("/api/access").then((r) => r.json()).then((a: { required: boolean; ok: boolean }) => {
      if (a.required && !a.ok) setPhase("locked");
    }).catch(() => undefined);
  }, []);

  /* -------------------------------------------------------- scanning */

  const startScan = useCallback(async (target: string) => {
    const u = normalizeUrl(target);
    if (!u) return;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setUrl(u);
    setPhase("scanning");
    setStatus([]);
    setError("");
    setScan(null);
    setJob(idleJob);
    setLayoutMissing(false);
    setScopeTouched(!!pending.current);
    gotReady.current = false;
    dispatch({ type: "reset" });
    try {
      const r = await scanPage(u, cookie.trim() || undefined, (s) => setStatus((p) => [...p, s]), ac.signal);
      setScan(r);
      dispatch({ type: "scanned", feeds: r.apis });
      setPhase("ready");
      setCookieOpen(false);
    } catch (e) {
      if (ac.signal.aborted) return;
      if (e instanceof LockedError) return setPhase("locked");
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, [cookie]);

  // The snapshot reports its lists once it has laid itself out.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const w = sheet.current?.window();
      if (!w || e.source !== w) return;
      const m = e.data as { source?: string; type?: string; [k: string]: unknown };
      if (!m || m.source !== "scrape-studio") return;
      if (m.type === "ready") {
        gotReady.current = true;
        const r = pending.current;
        pending.current = null;
        dispatch({
          type: "ready",
          lists: (m.lists as never) ?? [],
          next: (m.next as never) ?? null,
          prefer: r ? { itemSelector: r.itemSelector, columns: r.columns, feedEndpoint: r.feed?.endpoint } : undefined,
        });
        if (r) {
          setScopeRaw(r.scope);
          setFormat(r.format);
          setFileName(r.name);
          if (r.crawl) { setCrawlMode(r.crawl.mode); setMaxPages(r.crawl.maxPages); }
          say(`Recipe "${r.name}" applied. Check the columns, then export.`);
        }
      } else if (m.type === "pick") {
        dispatch({ type: "pick", listId: String(m.listId), created: (m.created as never) ?? null, column: m.column as never, remove: m.remove as string | undefined });
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [say]);

  // If the snapshot never reports (a page whose layout breaks without its scripts),
  // fall back to the site's data alone rather than hanging.
  useEffect(() => {
    if (phase !== "ready") return;
    const t = window.setTimeout(() => {
      if (!gotReady.current) {
        setLayoutMissing(true);
        dispatch({ type: "ready", lists: [], next: null });
      }
    }, 12000);
    return () => window.clearTimeout(t);
  }, [phase, scan]);

  /* -------------------------------------------------------- derived */

  const ws = st.active ? st.ws[st.active] : undefined;
  const activeList = st.lists.find((l) => l.id === st.active);
  const feed = ws?.feedId ? st.feeds.find((f) => f.id === ws.feedId) : undefined;

  const listMatches = useMemo(
    () => Object.fromEntries(st.lists.map((l) => [l.id, st.ws[l.id]?.match ?? matchList(l, st.feeds)])),
    [st.lists, st.ws, st.feeds],
  );
  const totals = useMemo(() => {
    const out: Record<string, number | "many" | null> = {};
    for (const l of st.lists) {
      const m = listMatches[l.id];
      const f = m ? st.feeds.find((x) => x.id === m.apiId) : undefined;
      out[l.id] = f ? f.total ?? (f.paginated ? "many" : null) : null;
    }
    return out;
  }, [st.lists, st.feeds, listMatches]);
  const otherFeeds = useMemo(() => {
    const matched = new Set(Object.values(listMatches).filter(Boolean).map((m) => m!.apiId));
    return st.feeds.filter((f) => !matched.has(f.id) && f.rows.length >= 3 && f.fields.filter((x) => !x.plumbing && x.fill > 0.3).length >= 2).slice(0, 6);
  }, [st.feeds, listMatches]);

  const onPage = activeList?.count ?? feed?.rows.length ?? 0;
  const feedAvailable = !!feed && (feed.paginated || (feed.total ?? 0) > onPage || !activeList);
  const crawlAvailable = !!activeList && activeList.itemSelector !== "body" && ws?.columns.some((c) => c.page);
  const extras = useMemo(() => (ws ? extraFields(ws, feed) : []), [ws, feed]);
  const onCols = ws?.columns.filter((c) => c.on) ?? [];

  // Default to the most complete scope the page supports, until the user chooses.
  useEffect(() => {
    if (scopeTouched || !ws) return;
    if (feedAvailable) setScopeRaw("feed");
    else if (crawlAvailable && st.next) {
      setScopeRaw("crawl");
      setCrawlMode(st.next.kind);
    } else setScopeRaw("page");
  }, [ws?.listId, feedAvailable, crawlAvailable, st.next, scopeTouched]); // eslint-disable-line react-hooks/exhaustive-deps

  const setScope = (s: Scope) => {
    setScopeTouched(true);
    setScopeRaw(s);
  };

  const jobKey = `${st.active}|${scope}|${feed?.id ?? ""}|${scope === "crawl" ? `${crawlMode}|${maxPages}|${onCols.filter((c) => c.page).map((c) => c.page!.key + c.name).join(",")}` : ""}`;
  const jobFresh = job.state === "done" && job.key === jobKey;

  const rows: Row[] = useMemo(() => {
    if (!ws) return [];
    if (scope === "feed" && feed) {
      if (jobFresh || (job.state === "running" && job.key === jobKey)) return feedRows(ws, activeList, job.rows);
      return activeList ? pageRows(ws, activeList, feed) : feedRows(ws, undefined, feed.rows);
    }
    if (scope === "crawl" && (jobFresh || (job.state === "running" && job.key === jobKey))) return job.rows;
    return pageRows(ws, activeList, feed);
  }, [ws, scope, feed, activeList, job, jobFresh, jobKey]);

  const expected =
    scope === "feed" ? (feed?.total ?? (jobFresh ? rows.length : null)) :
    scope === "crawl" ? (jobFresh ? rows.length : null) : onPage;

  /* -------------------------------------------------------- snapshot paint */

  useEffect(() => {
    const s = sheet.current;
    if (!s || phase !== "ready") return;
    const isPage = !!activeList;
    const columns = isPage && ws ? ws.columns.filter((c) => c.on && c.page).map((c) => ({
      key: c.page!.key, sel: c.page!.sel, multi: !!c.page!.multi, color: c.ink, fresh: c.page!.key === st.fresh,
    })) : [];
    const switched = lastActive.current !== st.active;
    lastActive.current = st.active;
    s.post({ type: switched ? "activate" : "paint", listId: isPage ? activeList!.id : null, columns, scroll: switched });
  }, [ws, activeList, st.active, st.fresh, phase]);

  const flash = useCallback((key: string) => sheet.current?.post({ type: "flash", key }), []);

  /* -------------------------------------------------------- export */

  async function runExport() {
    if (!ws || !scan) return;
    if (!onCols.length) return say("Switch on at least one column first.");
    const title = fileName.trim() || activeList?.name || scan.title || hostOf(scan.finalUrl);
    const fields = onCols.map((c) => c.name);

    if (scope === "page" || (scope !== "feed" && scope !== "crawl") || jobFresh) {
      const { blob, filename } = await buildFile(format, rows, fields, title);
      download(blob, filename);
      return say(`Exported ${rows.length.toLocaleString()} rows to ${filename}`);
    }

    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    const collected: Row[] = [];
    setJob({ state: "running", key: jobKey, rows: [], total: expected ?? null, status: "Starting" });
    try {
      let pages = 0;
      if (scope === "feed" && feed) {
        const needsEnrichTeam = onCols.some((c) =>
          c.feedKey === "person_name" ||
          c.feedKey === "designation" ||
          c.name.toLowerCase().includes("representative") ||
          c.name.toLowerCase().includes("designation")
        );
        await fetchAll(feed.token, {
          signal: ac.signal,
          enrichTeam: needsEnrichTeam,
          onRows: (r, total) => {
            collected.push(...r);
            pages++;
            setJob({
              state: "running",
              key: jobKey,
              rows: [...collected],
              total: total ?? feed.total,
              pages,
              status: needsEnrichTeam ? `Page ${pages} (enriching representatives)` : `Page ${pages}`,
            });
          },
        });
        const out = feedRows(ws, activeList, collected);
        setJob({ state: "done", key: jobKey, rows: collected, total: collected.length, pages });
        const { blob, filename } = await buildFile(format, out, fields, title);
        download(blob, filename);

      } else if (scope === "crawl" && activeList) {
        const pageCols = onCols.filter((c) => c.page);
        const summary = await crawlPages({
          url: scan.finalUrl,
          cookie: cookie.trim() || undefined,
          mode: crawlMode,
          nextSelector: st.next?.selector,
          maxPages,
          recipe: { itemSelector: activeList.itemSelector, fields: pageCols.map((c) => ({ name: c.name, sel: c.page!.sel, attr: c.page!.attr, multi: c.page!.multi })) },
        }, {
          rows: (r, page) => {
            collected.push(...r);
            pages = page;
            setJob({ state: "running", key: jobKey, rows: [...collected], total: null, pages, status: `Page ${page}` });
          },
          status: (s) => setJob((j) => ({ ...j, status: s })),
        }, ac.signal);
        const why = summary.stoppedBy === "limit" ? ` (stopped at your ${maxPages}-page limit)` : summary.stoppedBy === "time" ? " (stopped at the time limit; export again to continue from a later page)" : "";
        setJob({ state: "done", key: jobKey, rows: collected, total: collected.length, pages: summary.pages, message: why });
        const { blob, filename } = await buildFile(format, collected, pageCols.map((c) => c.name), title);
        download(blob, filename);

      }
    } catch (e) {
      if (ac.signal.aborted) {
        setJob({ state: collected.length ? "done" : "idle", key: jobKey, rows: collected, total: collected.length, message: " (stopped early)" });
        return say(collected.length ? `Stopped. ${collected.length.toLocaleString()} rows kept; export again to download them.` : "Stopped.");
      }
      if (e instanceof LockedError) return setPhase("locked");
      setJob({ state: "error", key: jobKey, rows: collected, total: null, message: e instanceof Error ? e.message : String(e) });
    }
  }

  function saveCurrent(name: string) {
    if (!ws || !scan) return;
    const r: Recipe = {
      id: crypto.randomUUID(),
      name: name.trim() || activeList?.name || hostOf(scan.finalUrl),
      url: scan.finalUrl,
      savedAt: Date.now(),
      itemSelector: activeList?.itemSelector,
      feed: feed ? { endpoint: feed.endpoint, jsonPath: feed.jsonPath } : undefined,
      columns: ws.columns.map((c) => ({ name: c.name, sel: c.page?.sel, attr: c.page?.attr, multi: c.page?.multi, feedKey: c.feedKey, on: c.on })),
      scope,
      crawl: scope === "crawl" ? { mode: crawlMode, maxPages } : undefined,
      format,
    };
    setRecipes(saveRecipe(r));
    setSaving(null);
    say(`Saved recipe "${r.name}"`);
  }

  function runRecipe(r: Recipe) {
    document.getElementById("recipes")?.hidePopover?.();
    pending.current = r;
    void startScan(r.url);
  }

  /* -------------------------------------------------------- render */

  const busy = job.state === "running";
  const pct = busy && job.total ? Math.min(100, (job.rows.length / job.total) * 100) : 0;
  const exportLabel =
    scope === "page" ? `Export ${onPage.toLocaleString()} rows` :
    jobFresh ? `Export ${rows.length.toLocaleString()} rows` :
    scope === "feed" ? (feed?.total ? `Get all ${feed.total.toLocaleString()} rows` : "Get every page") :
    "Capture pages and export";

  const pageOnlyNames = ws ? pageOnly(ws).map((c) => c.name) : [];

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="/" onClick={(e) => { e.preventDefault(); abort.current?.abort(); setPhase("idle"); setScan(null); dispatch({ type: "reset" }); }}>
          <Mark />
          <span className="word">Scrape Studio</span>
        </a>
        <form className="urlform" onSubmit={(e) => { e.preventDefault(); if (!url.trim()) { (e.currentTarget.querySelector("input") as HTMLInputElement)?.focus(); return; } pending.current = null; void startScan(url); }}>
          <label className="field">
            <Link2 size={16} aria-hidden="true" />
            <span className="visually-hidden">Page address</span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste a link to any page with a list on it"
              inputMode="url"
              onBlur={(e) => { e.currentTarget.scrollLeft = 0; }}
              autoComplete="url"
              spellCheck={false}
            />
          </label>
          <button type="button" className={`btn btn-quiet${cookie ? " on" : ""}`} onClick={() => setCookieOpen((v) => !v)} aria-expanded={cookieOpen} title="Scan a page that needs you to be signed in">
            <KeyRound size={15} aria-hidden="true" />
            <span>{cookie ? "Signed in" : "Signed-in page"}</span>
          </button>
          <button className="btn btn-primary" disabled={phase === "scanning"}>
            {phase === "scanning" ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}
            <span>Read page</span>
          </button>
        </form>
        <span className="spacer" />
        <button className="btn btn-ghost" popoverTarget="recipes">
          <Bookmark size={15} aria-hidden="true" />Recipes{recipes.length ? <span className="num" style={{ color: "var(--graphite-3)" }}>{recipes.length}</span> : null}
        </button>
        {cookieOpen && (
          <div className="cookie" role="dialog" aria-label="Signed-in page">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
              <label htmlFor="cookie">Cookie for this site</label>
              <button className="iconbtn" onClick={() => setCookieOpen(false)} aria-label="Close"><X size={16} /></button>
            </div>
            <p>
              Sign in to the site in your own browser. Open DevTools, choose <b>Network</b>, reload, click the page request, and copy the <b>Cookie</b> request header. Paste it here. It is sent only with this scan, never saved, and never shown again.
            </p>
            <textarea id="cookie" value={cookie} onChange={(e) => setCookie(e.target.value)} placeholder="sessionid=…; token=…" spellCheck={false} />
            <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
              {cookie && <button className="btn btn-ghost btn-sm" onClick={() => setCookie("")}>Clear</button>}
              <button className="btn btn-primary btn-sm" onClick={() => setCookieOpen(false)}>Done</button>
            </div>
          </div>
        )}
      </header>

      {phase === "idle" && <Welcome onTry={(u) => { pending.current = null; void startScan(u); }} />}
      {phase === "error" && (
        <Failed
          message={error}
          initialUrl={url}
          onRetry={() => void startScan(url)}
          onBack={() => setPhase("idle")}
          onScanUrl={(newUrl) => {
            setUrl(newUrl);
            void startScan(newUrl);
          }}
        />
      )}

      {phase === "ready" && scan && (
        <div className="work">
          <div className="deskcol">
            <div className="sheetbar">
              <span className="host">{hostOf(scan.finalUrl)}</span>
              <span className="title">{scan.title}</span>
              <span className="hint"><MousePointerClick size={14} aria-hidden="true" />Click anything on the page to add it as a column</span>
            </div>
            <div className="desk">
              <Sheet ref={sheet} html={scan.snapshot} title={scan.title} />
            </div>
            {ws && <Preview columns={ws.columns} rows={rows} total={expected ?? rows.length} label={scope === "page" ? "this page" : scope === "feed" ? (jobFresh ? "every page" : "this page, before fetching the rest") : jobFresh ? "captured pages" : "this page, before capturing the rest"} />}
          </div>

          <aside className="tray" aria-label="Extraction settings">
            <div className="tray-scroll">
              <section className="section">
                <div className="section-head"><h2>Found on this page</h2></div>
                <ListsFound lists={st.lists} otherFeeds={otherFeeds} active={st.active} totals={totals} onPick={(id) => dispatch({ type: "activate", id })} />
                {layoutMissing && <p className="note warn" style={{ marginTop: 8 }}><AlertTriangle size={14} aria-hidden="true" />The page&rsquo;s layout couldn&rsquo;t be read, so only the site&rsquo;s data is shown.</p>}
                {scan.notes.map((n) => <p key={n} className="note" style={{ marginTop: 8 }}>{n}</p>)}
              </section>

              {ws && (
                <section className="section">
                  <div className="section-head">
                    <h2>Columns</h2>
                    <span className="aside">{onCols.length} of {ws.columns.length} in the export</span>
                  </div>
                  {activeList?.manual && st.lists.some((l) => !l.manual) && (
                    <p className="note" style={{ margin: "0 0 10px" }}>
                      New list from your click. Your other columns are kept: pick a list above to go back to it.
                    </p>
                  )}
                  <ColumnTray ws={ws} hasFeed={!!feed} extras={extras} dispatch={dispatch as never} onFlash={flash} />
                  {activeList && <p className="hint-line"><MousePointerClick size={13} aria-hidden="true" />Click anything on the page to add it. Click an ink to take it off.</p>}
                </section>
              )}

              {ws && (
                <section className="section">
                  <div className="section-head"><h2>How much</h2></div>
                  <ScopePicker
                    scope={scope}
                    setScope={setScope}
                    onPage={onPage}
                    feed={{ available: feedAvailable, total: feed?.total ?? null, paginated: !!feed?.paginated, pageOnly: pageOnlyNames }}
                    crawl={{ available: !!crawlAvailable, next: st.next, mode: crawlMode, setMode: setCrawlMode, maxPages, setMaxPages }}
                  />
                </section>
              )}
            </div>

            {ws && (
              <div className="exportbar">
                <div className="formats" role="radiogroup" aria-label="File format">
                  {FORMATS.map((f) => (
                    <label key={f.id} title={f.hint}>
                      <input type="radio" name="fmt" checked={format === f.id} onChange={() => setFormat(f.id)} />
                      <span>{f.label}</span>
                    </label>
                  ))}
                </div>
                {busy ? (
                  <div className="progress" aria-live="polite">
                    <div className="ptext">
                      <span>{job.status ?? "Working"}…</span>
                      <span className="num">{job.rows.length.toLocaleString()}{job.total ? ` / ${job.total.toLocaleString()}` : ""} rows</span>
                    </div>
                    <div className={`meter${job.total ? "" : " indeterminate"}`}><i style={{ transform: `scaleX(${pct / 100})` }} /></div>
                    <button className="btn btn-quiet btn-block" onClick={() => abort.current?.abort()}>Stop and keep what&rsquo;s fetched</button>
                  </div>
                ) : (
                  <>
                    <div className="exportrow">
                      <input className="fname" value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder={activeList?.name || scan.title || "File name"} aria-label="File name" />
                      <button className="btn btn-primary" onClick={() => void runExport()} disabled={!onCols.length}>
                        <Download size={16} aria-hidden="true" />{exportLabel}
                      </button>
                    </div>
                    {job.state === "error" && <p className="note err" role="alert"><AlertTriangle size={14} aria-hidden="true" />{job.message} {job.rows.length ? `${job.rows.length.toLocaleString()} rows were fetched before it stopped.` : ""}</p>}
                    {jobFresh && <p className="note ok"><Check size={14} aria-hidden="true" />{rows.length.toLocaleString()} rows ready{job.pages ? ` from ${job.pages} pages` : ""}{job.message ?? ""}. Pick another format to download again.</p>}
                    {saving === null ? (
                      <button className="linkbtn" onClick={() => setSaving(fileName || activeList?.name || "")}><BookmarkPlus size={13} aria-hidden="true" style={{ verticalAlign: -2, marginRight: 4 }} />Save as recipe</button>
                    ) : (
                      <form className="exportrow" onSubmit={(e) => { e.preventDefault(); saveCurrent(saving); }}>
                        <input className="fname" autoFocus value={saving} onChange={(e) => setSaving(e.target.value)} placeholder="Recipe name" aria-label="Recipe name" />
                        <button className="btn btn-quiet">Save</button>
                        <button type="button" className="iconbtn" onClick={() => setSaving(null)} aria-label="Cancel"><X size={16} /></button>
                      </form>
                    )}
                  </>
                )}
              </div>
            )}
          </aside>
        </div>
      )}

      <Recipes recipes={recipes} onRun={runRecipe} onDelete={(r) => setRecipes(deleteRecipe(r.id))} />
      {toast && <div className="toast" role="status"><Check size={15} aria-hidden="true" />{toast}</div>}
    </div>
  );
}
