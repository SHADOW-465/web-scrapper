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

export function Failed({ message, onRetry, onBack }: { message: string; onRetry: () => void; onBack: () => void }) {
  return (
    <div className="blank">
      <article className="page-paper">
        <div className="errbox" role="alert">
          <b>That page couldn&rsquo;t be read.</b>
          {message}
        </div>
        <p style={{ marginTop: 16 }}>
          Some sites block automated browsers or need you to sign in first. If you can see the page in your own browser, try again, or use <b>Signed-in page</b> with your cookie.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" onClick={onRetry}>Try again</button>
          <button className="btn btn-quiet" onClick={onBack}>Start over</button>
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
