"use client";

import { Activity, Bot, Download, FolderOpen, History, Pause, Play, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { AiStatus } from "@/lib/client-api";
import type { Job, Progress } from "@/lib/job";
import { AiUsage, leftPercent, useAiDay } from "./AiUsageBar";

export type JobState = "running" | "waiting" | "paused" | "done" | "error";
export interface JobView { job: Job; state: JobState; progress: Progress; message?: string; live: boolean }

const fmtN = (n: number) => n.toLocaleString();
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};
const when = (t: number) => new Date(t).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const STATE_LABEL: Record<JobState, string> = { running: "Running", waiting: "Waiting for AI", paused: "Paused", done: "Done", error: "Stopped" };

/** The numbers a list row shows, from what the job holds (cheap: no table is built). */
export function jobStats(job: Job) {
  const L = job.leads;
  const results = L ? Object.values(L.results) : [];
  return {
    // Rows in her file: a "first N" request has N, whatever was fetched to find them.
    rows: job.plan?.limit ? Math.min(job.plan.limit, job.raw.length || job.total || job.plan.limit) : job.raw.length || job.total || 0,
    total: job.total,
    companies: L?.companyCount || 0,
    looked: results.length,
    people: results.filter((r) => r.people.length).length,
    websites: results.filter((r) => r.website).length,
    needAi: results.filter((r) => r.needsAi?.length).length,
  };
}

function JobItem({ v, onOpen, onDownload, onResume, onPause, onDelete }: {
  v: JobView;
  onOpen: (j: Job) => void;
  onDownload: (j: Job, f: "xlsx" | "csv") => void;
  onResume: (j: Job) => void;
  onPause: () => void;
  onDelete: (j: Job) => void;
}) {
  const { job, state, progress } = v;
  const s = jobStats(job);
  const pct = progress.of ? Math.min(100, (progress.done / progress.of) * 100) : null;
  const wait = state === "waiting" && job.leads?.aiWaitUntil && job.leads.aiWaitUntil > Date.now() ? job.leads.aiWaitUntil : null;
  return (
    <li className={`jobitem ${state}`}>
      <div className="ji-top">
        <b title={job.title}>{job.title}</b>
        <span className={`chip ${state}`}>{STATE_LABEL[state]}</span>
      </div>
      <div className="ji-sub">
        {hostOf(job.scanUrl)} · {when(job.updatedAt)}{job.gated ? " · signed in (this tab only)" : ""}
      </div>
      {job.request && <div className="ji-req" title={job.request}>“{job.request.split("\n").filter(Boolean).pop()}”</div>}
      {state !== "done" && (
        <>
          <div className={`meter${pct == null ? " indeterminate" : ""}`} aria-hidden="true"><i style={{ transform: `scaleX(${(pct ?? 0) / 100})` }} /></div>
          <div className="ji-progress">
            {wait ? `Continues by itself around ${when(wait)}` : `${progress.label}${progress.of ? `: ${fmtN(progress.done)} of ${fmtN(progress.of)}` : ""}`}
          </div>
        </>
      )}
      <div className="ji-stats">
        {s.rows ? <span><b>{fmtN(s.rows)}</b> rows</span> : null}
        {job.leads?.config.on ? <>
          <span><b>{fmtN(s.looked)}</b>{s.companies ? ` of ${fmtN(s.companies)}` : ""} companies looked up</span>
          <span><b>{fmtN(s.people)}</b> with a decision-maker</span>
          <span><b>{fmtN(s.websites)}</b> websites</span>
          {s.needAi ? <span className="warn"><b>{fmtN(s.needAi)}</b> waiting for AI</span> : null}
        </> : null}
      </div>
      {v.message && state === "error" && <p className="note err">{v.message}</p>}
      <div className="ji-actions">
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => onOpen(job)}><FolderOpen size={13} aria-hidden="true" />Open</button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => onDownload(job, "xlsx")}><Download size={13} aria-hidden="true" />Excel</button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => onDownload(job, "csv")}>CSV</button>
        {state === "running" && v.live && <button type="button" className="btn btn-quiet btn-sm" onClick={onPause}><Pause size={13} aria-hidden="true" />Pause</button>}
        {(state === "paused" || state === "error") && <button type="button" className="btn btn-quiet btn-sm" onClick={() => onResume(job)}><Play size={13} aria-hidden="true" />Resume</button>}
        {state === "waiting" && <button type="button" className="btn btn-quiet btn-sm" onClick={() => onResume(job)}><Sparkles size={13} aria-hidden="true" />Try AI now</button>}
        <span style={{ flex: 1 }} />
        <button type="button" className="iconbtn" onClick={() => onDelete(job)} aria-label={`Delete ${job.title}`} title="Delete from history"><Trash2 size={15} /></button>
      </div>
    </li>
  );
}

/**
 * The floating button (bottom left) and its panel: every export with its progress, and today's AI usage.
 */
export default function Dock(props: {
  open: boolean;
  setOpen: (v: boolean) => void;
  tab: "exports" | "usage";
  setTab: (t: "exports" | "usage") => void;
  jobs: JobView[];
  ai: AiStatus | null;
  aiError: string | null;
  testingAi: boolean;
  onTestAi: () => void;
  onOpen: (j: Job) => void;
  onDownload: (j: Job, f: "xlsx" | "csv") => void;
  onResume: (j: Job) => void;
  onPause: () => void;
  onDelete: (j: Job) => void;
}) {
  const { open, setOpen, tab, setTab, jobs } = props;
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const day = useAiDay();
  const pct = leftPercent(day, props.ai);
  const running = jobs.some((j) => j.state === "running");
  const waiting = !running && jobs.some((j) => j.state === "waiting");

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (document.querySelector(".viewer")) return; // Escape closes the opened export first
        setOpen(false);
        button.current?.focus();
      }
    };
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !button.current?.contains(t) && !(t as HTMLElement).closest?.(".viewer-backdrop")) setOpen(false);
    };
    window.addEventListener("keydown", key);
    window.addEventListener("mousedown", down);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("mousedown", down);
    };
  }, [open, setOpen]);

  return (
    <>
      <button
        ref={button} type="button" className={`dock-btn${running ? " running" : waiting ? " waiting" : ""}`}
        aria-expanded={open} aria-controls="dock" onClick={() => setOpen(!open)}
        title={running ? "An export is running" : waiting ? "An export is waiting for AI" : "Exports and AI usage"}
      >
        <Activity size={18} aria-hidden="true" />
        <span className="visually-hidden">Exports and AI usage{running ? " (an export is running)" : waiting ? " (an export is waiting for AI)" : ""}</span>
        {(running || waiting) && <span className="dock-dot" aria-hidden="true" />}
        {pct != null && (
          <span className="dock-ring" aria-hidden="true" style={{ ["--p" as string]: `${pct}` }} />
        )}
      </button>
      {open && (
        <div id="dock" ref={panel} className="dock" role="dialog" aria-label="Exports and AI usage">
          <div className="dock-head">
            <div className="seg" role="tablist" aria-label="Show">
              <button role="tab" aria-selected={tab === "exports"} className={tab === "exports" ? "on" : ""} onClick={() => setTab("exports")}>
                <History size={13} aria-hidden="true" />Exports{jobs.length ? ` (${jobs.length})` : ""}
              </button>
              <button role="tab" aria-selected={tab === "usage"} className={tab === "usage" ? "on" : ""} onClick={() => setTab("usage")}>
                <Bot size={13} aria-hidden="true" />AI usage{pct != null ? ` · ${Math.round(pct)}% left` : ""}
              </button>
            </div>
            <button type="button" className="iconbtn" onClick={() => setOpen(false)} aria-label="Close"><X size={16} /></button>
          </div>
          <div className="dock-body">
            {tab === "exports" ? (
              jobs.length ? (
                <ul className="joblist">
                  {jobs.map((v) => (
                    <JobItem key={v.job.id} v={v} onOpen={props.onOpen} onDownload={props.onDownload} onResume={props.onResume} onPause={props.onPause} onDelete={props.onDelete} />
                  ))}
                </ul>
              ) : (
                <p className="note" style={{ padding: "6px 2px" }}>No exports yet. Ask for one in the chat; it shows up here with its progress, and stays here (the last 25, for 30 days) so you can open or download it again.</p>
              )
            ) : (
              <AiUsage ai={props.ai} aiError={props.aiError} testingAi={props.testingAi} onTestAi={props.onTestAi} />
            )}
          </div>
          {tab === "exports" && jobs.length > 0 && (
            <p className="dock-foot"><RotateCcw size={12} aria-hidden="true" />Saved in this browser only. Exports waiting for AI continue by themselves while this site is open.</p>
          )}
        </div>
      )}
    </>
  );
}
