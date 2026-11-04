"use client";

import { AlertTriangle, ArrowRight, Bookmark, BookmarkPlus, Check, ChevronRight, Download, EyeOff, KeyRound, Link2, Loader2, MousePointerClick, RotateCcw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { aiStatus, fetchChunk, LockedError, lookupBatch, planWithAi, sampleItems, scanPage, ScanError, SkippedItemsError, unlock, type AiStatus, type CrawlRequest, type ScanResult } from "@/lib/client-api";
import { buildFile, download, FORMATS, type Format } from "@/lib/exporters";
import { discoveryRequest, fillPattern, findItemSource, sourceFromPastedUrl, specFor, spread, widerRows } from "@/lib/items-client";
import { baseRows, carryOver, deleteJob, exportFields, failedItems, finalRows, leadNames, loadJobs, newJob, planOutput, progressOf, runJob, type Job, type Progress } from "@/lib/job";
import { availableFrom, describeSource, followUp, fromAi, needsLookup, parseRequest, planFilter, planHeaders, resolvePlan, urlIn, type Plan } from "@/lib/wishes";
import { companiesFrom, guessLeadColumns, joinLeads, newLeadsState, type LeadResult, type LeadsConfig } from "@/lib/leads";
import { extraFields, feedRows, findDirectoryLinksInHtml, listRowCount, looksLikeNavigation, matchList, pageOnly, visiblePageRows, type Column, type DirectoryLink, type ItemSource, type Row, type Workspace } from "@/lib/model";
import { deleteRecipe, loadRecipes, saveRecipe, type Recipe } from "@/lib/recipes";
import { initial, reducer } from "@/lib/studio-state";
import { Failed, Locked, Printing } from "./Blank";
import AiUsageBar from "./AiUsageBar";
import { ChatHome, ChatPanel, type ChatMsg } from "./Chat";
import { affordableSearches, readAiDay } from "@/lib/ai-usage";
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
  // Sign-in: the login ID and password live only in this dialog until sent once; the server
  // answers with a sealed session (the site's cookies), kept in memory for this tab only.
  const [session, setSession] = useState<{ token: string; host: string } | null>(null);
  const [signInMode, setSignInMode] = useState<"password" | "cookie">("password");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
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
  // The conversation: her request in plain words, and the export plan read from it.
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [trialWanted, setTrialWanted] = useState(false);
  const [autoRun, setAutoRun] = useState(false);
  // Rows of the site's data loaded for browsing the table before an export (Next page).
  const [browse, setBrowse] = useState<{ id: string; raw: Row[]; next: number | null; error?: string } | null>(null);
  const pendingAsk = useRef<string | null>(null);
  const scanMsg = useRef<string | null>(null);
  const runMsg = useRef<string | null>(null);

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

  const addMsg = useCallback((m: Omit<ChatMsg, "id"> & { id?: string }) => {
    const id = m.id ?? crypto.randomUUID();
    setChat((c) => [...c, { ...m, id }]);
    return id;
  }, []);
  const updateMsg = useCallback((id: string | null, patch: Partial<ChatMsg>) => {
    if (id) setChat((c) => c.map((m) => (m.id === id ? { ...m, ...patch } : m)));
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

  const startScan = useCallback(async (target: string, login?: { username: string; password: string }) => {
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
    setPlan(null);
    setTrialWanted(false);
    setTried(null);
    setTryError(null);
    dispatch({ type: "reset" });
    try {
      const sameSite = session && hostOf(u).endsWith(session.host);
      const r = await scanPage(
        u, { cookie: cookie.trim() || undefined, session: !login && sameSite ? session.token : undefined },
        (s) => setStatus((p) => [...p, s]), ac.signal, login,
        (token) => setSession({ token, host: hostOf(u).split(".").slice(-2).join(".") }),
      );
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
  }, [cookie, session]);

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
  const browseId = `${scan?.finalUrl ?? ""}|${feed?.id ?? ""}`;
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
  const auth = { cookie: cookie.trim() || undefined, session: session && scan && hostOf(scan.finalUrl).endsWith(session.host) ? session.token : undefined };
  const signedIn = !!auth.cookie || !!auth.session;

  // Decision-makers: pick the company-name column for each dataset, keep the user's choice while it stays valid.
  useEffect(() => {
    if (!ws) return;
    setLeadsCfg((cur) => {
      if (cur && onNames.includes(cur.nameCol) && cur.listId === ws.listId) return cur;
      const g = guessLeadColumns(ws.columns, pageRowList);
      if (!g) return cur ? { ...cur, on: false } : null;
      // Off until a request asks for decision-makers (or she ticks it): most lists are not company directories.
      return { on: cur?.listId === ws.listId ? cur.on : false, ...g, limit: cur?.limit ?? null, aiSearch: cur?.aiSearch ?? -1, listId: ws.listId };
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
        ...auth,
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
  }, [scan, st.ws, st.lists, st.feeds, cookie, session]); // eslint-disable-line react-hooks/exhaustive-deps

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

  /* -------------------------------------------------------- conversation effects */

  // Scan progress and its outcome, in the conversation.
  useEffect(() => {
    if (phase === "scanning" && status.length) updateMsg(scanMsg.current, { text: `Reading ${hostOf(url)}… ${status[status.length - 1].toLowerCase()}` });
    if (phase === "error") {
      updateMsg(scanMsg.current, { busy: false, tone: "err", text: error, actions: [{ id: "retry-scan", label: "Try again" }] });
      scanMsg.current = null;
    }
  }, [phase, status, error, url, updateMsg]);

  // Page read: say what was found, then act on the request that came with the link.
  const pageSettled = phase === "ready" && (iframeReady || layoutMissing) && (!!ws || noListFound);
  useEffect(() => {
    if (!pageSettled || !scanMsg.current || !scan) return;
    const id = scanMsg.current;
    scanMsg.current = null;
    if (!ws) {
      updateMsg(id, { busy: false, tone: "warn", text: `I read ${hostOf(scan.finalUrl)}, but found no company list on this page.${directoryLinks.length ? ` Try the directory: ${directoryLinks.map((d) => d.label).join(", ")}.` : ""}` });
      pendingAsk.current = null;
      return;
    }
    const total = feed?.total ?? null;
    updateMsg(id, {
      busy: false,
      text: `I read “${scan.title}”: ${total ? `${fmtN(total)} ${companiesWord} in the site's data` : `${fmtN(onPage)} ${companiesWord} on this page`}${feed?.paginated ? `, ${fmtN(onPage)} per page` : ""}.`,
    });
    const ask = pendingAsk.current;
    pendingAsk.current = null;
    if (ask) void makePlan(ask);
    else addMsg({ role: "assistant", text: "What do you need in the export? For example: company, country, CEO name, email, LinkedIn, booth number." });
  }, [pageSettled]); // eslint-disable-line react-hooks/exhaustive-deps

  // A request read: start the full run (every row, every company), once each company's page on the site is known.
  useEffect(() => {
    if (!autoRun || !plan || !ws || ws.items?.status === "looking") return;
    setAutoRun(false);
    if (runMsg.current) {
      updateMsg(runMsg.current, { busy: false, progress: undefined, actions: [], text: "Restarted with your changed request (rows and lookups so far are kept)." });
      runMsg.current = null;
    }
    void startExport(format, { download: false });
  }, [autoRun, plan, ws?.items?.status, leadsCfg]); // eslint-disable-line react-hooks/exhaustive-deps

  // The trial: 5 companies, once each company's page on the site is known.
  useEffect(() => {
    if (!trialWanted || !leadsOn || trying || ws?.items?.status === "looking") return;
    setTrialWanted(false);
    const id = addMsg({ role: "assistant", text: "Looking up the first 5 companies (about 20–40 seconds)…", busy: true });
    void tryLeads().then((t) => {
      const total = expectedRows ?? onPage;
      if (!t) return updateMsg(id, { busy: false, tone: "err", text: "The trial didn't work. You can still get the file.", actions: exportActions(plan, total) });
      updateMsg(id, {
        busy: false,
        tone: t.quota ? "warn" : "ok",
        text: [
          `Tried ${t.looked}: ${t.website} with a website, ${t.person} with a named decision-maker, ${t.email} with a personal email, ${t.linkedin} with LinkedIn. They're in the table.`,
          t.quota ?? "",
          `The full run looks up ${fmtN(plan?.limit ? Math.min(plan.limit, total ?? plan.limit) : total ?? 0)} companies; you can leave it running.`,
        ].filter(Boolean).join("\n"),
        actions: exportActions(plan, total),
      });
    });
  }, [trialWanted, leadsOn, trying, ws?.items?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Export progress and result, in the conversation (for exports started from it).
  useEffect(() => {
    if (!run || !plan || !runMatches) return;
    const p = run.progress;
    const unit = p.stage === "items" ? "pages" : p.stage === "people" ? "companies" : "rows";
    if (run.state === "running") {
      const L = run.job.leads;
      const found = L ? Object.values(L.results) : [];
      const people = found.filter((r) => r.people.length).length;
      const sites = found.filter((r) => r.website).length;
      const text = [
        `${p.label}: ${fmtN(p.done)}${p.of ? ` of ${fmtN(p.of)}` : ""} ${unit}`,
        found.length ? `So far: ${fmtN(sites)} websites, ${fmtN(people)} companies with a named decision-maker.` : "",
        L?.quotaMessage ?? "",
      ].filter(Boolean).join("\n");
      const actions = [{ id: "ready-xlsx", label: "Download what's ready (Excel)" }, { id: "ready-csv", label: "CSV" }, { id: "pause", label: "Pause" }];
      if (!runMsg.current) runMsg.current = addMsg({ role: "assistant", text, busy: true, progress: { done: p.done, of: p.of }, actions });
      else updateMsg(runMsg.current, { text, progress: { done: p.done, of: p.of }, actions });
    } else if (runMsg.current) {
      const id = runMsg.current;
      runMsg.current = null;
      if (run.state === "done") updateMsg(id, { busy: false, progress: undefined, tone: "ok", text: run.message ?? "Done.", actions: [{ id: "download-xlsx", label: "Download Excel again" }, { id: "download-csv", label: "CSV" }] });
      else if (run.state === "stopped") updateMsg(id, { busy: false, progress: undefined, tone: "warn", text: run.message ?? "Paused.", actions: [{ id: "resume", label: "Resume", primary: true }] });
      else updateMsg(id, { busy: false, progress: undefined, tone: "err", text: run.message ?? "The export stopped.", actions: [{ id: "resume", label: "Retry from where it stopped", primary: true }] });
    }
  }, [run?.state, run?.progress.done, run?.progress.label]); // eslint-disable-line react-hooks/exhaustive-deps

  /* -------------------------------------------------------- preview */

  const crawlSelection = (w: Workspace) => JSON.stringify(w.columns.filter((c) => c.on && c.page).map((c) => ({name:c.name,page:c.page})));
  const jobLeadSig = (j: Job) => (j.leads?.config.on ? [j.leads.config.nameCol, j.leads.config.countryCol, j.leads.config.websiteCol, j.leads.config.limit].join("|") : "");
  const planSig = (p: Plan | null | undefined) => (p ? JSON.stringify([p.items, p.limit, p.country, p.sources]) : "");
  const runMatches = !!run && !!ws && run.job.scanUrl === scan?.finalUrl && run.job.ws.listId === ws.listId && run.job.scope === scope && run.state !== "error"
    && planSig(run.job.plan) === planSig(plan)
    && jobLeadSig(run.job) === leadSig
    && (scope !== "crawl" || (run.job.crawl?.maxPages === maxPages && run.job.crawl?.mode === crawlMode && crawlSelection(run.job.ws) === crawlSelection(ws)));
  const rows: Row[] = useMemo(() => {
    if (!ws) return [];
    if (runMatches && run) return finalRows({ ...run.job, ws });
    // Before an export: this page's rows plus any pages loaded with Next, with trial lookups joined in.
    const more = browse && browse.id === browseId && feed ? feedRows(ws, activeList, browse.raw) : [];
    const all = more.length ? [...pageRowList, ...more] : pageRowList;
    if (plan && scan) {
      const L = leadsOn && leadsCfg ? { ...newLeadsState(stripCfg(leadsCfg)), results: leadPreview } : undefined;
      return planOutput({ plan, leads: L, ws, scanUrl: scan.finalUrl }, all);
    }
    return leadsOn && leadsCfg ? joinLeads(all, leadsCfg, leadPreview, leadNames({ ws })) : all;
  }, [ws, pageRowList, run, runMatches, leadsOn, leadsCfg, leadPreview, plan, scan, browse, browseId, feed, activeList]);

  const loadedRaw = feed ? feed.rows.length + (browse && browse.id === browseId ? browse.raw.length : 0) : 0;
  const canLoadMore = !runMatches && !!feed?.token && !!feed.paginated && (browse?.id !== browseId || browse.next !== null) && (feed.total == null || loadedRaw < feed.total);
  async function loadMore() {
    if (!feed?.token) return;
    const cur = browse && browse.id === browseId ? browse : { id: browseId, raw: [] as Row[], next: 1 as number | null };
    if (cur.next === null) return;
    try {
      const chunk = await fetchChunk(feed.token, cur.next, abort.current?.signal, 100);
      setBrowse({ id: browseId, raw: [...cur.raw, ...chunk.rows], next: chunk.next, error: chunk.error });
    } catch (e) {
      setBrowse({ ...cur, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const planColumns: Column[] = useMemo(
    () => (plan ? planHeaders(plan).map((name) => ({ id: `plan:${name}`, name, ink: / \((source|confidence)\)$/.test(name) ? "#e8e3d4" : "#f7e733", on: true, sample: "" })) : []),
    [plan],
  );

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

  async function execute(job: Job, opts: { download?: boolean } = {}) {
    jobAbort.current?.abort();
    const ac = new AbortController();
    jobAbort.current = ac;
    setRun({ job, progress: progressOf(job), state: "running" });
    try {
      const done = await runJob(job, {
        signal: ac.signal,
        ...auth,
        onUpdate: (j, p) => { if (jobAbort.current === ac) setRun({ job: j, progress: p, state: "running" }); },
      });
      if (ac.signal.aborted || jobAbort.current !== ac) return;
      // Runs started from the chat finish with download buttons instead of a surprise download.
      const saved = opts.download === false ? null : await deliver(done);
      const count = saved?.count ?? finalRows(done).length;
      const failed = failedItems(done).length;
      setRun({
        job: done, progress: progressOf(done), state: "done",
        message: `${saved ? `${fmtN(count)} rows saved to ${saved.filename}.` : `Done: ${fmtN(count)} rows are ready.`}${failed ? ` ${fmtN(failed)} item pages couldn't be read; their columns are empty.` : ""}${done.note ? ` ${done.note}` : ""}${leadSummary(done)}`,
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

  async function startExport(fmt: Format = format, opts: { download?: boolean } = {}) {
    if (!ws || !scan) return;
    if (!onCols.length) return say("Switch on at least one column first.");
    const format = fmt;
    const title = fileName.trim() || activeList?.name || scan.title || hostOf(scan.finalUrl);
    const spec = specFor(ws);

    // Rows already here and nothing to visit: instant.
    if (scope === "page" && !spec && !leadsOn && !plan) {
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
        url: scan.finalUrl, ...auth, mode: crawlMode, nextSelector: st.next?.selector, maxPages,
        recipe: {
          itemSelector: activeList.itemSelector,
          fields: [
            ...pageCols.map((c) => ({ name: c.name, sel: c.page!.sel, attr: c.page!.attr, multi: c.page!.multi })),
            ...(spec && linkCol ? [{ name: "__url", sel: linkCol.sel, attr: "href" }] : []),
          ],
        },
      };
    }
    // AI web searches: "automatic" means as many as today's free Groq tokens allow.
    const cfg = leadsOn && leadsCfg ? stripCfg(leadsCfg) : null;
    if (cfg && cfg.aiSearch < 0) cfg.aiSearch = ai?.enabled ? affordableSearches(readAiDay(), ai.models?.length) : 0;
    const job = newJob({
      title, format, scanUrl: scan.finalUrl, scope, ws, list: activeList, feed, crawl, gated: signedIn,
      // Companies already looked up in a trial run are not looked up again.
      leads: cfg ? newLeadsState(cfg, leadPreview) : undefined,
      plan: plan ?? undefined,
      // A limit without a country filter needs only the first pages (a little extra for repeated names).
      stopAfter: plan?.limit && !plan.country && scope === "feed" ? Math.ceil(plan.limit * 1.2) + 40 : undefined,
    });
    // A changed request reuses the rows and lookups the last run already has.
    await execute(carryOver(job, run?.job), opts);
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

  async function tryLeads(): Promise<TrySummary | null> {
    if (!ws || !scan || !leadsCfg) return null;
    const { rows: all, urls: allUrls } = baseRows({ scope: "page", ws, list: activeList, feed, raw: [] });
    // With a plan, only rows it keeps (e.g. its country filter) are tried.
    const keep = new Set(plan ? planFilter(all, plan, ws.columns) : all);
    const idx = all.map((r, i) => (keep.has(r) ? i : -1)).filter((i) => i >= 0);
    const companies = companiesFrom(idx.map((i) => all[i]), idx.map((i) => allUrls[i]), { ...leadsCfg, limit: 5 });
    if (!companies.length) {
      setTryError(`No company names in the "${leadsCfg.nameCol}" column on this page${plan?.country ? ` from ${plan.country}` : ""}.`);
      return null;
    }
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
        const out = await lookupBatch({ companies: queue, fairHost: new URL(scan.finalUrl).hostname, useAi: true, aiSearch: leadsCfg.aiSearch < 0 ? 2 : Math.min(2, leadsCfg.aiSearch) }, signal);
        for (const r of out.results) found[r.id] = r;
        quota ??= out.ai.quotaMessage;
        for (const n of out.notices) if (!notes.includes(n)) notes.push(n);
        queue = queue.filter((c) => out.pending.includes(c.id));
      }
      if (signal?.aborted) return null;
      setLeadPreview((cur) => ({ ...cur, ...found }));
      const list = Object.values(found);
      const summary: TrySummary = {
        looked: list.length,
        website: list.filter((r) => r.website).length,
        person: list.filter((r) => r.people.length).length,
        email: list.filter((r) => r.people.some((p) => p.email)).length,
        linkedin: list.filter((r) => r.companyLinkedin || r.people.some((p) => p.linkedin)).length,
        notes, // a 429 is shown in red in the AI box, not inside this success note
        quota,
      };
      setTried(summary);
      if (quota) setAi((a) => (a ? { ...a, ok: false, message: quota } : a));
      return summary;
    } catch (e) {
      if (signal?.aborted) return null;
      if (e instanceof LockedError) {
        setPhase("locked");
        return null;
      }
      setTryError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setTrying(null);
    }
  }

  /* -------------------------------------------------------- the conversation */

  const companiesWord = activeList?.name && /aussteller|exhibitor/i.test(activeList.name) ? "exhibitors" : "rows";

  function onChatSend(text: string) {
    // Never let a password typed into the chat travel anywhere (it would reach the AI planner).
    const SECRET = /(\b(?:pass(?:word|wort)?|pwd|kennwort)(?:\s*[:=]|\s+(?:is|ist|lautet))\s*)\S+/gi;
    if (SECRET.test(text)) {
      addMsg({ role: "user", text: text.replace(SECRET, "$1•••") });
      addMsg({ role: "assistant", tone: "warn", text: "Please don't type passwords in the chat. I've opened the sign-in box: your password goes only to the site's own sign-in form, once, and isn't saved." });
      setSignInMode("password");
      setCookieOpen(true);
      return;
    }
    addMsg({ role: "user", text });
    if (/\b(log ?in|sign ?in|anmelden|einloggen|my account|mein konto|members? only|behind a login)\b/i.test(text) && !urlIn(text)) {
      addMsg({ role: "assistant", text: "Use the sign-in box I've opened (top right): enter your login ID and password there. They're used once to sign in to the site and never saved." });
      setSignInMode("password");
      setCookieOpen(true);
      return;
    }
    const link = urlIn(text);
    const ask = link ? text.replace(link, "").replace(link.replace(/^https?:\/\//, ""), "").trim() : text.trim();
    const sameSite = link && scan && hostOf(link) === hostOf(scan.finalUrl) && new URL(link).pathname === new URL(scan.finalUrl).pathname;
    if (link && !sameSite) {
      pendingAsk.current = ask;
      scanMsg.current = addMsg({ role: "assistant", text: `Reading ${hostOf(link)}…`, busy: true });
      pending.current = null;
      void startScan(link);
      return;
    }
    if (!scan || phase !== "ready") {
      if (phase === "scanning") {
        pendingAsk.current = [pendingAsk.current, ask].filter(Boolean).join("\n");
        addMsg({ role: "assistant", text: "Got it. I'll apply that as soon as the page is read." });
      } else addMsg({ role: "assistant", text: "Which website? Paste its link, with what you need in the export." });
      return;
    }
    if (ask) void makePlan(ask);
  }

  async function makePlan(text: string) {
    if (!ws || !scan) return;
    setPlanning(true);
    const avail = availableFrom(ws.columns, pageRowList, extras);
    const prev = plan;
    const thinking = addMsg({ role: "assistant", text: prev ? "Changing your export…" : "Reading your request…", busy: true });
    let next: Plan;
    let how = "";
    try {
      const rules = prev ? followUp(prev, text, avail) : { ...resolvePlan(parseRequest(text), avail), request: text };
      const answer = await planWithAi({
        message: text, previous: prev?.request, current: prev?.items.map((i) => i.label),
        fields: avail.map((a) => ({ name: a.name, samples: a.samples.slice(0, 3) })),
      }, abort.current?.signal);
      const viaAi = answer.ai ? fromAi(answer.ai, avail, prev ? `${prev.request}\n${text}` : text, prev ?? undefined) : null;
      next = viaAi ?? rules;
      how = viaAi ? "Understood by AI (Groq)." : answer.reason === "quota" ? `Understood by the built-in rules: ${answer.message}` : answer.reason === "off" ? "Understood by the built-in rules (AI is off)." : `Understood by the built-in rules (AI didn't answer: ${answer.message}).`;
      if (answer.reason === "quota") setAi((a) => (a ? { ...a, ok: false, message: answer.message } : a));
    } catch (e) {
      setPlanning(false);
      if (e instanceof LockedError) return setPhase("locked");
      updateMsg(thinking, { busy: false, tone: "err", text: e instanceof Error ? e.message : String(e) });
      return;
    }
    if (!next.items.length) {
      setPlanning(false);
      updateMsg(thinking, { busy: false, tone: "warn", text: `I couldn't match that to anything on this page${next.unresolved.length ? ` (${next.unresolved.join(", ")})` : ""}. Try names like: company, country, booth, CEO name, email, LinkedIn.` });
      return;
    }
    applyPlan(next);
    const lookup = needsLookup(next);
    const total = expectedRows ?? onPage;
    const lines = [
      `Here's your export: ${next.items.length} column${next.items.length === 1 ? "" : "s"}${next.sources ? ", each with its source and confidence" : ""}.`,
      next.country || next.limit ? `Only ${[next.country ? `companies from ${next.country}` : "", next.limit ? `the first ${next.limit}` : ""].filter(Boolean).join(", ")}.` : "",
      next.unresolved.length ? `Not available on this site: ${next.unresolved.join(", ")}.` : "",
      lookup
        ? `Looking up every company now${next.limit ? ` (the first ${fmtN(next.limit)})` : ""}: its page on this site, then its own website (imprint, team, contact). Results fill the table as they come in; you can download what's ready at any time.`
        : "Fetching every row now; the table fills as it goes.",
      how,
    ].filter(Boolean);
    updateMsg(thinking, {
      busy: false,
      text: lines.join("\n"),
      chips: next.items.map((i) => ({ label: i.label, hint: describeSource(i.source) })),
      actions: [],
    });
    setPlanning(false);
    setAutoRun(true);
  }

  /** Switch on the columns the plan reads, and set the decision-maker lookup to match. */
  function applyPlan(next: Plan) {
    if (!ws) return;
    const needIds = new Set<string>();
    for (const it of next.items) if (it.source.type === "column") needIds.add(it.source.id);
    if (next.companyColId) needIds.add(next.companyColId);
    if (next.country && next.countryColId) needIds.add(next.countryColId);
    for (const id of needIds) {
      const c = ws.columns.find((x) => x.id === id);
      if (c && !c.on) dispatch({ type: "toggle", id });
      if (!c && id.startsWith("feed:")) {
        const f = extras.find((x) => `feed:${x.key}` === id);
        if (f) dispatch({ type: "addFeedField", field: f });
      }
    }
    for (const it of next.items) {
      if (it.source.type !== "feed") continue;
      const key = it.source.key;
      const f = extras.find((x) => x.key === key);
      if (f) dispatch({ type: "addFeedField", field: f });
    }
    const company = next.companyColId ? ws.columns.find((c) => c.id === next.companyColId) : undefined;
    const country = next.countryColId ? ws.columns.find((c) => c.id === next.countryColId) : undefined;
    if (needsLookup(next) && company) {
      setLeadsCfg((cur) => ({ on: true, nameCol: company.name, countryCol: country?.name, websiteCol: cur?.websiteCol, limit: next.limit, aiSearch: cur?.aiSearch ?? -1, listId: ws.listId }));
    } else setLeadsCfg((cur) => (cur ? { ...cur, on: false } : cur));
    setPlan(next);
    setDoneNote(null);
  }

  function exportActions(p: Plan | null, total: number | null) {
    const what = p?.limit ? `the first ${fmtN(p.limit)}${p.country ? ` from ${p.country}` : ""}` : p?.country ? `all from ${p.country}` : total ? `all ${fmtN(total)}` : "all";
    return [
      { id: "export-xlsx", label: `Get ${what} as Excel`, primary: true },
      { id: "export-csv", label: "CSV" },
    ];
  }

  function onChatAction(id: string) {
    if (id === "export-xlsx" || id === "download-xlsx") { setFormat("xlsx"); runMsg.current = null; void startExport("xlsx"); }
    else if (id === "export-csv" || id === "download-csv") { setFormat("csv"); runMsg.current = null; void startExport("csv"); }
    else if ((id === "ready-xlsx" || id === "ready-csv") && run && ws) {
      void deliver({ ...run.job, ws, format: id === "ready-xlsx" ? "xlsx" : "csv" }).then(({ count, filename }) => say(`${fmtN(count)} rows so far saved to ${filename}`));
    }
    else if (id === "pause") jobAbort.current?.abort();
    else if (id === "try") setTrialWanted(true);
    else if (id === "retry-scan") void startScan(url);
    else if (id === "resume" && run) void execute(run.job, { download: false });
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
    plan ? `Get ${plan.limit ? `the first ${fmtN(plan.limit)}` : "all"}${plan.country ? ` from ${plan.country}` : ""}${needsLookup(plan) ? " + decision-makers" : ""}` :
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
          <button type="button" className={`btn btn-quiet${cookie || session ? " on" : ""}`} onClick={() => setCookieOpen((v) => !v)} aria-expanded={cookieOpen} title="Scan a page that needs you to be signed in">
            <KeyRound size={15} aria-hidden="true" />
            <span>{session ? `Signed in · ${session.host}` : cookie ? "Cookie set" : "Sign in"}</span>
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
          <div className="cookie signin" role="dialog" aria-label="Sign in to a site">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
              <div className="seg" role="tablist" aria-label="How to sign in">
                <button role="tab" aria-selected={signInMode === "password"} className={signInMode === "password" ? "on" : ""} onClick={() => setSignInMode("password")}>Login ID &amp; password</button>
                <button role="tab" aria-selected={signInMode === "cookie"} className={signInMode === "cookie" ? "on" : ""} onClick={() => setSignInMode("cookie")}>Paste a cookie</button>
              </div>
              <button className="iconbtn" onClick={() => setCookieOpen(false)} aria-label="Close"><X size={16} /></button>
            </div>
            {signInMode === "password" ? (
              <form autoComplete="off" onSubmit={(e) => {
                e.preventDefault();
                const target = normalizeUrl(url) || scan?.finalUrl || "";
                if (!target) return say("Paste the site's address first.");
                if (!loginId.trim() || !password) return;
                const creds = { username: loginId.trim(), password };
                setPassword(""); // the password leaves this tab once, in this request, and is not kept
                setCookieOpen(false);
                if (chat.length) {
                  scanMsg.current = addMsg({ role: "assistant", text: `Signing in to ${hostOf(target)}…`, busy: true });
                  pendingAsk.current = plan?.request ?? null;
                }
                pending.current = null;
                void startScan(target, creds);
              }}>
                {session ? (
                  <p className="note ok" style={{ margin: "8px 0" }}><Check size={14} aria-hidden="true" /><span>Signed in to {session.host} for this tab. <button type="button" className="linkbtn" onClick={() => setSession(null)}>Sign out</button></span></p>
                ) : null}
                <label htmlFor="login-id">Login ID or email</label>
                <input id="login-id" className="fname" value={loginId} onChange={(e) => setLoginId(e.target.value)} autoComplete="off" spellCheck={false} />
                <label htmlFor="login-pw">Password</label>
                <input id="login-pw" className="fname" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
                <p>Used once to sign in to <b>{hostOf(normalizeUrl(url) || scan?.finalUrl || "the site")}</b>, then dropped: never saved, logged or shown. It is only typed into that site&rsquo;s own sign-in form. Sites with a CAPTCHA or a one-time code need “Paste a cookie”.</p>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={!loginId.trim() || !password}>Sign in and read page</button>
                </div>
              </form>
            ) : (
              <>
                <p>
                  Sign in to the site in your own browser. Open DevTools, choose <b>Network</b>, reload, click the page request, and copy the <b>Cookie</b> request header. Paste it here. It is sent only to that site, never saved, and never shown again.
                </p>
                <textarea id="cookie" value={cookie} onChange={(e) => setCookie(e.target.value)} placeholder="sessionid=…; token=…" spellCheck={false} aria-label="Cookie for this site" />
                <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
                  {cookie && <button className="btn btn-ghost btn-sm" onClick={() => setCookie("")}>Clear</button>}
                  <button className="btn btn-primary btn-sm" onClick={() => setCookieOpen(false)}>Done</button>
                </div>
              </>
            )}
          </div>
        )}
      </header>
      <AiUsageBar enabled={ai ? ai.enabled : null} models={ai?.models} />

      {(phase === "idle" || (chat.length > 0 && (phase === "scanning" || phase === "error"))) && (
        <ChatHome messages={chat} onSend={onChatSend} onAction={onChatAction} busy={phase === "scanning" || planning}>
          {jobCard}
        </ChatHome>
      )}
      {phase === "scanning" && !chat.length && <Printing host={hostOf(url)} status={status} />}
      {phase === "error" && !chat.length && <Failed message={error} kind={errorKind} onRetry={() => void startScan(url)} onBack={() => setPhase("idle")} />}
      {phase === "locked" && <Locked onUnlock={async (pw) => { const ok = await unlock(pw); if (ok) { setPhase("idle"); if (url) void startScan(url); } return ok; }} />}

      {phase === "ready" && scan && (
        <div className="work">
          <div className="deskcol">
            <Preview
              columns={plan ? planColumns : ws ? [...ws.columns, ...leadColumns] : []}
              rows={rows}
              total={runMatches && run?.state === "done" ? rows.length : plan ? (plan.limit ?? (plan.country ? rows.length : expectedRows ?? rows.length)) : scope === "page" ? rows.length : expectedRows ?? rows.length}
              label={runMatches ? (run?.state === "done" ? "everything fetched" : "fetched so far") : plan ? (needsLookup(plan) ? "this page; decision-maker columns fill in for tried companies and when you export" : "this page, as your export will look") : hasItemCols ? "this page; item-page columns fill in when you export" : leadsOn ? "this page; decision-maker columns fill in when you export or try" : scope === "page" ? "this page" : loadedRaw > (feed?.rows.length ?? 0) ? "browsing the site's data; the export fetches everything" : "this page, before fetching the rest"}
              tableOnly={tableOnly}
              onToggleTableOnly={() => setTableOnly((v) => !v)}
              noListFound={noListFound}
              isNavigation={isNavigation}
              directoryLinks={directoryLinks}
              onFollowLink={followDirectoryLink}
              canLoadMore={canLoadMore}
              onLoadMore={loadMore}
              loadError={browse && browse.id === browseId ? browse.error ?? null : null}
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
              <ChatPanel messages={chat} onSend={onChatSend} onAction={onChatAction} busy={planning || !!trying} />
              <details className="advanced" open={!plan}>
              <summary><ChevronRight size={14} aria-hidden="true" />Advanced settings</summary>
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
                  gated={signedIn}
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
              </details>
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
                      <button className="btn btn-primary" onClick={() => void startExport(format)} disabled={!onCols.length || busy}>
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
