/**
 * Today's Groq usage, for the "AI left today" bar. Browser only.
 *
 * Groq tells us requests left today (x-ratelimit-remaining-requests, per model) and, when a
 * daily limit is hit, the day's real token use ("Limit 200000, Used 199980"). Daily tokens are
 * otherwise not reported, so this browser also counts the tokens its own requests used.
 * Stored per UTC day in localStorage (numbers only, no content, no key).
 */
export const FREE_TOKENS_PER_DAY = 200_000;   // per model, Groq free tier (gpt-oss-20b and -120b)
export const FREE_REQUESTS_PER_DAY = 1_000;   // per model
export const OPENROUTER_FREE_PER_DAY = 50;    // free-model requests a day (1,000 once $10 of credits were ever bought)

export interface ModelLimits { remainingRequests?: number; limitRequests?: number; dayTokensUsed?: number; dayTokensLimit?: number; at: number }
export interface AiDay {
  day: string;
  tokens: number;
  requests: number;
  searches: number;
  models: string[];
  limits: Record<string, ModelLimits>;
  dayLimitUntil?: number;     // a daily 429 was seen: AI is unavailable until about then
  dayLimitMessage?: string;
  orModels?: string[];        // OpenRouter fallback, when configured
  orRequests?: number;        // OpenRouter requests made today from this browser
  orDaily?: { used?: number; limit?: number }; // OpenRouter's own count, when it reports one
}

const KEY = "ss-ai-usage";
const today = () => new Date().toISOString().slice(0, 10);
const empty = (): AiDay => ({ day: today(), tokens: 0, requests: 0, searches: 0, models: [], limits: {} });

export function readAiDay(): AiDay {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? "null") as AiDay | null;
    if (d && d.day === today()) return { ...empty(), ...d };
  } catch {
    /* storage blocked: start from zero */
  }
  return empty();
}

function write(d: AiDay) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* the bar still updates for this page */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("ss-ai-usage", { detail: d }));
}

/** Record an `ai` event from any route (counts, Groq's limit headers, a daily 429). */
export function noteAi(e: Record<string, unknown> | undefined | null) {
  if (!e || typeof window === "undefined") return;
  const d = readAiDay();
  d.tokens += Number(e.tokens) || 0;
  d.requests += Number(e.requests) || 0;
  d.searches += Number(e.searches) || 0;
  if (Array.isArray(e.models) && e.models.length) d.models = e.models.map(String);
  const or = e.openrouter as { models?: string[]; requests?: number; daily?: { used?: number; limit?: number } } | undefined;
  if (or) {
    if (Array.isArray(or.models)) d.orModels = or.models.map(String);
    d.orRequests = (d.orRequests ?? 0) + (Number(or.requests) || 0);
    if (or.daily && (or.daily.used != null || or.daily.limit != null)) d.orDaily = or.daily;
  }
  const limits = (e.limits ?? {}) as Record<string, ModelLimits>;
  for (const [m, l] of Object.entries(limits)) {
    if (!l || typeof l !== "object") continue;
    const merged: ModelLimits = { ...d.limits[m], ...l };
    // The model answered again without a daily figure: its old "used up" figure no longer holds.
    if (l.dayTokensUsed == null && l.remainingRequests != null) {
      delete merged.dayTokensUsed;
      delete merged.dayTokensLimit;
    }
    d.limits[m] = merged;
  }
  if (Object.values(limits).some((l) => l && l.dayTokensUsed == null && l.remainingRequests != null) && !(e.quotaScope === "day" || (e.quota as { scope?: string } | null)?.scope === "day")) {
    d.dayLimitUntil = undefined; // AI answered again
    d.dayLimitMessage = undefined;
  }
  const q = (e.quota ?? null) as { scope?: string; resetInSeconds?: number; message?: string } | null;
  const scope = (e.quotaScope as string | undefined) ?? q?.scope;
  const message = (e.quotaMessage as string | undefined) ?? q?.message;
  if (scope === "day" && message) {
    d.dayLimitUntil = Date.now() + (Number(q?.resetInSeconds) || 3600) * 1000;
    d.dayLimitMessage = message;
  }
  write(d);
}

export interface AiLeft {
  usedTokens: number;          // best estimate of tokens used today
  budgetTokens: number;        // free daily tokens across the configured models
  requestsLeft: number | null; // from Groq (first model), when known
  requestsAt: number | null;
  limited: boolean;            // a daily limit is in force
  resetsInMin: number | null;
  fromGroq: boolean;           // usedTokens comes from Groq's own figure
}

export function aiLeft(d: AiDay, modelCount = 2): AiLeft {
  const models = Math.max(1, d.models.length || modelCount);
  const budget = FREE_TOKENS_PER_DAY * models;
  const reported = Object.values(d.limits).reduce((sum, l) => sum + (l.dayTokensUsed ?? 0), 0);
  const first = d.models[0] ? d.limits[d.models[0]] : Object.values(d.limits)[0];
  const limited = !!d.dayLimitUntil && d.dayLimitUntil > Date.now();
  return {
    usedTokens: limited ? budget : Math.max(d.tokens, reported),
    budgetTokens: budget,
    requestsLeft: first?.remainingRequests ?? null,
    requestsAt: first?.at ?? null,
    limited,
    resetsInMin: limited ? Math.ceil((d.dayLimitUntil! - Date.now()) / 60_000) : null,
    fromGroq: reported > d.tokens,
  };
}

/** How many AI web searches today's remaining free tokens allow (about 5,000 tokens each, keeping a reserve). */
export function affordableSearches(d: AiDay, modelCount = 2): number {
  const l = aiLeft(d, modelCount);
  if (l.limited) return 0;
  return Math.max(0, Math.floor((l.budgetTokens - l.usedTokens - 60_000) / 5_000));
}

export function selfCheck(): string {
  const d: AiDay = { day: today(), tokens: 50_000, requests: 20, searches: 3, models: ["a", "b"], limits: { a: { remainingRequests: 980, at: 1 } } };
  const l = aiLeft(d);
  if (l.budgetTokens !== 400_000 || l.usedTokens !== 50_000 || l.requestsLeft !== 980) throw new Error("ai-usage: basic");
  if (affordableSearches(d) !== 58) throw new Error(`ai-usage: searches ${affordableSearches(d)}`);
  const hit = aiLeft({ ...d, limits: { a: { dayTokensUsed: 199_980, at: 1 } } });
  if (hit.usedTokens !== 199_980 || !hit.fromGroq) throw new Error("ai-usage: groq's own figure wins");
  const lim = aiLeft({ ...d, dayLimitUntil: Date.now() + 30 * 60_000 });
  if (!lim.limited || lim.usedTokens !== lim.budgetTokens) throw new Error("ai-usage: limited");
  return "ai-usage ok (4 checks)";
}
