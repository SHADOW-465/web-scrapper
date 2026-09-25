"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { cell } from "@/lib/exporters";
import type { Column, Row } from "@/lib/model";

const SHOW = 60;

export default function Preview({ columns, rows, total, label }: { columns: Column[]; rows: Row[]; total: number; label: string }) {
  const [open, setOpen] = useState(true);
  const on = columns.filter((c) => c.on);
  return (
    <section className={`preview${open ? "" : " collapsed"}`} aria-label="Preview">
      <div className="preview-head">
        <h2>Preview</h2>
        <span className="aside">
          {rows.length ? <><span className="num">{Math.min(rows.length, SHOW).toLocaleString()}</span> of <span className="num">{total.toLocaleString()}</span> rows</> : "No rows yet"} · {label}
        </span>
        <span style={{ marginLeft: "auto" }} />
        <button className="iconbtn" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? "Collapse preview" : "Expand preview"}>
          {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </div>
      {open && (
        <div className="preview-body">
          {on.length === 0 ? (
            <p className="note" style={{ padding: 14 }}>Mark at least one column on the page, or switch one on in the tray.</p>
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
