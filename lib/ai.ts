/**
 * Optional AI help via Groq's free tier (see lib/groq.ts for models and limits).
 *
 * Used for small jobs only, never for bulk extraction: naming fields, and
 * reading records from a page with no list. Without GROQ_API_KEY every
 * function returns null and the app falls back to its built-in rules.
 * A rate limit (429) is not hidden: it is recorded and shown via quotaNotice().
 */
import { aiEnabled, groqJson as groq, quotaNotice, AiQuotaError } from "./groq";

export { aiEnabled, quotaNotice };

/** Ask for a JSON object. Null on failure; a 429 is recorded in quotaNotice() for the UI. */
export async function groqJson<T>(system: string, user: string, maxTokens = 2500): Promise<T | null> {
  try {
    return await groq<T>("legacy", system, user, { maxTokens });
  } catch (e) {
    if (e instanceof AiQuotaError) return null; // surfaced through quotaNotice()
    return null;
  }
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
