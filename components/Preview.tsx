"use client";

import { ChevronDown, ChevronUp, Table2 } from "lucide-react";
import { useState } from "react";
import { cell } from "@/lib/exporters";
import type { Column, Row } from "@/lib/model";

const SHOW = 60;

export default function Preview({
  columns,
  rows,
  total,
  label,
  tableOnly,
  onToggleTableOnly,
}: {
  columns: Column[];
  rows: Row[];
  total: number;
  label: string;
  tableOnly?: boolean;
  onToggleTableOnly?: () => void;
}) {
  const [open, setOpen] = useState(true);
  const isOpen = open || !!tableOnly;
  const on = columns.filter((c) => c.on);
  const shown = Math.min(rows.length, SHOW);
  const effectiveTotal = Math.max(shown, total);
  return (
    <section className={`preview${isOpen ? "" : " collapsed"}${tableOnly ? " full" : ""}`} aria-label="Results table">
      <div className="preview-head">
        <h2>Results table</h2>
        <span className="aside">
          {rows.length ? (
            shown === effectiveTotal ? (
              <><span className="num">{effectiveTotal.toLocaleString()}</span> {effectiveTotal === 1 ? "row" : "rows"}</>
            ) : (
              <><span className="num">{shown.toLocaleString()}</span> of <span className="num">{effectiveTotal.toLocaleString()}</span> rows</>
            )
          ) : (
            "No rows yet"
          )} · {label}
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
          {on.length === 0 ? (
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
                {rows.slice(0, SHOW).map((r, i) => (
                  <tr key={i}>
                    <td className="rn">{i + 1}</td>
                    {on.map((c) => {
                      const v = cell(r[c.name]);
                      return <td key={c.id} className={v ? undefined : "empty"} title={v}>{v || "–"}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
