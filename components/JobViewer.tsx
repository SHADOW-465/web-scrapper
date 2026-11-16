"use client";

import { Download, Pause, Play, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { exportFields, finalRows } from "@/lib/job";
import type { Column } from "@/lib/model";
import type { JobView } from "./Dock";
import { jobStats } from "./Dock";
import Preview from "./Preview";

const fmtN = (n: number) => n.toLocaleString();

/** One export, opened from the history: its whole table (live while it runs), and downloads. */
export default function JobViewer({ v, onClose, onDownload, onResume, onPause }: {
  v: JobView;
  onClose: () => void;
  onDownload: (f: "xlsx" | "csv") => void;
  onResume: () => void;
  onPause: () => void;
}) {
  const { job, state, progress } = v;
  const rows = useMemo(() => finalRows(job), [job]);
  const columns: Column[] = useMemo(
    () => exportFields(job).map((name) => ({ id: `v:${name}`, name, ink: / \((source|confidence)\)$|source$|confidence$/i.test(name) ? "#e8e3d4" : "#f7e733", on: true, sample: "" })),
    [job],
  );
  const s = jobStats(job);
  const fetchedRows = job.scope === "feed" && job.feed?.paginated ? job.raw.length : rows.length;
  const partialFetch = job.total != null && fetchedRows < job.total;
  const close = useRef<HTMLButtonElement>(null);
  // Focus starts on Close; Escape closes (handled on the dialog itself, and on the page for focus outside it).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    close.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, []);

  const status =
    state === "running" || state === "waiting" ? progress.label || "Still working…" :
    state === "paused" ? `Paused: ${progress.label}` : state === "error" ? v.message ?? "Stopped" : "Finished";

  return (
    <div className="viewer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="viewer" role="dialog" aria-modal="true" aria-labelledby="viewer-title">
        <header className="viewer-head">
          <div style={{ minWidth: 0 }}>
            <h2 id="viewer-title">{job.title}</h2>
            <p>
              {status}
              {job.leads?.config.on ? ` · ${fmtN(s.looked)} companies looked up, ${fmtN(s.people)} with a decision-maker, ${fmtN(s.websites)} websites` : ""}
            </p>
          </div>
          <div className="viewer-actions">
            {state === "running" && v.live && <button type="button" className="btn btn-quiet btn-sm" onClick={onPause}><Pause size={13} aria-hidden="true" />Pause</button>}
            {(state === "paused" || state === "error") && <button type="button" className="btn btn-quiet btn-sm" onClick={onResume}><Play size={13} aria-hidden="true" />Resume</button>}
            {state === "waiting" && <button type="button" className="btn btn-quiet btn-sm" onClick={onResume}><Play size={13} aria-hidden="true" />Continue</button>}
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onDownload("xlsx")}><Download size={13} aria-hidden="true" />Excel</button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => onDownload("csv")}>CSV</button>
            <button ref={close} type="button" className="iconbtn" onClick={onClose} aria-label="Close"><X size={18} /></button>
          </div>
        </header>
        <div className="viewer-table">
          <Preview
            columns={columns}
            rows={rows}
            total={partialFetch ? Math.max(rows.length, job.total ?? rows.length) : rows.length}
            label={partialFetch ? `${fetchedRows.toLocaleString()} of ${(job.total ?? rows.length).toLocaleString()} fetched so far` : state === "done" ? `all ${rows.length.toLocaleString()} rows` : "fetched so far"}
            tableOnly
          />
        </div>
      </div>
    </div>
  );
}
