"use client";

import { AlertTriangle, Bot, Check, ChevronRight, Loader2, Sparkles, UserSearch } from "lucide-react";
import type { AiStatus } from "@/lib/client-api";
import { estimateSeconds, type LeadsConfig, type LeadsState } from "@/lib/leads";

export interface TrySummary { looked: number; website: number; person: number; email: number; linkedin: number; notes: string[]; quota?: string }

const duration = (secs: number) => {
  if (secs < 90) return "about a minute";
  const mins = Math.round(secs / 60);
  return mins < 90 ? `about ${mins} minutes` : `about ${Math.round(mins / 6) / 10} hours`;
};

/** "Find decision-makers": settings, an AI check, and a small trial run before the full export. */
export function LeadsPanel(props: {
  config: LeadsConfig | null;
  setConfig: (c: LeadsConfig) => void;
  columns: string[];
  companies: number | null;
  findingPages: boolean;
  hasPages: boolean;
  gated: boolean;
  ai: AiStatus | null;
  aiError: string | null;
  testingAi: boolean;
  onTestAi: () => void;
  trying: string | null;
  tried: TrySummary | null;
  tryError: string | null;
  onTry: () => void | Promise<unknown>;
  run: LeadsState | null;
  busy: boolean;
}) {
  const { config: cfg, setConfig, columns, companies, ai } = props;
  if (!cfg) return null;
  const set = (patch: Partial<LeadsConfig>) => setConfig({ ...cfg, ...patch });
  const count = companies == null ? null : cfg.limit ? Math.min(cfg.limit, companies) : companies;
  const limits = ai?.limits ? Object.entries(ai.limits)[0] : undefined;

  return (
    <section className="section leads" aria-labelledby="leads-h">
      <div className="section-head">
        <h2 id="leads-h">Decision-makers</h2>
        <span className="aside">{cfg.on ? "on" : "off"}</span>
      </div>

      <label className="switchrow">
        <input type="checkbox" checked={cfg.on} onChange={(e) => set({ on: e.target.checked })} disabled={!columns.length} />
        <span>
          <b>Look up each company&rsquo;s decision-makers</b>
          <small>Owner, CEO, managing director or head of purchasing, with email, phone and LinkedIn where published. Reads the company&rsquo;s page on this site and its own website (imprint, team, contact). Nothing is guessed: an empty cell means it isn&rsquo;t published.</small>
        </span>
      </label>

      {cfg.on && (
        <>
          <div className="leadgrid">
            <label htmlFor="lead-name">Company name</label>
            <select id="lead-name" value={cfg.nameCol} onChange={(e) => set({ nameCol: e.target.value })}>
              {columns.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <label htmlFor="lead-country">Country</label>
            <select id="lead-country" value={cfg.countryCol ?? ""} onChange={(e) => set({ countryCol: e.target.value || undefined })}>
              <option value="">(none)</option>
              {columns.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <label htmlFor="lead-limit">Companies</label>
            <div className="limitrow">
              <select id="lead-limit" value={cfg.limit ? "some" : "all"} onChange={(e) => set({ limit: e.target.value === "all" ? null : cfg.limit || 25 })}>
                <option value="all">All{companies ? ` (${companies.toLocaleString()})` : ""}</option>
                <option value="some">Only the first…</option>
              </select>
              {cfg.limit ? (
                <input type="number" min={1} max={100000} value={cfg.limit} aria-label="How many companies"
                  onChange={(e) => set({ limit: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
              ) : null}
            </div>
          </div>

          {!props.hasPages && !props.findingPages && (
            <p className="note warn"><AlertTriangle size={14} aria-hidden="true" /><span>These rows don&rsquo;t link to a page of their own on this site, so each company&rsquo;s website has to be found by its name. Expect fewer results.</span></p>
          )}
          {props.findingPages && <p className="note"><Loader2 size={14} className="spin" aria-hidden="true" />Finding each company&rsquo;s page on this site…</p>}

          <div className="aibox" aria-live="polite">
            <div className="aihead">
              <Bot size={15} aria-hidden="true" />
              {props.aiError ? <span>AI status unknown: {props.aiError}</span> : !ai ? <span>Checking AI…</span> : ai.enabled ? (
                <span>AI on: Groq <code>{ai.models?.[0]}</code>{ai.models?.[1] ? <> (falls back to <code>{ai.models[1]}</code>)</> : null}</span>
              ) : (
                <span>AI off: <code>GROQ_API_KEY</code> isn&rsquo;t set on the server. Lookups still run, without AI.</span>
              )}
              {ai?.enabled && (
                <button type="button" className="btn btn-quiet btn-sm" onClick={props.onTestAi} disabled={props.testingAi}>
                  {props.testingAi ? <Loader2 size={13} className="spin" aria-hidden="true" /> : null}Test AI
                </button>
              )}
            </div>
            {ai?.ok === true && (
              <p className="note ok"><Check size={14} aria-hidden="true" /><span>Groq answered in {((ai.ms ?? 0) / 1000).toFixed(1)} s.{limits?.[1].remainingTokens != null ? ` Left right now on ${limits[0]}: ${limits[1].remainingRequests ?? "?"} requests today, ${limits[1].remainingTokens.toLocaleString()} tokens this minute.` : ""}</span></p>
            )}
            {ai?.ok === false && ai.enabled && (
              <p className="note err" role="alert"><AlertTriangle size={14} aria-hidden="true" /><span>{ai.message}</span></p>
            )}
            {ai?.enabled && (
              <div className="leadgrid">
                <label htmlFor="lead-ai-auto">AI web searches</label>
                <div className="limitrow">
                  <label className="limitrow" style={{ gap: 6 }}>
                    <input id="lead-ai-auto" type="checkbox" checked={cfg.aiSearch < 0} onChange={(e) => set({ aiSearch: e.target.checked ? -1 : 10 })} />
                    <small>Automatic: as many as today&rsquo;s free limit allows</small>
                  </label>
                  {cfg.aiSearch >= 0 && (
                    <input id="lead-ai" type="number" min={0} max={500} value={cfg.aiSearch} aria-label="AI web searches per run"
                      onChange={(e) => set({ aiSearch: Math.max(0, Math.min(500, Math.floor(Number(e.target.value) || 0))) })} />
                  )}
                </div>
              </div>
            )}
            <details className="extra">
              <summary><ChevronRight size={14} aria-hidden="true" />How AI is used (Groq free tier)</summary>
              <p>Names, emails and LinkedIn links are read by code from the pages, not by AI. AI is used for two small jobs: (1) reading a name where a page mentions a role but code couldn&rsquo;t isolate the name (about 1 request per 10 companies), and (2) web searches for missing websites (each uses about 3,000–6,000 of the 200,000 free tokens per day). Everything AI suggests is checked against the page text and dropped if it isn&rsquo;t written there. If Groq&rsquo;s limit is reached, you&rsquo;ll see the message here and the lookup carries on without AI.</p>
            </details>
          </div>

          <div className="tryrow">
            <button type="button" className="btn btn-quiet btn-sm" onClick={props.onTry} disabled={!!props.trying || props.busy || props.findingPages}>
              {props.trying ? <Loader2 size={13} className="spin" aria-hidden="true" /> : <UserSearch size={13} aria-hidden="true" />}
              Try on the first 5 companies
            </button>
            {props.trying && <span className="hint-line" style={{ margin: 0 }}>{props.trying}</span>}
          </div>
          {props.tryError && <p className="note err" role="alert"><AlertTriangle size={14} aria-hidden="true" /><span>{props.tryError}</span></p>}
          {props.tried && (
            <p className="note ok"><Sparkles size={14} aria-hidden="true" />
              <span>{props.tried.looked} looked up: {props.tried.website} with a website, {props.tried.person} with a named decision-maker, {props.tried.email} with a personal email, {props.tried.linkedin} with LinkedIn. See the table.{props.tried.notes.length ? ` ${props.tried.notes.join(" ")}` : ""}</span>
            </p>
          )}

          {props.run?.quotaMessage && (
            <p className="note err" role="alert"><AlertTriangle size={14} aria-hidden="true" /><span>{props.run.quotaMessage}</span></p>
          )}
          {props.run?.notices.map((n) => <p key={n} className="note warn"><AlertTriangle size={14} aria-hidden="true" /><span>{n}</span></p>)}
          {props.run && (props.run.aiRequests > 0 || props.run.aiSearchesUsed > 0) && (
            <p className="hint-line">AI this run: {props.run.aiRequests} Groq requests, {props.run.aiTokens.toLocaleString()} tokens, {props.run.aiSearchesUsed} web searches.</p>
          )}

          {count ? (
            <p className="note warn" style={{ marginTop: 10 }}>
              Looks up {count.toLocaleString()} {count === 1 ? "company" : "companies"}, {duration(estimateSeconds(count))}.{" "}
              {props.gated ? "Signed-in exports are kept in memory only: keep this tab open." : "You can leave it running; progress is saved and resumes if the tab closes."}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
