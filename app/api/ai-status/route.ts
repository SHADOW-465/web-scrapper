import { denied, hasAccess } from "@/lib/access";
import { AiQuotaError, aiEnabled, groqJson, latestLimits, models, openrouterModels, searchEnabled, takeUsage } from "@/lib/groq";
import { safeMessage } from "@/lib/redact";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * OpenRouter's own count of today's free-model requests (GET /api/v1/key: usage info only,
 * no AI request is made and nothing is spent). Shape read defensively.
 */
async function openrouterDaily(): Promise<{ used?: number; limit?: number } | undefined> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return undefined;
  try {
    const base = (process.env.NODE_ENV !== "production" && !process.env.VERCEL && process.env.OPENROUTER_BASE_URL) || "https://openrouter.ai/api/v1";
    const res = await fetch(`${base}/key`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return undefined;
    const data = ((await res.json()) as { data?: Record<string, unknown> }).data ?? {};
    const f = data.free_model_daily_requests as Record<string, unknown> | number | undefined;
    const pick = (o: Record<string, unknown>, ...k: string[]) => k.map((x) => o[x]).find((v) => typeof v === "number") as number | undefined;
    if (f && typeof f === "object") return { used: pick(f, "used", "count", "usage", "requests"), limit: pick(f, "limit", "max", "ceiling") };
    if (typeof f === "number") return { used: f };
    return undefined;
  } catch {
    return undefined;
  }
}

/** GET: which AI is configured (no AI request is made). Never returns a key. */
export async function GET(req: Request) {
  if (!hasAccess(req)) return denied();
  return Response.json({
    enabled: aiEnabled(), search: searchEnabled(), models: models(), limits: latestLimits(),
    openrouter: openrouterModels().length ? { models: openrouterModels(), daily: await openrouterDaily() } : undefined,
  }, { headers: { "cache-control": "no-store" } });
}

/** POST: one tiny Groq request to prove the key and model work, and read the current free-tier limits. */
export async function POST(req: Request) {
  if (!hasAccess(req)) return denied();
  if (!aiEnabled()) return Response.json({ enabled: false, ok: false, message: "AI is off: GROQ_API_KEY is not set on the server." });
  const started = Date.now();
  try {
    const out = await groqJson<{ ok?: unknown }>("ping-" + Math.floor(Date.now() / 60_000), "Reply with JSON only.", 'Return {"ok":true}', { maxTokens: 300 });
    return Response.json({
      enabled: true, ok: out?.ok === true, ms: Date.now() - started, models: models(),
      limits: latestLimits(), usage: takeUsage(),
      message: out?.ok === true ? "Groq answered." : "Groq answered, but not with the expected JSON.",
    }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({
      enabled: true, ok: false, ms: Date.now() - started, models: models(), limits: latestLimits(),
      quota: e instanceof AiQuotaError ? { scope: e.scope, resetInSeconds: e.resetInSeconds } : undefined,
      message: safeMessage(e),
    }, { headers: { "cache-control": "no-store" } });
  }
}
