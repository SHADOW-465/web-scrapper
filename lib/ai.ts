/**
 * Optional AI help via Groq's free tier (OpenAI-compatible API).
 *
 * Used for two small jobs, never for bulk extraction (the free tier's rate
 * limits could not carry thousands of pages, and deterministic selectors are
 * faster and exact):
 *   1. naming fields the way a person would, and flagging junk fields;
 *   2. reading records out of a page that has no list or data feed at all.
 *
 * Without GROQ_API_KEY, or on any error or rate limit, every function returns
 * null and the app falls back to its built-in rules.
 */

const ENDPOINT = "https://api.groq.com/openai/v1";
const PREFERRED = ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.1-8b-instant"];

export const aiEnabled = () => !!process.env.GROQ_API_KEY;

let workingModel: string | null = null;

async function listModels(key: string): Promise<string[]> {
  try {
    const res = await fetch(`${ENDPOINT}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: Array<{ id: string; active?: boolean }> };
    return (data.data ?? [])
      .filter((m) => m.active !== false && !/whisper|guard|tts|playai|vision|compound|embed/i.test(m.id))
      .map((m) => m.id);
  } catch {
    return [];
  }
}

/** Ask for a JSON object. Returns null on any failure. */
export async function groqJson<T>(system: string, user: string, maxTokens = 2500): Promise<T | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  const candidates = [process.env.GROQ_MODEL, workingModel, ...PREFERRED].filter((m, i, a): m is string => !!m && a.indexOf(m) === i);

  for (let attempt = 0; attempt < candidates.length + 1; attempt++) {
    let model = candidates[attempt];
    if (!model) {
      // Every preferred name was retired: ask Groq what it serves today.
      const live = await listModels(key);
      model = live.find((m) => /llama|gpt-oss|qwen|mixtral/i.test(m)) ?? live[0];
      if (!model) return null;
    }
    try {
      const res = await fetch(`${ENDPOINT}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: maxTokens,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: AbortSignal.timeout(25_000),
      });
      if (res.status === 404 || res.status === 400) {
        const err = await res.text();
        if (/model/i.test(err) && /(not.?found|decommission|does not exist|not supported)/i.test(err)) continue;
        return null;
      }
      if (!res.ok) return null; // 429 rate limit, 5xx: fall back quietly
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = data.choices?.[0]?.message?.content ?? "";
      workingModel = model;
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }
  return null;
}

export interface FieldForNaming { key: string; current: string; samples: string[] }

/**
 * Better names for fields, and which ones are junk (ids, flags, layout text).
 * Returns key -> { label, keep }.
 */
export async function nameFields(context: string, fields: FieldForNaming[]): Promise<Record<string, { label: string; keep: boolean }> | null> {
  if (!aiEnabled() || !fields.length) return null;
  const list = fields.slice(0, 60).map((f) => ({ key: f.key, current: f.current, samples: f.samples.slice(0, 3).map((s) => s.slice(0, 80)) }));
  const out = await groqJson<{ fields?: Array<{ key: string; label: string; keep: boolean }> }>(
    "You label spreadsheet columns for people doing business research. " +
      "Given fields extracted from a web page with sample values, give each a short, plain column name (1-3 words, Title Case, " +
      "the way the website itself would present it, e.g. 'Company', 'Country', 'Hall', 'Stand', 'Designation', 'Email'). " +
      "Set keep=false for fields a person would never want in a spreadsheet: internal ids, hashes, true/false flags, counters, " +
      "sort orders, layout or navigation text, image placeholders. Base names on the SAMPLE VALUES, not only the key. " +
      "Do not call a field 'Designation' unless its samples are job titles. " +
      'Reply as JSON: {"fields":[{"key":"...","label":"...","keep":true}]} with every input key exactly once.',
    `Page: ${context.slice(0, 200)}\nFields:\n${JSON.stringify(list)}`,
  );
  if (!out?.fields?.length) return null;
  const known = new Set(fields.map((f) => f.key));
  const result: Record<string, { label: string; keep: boolean }> = {};
  for (const f of out.fields) {
    if (known.has(f.key) && typeof f.label === "string" && f.label.trim()) {
      result[f.key] = { label: f.label.trim().slice(0, 40), keep: f.keep !== false };
    }
  }
  return Object.keys(result).length ? result : null;
}

/** Read records out of a page's visible text when nothing structured was found. */
export async function extractRecords(title: string, text: string): Promise<Array<Record<string, string>> | null> {
  if (!aiEnabled() || text.trim().length < 80) return null;
  const out = await groqJson<{ records?: Array<Record<string, unknown>> }>(
    "You extract structured data from the visible text of a web page. " +
      "If the page lists several similar things (people, companies, products, events), return one record per thing. " +
      "If it describes one thing, return one record. Use the same short Title Case field names for every record " +
      "(e.g. Name, Company, Designation, Email, Phone, Website, Address, Country, Price, Date, Description). " +
      "Copy values exactly as written; never invent or guess values; omit fields that are absent. " +
      'Reply as JSON: {"records":[{...}]}.',
    `Title: ${title.slice(0, 200)}\n\nPage text:\n${text.slice(0, 14_000)}`,
    6000,
  );
  const records = out?.records?.filter((r) => r && typeof r === "object") ?? [];
  const clean = records
    .map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v != null && typeof v !== "object").map(([k, v]) => [k.slice(0, 40), String(v).slice(0, 2000)])))
    .filter((r) => Object.keys(r).length > 0);
  return clean.length ? clean : null;
}
