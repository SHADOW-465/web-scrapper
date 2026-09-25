/**
 * Client-side exports. Files are built in the browser from rows the page
 * already holds, so the server never writes a file and has nothing to store.
 */
export type Format = "csv" | "xlsx" | "json" | "pdf";
export type Row = Record<string, unknown>;

export const FORMATS: Array<{ id: Format; label: string; hint: string }> = [
  { id: "xlsx", label: "Excel", hint: ".xlsx, opens in Excel, Numbers, Sheets" },
  { id: "csv", label: "CSV", hint: "UTF-8, works everywhere" },
  { id: "json", label: "JSON", hint: "for code and databases" },
  { id: "pdf", label: "PDF", hint: "printable table" },
];

export function cell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function csvField(s: string): string {
  // Leading =,+,-,@ would run as a formula when opened in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: Row[], fields: string[]): string {
  const lines = [fields.map(csvField).join(",")];
  for (const r of rows) lines.push(fields.map((f) => csvField(cell(r[f]))).join(","));
  // BOM so Excel on Windows reads accents and umlauts correctly.
  return "﻿" + lines.join("\r\n");
}

export function toJson(rows: Row[], fields: string[]): string {
  return JSON.stringify(rows.map((r) => Object.fromEntries(fields.map((f) => [f, r[f] ?? ""]))), null, 2);
}

async function toXlsx(rows: Row[], fields: string[]): Promise<Blob> {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const header = fields.map((f) => ({ value: f, fontWeight: "bold" as const }));
  const body = rows.map((r) => fields.map((f) => {
    const v = r[f];
    return typeof v === "number" ? { value: v } : { value: cell(v) };
  }));
  const widths = fields.map((f) => ({
    width: Math.min(60, Math.max(10, f.length + 2, ...rows.slice(0, 300).map((r) => cell(r[f]).length + 2))),
  }));
  return writeXlsxFile([header, ...body] as never, { columns: widths, stickyRowsCount: 1 } as never).toBlob();
}

async function toPdf(rows: Row[], fields: string[], title: string): Promise<Blob> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: fields.length > 4 ? "landscape" : "portrait", unit: "pt", format: "a4" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(title.slice(0, 90), 36, 40);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text(`${rows.length.toLocaleString()} rows · ${new Date().toLocaleString()}`, 36, 56);
  autoTable(doc, {
    startY: 68,
    head: [fields],
    body: rows.map((r) => fields.map((f) => cell(r[f]).slice(0, 300))),
    styles: { fontSize: 7.5, cellPadding: 3, overflow: "linebreak", textColor: 29 },
    headStyles: { fillColor: [29, 31, 34], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [246, 247, 248] },
    margin: { left: 36, right: 36 },
    didDrawPage: (d) => {
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(`Page ${d.pageNumber}`, doc.internal.pageSize.getWidth() - 70, doc.internal.pageSize.getHeight() - 18);
    },
  });
  return doc.output("blob");
}

export function fileBase(name: string): string {
  return (name || "export").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 60) || "export";
}

export async function buildFile(fmt: Format, rows: Row[], fields: string[], title: string): Promise<{ blob: Blob; filename: string }> {
  const base = fileBase(title);
  if (fmt === "csv") return { blob: new Blob([toCsv(rows, fields)], { type: "text/csv;charset=utf-8" }), filename: `${base}.csv` };
  if (fmt === "json") return { blob: new Blob([toJson(rows, fields)], { type: "application/json" }), filename: `${base}.json` };
  if (fmt === "xlsx") return { blob: await toXlsx(rows, fields), filename: `${base}.xlsx` };
  return { blob: await toPdf(rows, fields, title), filename: `${base}.pdf` };
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function selfCheck(): string {
  const rows = [{ Name: "Zoë, \"Z\"", City: "Köln", n: 3 }, { Name: "=HYPERLINK(1)", City: null, n: 4 }];
  const csv = toCsv(rows, ["Name", "City"]);
  if (!csv.startsWith("﻿Name,City")) throw new Error("csv header/BOM wrong");
  if (!csv.includes('"Zoë, ""Z"""')) throw new Error("csv quoting wrong");
  if (!csv.includes("'=HYPERLINK(1)")) throw new Error("formula injection not neutralised");
  const json = JSON.parse(toJson(rows, ["Name"]));
  if (Object.keys(json[0]).join() !== "Name") throw new Error("json field trim wrong");
  if (fileBase("Quotes to Scrape!") !== "quotes-to-scrape") throw new Error("filename wrong");
  return "exporters ok";
}
