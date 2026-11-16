/** Words the client should never see. Code and server logs may keep them. */
const TECHNICAL = /\b(AI|Groq|OpenRouter|gpt-oss|gemma|llama)\b|\bHTTP\b|\b429\b|rate limit|\bquota\b|\btokens?\b|\brequests\b|\blimits?\b|\breset\b/i;

export const SITE_DOWN = "This site couldn't be read right now. Try again in a few minutes.";
export const STILL = "Still working…";

export function technical(text: string): boolean {
  return TECHNICAL.test(text);
}

/** A sentence for a failure that will not fix itself. */
export function forPerson(raw: string): string {
  if (!raw.trim() || technical(raw)) return SITE_DOWN;
  return raw;
}

/** A sentence while a step is retrying on its own. */
export function hiccup(raw: string): string {
  if (!raw.trim() || technical(raw)) return STILL;
  return raw;
}
