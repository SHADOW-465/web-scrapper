"use client";

import { Check, KeyRound, Loader2 } from "lucide-react";
import { useState } from "react";

const EXAMPLES = [
  { url: "https://quotes.toscrape.com/scroll", title: "Quotes, endless scroll", note: "practice site" },
  { url: "https://books.toscrape.com/", title: "A book catalogue", note: "50 pages" },
  { url: "https://news.ycombinator.com/", title: "Hacker News", note: "front page" },
  { url: "https://en.wikipedia.org/wiki/List_of_largest_companies_by_revenue", title: "A Wikipedia table", note: "companies by revenue" },
];

export function Welcome({ onTry }: { onTry: (url: string) => void }) {
  return (
    <div className="blank">
      <article className="page-paper">
        <h1>
          Paste a link. <span className="hl">Mark what you want.</span> Take all of it.
        </h1>
        <p>Scrape Studio opens the page the way you see it, finds the lists on it, and highlights them. You decide which pieces become columns.</p>
        <ol className="steps">
          <li><span><b>Paste any page</b> with a list on it: a directory, a catalogue, search results, a table.</span></li>
          <li><span><b>Click what you want.</b> Each thing you click gets its own <span className="hl" style={{ ["--hl" as string]: "#ff6fae" }}>ink</span> and becomes a column. Click it again to take it off.</span></li>
          <li><span><b>Take every page,</b> not just the first. When the site loads its own data, we read all of it; otherwise we turn the pages for you.</span></li>
        </ol>
        <p className="tryline">Try one</p>
        <div className="examples">
          {EXAMPLES.map((e) => (
            <button key={e.url} className="example" onClick={() => onTry(e.url)}>
              <b>{e.title}</b>
              <span>{e.note}</span>
            </button>
          ))}
        </div>
        <div className="fineprint">
          Pages behind a sign-in work too: use <b>Signed-in page</b> next to the address and paste your browser&rsquo;s cookie for that site. It&rsquo;s used for that one scan, never saved, never shown again. Check a site&rsquo;s terms before taking large amounts of its data.
        </div>
      </article>
    </div>
  );
}

const STEPS = ["Starting a browser", "Opening the page", "Waiting for the content to appear", "Reading what the page shows", "Matching it to the site's own data"];

export function Printing({ host, status }: { host: string; status: string[] }) {
  const current = status[status.length - 1];
  const idx = Math.max(0, STEPS.indexOf(current));
  return (
    <div className="blank" aria-live="polite">
      <article className="page-paper printing">
        <h2>Reading <span className="num" style={{ fontWeight: 500 }}>{host}</span></h2>
        <ol>
          {STEPS.map((s, i) => (
            <li key={s} className={i < idx ? "done" : i === idx ? "now" : ""}>
              {i < idx ? <Check size={16} aria-hidden="true" /> : i === idx ? <Loader2 size={16} className="spin" style={{ animation: "spin .9s linear infinite" }} aria-hidden="true" /> : <span style={{ width: 16 }} />}
              <span>{s}</span>
            </li>
          ))}
        </ol>
        <div className="skeleton" aria-hidden="true">
          <i style={{ width: "92%" }} /><i style={{ width: "78%" }} /><i style={{ width: "85%" }} /><i style={{ width: "60%" }} />
        </div>
      </article>
    </div>
  );
}

export function Failed({
  message,
  initialUrl,
  onRetry,
  onBack,
  onScanUrl,
}: {
  message: string;
  initialUrl?: string;
  onRetry: () => void;
  onBack: () => void;
  onScanUrl?: (url: string) => void;
}) {
  const isBuchmesse = initialUrl?.includes("buchmesse.de");
  const suggestedApi = isBuchmesse
    ? "https://event.buchmesse.de/api/v1/search/exhibitors"
    : initialUrl?.includes("/api/")
    ? initialUrl
    : "";
  const [customUrl, setCustomUrl] = useState(suggestedApi || initialUrl || "");

  const isServerlessTimeout =
    message.includes("500") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("memory") ||
    message.includes("browser");

  return (
    <div className="blank">
      <article className="page-paper">
        <div className="errbox" role="alert">
          <b style={{ display: "block", marginBottom: 4 }}>That page couldn&rsquo;t be read.</b>
          <span>{message}</span>
        </div>

        {isServerlessTimeout && (
          <div
            style={{
              marginTop: 14,
              padding: "12px 14px",
              background: "var(--paper-subtle, #f8fafc)",
              border: "1px solid var(--border, #e2e8f0)",
              borderRadius: 6,
              fontSize: 13,
            }}
          >
            <p style={{ margin: "0 0 6px 0", fontWeight: 600, color: "var(--fg, #1e293b)" }}>
              Why did this happen?
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, color: "var(--muted, #475569)", lineHeight: 1.5 }}>
              <li>
                <strong>Vercel Timeout (10s):</strong> Heavy SPA sites take 15–20s for headless Chrome to render, exceeding serverless limits.
              </li>
              <li>
                <strong>Fast-Path Direct API:</strong> You can scrape directories directly using their JSON catalog endpoint with zero browser overhead.
              </li>
              <li>
                <strong>Local Port Conflict:</strong> If running locally, another app may be occupying port 3000 (try <code>http://localhost:3001</code>).
              </li>
            </ul>
          </div>
        )}

        {onScanUrl && (
          <div style={{ marginTop: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--fg, #334155)", marginBottom: 6 }}>
              Bypass browser with direct catalog API endpoint:
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                className="input"
                style={{ flex: 1, padding: "7px 10px", fontSize: 13 }}
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="https://event.buchmesse.de/api/v1/search/exhibitors"
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (customUrl.trim()) onScanUrl(customUrl.trim());
                }}
              >
                Scan Direct API
              </button>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <button className="btn btn-primary" onClick={onRetry}>
            Try again
          </button>
          <button className="btn btn-quiet" onClick={onBack}>
            Start over
          </button>
        </div>
      </article>
    </div>
  );
}

export function Locked({ onUnlock }: { onUnlock: (pw: string) => Promise<boolean> }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="blank">
      <article className="page-paper lock">
        <h1 style={{ fontSize: 26 }}>This studio is private.</h1>
        <p>Enter the access password to start scanning pages.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErr("");
            const ok = await onUnlock(pw);
            setBusy(false);
            if (!ok) setErr("That password isn't right.");
          }}
        >
          <label className="field" style={{ height: 40 }}>
            <KeyRound size={16} aria-hidden="true" />
            <span className="visually-hidden">Access password</span>
            <input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
          </label>
          <button className="btn btn-primary" disabled={!pw || busy}>{busy ? <Loader2 size={16} className="spin" /> : null}Unlock</button>
        </form>
        {err && <p className="note err" role="alert" style={{ marginTop: 10 }}>{err}</p>}
      </article>
    </div>
  );
}
