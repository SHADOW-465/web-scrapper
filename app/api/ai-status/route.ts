import { denied, hasAccess } from "@/lib/access";
import { AiQuotaError, aiEnabled, groqJson, latestLimits, models, takeUsage } from "@/lib/groq";
import { safeMessage } from "@/lib/redact";

export const runtime = "nodejs";
export const maxDuration = 30;

/** GET: is AI configured (no Groq request). Never returns the key. */
export async function GET(req: Request) {
  if (!hasAccess(req)) return denied();
  return Response.json({ enabled: aiEnabled(), models: models(), limits: latestLimits() }, { headers: { "cache-control": "no-store" } });
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
