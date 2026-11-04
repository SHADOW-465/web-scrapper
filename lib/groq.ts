/**
 * Groq client for every AI call. Free-tier models only.
 *
 *   GROQ_API_KEY         required for any AI (read from the environment only, never logged)
 *   GROQ_MODEL           primary   (default openai/gpt-oss-20b)
 *   GROQ_FALLBACK_MODEL  fallback  (default openai/gpt-oss-120b)
 *
 * Rate limits are never hidden: a 429 that cannot be waited out is thrown as
 * AiQuotaError and shown to the user, with the time until the limit resets.
 */
import { scrub } from "./redact";

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const MAX_WAIT_S = 20; // wait this long for a per-minute limit; anything longer is a different model's turn

export const aiEnabled = () => !!process.env.GROQ_API_KEY;
export const models = () => [
  process.env.GROQ_MODEL || "openai/gpt-oss-20b",
  process.env.GROQ_FALLBACK_MODEL || "openai/gpt-oss-120b",
].filter((m, i, a) => a.indexOf(m) === i);

export class AiQuotaError extends Error {
  constructor(public scope: "day" | "minute", public resetInSeconds: number) {
    const when = resetInSeconds >= 3600 ? `about ${Math.ceil(resetInSeconds / 3600)} h` : resetInSeconds >= 90 ? `about ${Math.ceil(resetInSeconds / 60)} min` : `${Math.max(1, Math.ceil(resetInSeconds))} s`;
    super(`Groq's free limit is used up (${scope === "day" ? "daily" : "per-minute"} limit, HTTP 429). It resets in ${when}. Results below were found without AI.`);
    this.name = "AiQuotaError";
  }
}
export class AiError extends Error {
  constructor(message: string) {
    super(scrub(message, [process.env.GROQ_API_KEY]));
    this.name = "AiError";
  }
}

/* ------------------------------------------------------------ state (per server instance) */

const blockedUntil = new Map<string, { until: number; scope: "day" | "minute" }>();
const cache = new Map<string, { at: number; value: unknown }>();
const usage = { requests: 0, tokens: 0, cached: 0 };
let notice: AiQuotaError | null = null;

/** Counters since the last call; routes emit them as an `ai` event. */
export function takeUsage() {
  const out = { ...usage, quota: notice ? { scope: notice.scope, resetInSeconds: notice.resetInSeconds, message: notice.message } : undefined };
  usage.requests = usage.tokens = usage.cached = 0;
  return out;
}
export const quotaNotice = () => notice;

type FetchFn = typeof fetch;
let doFetch: FetchFn = (...a) => fetch(...a);
let sleepFn = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Test hook. */
export function __setTransport(f?: FetchFn, s?: (ms: number) => Promise<void>) {
  doFetch = f ?? ((...a) => fetch(...a));
  sleepFn = s ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  blockedUntil.clear();
  cache.clear();
  notice = null;
  usage.requests = usage.tokens = usage.cached = 0;
}

async function sha(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** "2m59.56s", "1h2m", "7.66s" -> seconds. */
export function parseDuration(text: string | null | undefined): number | null {
  if (!text) return null;
  let total = 0;
  let any = false;
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(ms|h|m|s)/g)) {
    any = true;
    const n = parseFloat(m[1]);
    total += m[2] === "h" ? n * 3600 : m[2] === "m" ? n * 60 : m[2] === "ms" ? n / 1000 : n;
  }
  if (!any && /^\d+(\.\d+)?$/.test(text.trim())) return parseFloat(text);
  return any ? total : null;
}

export interface GroqOptions<T> {
  maxTokens?: number;
  validate?: (value: unknown) => value is T;
}

interface Attempt { ok: true; text: string; tokens: number }
type Failure = { ok: false; kind: "quota"; scope: "day" | "minute"; wait: number } | { ok: false; kind: "bad" | "error"; message: string };

async function call(model: string, system: string, user: string, maxTokens: number, withReasoning: boolean): Promise<Attempt | Failure> {
  const key = process.env.GROQ_API_KEY!;
  const body: Record<string, unknown> = {
    model,
    temperature: 0,
    max_completion_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
  };
  if (withReasoning) {
    body.reasoning_effort = "low"; // reasoning tokens count against the free limits
    body.include_reasoning = false;
  }
  let res: Response;
  try {
    res = await doFetch(ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(40_000),
    });
  } catch (e) {
    return { ok: false, kind: "error", message: `Could not reach Groq: ${scrub(e instanceof Error ? e.message : e, [key])}` };
  }
  usage.requests++;
  if (res.status === 429) {
    const text = await res.text().catch(() => "");
    const retry = parseDuration(res.headers.get("retry-after")) ?? parseDuration(res.headers.get("x-ratelimit-reset-requests")) ?? parseDuration(res.headers.get("x-ratelimit-reset-tokens")) ?? 30;
    const daily = /per day|\bTPD\b|\bRPD\b/i.test(text) || retry > 3600;
    return { ok: false, kind: "quota", scope: daily ? "day" : "minute", wait: retry };
  }
  if (res.status === 400 && withReasoning) {
    const text = await res.text().catch(() => "");
    if (/reasoning|include_reasoning/i.test(text)) return call(model, system, user, maxTokens, false);
    return { ok: false, kind: "error", message: `Groq rejected the request (400): ${scrub(text.slice(0, 200), [key])}` };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, kind: "error", message: `Groq answered HTTP ${res.status}${res.status === 401 ? " (check GROQ_API_KEY)" : ""}: ${scrub(text.slice(0, 200), [key])}` };
  }
  const data = (await res.json().catch(() => ({}))) as { choices?: Array<{ message?: { content?: string } }>; usage?: { total_tokens?: number } };
  const tokens = data.usage?.total_tokens ?? Math.ceil((system.length + user.length) / 3.5) + maxTokens;
  usage.tokens += tokens;
  return { ok: true, text: data.choices?.[0]?.message?.content ?? "", tokens };
}

function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error("not json");
  }
}

/**
 * Ask for a JSON object. Tries the primary model, then the fallback.
 * Throws AiQuotaError when every model is rate-limited, AiError for other failures.
 */
export async function groqJson<T = unknown>(kind: string, system: string, user: string, opts: GroqOptions<T> = {}): Promise<T> {
  if (!aiEnabled()) throw new AiError("AI is off: GROQ_API_KEY is not set.");
  const maxTokens = opts.maxTokens ?? 2500;
  const ck = await sha(`${kind}\n${system}\n${user}`);
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < 6 * 3600_000) {
    usage.cached++;
    return hit.value as T;
  }

  let quota: AiQuotaError | null = null;
  let lastError = "";
  for (const model of models()) {
    const blocked = blockedUntil.get(model);
    if (blocked && blocked.until > Date.now()) {
      quota = new AiQuotaError(blocked.scope, (blocked.until - Date.now()) / 1000);
      continue;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await call(model, system, user, maxTokens, true);
      if (r.ok) {
        try {
          const value = parseJson(r.text);
          if (opts.validate && !opts.validate(value)) throw new Error("invalid shape");
          cache.set(ck, { at: Date.now(), value });
          if (cache.size > 200) cache.delete(cache.keys().next().value as string);
          notice = null;
          return value as T;
        } catch {
          lastError = `${model} returned output that was not usable`;
          break; // next model
        }
      }
      if (r.kind === "quota") {
        if (r.scope === "minute" && r.wait <= MAX_WAIT_S && attempt === 0) {
          await sleepFn(Math.ceil(r.wait * 1000) + 250);
          continue; // same model, once
        }
        blockedUntil.set(model, { until: Date.now() + r.wait * 1000, scope: r.scope });
        quota = new AiQuotaError(r.scope, r.wait);
        break; // next model
      }
      lastError = r.message;
      break;
    }
  }
  if (quota) {
    notice = quota;
    throw quota;
  }
  throw new AiError(lastError || "Groq did not return a usable answer.");
}

export async function selfCheckAsync(): Promise<string> {
  const eq = (a: unknown, b: unknown, m: string) => {
    if (a !== b) throw new Error(`groq: ${m}: ${String(a)} != ${String(b)}`);
  };
  process.env.GROQ_API_KEY = "gsk_testtesttesttest1234";
  const ok = (content: unknown, tokens = 50) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { total_tokens: tokens } }), { status: 200 });
  const limited = (msg: string, retry: string) => new Response(JSON.stringify({ error: { message: msg } }), { status: 429, headers: { "retry-after": retry } });
  const seen: string[] = [];
  let queue: Array<() => Response> = [];
  const fake: FetchFn = async (_u, init) => {
    seen.push(JSON.parse(String(init?.body)).model);
    return queue.shift()!();
  };
  const noSleep = async () => {};

  // daily limit on primary -> fallback answers
  __setTransport(fake, noSleep);
  queue = [() => limited("Rate limit reached ... tokens per day (TPD)", "5000"), () => ok({ a: 1 })];
  eq(JSON.stringify(await groqJson("t", "s", "u1")), '{"a":1}', "fallback result");
  eq(seen.join(","), "openai/gpt-oss-20b,openai/gpt-oss-120b", "fallback order");

  // per-minute limit: waits and retries the same model once
  __setTransport(fake, noSleep);
  seen.length = 0;
  queue = [() => limited("requests per minute", "3"), () => ok({ b: 2 })];
  eq(JSON.stringify(await groqJson("t", "s", "u2")), '{"b":2}', "retry result");
  eq(seen.join(","), "openai/gpt-oss-20b,openai/gpt-oss-20b", "same model retried");

  // both exhausted -> AiQuotaError, visible, key never in message
  __setTransport(fake, noSleep);
  queue = [() => limited("tokens per day", "7200"), () => limited("tokens per day", "7200")];
  let err: unknown;
  try {
    await groqJson("t", "s", "u3");
  } catch (e) {
    err = e;
  }
  eq(err instanceof AiQuotaError, true, "quota error thrown");
  eq((err as AiQuotaError).scope, "day", "quota scope");
  eq(/gsk_/.test((err as Error).message), false, "no key in message");
  eq(!!quotaNotice(), true, "notice recorded for the UI");

  // bad JSON on primary -> fallback
  __setTransport(fake, noSleep);
  seen.length = 0;
  queue = [() => new Response(JSON.stringify({ choices: [{ message: { content: "nope" } }] }), { status: 200 }), () => ok({ c: 3 })];
  eq(JSON.stringify(await groqJson("t", "s", "u4")), '{"c":3}', "bad output falls back");

  // cache
  seen.length = 0;
  await groqJson("t", "s", "u4");
  eq(seen.length, 0, "cached call makes no request");

  eq(parseDuration("2m59.56s"), 179.56, "duration");
  __setTransport();
  delete process.env.GROQ_API_KEY;
  return "groq ok (fallback, retry, quota, bad json, cache)";
}
