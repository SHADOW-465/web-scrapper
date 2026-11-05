"use client";

import { Bot, Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { aiLeft, FREE_REQUESTS_PER_DAY, OPENROUTER_FREE_PER_DAY, readAiDay, type AiDay } from "@/lib/ai-usage";
import type { AiStatus } from "@/lib/client-api";

const k = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}K` : n.toLocaleString());

/** Today's usage, live (updates whenever any request reports AI use). */
export function useAiDay(): AiDay | null {
  const [day, setDay] = useState<AiDay | null>(null);
  useEffect(() => {
    setDay(readAiDay());
    const on = (e: Event) => setDay((e as CustomEvent<AiDay>).detail);
    window.addEventListener("ss-ai-usage", on);
    const t = window.setInterval(() => setDay(readAiDay()), 60_000); // a new day, or a limit running out
    return () => {
      window.removeEventListener("ss-ai-usage", on);
      window.clearInterval(t);
    };
  }, []);
  return day;
}

/** Share of today's free AI left (0-100), or null when unknown or AI is off. */
export function leftPercent(day: AiDay | null, ai: AiStatus | null): number | null {
  if (!day || !ai?.enabled || !ai.models?.length) return null;
  const l = aiLeft(day, ai.models.length);
  return Math.max(0, Math.min(100, 100 - (l.usedTokens / l.budgetTokens) * 100));
}

/** "AI left today": the Groq free tier, the OpenRouter backup, and a one-request test. */
export function AiUsage({ ai, aiError, testingAi, onTestAi }: { ai: AiStatus | null; aiError: string | null; testingAi: boolean; onTestAi: () => void }) {
  const day = useAiDay();
  if (aiError) return <p className="note err">AI status unknown: {aiError}</p>;
  if (!ai || !day) return <p className="note"><Loader2 size={14} className="spin" aria-hidden="true" />Checking AI…</p>;
  if (!ai.enabled) {
    return (
      <div className="usage">
        <p className="note"><Bot size={14} aria-hidden="true" /><span>AI is off on this server: neither <code>GROQ_API_KEY</code> nor <code>OPENROUTER_API_KEY</code> is set. Everything still works with the built-in rules, without AI.</span></p>
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
            <b>Groq</b>
            <span>{l.limited ? "daily limit reached" : `${Math.round(pct)}% left today`}</span>
          </div>
          <div className={`aimeter big${l.limited ? " err" : pct < 20 ? " warn" : ""}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Free Groq tokens left today">
            <i style={{ width: `${pct}%` }} />
          </div>
          <ul className="usage-lines">
            {l.limited
              ? <li>Groq frees it up in about {l.resetsInMin != null && l.resetsInMin >= 90 ? `${Math.round(l.resetsInMin / 60)} h` : `${l.resetsInMin ?? 60} min`}. Exports carry on without AI and finish the AI part afterwards.</li>
              : <li>About <b>{k(Math.max(0, l.budgetTokens - l.usedTokens))}</b> of {k(l.budgetTokens)} tokens left ({ai.models!.length} models × 200K a day)</li>}
            {l.requestsLeft != null && <li><b>{l.requestsLeft.toLocaleString()}</b> of {FREE_REQUESTS_PER_DAY.toLocaleString()} requests left today (reported by Groq)</li>}
            <li>{day.searches.toLocaleString()} AI web searches today</li>
          </ul>
        </section>
      )}
      {ai.openrouter?.models.length ? (
        <section>
          <div className="usage-head">
            <b>OpenRouter backup</b>
            <span>{orUsed.toLocaleString()} of {orLimit.toLocaleString()} free requests used</span>
          </div>
          <div className="aimeter big" aria-hidden="true"><i style={{ width: `${Math.max(0, 100 - (orUsed / orLimit) * 100)}%` }} /></div>
          <ul className="usage-lines"><li>Reads requests and names when Groq is used up. AI website search needs Groq (OpenRouter&rsquo;s search isn&rsquo;t free).</li></ul>
        </section>
      ) : null}
      <div className="usage-foot">
        <button type="button" className="btn btn-quiet btn-sm" onClick={onTestAi} disabled={testingAi}>
          {testingAi ? <Loader2 size={13} className="spin" aria-hidden="true" /> : null}Test AI
        </button>
        {ai.ok === true && <span className="note ok"><Check size={13} aria-hidden="true" />Answered in {((ai.ms ?? 0) / 1000).toFixed(1)} s</span>}
        {ai.ok === false && ai.message && <span className="note err">{ai.message}</span>}
      </div>
      <p className="usage-fine">{l?.fromGroq ? "Token figures as reported by Groq." : "Tokens are counted in this browser (other apps using the same key aren't seen); requests left come from Groq."}</p>
    </div>
  );
}
