"use client";

import { Bot, Check, Loader2 } from "lucide-react";
import { aiLeft, FREE_REQUESTS_PER_DAY, OPENROUTER_FREE_PER_DAY } from "@/lib/ai-usage";
import type { AiStatus } from "@/lib/client-api";
import { useAiDay } from "../AiUsageBar";

const k = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}K` : n.toLocaleString());

/** Diagnostics for a developer (`?debug=1` or a non-production build). Not shown to the client. */
export function AiUsage({ ai, aiError, testingAi, onTestAi }: { ai: AiStatus | null; aiError: string | null; testingAi: boolean; onTestAi: () => void }) {
  const day = useAiDay();
  if (aiError) return <p className="note err">Status unknown: {aiError}</p>;
  if (!ai || !day) return <p className="note"><Loader2 size={14} className="spin" aria-hidden="true" />Checking…</p>;
  if (!ai.enabled) {
    return (
      <div className="usage">
        <p className="note"><Bot size={14} aria-hidden="true" /><span>Off on this server: neither key is set. Lists still load from the site&rsquo;s own data.</span></p>
      </div>
    );
  }
  const hasGroq = !!ai.models?.length;
  const l = hasGroq ? aiLeft(day, ai.models!.length) : null;
  const pct = l ? Math.max(0, Math.min(100, 100 - (l.usedTokens / l.budgetTokens) * 100)) : null;
  const orUsed = Math.max(day.orDaily?.used ?? 0, day.orRequests ?? 0);
  const orLimit = day.orDaily?.limit ?? OPENROUTER_FREE_PER_DAY;
  return (
    <div className="usage">
      {l && pct != null && (
        <section>
          <div className="usage-head">
            <b>Primary</b>
            <span>{l.limited ? "paused for today" : `${Math.round(pct)}% left today`}</span>
          </div>
          <div className={`aimeter big${l.limited ? " err" : pct < 20 ? " warn" : ""}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Share left today">
            <i style={{ width: `${pct}%` }} />
          </div>
          <ul className="usage-lines">
            {l.limited
              ? <li>Paused for about {l.resetsInMin != null && l.resetsInMin >= 90 ? `${Math.round(l.resetsInMin / 60)} h` : `${l.resetsInMin ?? 60} min`}. Exports keep going and fill the rest in afterwards.</li>
              : <li>About <b>{k(Math.max(0, l.budgetTokens - l.usedTokens))}</b> of {k(l.budgetTokens)} left ({ai.models!.length} models)</li>}
            {l.requestsLeft != null && <li><b>{l.requestsLeft.toLocaleString()}</b> of {FREE_REQUESTS_PER_DAY.toLocaleString()} calls left today</li>}
            <li>{day.searches.toLocaleString()} website searches today</li>
          </ul>
        </section>
      )}
      {ai.openrouter?.models.length ? (
        <section>
          <div className="usage-head">
            <b>Backup</b>
            <span>{orUsed.toLocaleString()} of {orLimit.toLocaleString()} free calls used</span>
          </div>
          <div className="aimeter big" aria-hidden="true"><i style={{ width: `${Math.max(0, 100 - (orUsed / orLimit) * 100)}%` }} /></div>
          <ul className="usage-lines"><li>Reads names when the primary is busy. Website search stays on the primary.</li></ul>
        </section>
      ) : null}
      <div className="usage-foot">
        <button type="button" className="btn btn-quiet btn-sm" onClick={onTestAi} disabled={testingAi}>
          {testingAi ? <Loader2 size={13} className="spin" aria-hidden="true" /> : null}Test
        </button>
        {ai.ok === true && <span className="note ok"><Check size={13} aria-hidden="true" />Answered in {((ai.ms ?? 0) / 1000).toFixed(1)} s</span>}
        {ai.ok === false && ai.message && <span className="note err">{ai.message}</span>}
      </div>
    </div>
  );
}
