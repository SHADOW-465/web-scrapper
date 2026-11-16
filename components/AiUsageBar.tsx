"use client";

import { useEffect, useState } from "react";
import { aiLeft, readAiDay, type AiDay } from "@/lib/ai-usage";
import type { AiStatus } from "@/lib/client-api";

/** Today's counters, live (updates whenever a lookup reports use). */
export function useAiDay(): AiDay | null {
  const [day, setDay] = useState<AiDay | null>(null);
  useEffect(() => {
    setDay(readAiDay());
    const on = (e: Event) => setDay((e as CustomEvent<AiDay>).detail);
    window.addEventListener("ss-ai-usage", on);
    const t = window.setInterval(() => setDay(readAiDay()), 60_000);
    return () => {
      window.removeEventListener("ss-ai-usage", on);
      window.clearInterval(t);
    };
  }, []);
  return day;
}

/** Share left today (0-100), or null when unknown or off. */
export function leftPercent(day: AiDay | null, ai: AiStatus | null): number | null {
  if (!day || !ai?.enabled || !ai.models?.length) return null;
  const l = aiLeft(day, ai.models.length);
  return Math.max(0, Math.min(100, 100 - (l.usedTokens / l.budgetTokens) * 100));
}
