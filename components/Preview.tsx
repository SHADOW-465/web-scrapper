"use client";

import { AlertTriangle, ArrowRight, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronUp, Loader2, Table2 } from "lucide-react";
import { useEffect, useState } from "react";
import { cell } from "@/lib/exporters";
import type { Column, DirectoryLink, Row } from "@/lib/model";

const PAGE = 50;

export default function Preview({
  columns,
  rows,
  total,
  label,
  tableOnly,
  onToggleTableOnly,
  noListFound,
  isNavigation,
  directoryLinks,
  onFollowLink,
  canLoadMore,
  onLoadMore,
  loadError,
}: {
  columns: Column[];
  rows: Row[];
  total: number;
  label: string;
  tableOnly?: boolean;
  onToggleTableOnly?: () => void;
  noListFound?: boolean;
  isNavigation?: boolean;
  directoryLinks?: DirectoryLink[];
  onFollowLink?: (url: string) => void;
  /** More rows exist on the site than are loaded here: Next fetches them. */
  canLoadMore?: boolean;
  onLoadMore?: () => Promise<void>;
  loadError?: string | null;
}) {
  const [open, setOpen] = useState(true);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const isOpen = open || !!tableOnly;
  const on = columns.filter((c) => c.on);
  const effectiveTotal = Math.max(rows.length, total);
  const pages = Math.max(1, Math.ceil(effectiveTotal / PAGE));
  const last = Math.max(0, Math.ceil(rows.length / PAGE) - 1);
  // Stay on a page that exists (a new dataset or a shorter table moves back).
  useEffect(() => {
    if (page > last && !loading) setPage(last);
  }, [page, last, loading]);
  const from = page * PAGE;
  const slice = rows.slice(from, from + PAGE);
  const hasNext = from + PAGE < rows.length || !!canLoadMore;
  const next = async () => {
    if (from + PAGE < rows.length) return setPage(page + 1);
    if (!canLoadMore || !onLoadMore) return;
    setLoading(true);
    try {
      await onLoadMore();
      setPage(page + 1);
    } finally {
      setLoading(false);
    }
  };
  const shown = slice.length;
  // A page is never shown half-empty while the site has more: fill it first, so no rows are skipped.
  useEffect(() => {
    if (slice.length >= PAGE || !canLoadMore || !onLoadMore || loading || !on.length) return;
    let live = true;
    setLoading(true);
    void Promise.resolve(onLoadMore()).finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [slice.length, canLoadMore, page]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className={`preview${isOpen ? "" : " collapsed"}${tableOnly ? " full" : ""}`} aria-label="Results table">
      <div className="preview-head">
        <h2>Results table</h2>
        <span className="aside">
          {noListFound ? (
            "No company list found on this page"
          ) : rows.length ? (
            shown === effectiveTotal ? (
              <><span className="num">{effectiveTotal.toLocaleString()}</span> {effectiveTotal === 1 ? "row" : "rows"}</>
            ) : (
              <>rows <span className="num">{(from + 1).toLocaleString()}–{(from + shown).toLocaleString()}</span> of <span className="num">{effectiveTotal.toLocaleString()}</span></>
            )
          ) : (
            "No rows yet"
          )}
          {!noListFound ? ` · ${label}` : ""}
        </span>
        <span style={{ marginLeft: "auto" }} />
        {onToggleTableOnly && (
          <button
            type="button"
            className={`btn btn-quiet btn-sm table-only-toggle${tableOnly ? " on" : ""}`}
            aria-pressed={!!tableOnly}
            onClick={onToggleTableOnly}
          >
            <Table2 size={14} aria-hidden="true" />
            <span>Table only</span>
          </button>
        )}
        {!tableOnly && (
          <button className="iconbtn" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? "Collapse results table" : "Expand results table"}>
            {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        )}
      </div>
      {isOpen && (
        <div className="preview-body">
          {isNavigation && (
            <div className="note warn" role="status" style={{ padding: "10px 14px", borderBottom: "1px solid var(--rule)", background: "var(--chrome)" }}>
              <AlertTriangle size={15} aria-hidden="true" />
              <div>
                <b>These rows look like site navigation links, not a company list.</b>
                {directoryLinks && directoryLinks.length > 0 && onFollowLink && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                    {directoryLinks.map((d) => (
                      <button key={d.url} type="button" className="btn btn-primary btn-sm" onClick={() => onFollowLink(d.url)}>
                        <span>{d.label}</span>
                        <ArrowRight size={14} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          {noListFound ? (
            <div style={{ padding: "22px 18px" }}>
              <p className="note warn" style={{ fontSize: 14, fontWeight: 600 }}>
                <AlertTriangle size={16} aria-hidden="true" />
                <span>No company list found on this page.</span>
              </p>
              <p style={{ margin: "6px 0 12px", color: "var(--graphite-2)", fontSize: 13.5 }}>
                This page does not contain a directory table or repeating company cards of its own. Make sure you are on the directory listing page, or click a company on the page preview below to mark it manually.
              </p>
              {directoryLinks && directoryLinks.length > 0 && onFollowLink && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 10 }}>
                  {directoryLinks.map((d) => (
                    <button key={d.url} type="button" className="btn btn-primary" onClick={() => onFollowLink(d.url)}>
                      <span>{d.label}</span>
                      <ArrowRight size={15} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : on.length === 0 ? (
            <p className="note" style={{ padding: 14 }}>Mark at least one column on the page, or switch one on in the right panel.</p>
          ) : (
            <table className="grid">
              <thead>
                <tr>
                  <th className="rn" scope="col"><span className="visually-hidden">Row</span></th>
                  {on.map((c) => (
                    <th key={c.id} scope="col" style={{ ["--ink" as string]: c.ink }}>
                      {c.name}
                      <span className="ink" aria-hidden="true" />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slice.map((r, i) => (
                  <tr key={from + i}>
                    <td className="rn">{from + i + 1}</td>
                    {on.map((c) => {
                      const v = cell(r[c.name]);
                      const link = /^https?:\/\/\S+$/i.test(v);
                      return (
                        <td key={c.id} className={v ? undefined : "empty"} title={v}>
                          {link ? <a className="cell-link" href={v} target="_blank" rel="noreferrer noopener">{v.replace(/^https?:\/\/(www\.)?/, "")}</a> : v || "–"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!noListFound && on.length > 0 && (pages > 1 || hasNext) && (
            <nav className="pager" aria-label="Table pages">
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setPage(0)} disabled={page === 0 || loading} aria-label="First page"><ChevronsLeft size={14} aria-hidden="true" /></button>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0 || loading}><ChevronLeft size={14} aria-hidden="true" />Prev</button>
              <span className="pageinfo">Page <b className="num">{(page + 1).toLocaleString()}</b> of <span className="num">{pages.toLocaleString()}</span>{rows.length < effectiveTotal ? <> · <span className="num">{rows.length.toLocaleString()}</span> loaded</> : null}</span>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => void next()} disabled={!hasNext || loading}>
                {loading ? <Loader2 size={14} className="spin" aria-hidden="true" /> : null}Next<ChevronRight size={14} aria-hidden="true" />
              </button>
              {loadError ? <span className="note err" role="alert">{loadError}</span> : null}
            </nav>
          )}
        </div>
      )}
    </section>
  );
}
