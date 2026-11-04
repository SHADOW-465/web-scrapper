"use client";

import { AlertTriangle, ArrowRight, Bookmark, BookmarkPlus, Check, Download, EyeOff, KeyRound, Link2, Loader2, MousePointerClick, RotateCcw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { aiStatus, fetchChunk, LockedError, lookupBatch, sampleItems, scanPage, ScanError, SkippedItemsError, unlock, type AiStatus, type CrawlRequest, type ScanResult } from "@/lib/client-api";
import { buildFile, download, FORMATS, type Format } from "@/lib/exporters";
import { discoveryRequest, fillPattern, findItemSource, sourceFromPastedUrl, specFor, spread, widerRows } from "@/lib/items-client";
import { baseRows, deleteJob, exportFields, failedItems, finalRows, leadNames, loadJobs, newJob, progressOf, runJob, type Job, type Progress } from "@/lib/job";
import { companiesFrom, guessLeadColumns, joinLeads, newLeadsState, type LeadResult, type LeadsConfig } from "@/lib/leads";
import { extraFields, findDirectoryLinksInHtml, listRowCount, looksLikeNavigation, matchList, pageOnly, visiblePageRows, type Column, type DirectoryLink, type ItemSource, type Row, type Workspace } from "@/lib/model";
import { deleteRecipe, loadRecipes, saveRecipe, type Recipe } from "@/lib/recipes";
import { initial, reducer } from "@/lib/studio-state";
import { Failed, Locked, Printing, Welcome } from "./Blank";
import { LeadsPanel, type TrySummary } from "./Leads";
import Mark from "./Mark";
import Preview from "./Preview";
import Recipes from "./Recipes";
import Sheet, { type SheetHandle } from "./Sheet";
import { ColumnTray, ItemFields, ListsFound, ScopePicker, type CrawlMode, type Scope } from "./Tray";

type Phase = "idle" | "scanning" | "ready" | "error" | "locked";

interface Run {
  job: Job;
  progress: Progress;
  state: "running" | "done" | "error" | "stopped";
  message?: string;
}

function normalizeUrl(v: string): string {
  const t = v.trim();
  if (!t) return "";
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

function hostOf(u: string): string {
  try {
    return new URL(u).host.replace(/^www\./, "");
  } catch {
    return u;
  }
}

const fmtN = (n: number) => n.toLocaleString();

export default function Studio() {
  const [url, setUrl] = useState("");
  const [cookie, setCookie] = useState("");
  const [cookieOpen, setCookieOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [errorKind, setErrorKind] = useState<"server" | "site">("server");
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [st, dispatch] = useReducer(reducer, initial);
  const [scope, setScopeRaw] = useState<Scope>("page");
  const [scopeTouched, setScopeTouched] = useState(false);
  const [crawlMode, setCrawlMode] = useState<CrawlMode>("next");
  const [maxPages, setMaxPages] = useState(20);
  const [format, setFormat] = useState<Format>("xlsx");
  const [fileName, setFileName] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [resumable, setResumable] = useState<Job[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [doneNote, setDoneNote] = useState<string | null>(null);
  const [layoutMissing, setLayoutMissing] = useState(false);
  const [iframeReady, setIframeReady] = useState(false);
  const [tableOnly, setTableOnly] = useState(false);
  const [leadsCfg, setLeadsCfg] = useState<LeadsConfig | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [testingAi, setTestingAi] = useState(false);
  const [leadPreview, setLeadPreview] = useState<Record<string, LeadResult>>({});
  const [trying, setTrying] = useState<string | null>(null);
  const [tried, setTried] = useState<TrySummary | null>(null);
  const [tryError, setTryError] = useState<string | null>(null);

  const sheet = useRef<SheetHandle>(null);
  const abort = useRef<AbortController | null>(null);
  const jobAbort = useRef<AbortController | null>(null);
  const pending = useRef<Recipe | null>(null);
  const gotReady = useRef(false);
  const lastActive = useRef<string | null>(null);
  const looking = useRef(new Set<string>());

  const say = useCallback((t: string) => {
    setToast(t);
    window.setTimeout(() => setToast((cur) => (cur === t ? null : cur)), 3200);
  }, []);

  /* -------------------------------------------------------- boot */

  const refreshResumable = useCallback(async () => {
    const jobs = await loadJobs();
    setResumable(jobs.filter((j) => j.stage !== "done"));
  }, []);

  useEffect(() => {
    setRecipes(loadRecipes());
    void refreshResumable();
    fetch("/api/access").then((r) => r.json()).then((a: { required: boolean; ok: boolean }) => {
      if (a.required && !a.ok) setPhase("locked");
      else aiStatus().then(setAi, (e) => setAiError(e instanceof Error ? e.message : String(e)));
    }).catch(() => undefined);
  }, [refreshResumable]);

  /* -------------------------------------------------------- scanning */

  const startScan = useCallback(async (target: string) => {
    const u = normalizeUrl(target);
    if (!u) return;
    abort.current?.abort();
    jobAbort.current?.abort();
    jobAbort.current = null;
    setRun(null);
    setDoneNote(null);
    const ac = new AbortController();
    abort.current = ac;
    setUrl(u);
    setPhase("scanning");
    setStatus([]);
    setError("");
    setScan(null);
    setLayoutMissing(false);
    setIframeReady(false);
    setScopeTouched(!!pending.current);
    gotReady.current = false;
    looking.current.clear();
    setLeadPreview({});
    setTried(null);
    setTryError(null);
    dispatch({ type: "reset" });
    try {
      const r = await scanPage(u, cookie.trim() || undefined, (s) => setStatus((p) => [...p, s]), ac.signal);
      if (ac.signal.aborted) return;
      setScan(r);
      dispatch({ type: "scanned", feeds: r.apis });
      setPhase("ready");
      setCookieOpen(false);
    } catch (e) {
      if (ac.signal.aborted) return;
      if (e instanceof LockedError) return setPhase("locked");
      setError(e instanceof Error ? e.message : String(e));
      setErrorKind(e instanceof ScanError ? e.kind : "server");
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
        setIframeReady(true);
        const r = pending.current;
        pending.current = null;
        const fromIframe = (m.directoryLinks as DirectoryLink[] | undefined) ?? [];
        const fromSnap = scan ? findDirectoryLinksInHtml(scan.snapshot, scan.finalUrl) : [];
        const mergedDirLinks = [...fromIframe, ...fromSnap];
        dispatch({
          type: "ready",
          lists: (m.lists as never) ?? [],
          next: (m.next as never) ?? null,
          directoryLinks: mergedDirLinks,
          prefer: r ? { itemSelector: r.itemSelector, columns: r.columns, feedEndpoint: r.feed?.endpoint, itemColumns: r.itemColumns } : undefined,
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
  }, [say, scan]);

  // A snapshot that never reports (its layout broke without scripts): use the site's data alone.
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
  const directoryLinks = useMemo<DirectoryLink[]>(() => {
    const out: DirectoryLink[] = [];
    const seenUrls = new Set<string>();
    const seenLabels = new Set<string>();
    for (const d of [...st.directoryLinks, ...(scan ? findDirectoryLinksInHtml(scan.snapshot, scan.finalUrl) : [])]) {
      const labelKey = d.label.trim().toLowerCase();
      if (!d.url || seenUrls.has(d.url) || seenLabels.has(labelKey)) continue;
      seenUrls.add(d.url);
      seenLabels.add(labelKey);
      out.push(d);
    }
    return out;
  }, [st.directoryLinks, scan]);
  const isNavigation = looksLikeNavigation(activeList);
  const noListFound = !ws && (iframeReady || layoutMissing);

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
    return st.feeds
      .filter((f) => {
        if (st.active === `feed:${f.id}`) return true;
        if (matched.has(f.id)) return false;
        if (/\b(filters?|facets?)\b/i.test(`${f.jsonPath} ${f.endpoint}`)) return false;
        const nonPlumbing = f.fields.filter((x) => !x.plumbing && x.fill > 0.3);
        if (nonPlumbing.length <= 3 && nonPlumbing.every((x) => /^(name|parent|iso|cnt|count|id|value|label|selected|cond|item_url)$/i.test(x.key.split(".").pop() ?? x.key))) return false;
        return f.rows.length >= 3 && nonPlumbing.length >= 2;
      })
      .slice(0, 6);
  }, [st.feeds, listMatches, st.active]);

  const pageRowList = useMemo(() => (ws ? visiblePageRows(ws, activeList, feed) : []), [ws, activeList, feed]);
  const listCounts = useMemo(
    () => Object.fromEntries(st.lists.map((l) => {
      const w = st.ws[l.id];
      const f = w?.feedId ? st.feeds.find((x) => x.id === w.feedId) : undefined;
      return [l.id, listRowCount(l, w, f)];
    })),
    [st.lists, st.ws, st.feeds],
  );
  const onPage = ws ? pageRowList.length : (activeList ? (listCounts[activeList.id] ?? activeList.count) : (feed?.rows.length ?? 0));
  const feedAvailable = !!feed && (feed.paginated || (feed.total ?? 0) > onPage || !activeList);
  const crawlAvailable = !!activeList && activeList.itemSelector !== "body" && ws?.columns.some((c) => c.page);
  const extras = useMemo(() => (ws ? extraFields(ws, feed) : []), [ws, feed]);
  const onCols = ws?.columns.filter((c) => c.on) ?? [];
  const onNames = onCols.map((c) => c.name);

  // Decision-makers: pick the company-name column for each dataset, keep the user's choice while it stays valid.
  useEffect(() => {
    if (!ws) return;
    setLeadsCfg((cur) => {
      if (cur && onNames.includes(cur.nameCol) && cur.listId === ws.listId) return cur;
      const g = guessLeadColumns(ws.columns, pageRowList);
      if (!g) return cur ? { ...cur, on: false } : null;
      return { on: cur?.listId === ws.listId ? cur.on : true, ...g, limit: cur?.limit ?? null, aiSearch: cur?.aiSearch ?? 10, listId: ws.listId };
    });
  }, [ws?.listId, onNames.join("\u0000"), pageRowList.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const leadsOn = !!leadsCfg?.on && !!ws && onNames.includes(leadsCfg.nameCol);
  const leadSig = leadsOn && leadsCfg ? [leadsCfg.nameCol, leadsCfg.countryCol, leadsCfg.websiteCol, leadsCfg.limit].join("|") : "";
  const leadColumns: Column[] = useMemo(() => {
    if (!leadsOn || !ws) return [];
    return Object.values(leadNames({ ws })).map((name) => ({ id: `lead:${name}`, name, ink: "#e8e3d4", on: true, sample: "" }));
  }, [leadsOn, ws]);

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

  const expectedRows =
    scope === "feed" ? (feed?.total ?? (feed && !feed.paginated ? feed.rows.length : null)) :
    scope === "crawl" ? null : onPage;

  /* -------------------------------------------------------- item pages */

  const lookForItems = useCallback(async (wsId: string, override?: { urls: string[]; source: ItemSource | null }) => {
    if (!scan) return;
    const signal = abort.current?.signal;
    const updateItems = (action: Parameters<typeof dispatch>[0]) => { if (!signal?.aborted) dispatch(action); };
    const w: Workspace | undefined = st.ws[wsId];
    if (!w) return;
    const list = st.lists.find((l) => l.id === wsId);
    const f = w.feedId ? st.feeds.find((x) => x.id === w.feedId) : undefined;
    if ((list && (list.count < 2 || list.itemSelector === "body")) || (!list && (!f || f.ai || f.rows.length < 2))) return;

    let source: ItemSource | null = override?.source ?? null;
    let urls = override?.urls ?? [];
    let extra: Row[] = [];
    if (!override && f) {
      updateItems({ type: "items", wsId, items: { status: "looking", message: "Picking sample items from across the list" } });
      extra = await widerRows(f, async (i, n) => (await fetchChunk(f.token, i, signal, n)).rows).catch(() => []);
    }
    if (signal?.aborted) return;
    if (!override) {
      source = findItemSource(scan.finalUrl, list, f, w, scan.snapshot);
      if (source?.columnKey && list) urls = spread((list.columns.find((c) => c.key === source!.columnKey)?.values ?? []).filter(Boolean), 40);
      else if (source?.key && source.pattern && f) urls = spread([...f.rows, ...extra], 40).map((r) => fillPattern(source!.pattern!, r[source!.key!])).filter(Boolean);
      if (!urls.length && !f) {
        updateItems({ type: "items", wsId, items: { status: "none", message: "These rows don't link to pages of their own." } });
        return;
      }
    }
    updateItems({ type: "items", wsId, items: { status: "looking" } });
    try {
      const res = await sampleItems({
        scanUrl: scan.finalUrl,
        cookie: cookie.trim() || undefined,
        urls: urls.length ? urls : undefined,
        discover: urls.length || !f ? undefined : discoveryRequest(scan.finalUrl, f, extra),
      }, (text) => updateItems({ type: "items", wsId, items: { status: "looking", message: text } }), signal);
      if (signal?.aborted) return;
      if (!res) {
        updateItems({ type: "items", wsId, items: { status: "none" } });
        return;
      }
      const src = source ?? res.pattern;
      if (!src) {
        updateItems({ type: "items", wsId, items: { status: "error", message: "That page was read, but none of the rows' values appear in its address, so rows can't be matched to their pages." } });
        return;
      }
      updateItems({ type: "items", wsId, items: { status: "ready", source: src, catalogue: res.catalogue } });
    } catch (e) {
      if (signal?.aborted) return;
      if (e instanceof LockedError) return setPhase("locked");
      if (e instanceof SkippedItemsError) return updateItems({ type: "items", wsId, items: { status: "none", message: e.message } });
      updateItems({ type: "items", wsId, items: { status: "error", message: e instanceof Error ? e.message : String(e) } });
    }
  }, [scan, st.ws, st.lists, st.feeds, cookie]);

  // Look once per dataset, as soon as it's open.
  useEffect(() => {
    if (phase !== "ready" || !st.active || !ws || ws.items || looking.current.has(st.active)) return;
    looking.current.add(st.active);
    void lookForItems(st.active);
  }, [phase, st.active, ws, lookForItems]);

  function pasteItemUrl(u: string) {
    if (!st.active || !ws) return;
    const addr = normalizeUrl(u);
    const src = ws.items?.source ?? sourceFromPastedUrl(addr, feed);
    // A new example replaces the fields found so far.
    dispatch({ type: "items", wsId: st.active, items: { status: "looking" }, reset: true });
    void lookForItems(st.active, { urls: [addr], source: src });
  }

  /* -------------------------------------------------------- preview */

  const crawlSelection = (w: Workspace) => JSON.stringify(w.columns.filter((c) => c.on && c.page).map((c) => ({name:c.name,page:c.page})));
  const jobLeadSig = (j: Job) => (j.leads?.config.on ? [j.leads.config.nameCol, j.leads.config.countryCol, j.leads.config.websiteCol, j.leads.config.limit].join("|") : "");
  const runMatches = !!run && !!ws && run.job.scanUrl === scan?.finalUrl && run.job.ws.listId === ws.listId && run.job.scope === scope && run.state !== "error"
    && jobLeadSig(run.job) === leadSig
    && (scope !== "crawl" || (run.job.crawl?.maxPages === maxPages && run.job.crawl?.mode === crawlMode && crawlSelection(run.job.ws) === crawlSelection(ws)));
  const rows: Row[] = useMemo(() => {
    if (!ws) return [];
    if (runMatches && run) return finalRows({ ...run.job, ws });
    // Before an export: this page's rows, with any trial lookups joined in.
    return leadsOn && leadsCfg ? joinLeads(pageRowList, leadsCfg, leadPreview, leadNames({ ws })) : pageRowList;
  }, [ws, pageRowList, run, runMatches, leadsOn, leadsCfg, leadPreview]);

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

  async function deliver(job: Job) {
    const out = finalRows(job);
    const { blob, filename } = await buildFile(job.format, out, exportFields(job), job.title);
    download(blob, filename);
    return { count: out.length, filename };
  }

  async function execute(job: Job) {
    jobAbort.current?.abort();
    const ac = new AbortController();
    jobAbort.current = ac;
    setRun({ job, progress: progressOf(job), state: "running" });
    try {
      const done = await runJob(job, {
        signal: ac.signal,
        cookie: cookie.trim() || undefined,
        onUpdate: (j, p) => { if (jobAbort.current === ac) setRun({ job: j, progress: p, state: "running" }); },
      });
      if (ac.signal.aborted || jobAbort.current !== ac) return;
      const { count, filename } = await deliver(done);
      const failed = failedItems(done).length;
      setRun({
        job: done, progress: progressOf(done), state: "done",
        message: `${fmtN(count)} rows saved to ${filename}.${failed ? ` ${fmtN(failed)} item pages couldn't be read; their columns are empty.` : ""}${done.note ? ` ${done.note}` : ""}${leadSummary(done)}`,
      });
      await deleteJob(done.id);
    } catch (e) {
      if (jobAbort.current !== ac) return;
      if (ac.signal.aborted) {
        setRun((r) => (r ? { ...r, state: "stopped", message: "Paused. Progress is saved; resume any time within 6 hours." } : r));
      } else if (e instanceof LockedError) {
        setPhase("locked");
      } else {
        setRun((r) => (r ? { ...r, state: "error", message: e instanceof Error ? e.message : String(e) } : r));
      }
    } finally {
      void refreshResumable();
    }
  }

  async function startExport() {
    if (!ws || !scan) return;
    if (!onCols.length) return say("Switch on at least one column first.");
    const title = fileName.trim() || activeList?.name || scan.title || hostOf(scan.finalUrl);
    const spec = specFor(ws);

    // Rows already here and nothing to visit: instant.
    if (scope === "page" && !spec && !leadsOn) {
      const out = pageRowList;
      const { blob, filename } = await buildFile(format, out, onCols.map((c) => c.name), title);
      download(blob, filename);
      const msg = `${fmtN(out.length)} rows saved to ${filename}`;
      setDoneNote(`${msg}. Pick another format to download again.`);
      return say(msg);
    }
    // The last run already has these rows and item pages: just write the file again.
    if (runMatches && run?.state === "done" && JSON.stringify(specFor(run.job.ws)?.fields.map((f) => f.key)) === JSON.stringify(spec?.fields.map((f) => f.key))) {
      const { count, filename } = await deliver({ ...run.job, ws, format, title });
      const msg = `${fmtN(count)} rows saved to ${filename}`;
      setDoneNote(`${msg}. Pick another format to download again.`);
      return say(msg);
    }

    let crawl: CrawlRequest | undefined;
    if (scope === "crawl" && activeList) {
      const pageCols = onCols.filter((c) => c.page);
      const linkCol = ws.items?.source?.columnKey ? activeList.columns.find((c) => c.key === ws.items!.source!.columnKey) : undefined;
      crawl = {
        url: scan.finalUrl, cookie: cookie.trim() || undefined, mode: crawlMode, nextSelector: st.next?.selector, maxPages,
        recipe: {
          itemSelector: activeList.itemSelector,
          fields: [
            ...pageCols.map((c) => ({ name: c.name, sel: c.page!.sel, attr: c.page!.attr, multi: c.page!.multi })),
            ...(spec && linkCol ? [{ name: "__url", sel: linkCol.sel, attr: "href" }] : []),
          ],
        },
      };
    }
    await execute(newJob({
      title, format, scanUrl: scan.finalUrl, scope, ws, list: activeList, feed, crawl, gated: !!cookie.trim(),
      // Companies already looked up in a trial run are not looked up again.
      leads: leadsOn && leadsCfg ? newLeadsState(stripCfg(leadsCfg), leadPreview) : undefined,
    }));
  }

  async function testAi() {
    setTestingAi(true);
    try {
      setAi(await aiStatus(true));
      setAiError(null);
    } catch (e) {
      if (e instanceof LockedError) return setPhase("locked");
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setTestingAi(false);
    }
  }

  async function tryLeads() {
    if (!ws || !scan || !leadsCfg) return;
    const { rows: base, urls } = baseRows({ scope: "page", ws, list: activeList, feed, raw: [] });
    const companies = companiesFrom(base, urls, { ...leadsCfg, limit: 5 });
    if (!companies.length) return setTryError(`No company names in the "${leadsCfg.nameCol}" column on this page.`);
    const signal = abort.current?.signal;
    setTryError(null);
    setTried(null);
    setTrying(`Looking up ${companies.length} companies (about 20–40 s)…`);
    try {
      const found: Record<string, LeadResult> = {};
      let queue = companies;
      let quota: string | undefined;
      const notes: string[] = [];
      for (let pass = 0; pass < 2 && queue.length; pass++) {
        const out = await lookupBatch({ companies: queue, fairHost: new URL(scan.finalUrl).hostname, useAi: true, aiSearch: Math.min(2, leadsCfg.aiSearch) }, signal);
        for (const r of out.results) found[r.id] = r;
        quota ??= out.ai.quotaMessage;
        for (const n of out.notices) if (!notes.includes(n)) notes.push(n);
        queue = queue.filter((c) => out.pending.includes(c.id));
      }
      if (signal?.aborted) return;
      setLeadPreview((cur) => ({ ...cur, ...found }));
      const list = Object.values(found);
      setTried({
        looked: list.length,
        website: list.filter((r) => r.website).length,
        person: list.filter((r) => r.people.length).length,
        email: list.filter((r) => r.people.some((p) => p.email)).length,
        linkedin: list.filter((r) => r.companyLinkedin || r.people.some((p) => p.linkedin)).length,
        notes, // a 429 is shown in red in the AI box, not inside this success note
      });
      if (quota) setAi((a) => (a ? { ...a, ok: false, message: quota } : a));
    } catch (e) {
      if (signal?.aborted) return;
      if (e instanceof LockedError) return setPhase("locked");
      setTryError(e instanceof Error ? e.message : String(e));
    } finally {
      setTrying(null);
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
      columns: ws.columns.filter((c) => !c.item).map((c) => ({ name: c.name, sel: c.page?.sel, attr: c.page?.attr, multi: c.page?.multi, feedKey: c.feedKey, on: c.on })),
      itemColumns: ws.columns.filter((c) => c.item && c.on).map((c) => ({ key: c.item!.key, name: c.name })),
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

  const followDirectoryLink = useCallback((targetUrl: string) => {
    pending.current = null;
    void startScan(targetUrl);
  }, [startScan]);

  /* -------------------------------------------------------- render */

  const busy = run?.state === "running";
  const p = run?.progress;
  const pct = busy && p?.of ? Math.min(100, (p.done / p.of) * 100) : 0;
  const hasItemCols = onCols.some((c) => c.item);
  const exportLabel =
    runMatches && run?.state === "done" ? `Download ${fmtN(rows.length)} rows` :
    leadsOn ? (scope === "page" ? `Get ${fmtN(onPage)} rows + decision-makers` : scope === "feed" && feed?.total ? `Get all ${fmtN(feed.total)} + decision-makers` : "Get rows + decision-makers") :
    scope === "page" ? (hasItemCols ? `Get ${fmtN(onPage)} rows` : `Export ${fmtN(onPage)} rows`) :
    scope === "feed" ? (feed?.total ? `Get all ${fmtN(feed.total)} rows` : "Get every page") :
    "Capture pages and export";
  const pageOnlyNames = ws ? pageOnly(ws).map((c) => c.name) : [];
  const detachedRun = run && (run.state === "running" || run.state === "stopped" || run.state === "error") && !runMatches;

  const jobCard = (
    <JobBanner
      run={detachedRun ? run : null}
      resumable={resumable.filter((j) => j.id !== run?.job.id)}
      onResume={(j) => void execute(j)}
      onDiscard={async (j) => { await deleteJob(j.id); void refreshResumable(); }}
      onStop={() => jobAbort.current?.abort()}
    />
  );

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
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a link to any page with a list on it" inputMode="url"
              onBlur={(e) => { e.currentTarget.scrollLeft = 0; }} autoComplete="url" spellCheck={false} />
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
              Sign in to the site in your own browser. Open DevTools, choose <b>Network</b>, reload, click the page request, and copy the <b>Cookie</b> request header. Paste it here. It is sent only to that site, never saved, and never shown again.
            </p>
            <textarea id="cookie" value={cookie} onChange={(e) => setCookie(e.target.value)} placeholder="sessionid=…; token=…" spellCheck={false} />
            <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
              {cookie && <button className="btn btn-ghost btn-sm" onClick={() => setCookie("")}>Clear</button>}
              <button className="btn btn-primary btn-sm" onClick={() => setCookieOpen(false)}>Done</button>
            </div>
          </div>
        )}
      </header>

      {phase === "idle" && (
        <div className="blank-wrap">
          {jobCard}
          <Welcome onTry={(u) => { pending.current = null; void startScan(u); }} />
        </div>
      )}
      {phase === "scanning" && <Printing host={hostOf(url)} status={status} />}
      {phase === "error" && <Failed message={error} kind={errorKind} onRetry={() => void startScan(url)} onBack={() => setPhase("idle")} />}
      {phase === "locked" && <Locked onUnlock={async (pw) => { const ok = await unlock(pw); if (ok) { setPhase("idle"); if (url) void startScan(url); } return ok; }} />}

      {phase === "ready" && scan && (
        <div className="work">
          <div className="deskcol">
            <Preview
              columns={ws ? [...ws.columns, ...leadColumns] : []}
              rows={rows}
              total={runMatches && run?.state === "done" ? rows.length : scope === "page" ? rows.length : expectedRows ?? rows.length}
              label={runMatches ? (run?.state === "done" ? "everything fetched" : "fetched so far") : hasItemCols ? "this page; item-page columns fill in when you export" : leadsOn ? "this page; decision-maker columns fill in when you export or try" : scope === "page" ? "this page" : "this page, before fetching the rest"}
              tableOnly={tableOnly}
              onToggleTableOnly={() => setTableOnly((v) => !v)}
              noListFound={noListFound}
              isNavigation={isNavigation}
              directoryLinks={directoryLinks}
              onFollowLink={followDirectoryLink}
            />
            <div className={`sheetbar${tableOnly ? " collapsed" : ""}`}>
              <span className="host">{hostOf(scan.finalUrl)}</span>
              <span className="title">{scan.title}</span>
              <span className="hint"><MousePointerClick size={14} aria-hidden="true" />Click anything on the page to add it as a column</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTableOnly(true)} title="Hide the website preview">
                <EyeOff size={13} aria-hidden="true" />
                <span>Hide preview</span>
              </button>
            </div>
            <div className={`desk${tableOnly ? " collapsed" : ""}`}>
              <Sheet ref={sheet} html={scan.snapshot} title={scan.title} />
            </div>
          </div>

          <aside className="tray" aria-label="Extraction settings">
            <div className="tray-scroll">
              {jobCard}
              <section className="section">
                <div className="section-head"><h2>Found on this page</h2></div>
                <ListsFound
                  lists={st.lists}
                  otherFeeds={otherFeeds}
                  active={st.active}
                  totals={totals}
                  counts={listCounts}
                  directoryLinks={directoryLinks}
                  onPick={(id) => { setDoneNote(null); dispatch({ type: "activate", id }); }}
                  onFollowLink={followDirectoryLink}
                />
                {isNavigation && (
                  <p className="note warn" style={{ marginTop: 8 }}>
                    <AlertTriangle size={14} aria-hidden="true" />
                    <span>These rows look like site navigation rather than a company list.</span>
                  </p>
                )}
                {layoutMissing && <p className="note warn" style={{ marginTop: 8 }}><AlertTriangle size={14} aria-hidden="true" />The page&rsquo;s layout couldn&rsquo;t be read, so only the site&rsquo;s data is shown.</p>}
                {scan.notes.map((n) => <p key={n} className="note" style={{ marginTop: 8 }}>{n}</p>)}
              </section>

              {ws && (
                <section className="section">
                  <div className="section-head">
                    <h2>On each row</h2>
                    <span className="aside">{onCols.filter((c) => !c.item).length} selected</span>
                  </div>
                  {activeList?.manual && st.lists.some((l) => !l.manual) && (
                    <p className="note" style={{ margin: "0 0 10px" }}>New list from your click. Your other columns are kept: pick a list above to go back to it.</p>
                  )}
                  <ColumnTray ws={ws} hasFeed={!!feed} extras={extras} dispatch={dispatch as never} onFlash={flash} />
                  {activeList && <p className="hint-line"><MousePointerClick size={13} aria-hidden="true" />Click anything on the page preview to add or remove a column.</p>}
                </section>
              )}

              {ws && (
                <ItemFields ws={ws} rowCount={expectedRows} dispatch={dispatch as never}
                  onRetry={() => st.active && void lookForItems(st.active)} onPaste={pasteItemUrl} />
              )}

              {ws && (
                <LeadsPanel
                  config={leadsCfg}
                  setConfig={(c) => setLeadsCfg({ ...c, listId: ws.listId })}
                  columns={onNames}
                  companies={expectedRows}
                  findingPages={ws.items?.status === "looking"}
                  hasPages={!!ws.items?.source}
                  gated={!!cookie.trim()}
                  ai={ai}
                  aiError={aiError}
                  testingAi={testingAi}
                  onTestAi={() => void testAi()}
                  trying={trying}
                  tried={tried}
                  tryError={tryError}
                  onTry={() => void tryLeads()}
                  run={runMatches && run?.job.leads ? run.job.leads : null}
                  busy={!!busy}
                />
              )}

              {ws && (
                <section className="section">
                  <div className="section-head"><h2>How much</h2></div>
                  <ScopePicker scope={scope} setScope={setScope} onPage={onPage}
                    feed={{ available: feedAvailable, total: feed?.total ?? null, paginated: !!feed?.paginated, pageOnly: pageOnlyNames }}
                    crawl={{ available: !!crawlAvailable, next: st.next, mode: crawlMode, setMode: setCrawlMode, maxPages, setMaxPages }} />
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
                {busy && runMatches && p ? (
                  <div className="progress" aria-live="polite">
                    <div className="ptext">
                      <span>{p.label}…</span>
                      <span className="num">{fmtN(p.done)}{p.of ? ` / ${fmtN(p.of)}` : ""}{p.stage === "items" ? " pages" : p.stage === "people" ? " companies" : " rows"}</span>
                    </div>
                    <div className={`meter${p.of ? "" : " indeterminate"}`}><i style={{ transform: `scaleX(${pct / 100})` }} /></div>
                    <button className="btn btn-quiet btn-block" onClick={() => jobAbort.current?.abort()}>Pause (progress is saved)</button>
                  </div>
                ) : (
                  <>
                    <div className="exportrow">
                      <input className="fname" value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder={activeList?.name || scan.title || "File name"} aria-label="File name" />
                      <button className="btn btn-primary" onClick={() => void startExport()} disabled={!onCols.length || busy}>
                        <Download size={16} aria-hidden="true" />{exportLabel}
                      </button>
                    </div>
                    {((runMatches && run?.state === "done" && run.message) || doneNote) && (
                      <p className="note ok">
                        <Check size={14} aria-hidden="true" />
                        {runMatches && run?.state === "done" && run.message ? `${run.message} Pick another format to download again.` : doneNote}
                      </p>
                    )}
                    {runMatches && run?.state === "stopped" && (
                      <p className="note">{run.message} <button className="linkbtn" onClick={() => void execute(run.job)}>Resume</button></p>
                    )}
                    {run?.state === "error" && run.job.ws.listId === ws.listId && (
                      <p className="note err" role="alert"><AlertTriangle size={14} aria-hidden="true" />
                        <span>{run.message} <button className="linkbtn" onClick={() => void execute({ ...run.job, error: undefined })}>Retry from where it stopped</button></span>
                      </p>
                    )}
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

/** Unfinished exports (resume or discard), and progress of one running away from its page. */
function JobBanner({ run, resumable, onResume, onDiscard, onStop }: {
  run: Run | null;
  resumable: Job[];
  onResume: (j: Job) => void;
  onDiscard: (j: Job) => void;
  onStop: () => void;
}) {
  if (!run && !resumable.length) return null;
  return (
    <section className="jobbanner" aria-label="Exports">
      {run && (
        <div className="jobrow">
          <div style={{ minWidth: 0 }}>
            <b>{run.job.title}</b>
            <span>{run.state === "running" ? `${run.progress.label}: ${fmtN(run.progress.done)}${run.progress.of ? ` of ${fmtN(run.progress.of)}` : ""}` : run.message}</span>
          </div>
          {run.state === "running"
            ? <button className="btn btn-quiet btn-sm" onClick={onStop}>Pause</button>
            : <button className="btn btn-quiet btn-sm" onClick={() => onResume(run.job)}><RotateCcw size={13} aria-hidden="true" />Resume</button>}
        </div>
      )}
      {resumable.map((j) => {
        const pr = progressOf(j);
        return (
          <div className="jobrow" key={j.id}>
            <div style={{ minWidth: 0 }}>
              <b>Unfinished: {j.title}</b>
              <span>{pr.stage === "items" ? `Item pages ${fmtN(pr.done)} of ${fmtN(pr.of ?? 0)}` : pr.stage === "people" ? `Companies looked up ${fmtN(pr.done)} of ${fmtN(pr.of ?? 0)}` : `${fmtN(j.raw.length)} rows so far`} · {new Date(j.updatedAt).toLocaleString()}</span>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <button className="btn btn-quiet btn-sm" onClick={() => onResume(j)}><RotateCcw size={13} aria-hidden="true" />Resume</button>
              <button className="iconbtn" onClick={() => onDiscard(j)} aria-label={`Discard ${j.title}`}><Trash2 size={15} /></button>
            </div>
          </div>
        );
      })}
    </section>
  );
}

/** The config saved with a job (the UI-only listId is dropped). */
function stripCfg(c: LeadsConfig & { listId?: string }): LeadsConfig {
  const { listId: _l, ...rest } = c;
  return rest;
}

/** " 812 of 1,000 companies have a named decision-maker…" for the finished-export message. */
function leadSummary(job: Job): string {
  const L = job.leads;
  if (!L?.config.on) return "";
  const all = Object.values(L.results);
  const person = all.filter((r) => r.people.length).length;
  const email = all.filter((r) => r.people.some((p) => p.email)).length;
  const site = all.filter((r) => r.website).length;
  return ` Decision-makers: ${fmtN(person)} of ${fmtN(all.length)} companies have a named person (${fmtN(email)} with a personal email), ${fmtN(site)} have a website.${L.quotaMessage ? ` ${L.quotaMessage}` : ""}`;
}
