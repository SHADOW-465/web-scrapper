"use client";

import { Bot } from "lucide-react";
import { useEffect, useState } from "react";
import { aiLeft, FREE_REQUESTS_PER_DAY, readAiDay, type AiDay } from "@/lib/ai-usage";

const k = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}K` : n.toLocaleString());

/** "AI left today": Groq free-tier usage for this day, always visible under the top bar. */
export default function AiUsageBar({ enabled, models }: { enabled: boolean | null; models?: string[] }) {
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
  if (enabled === null || !day) return null;
  if (!enabled) {
    return (
      <div className="aibar off" role="status">
        <Bot size={14} aria-hidden="true" />
        <span>AI is off on this server (<code>GROQ_API_KEY</code> not set). Everything still works with the built-in rules, without AI.</span>
      </div>
    );
  }
  const l = aiLeft(day, models?.length ?? 2);
  const leftPct = Math.max(0, Math.min(100, 100 - (l.usedTokens / l.budgetTokens) * 100));
  const tone = l.limited ? "err" : leftPct < 20 ? "warn" : "";
  return (
    <div className={`aibar ${tone}`} role="status" aria-label="AI usage today">
      <Bot size={14} aria-hidden="true" />
      <b>AI left today</b>
      <span className="aimeter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(leftPct)} aria-label="Free AI tokens left today">
        <i style={{ width: `${leftPct}%` }} />
      </span>
      {l.limited ? (
        <span>Daily limit reached{l.resetsInMin != null ? `; Groq frees it up in about ${l.resetsInMin >= 90 ? `${Math.round(l.resetsInMin / 60)} h` : `${l.resetsInMin} min`}` : ""}. Lookups carry on without AI.</span>
      ) : (
        <span>
          about <b>{k(Math.max(0, l.budgetTokens - l.usedTokens))}</b> of {k(l.budgetTokens)} tokens
          {l.requestsLeft != null ? <> · <b>{l.requestsLeft.toLocaleString()}</b> of {FREE_REQUESTS_PER_DAY.toLocaleString()} requests (Groq)</> : null}
          {day.searches ? <> · {day.searches} web searches</> : null}
        </span>
      )}
      <span className="aibar-note" title="Groq reports requests left; daily tokens are counted by this browser (other apps using the same key aren't seen) until Groq reports its own figure.">
        {l.fromGroq ? "tokens as reported by Groq" : "tokens counted in this browser"}
      </span>
    </div>
  );
}
