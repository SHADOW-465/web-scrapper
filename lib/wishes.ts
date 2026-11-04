/**
 * "What do you need in your export?" in plain words -> an export plan.
 *
 *   "company, CEO name, email, LinkedIn, booth number, only German companies, first 100"
 *
 * Rules first (English and German), so it works without AI. Every column in the
 * plan points at something real: a column of the site's list, or a field the
 * company lookup fills. Wishes that match nothing are reported, never invented.
 * Pure (no I/O): runs in the browser and is checked offline.
 */
import { countryEntry, sameCountry } from "./countries";
import type { LeadResult } from "./leads";
import type { Column, FeedField, Row } from "./model";
import type { Person } from "./people";
import { roleOf, type Role } from "./roles";

export type Part = "name" | "title" | "email" | "phone" | "linkedin";
export type Source =
  | { type: "column"; id: string }                                  // a column of the site's list
  | { type: "feed"; key: string; label: string }                    // a field of the site's data, not a column yet
  | { type: "person"; role: Role | "any"; part: Part }              // from the company lookup
  | { type: "company"; part: "website" | "email" | "phone" | "linkedin" }
  | { type: "contact"; part: "email" | "phone" | "linkedin" };      // the decision-maker's, else the company's general one

export interface PlanItem { label: string; source: Source }
export interface Plan {
  items: PlanItem[];
  limit: number | null;
  country: string | null;          // only companies from this country
  sources: boolean;                // add "source" and "confidence" columns per field
  unresolved: string[];            // wishes nothing on the page or in the lookup can fill
  companyColId: string | null;     // the column holding the company name
  countryColId: string | null;
  by: "ai" | "rules";
  request: string;                 // the request as understood so far (for follow-ups)
}

type Kind = "company" | "website" | "country" | "city" | "hall" | "booth" | "email" | "phone" | "address" | "description" | "category" | "linkedin" | "person" | "other";
export interface Wish { raw: string; label: string; kind: Kind; role?: Role | "any"; part?: Part; company?: boolean }
export interface Request { wishes: Wish[]; limit: number | null; country: string | null; sources: boolean | null }

/* ------------------------------------------------------------ reading the request */

const URL_RE = /\bhttps?:\/\/[^\s<>"']+|\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|de|org|net|eu|io|co|uk|fr|it|es|at|ch|nl|pl|info|biz)(?:\/[^\s<>"']*)?/i;

/** The first web address in a message (with or without https://), if any. */
export function urlIn(text: string): string | null {
  const m = text.match(URL_RE);
  if (!m) return null;
  const u = m[0].replace(/[),.;!?]+$/, "");
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

const LIMIT_RE = /\b(?:(?:the\s+)?first|top|only|just|max(?:imum)?|up to|erste[nr]?|nur|die ersten|bis zu)\s+(\d{1,6})\b|\b(\d{1,6})\s+(?:companies|company|exhibitors|rows|firms|publishers|leads|firmen|unternehmen|aussteller|verlage|zeilen)\b/i;
const COUNTRY_RE = /\b(?:(?:only|just|nur)\s+)?(?:from|in|based in|aus|in)\s+(the\s+)?([a-zà-ž]+(?:\s+[a-zà-ž]+){0,2})\b|\b(?:(?:only|just|nur)\s+)?([a-zà-ž]+)\s+(?:companies|publishers|exhibitors|firms|verlage|firmen|unternehmen|aussteller)\b/gi;
const FILLER = /^(?:hi|hello|hallo|hey|please|bitte|only|just|nur|add|include|remove|drop|delete|take out|without|ohne|entferne|lösche|füge|hinzu|noch|ergänze|dazu|weg mit|thanks|danke|i need|i want|i'd like|i would like|we need|give me|get me|can you|could you|export|scrape|extract|find|collect|list|a list of|list of|liste der|liste mit|ich brauche|ich möchte|wir brauchen|gib mir|for each (?:company|exhibitor)|for every (?:company|exhibitor)|of (?:each|every|all) (?:companies|company|exhibitors|exhibitor)|all (?:companies|exhibitors)|everything|the|their|its|with|including|incl\.?|plus|also|and|und|mit|sowie|auch|details|info|information|data|columns?|fields?|in (?:the )?(?:export|file|table|sheet)|in my export|on this site|from this site|from this page|on this page)\b\s*/i;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function classify(piece: string): Wish | null {
  let t = piece.trim().replace(/^[-–•*]\s*/, "");
  for (let i = 0; i < 6; i++) {
    const before = t;
    t = t.replace(FILLER, "").replace(/\s+(?:please|bitte)$/i, "").trim();
    if (t === before) break;
  }
  t = t.replace(/[.!?:]+$/, "").replace(/\s+(?:for|of|from|in|on|at|to|für|von|aus|der|des|bei|the)$/gi, "").replace(/\s+(?:for|of|from|in|on|at|to|für|von|aus|der|des|bei|the)$/gi, "").trim();
  if (!t || t.length > 80 || /^(and|und|or|oder|the|a|an)$/i.test(t)) return null;
  const l = t.toLowerCase();
  const label = cap(t);
  const part: Part | undefined =
    /\be-?mails?\b|\bmail\b|\bmailadresse/.test(l) ? "email" :
    /\b(phone|telephone|tel\.?|telefon\w*|mobile|handy|number|nummer)\b/.test(l) && !/\b(stand|booth|hall|halle)\b/.test(l) ? "phone" :
    /linked\s?in/.test(l) ? "linkedin" :
    /\b(title|position|role|designation|job|funktion|rolle|titel)\b/.test(l) ? "title" :
    /\b(name|names|who|wer)\b/.test(l) ? "name" : undefined;

  const companyLevel = /\b(company|firm|firmen|unternehmens?|corporate|general|allgemeine?|office|zentrale)\b/.test(l) && !/\bname\b/.test(l);
  const role: Role | "any" | null =
    roleOf(l) ?? (/\b(decision[- ]?makers?|entscheider\w*|key (?:people|person|contacts?)|contact persons?|ansprechpartner\w*|management|leadership|executives?|people|persons?|personen|team)\b/.test(l) ? "any" : null);

  if (role && !(companyLevel && part)) return { raw: piece, label, kind: "person", role, part: part ?? "name" };
  if (part === "linkedin") return { raw: piece, label, kind: "linkedin", part, company: companyLevel };
  if (part === "email") return { raw: piece, label, kind: "email", part, company: companyLevel };
  if (part === "phone") return { raw: piece, label, kind: "phone", part, company: companyLevel };
  if (/\b(websites?|homepage|web ?site|webseite|internetseite|url|www|domain)\b/.test(l)) return { raw: piece, label, kind: "website" };
  if (/\b(compan(?:y|ies)|firm|firma|firmen\w*|unternehmen\w*|exhibitors?|aussteller\w*|organi[sz]ations?|publishers?|verlag\w*|brand|name)\b/.test(l)) return { raw: piece, label, kind: "company" };
  if (/\b(country|countries|land|länder|nation)\b/.test(l)) return { raw: piece, label, kind: "country" };
  if (/\b(city|cities|town|stadt|ort)\b/.test(l)) return { raw: piece, label, kind: "city" };
  if (/\b(booth|stand|stall|standnummer|booth ?number|stand ?number)\b/.test(l)) return { raw: piece, label, kind: "booth" };
  if (/\b(hall|halle|hallen|pavilion)\b/.test(l)) return { raw: piece, label, kind: "hall" };
  if (/\b(address|adresse|anschrift|street|stra(?:ß|ss)e|postcode|zip|plz)\b/.test(l)) return { raw: piece, label, kind: "address" };
  if (/\b(description|about|profile|profil|beschreibung|summary|bio|überblick)\b/.test(l)) return { raw: piece, label, kind: "description" };
  if (/\b(categor\w*|sector|branche|genre|topics?|themen|kategorie\w*|segment|industry|products?|produkte)\b/.test(l)) return { raw: piece, label, kind: "category" };
  return { raw: piece, label, kind: "other" };
}

/** Read a plain-words request: the wishes in order, plus limit, country filter and source columns. */
export function parseRequest(text: string): Request {
  let t = ` ${text.replace(URL_RE, " ")} `;
  let limit: number | null = null;
  const lm = t.match(LIMIT_RE);
  if (lm) {
    limit = Number(lm[1] ?? lm[2]) || null;
    t = t.replace(lm[0], " , ");
  }
  let country: string | null = null;
  for (const m of t.matchAll(COUNTRY_RE)) {
    const name = (m[2] ?? m[3] ?? "").trim();
    // "from Germany", "German companies"; try the longest phrase first ("United Kingdom").
    const words = name.split(/\s+/);
    for (let n = words.length; n >= 1; n--) {
      const cand = words.slice(0, n).join(" ");
      if (countryEntry(cand)) {
        country = cand;
        t = t.replace(m[0], " , ");
        break;
      }
    }
    if (country) break;
  }
  let sources: boolean | null = null;
  if (/\b(no|without|ohne|skip)\s+(the\s+)?(sources?|quellen?|confidence|source columns?)\b/i.test(t)) {
    sources = false;
    t = t.replace(/\b(no|without|ohne|skip)\s+(the\s+)?(sources?|quellen?|confidence|source columns?)( and confidence)?\b/gi, " , ");
  } else if (/\b(with|mit|include|add)\s+(the\s+)?(sources?|quellen?)\b/i.test(t)) {
    sources = true;
    t = t.replace(/\b(with|mit|include|add)\s+(the\s+)?(sources?|quellen?)( and confidence)?\b/gi, " , ");
  }
  const pieces = t
    .split(/[,;\n]|\s+(?:and|und|plus|as well as|sowie|also|auch|with|mit)\s+|\s&\s(?!licens)|\s\/\s/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const wishes: Wish[] = [];
  for (const p of pieces) {
    const w = classify(p);
    if (w && !wishes.some((x) => x.label.toLowerCase() === w.label.toLowerCase())) wishes.push(w);
    if (wishes.length >= 15) break;
  }
  return { wishes, limit, country, sources };
}

/* ------------------------------------------------------------ matching wishes to what the page has */

export interface Available { id: string; name: string; samples: string[]; on: boolean; feedKey?: string; extra?: boolean }

/** Everything the plan can point at: the dataset's columns (on or off) and its unused data fields. */
export function availableFrom(columns: Column[], rows: Row[], extras: FeedField[]): Available[] {
  const vals = (name: string) => rows.slice(0, 30).map((r) => r[name]).filter((v) => v != null && v !== "").map(String);
  return [
    ...columns.map((c) => ({ id: c.id, name: c.name, samples: c.on ? vals(c.name) : c.sample ? [c.sample] : [], on: c.on, feedKey: c.feedKey })),
    ...extras.map((f) => ({ id: `feed:${f.key}`, name: f.label, samples: f.sample ? [f.sample] : [], on: false, feedKey: f.key, extra: true })),
  ];
}

const shape = {
  email: (v: string) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v.trim()),
  phone: (v: string) => /^[+(]?\d[\d\s()./-]{6,}$/.test(v.trim()),
  domain: (v: string) => /^(https?:\/\/)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(v.trim()),
  hall: (v: string) => /^(hall|halle|pavilion|forum)\s*[\w.]+/i.test(v.trim()),
  booth: (v: string) => /^[A-Z]{0,3}[ -]?\d{1,4}[A-Z]?$/.test(v.trim()),
};
const NAMES: Partial<Record<Kind, RegExp>> = {
  company: /^(company|company name|name|exhibitor|exhibitor name|aussteller|firma|firmenname|unternehmen|organi[sz]ation|publisher|verlag|brand)$/i,
  website: /\b(website|webseite|homepage|web|www|url|site)\b/i,
  country: /\b(country|land|nation|staat)\b/i,
  city: /\b(city|stadt|ort|town)\b/i,
  hall: /\b(hall|halle|pavilion)\b/i,
  booth: /\b(stand|booth|stall)\b/i,
  email: /\be-?mail\b/i,
  phone: /\b(phone|tel|telefon|mobile)\b/i,
  address: /\b(address|adresse|anschrift|street|straße)\b/i,
  description: /\b(about|description|beschreibung|profile|profil|summary|text)\b/i,
  category: /\b(categor\w*|sector|branche|genre|topic|kategorie\w*|segment|tags?)\b/i,
};
// Everyday words for what a column is often called on the page.
const SYNONYMS: Record<string, string[]> = {
  author: ["name", "by", "writer", "autor"], writer: ["name", "author", "by"], autor: ["name", "author"],
  title: ["name", "heading", "titel"], price: ["cost", "preis", "amount"], preis: ["price", "cost"], date: ["datum", "when", "time"],
  rating: ["stars", "score", "bewertung"], tags: ["keywords", "topics", "schlagworte"], quote: ["text"], text: ["description", "body"],
  location: ["city", "address", "ort"], speaker: ["name"], product: ["name", "title"],
};
const JUNK = /\b(id|ids|count|anzahl|sort|order|index|flag|is |has )\b|_id\b/i;
const SHAPE: Partial<Record<Kind, (v: string) => boolean>> = { email: shape.email, phone: shape.phone, website: shape.domain, hall: shape.hall, booth: shape.booth };

function bestColumn(w: Wish, avail: Available[]): Available | null {
  const kindRe = NAMES[w.kind];
  const looks = SHAPE[w.kind];
  const base = w.label.toLowerCase().split(/[^a-zà-ž0-9]+/).filter((x) => x.length >= 3 && !/^(the|and|und|der|die|das|number|nummer|name)$/.test(x));
  const words = [...new Set([...base, ...base.flatMap((x) => SYNONYMS[x] ?? [])])];
  let best: { a: Available; score: number } | null = null;
  for (const a of avail) {
    if (JUNK.test(` ${a.name} `) && !JUNK.test(` ${w.label} `)) continue;
    const name = a.name.toLowerCase();
    let score = 0;
    if (name === w.label.toLowerCase()) score += 10;
    if (kindRe?.test(a.name)) score += 6;
    if (w.kind === "company" && /\bname\b/.test(name) && !/\b(first|last|vor|nach|contact|person|team|member|stand|hall)\b/.test(name)) score += 3;
    const nameWords = name.split(/[^a-zà-ž0-9]+/);
    const overlap = base.filter((x) => nameWords.includes(x)).length + words.filter((x) => !base.includes(x) && nameWords.includes(x)).length;
    score += overlap * 4;
    if (looks && a.samples.length) {
      const ok = a.samples.filter(looks).length / a.samples.length;
      if (ok >= 0.6) score += 4;
      else if (kindRe?.test(a.name) && w.kind !== "booth" && w.kind !== "hall") score -= 6; // "Url" holding slugs is not a website
    }
    if (!a.samples.length) score -= 2;
    if (a.on) score += 1;
    if (a.extra) score -= 1;
    // A free-form wish ("quote text") is placed by one whole-word match with a column's name.
    const need = w.kind === "other" ? 5 : 6;
    if (score >= need && (!best || score > best.score)) best = { a, score };
  }
  return best?.a ?? null;
}

/** Turn a parsed request into a plan against the columns this page really has. */
export function resolvePlan(req: Request, avail: Available[], prev?: Plan): Plan {
  const items: PlanItem[] = [];
  const unresolved: string[] = [];
  const col = (a: Available): Source => (a.extra ? { type: "feed", key: a.feedKey!, label: a.name } : { type: "column", id: a.id });
  for (const w of req.wishes) {
    let source: Source | null = null;
    if (w.kind === "person") source = { type: "person", role: w.role ?? "any", part: w.part ?? "name" };
    else if (w.kind === "linkedin") source = w.company ? { type: "company", part: "linkedin" } : { type: "contact", part: "linkedin" };
    else if (w.kind === "email" || w.kind === "phone") {
      const listed = !w.company ? bestColumn(w, avail) : null;
      source = listed ? col(listed) : w.company ? { type: "company", part: w.kind } : { type: "contact", part: w.kind };
    } else if (w.kind === "website") {
      const listed = bestColumn(w, avail);
      source = listed ? col(listed) : { type: "company", part: "website" };
    } else {
      const listed = bestColumn(w, avail);
      if (listed) source = col(listed);
    }
    if (source) items.push({ label: w.label, source });
    else unresolved.push(w.label);
  }
  const companyCol = bestColumn({ raw: "", label: "company name", kind: "company" }, avail.filter((a) => !a.extra));
  const countryCol = bestColumn({ raw: "", label: "country", kind: "country" }, avail);
  return {
    items,
    limit: req.limit ?? prev?.limit ?? null,
    country: req.country ?? prev?.country ?? null,
    sources: req.sources ?? prev?.sources ?? true,
    unresolved,
    companyColId: companyCol?.id ?? null,
    countryColId: countryCol?.id ?? null,
    by: "rules",
    request: [prev?.request, ""].filter(Boolean).join(""),
  };
}

/**
 * A follow-up message: "also add country", "remove phone", "only the first 100",
 * "without sources". Anything else that names fields replaces the request.
 */
export function followUp(prev: Plan, message: string, avail: Available[]): Plan {
  const m = message.trim();
  const req = parseRequest(m);
  const removing = /^(?:please\s+)?(?:remove|drop|delete|take out|without|no|ohne|entferne|lösche|weg mit)\b/i.test(m);
  const adding = /^(?:please\s+)?(?:add|also|plus|and|include|auch|dazu|füge|noch|ergänze)\b/i.test(m);
  const onlySettings = !req.wishes.length || req.wishes.every((w) => w.kind === "other" && /^(only|just|nur|first|erste|companies|firmen)$/i.test(w.label));
  const base: Plan = { ...prev, limit: req.limit ?? prev.limit, country: req.country ?? prev.country, sources: req.sources ?? prev.sources };
  if (removing) {
    const drop = req.wishes.map((w) => w.label.toLowerCase());
    const items = prev.items.filter((it) => !drop.some((d) => it.label.toLowerCase().includes(d) || d.includes(it.label.toLowerCase())));
    return { ...base, items, request: `${prev.request}\n${m}` };
  }
  if (adding || onlySettings) {
    const more = resolvePlan({ ...req, wishes: req.wishes }, avail, base);
    const items = [...prev.items, ...more.items.filter((n) => !prev.items.some((o) => o.label.toLowerCase() === n.label.toLowerCase()))];
    return { ...base, items, unresolved: more.unresolved, request: `${prev.request}\n${m}` };
  }
  return { ...resolvePlan(req, avail), request: m };
}

/* ------------------------------------------------------------ AI answers, checked */

/** The JSON shape asked of the AI planner. */
export interface AiPlan {
  columns?: Array<{ label?: unknown; source?: unknown }>;
  limit?: unknown;
  country?: unknown;
  sources?: unknown;
}

/** Accept an AI plan only where every column points at something real; the rest is reported as unresolved. */
export function fromAi(ai: AiPlan, avail: Available[], request: string, prev?: Plan): Plan | null {
  if (!Array.isArray(ai.columns) || !ai.columns.length) return null;
  const items: PlanItem[] = [];
  const unresolved: string[] = [];
  const ROLES = ["owner", "ceo", "md", "purchasing", "decision", "any"];
  for (const c of ai.columns.slice(0, 15)) {
    const label = typeof c.label === "string" ? c.label.trim().slice(0, 60) : "";
    const src = typeof c.source === "string" ? c.source.trim() : "";
    if (!label) continue;
    let source: Source | null = null;
    const f = src.match(/^field:(.+)$/i);
    const p = src.match(/^person:([a-z]+):(name|title|email|phone|linkedin)$/i);
    const co = src.match(/^company:(website|email|phone|linkedin)$/i);
    const ct = src.match(/^contact:(email|phone|linkedin)$/i);
    if (f) {
      const a = avail.find((x) => x.name.toLowerCase() === f[1].trim().toLowerCase());
      if (a) source = a.extra ? { type: "feed", key: a.feedKey!, label: a.name } : { type: "column", id: a.id };
    } else if (p && ROLES.includes(p[1].toLowerCase())) source = { type: "person", role: p[1].toLowerCase() as Role | "any", part: p[2].toLowerCase() as Part };
    else if (co) source = { type: "company", part: co[1].toLowerCase() as "website" };
    else if (ct) source = { type: "contact", part: ct[1].toLowerCase() as "email" };
    if (source) items.push({ label, source });
    else unresolved.push(label);
  }
  if (!items.length) return null;
  const rules = resolvePlan({ wishes: [], limit: null, country: null, sources: null }, avail, prev);
  const country = typeof ai.country === "string" && countryEntry(ai.country) ? ai.country : prev?.country ?? null;
  const limit = typeof ai.limit === "number" && ai.limit > 0 ? Math.floor(ai.limit) : prev?.limit ?? null;
  return { ...rules, items, unresolved, limit, country, sources: typeof ai.sources === "boolean" ? ai.sources : prev?.sources ?? true, by: "ai", request };
}

/* ------------------------------------------------------------ the export rows */

/** Does the plan need the company lookup (any decision-maker or company-contact column)? */
export const needsLookup = (plan: Plan) => plan.items.some((i) => i.source.type === "person" || i.source.type === "company" || i.source.type === "contact");

/** File/table headers, in her order and wording. */
export function planHeaders(plan: Plan): string[] {
  return plan.items.flatMap((i) => (plan.sources ? [i.label, `${i.label} (source)`, `${i.label} (confidence)`] : [i.label]));
}

const CONF: Record<string, string> = { high: "High", medium: "Medium", low: "Low" };
const conf = (p: Person) => `${CONF[p.confidence] ?? p.confidence}${p.sourceKind === "ai" ? " (read by AI)" : ""}`;
const VIA: Record<string, [string, string]> = {
  listing: ["Listed in the directory", "High"],
  "exhibitor-page": ["Exhibitor page", "High"],
  "domain-check": ["Name match, check", "Medium"],
  "web-search": ["Web search, check", "Medium"],
  "ai-search": ["AI web search, check", "Medium"],
};

/** One cell: value, where it came from, how sure. Empty value = not found. */
function cellFor(item: PlanItem, row: Row, colName: (s: Source) => string | undefined, lead: LeadResult | undefined, listing: string): [string, string, string] {
  const s = item.source;
  if (s.type === "column" || s.type === "feed") {
    const n = colName(s);
    const v = n ? row[n] : undefined;
    const text = v == null ? "" : typeof v === "string" ? v : String(v);
    return text ? [text, listing, "High"] : ["", "", ""];
  }
  if (!lead) return ["", "", ""];
  const pick = (p: Person | undefined, part: Part): [string, string, string] => {
    if (!p) return ["", "", ""];
    const v = part === "name" ? p.name : part === "title" ? p.roleRaw : part === "email" ? p.email : part === "phone" ? p.phone : p.linkedin;
    return v ? [v, p.sourceUrl, conf(p)] : ["", "", ""];
  };
  if (s.type === "person") {
    if (s.role === "any") return pick(s.part === "name" || s.part === "title" ? lead.people[0] : lead.people.find((x) => x[s.part as "email"]), s.part);
    const exact = lead.people.find((x) => x.role === s.role);
    if (exact) return pick(exact, s.part);
    // Asked for the CEO/owner/MD: the most senior person found stands in, and the confidence cell says their real title.
    if (s.role === "ceo" || s.role === "owner" || s.role === "md") {
      const stand = ["ceo", "owner", "md"].map((r) => lead.people.find((x) => x.role === r)).find(Boolean);
      const [v, src, c] = pick(stand, s.part);
      return v ? [v, src, `${c} (title: ${stand!.roleRaw})`] : ["", "", ""];
    }
    return ["", "", ""];
  }
  if (s.type === "company") {
    if (s.part === "website") return lead.website ? [lead.website, VIA[lead.websiteSource ?? ""]?.[0] ?? "", VIA[lead.websiteSource ?? ""]?.[1] ?? ""] : ["", "", ""];
    if (s.part === "email") return lead.companyEmail ? [lead.companyEmail, lead.companyEmailSource ?? "", "High (general mailbox)"] : ["", "", ""];
    if (s.part === "phone") return lead.companyPhone ? [lead.companyPhone, lead.companyPhoneSource ?? "", "High (main number)"] : ["", "", ""];
    return lead.companyLinkedin ? [lead.companyLinkedin, "Listed by the company", /\/in\//.test(lead.companyLinkedin) ? "Medium (a personal profile)" : "High"] : ["", "", ""];
  }
  // contact: the decision-maker's own, else the company's general one (the confidence says which)
  const own = lead.people.find((x) => x[s.part]);
  if (own) return pick(own, s.part);
  if (s.part === "email" && lead.companyEmail) return [lead.companyEmail, lead.companyEmailSource ?? "", "Company mailbox, not a person"];
  if (s.part === "phone" && lead.companyPhone) return [lead.companyPhone, lead.companyPhoneSource ?? "", "Company number, not a person"];
  if (s.part === "linkedin" && lead.companyLinkedin) {
    const personal = /\/in\//.test(lead.companyLinkedin);
    return [lead.companyLinkedin, "Listed by the company", personal ? "A profile the company lists, not tied to a named person" : "Company page, not a person"];
  }
  return ["", "", ""];
}

/**
 * The export: one row per company, exactly her columns (plus source/confidence when on),
 * filtered by country and cut to the limit.
 */
export function planRows(
  rows: Row[],
  plan: Plan,
  columns: Column[],
  leadOf: (row: Row) => LeadResult | undefined,
  listing: string,
): Row[] {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const colName = (s: Source) => (s.type === "column" ? byId.get(s.id)?.name : s.type === "feed" ? columns.find((c) => c.feedKey === s.key)?.name : undefined);
  const companyName = plan.companyColId ? byId.get(plan.companyColId)?.name : undefined;
  const countryName = plan.countryColId ? byId.get(plan.countryColId)?.name ?? columns.find((c) => `feed:${c.feedKey}` === plan.countryColId)?.name : undefined;
  const out: Row[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (plan.country && countryName && !sameCountry(String(r[countryName] ?? ""), plan.country)) continue;
    const key = companyName ? String(r[companyName] ?? "").trim().toLowerCase() : "";
    if (key && seen.has(key)) continue; // one row per company
    if (key) seen.add(key);
    const lead = leadOf(r);
    const o: Row = {};
    for (const it of plan.items) {
      const [v, src, c] = cellFor(it, r, colName, lead, listing);
      o[it.label] = v;
      if (plan.sources) {
        o[`${it.label} (source)`] = src;
        o[`${it.label} (confidence)`] = c;
      }
    }
    out.push(o);
    if (plan.limit && out.length >= plan.limit) break;
  }
  return out;
}

/** Rows the plan keeps (country filter), before projection: used to pick which companies to look up. */
export function planFilter(rows: Row[], plan: Plan, columns: Column[]): Row[] {
  const countryName = plan.countryColId ? columns.find((c) => c.id === plan.countryColId || `feed:${c.feedKey}` === plan.countryColId)?.name : undefined;
  return plan.country && countryName ? rows.filter((r) => sameCountry(String(r[countryName] ?? ""), plan.country!)) : rows;
}

/** A short description of the plan for the chat. */
export function describeSource(s: Source): string {
  const ROLE: Record<string, string> = { owner: "owner/founder", ceo: "CEO", md: "managing director", purchasing: "head of purchasing", decision: "senior decision-maker", any: "decision-maker" };
  if (s.type === "column" || s.type === "feed") return "from the list";
  if (s.type === "person") return `${ROLE[s.role]}'s ${s.part === "title" ? "job title" : s.part}, looked up`;
  if (s.type === "company") return `company ${s.part}, looked up`;
  return `decision-maker's ${s.part}, else the company's, looked up`;
}

export function selfCheck(): string {
  const eq = (a: unknown, b: unknown, m: string) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`wishes: ${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  };
  eq(urlIn("https://event.buchmesse.de/marketplace/exhibitors?pageNumber=1 I need company and email"), "https://event.buchmesse.de/marketplace/exhibitors?pageNumber=1", "url");
  eq(urlIn("look at event.buchmesse.de please"), "https://event.buchmesse.de", "bare domain");
  const r = parseRequest("https://x.de/ I need the company name, CEO name, email, LinkedIn and booth number for the first 50 German companies");
  eq(r.wishes.map((w) => `${w.label}|${w.kind}|${w.role ?? ""}|${w.part ?? ""}`), ["Company name|company||", "CEO name|person|ceo|name", "Email|email||email", "LinkedIn|linkedin||linkedin", "Booth number|booth||"], "wishes");
  eq([r.limit, r.country], [50, "German"], "limit and country");
  const de = parseRequest("Firma, Geschäftsführer, E-Mail und Halle, nur aus Deutschland, ohne Quellen");
  eq(de.wishes.map((w) => w.kind), ["company", "person", "email", "hall"], "German request");
  eq([de.country, de.sources], ["Deutschland", false], "German filter and no sources");
  eq(parseRequest("head of purchasing email").wishes[0], { raw: "head of purchasing email", label: "Head of purchasing email", kind: "person", role: "purchasing", part: "email" }, "role + part");
  eq(parseRequest("company email").wishes[0].company, true, "company-level email");

  const cols: Column[] = [
    { id: "c1", name: "Name", ink: "", on: true, sample: "" },
    { id: "c2", name: "Country", ink: "", on: true, sample: "" },
    { id: "c3", name: "Hall", ink: "", on: true, sample: "" },
    { id: "c4", name: "Stand", ink: "", on: true, sample: "" },
    { id: "c5", name: "Url", ink: "", on: false, sample: "bookend-inc" },
  ];
  const rows: Row[] = [
    { Name: "Muster Verlag", Country: "Deutschland", Hall: "Halle 3.1", Stand: "B54" },
    { Name: "Acme Books", Country: "Vereinigtes Königreich", Hall: "Halle 6", Stand: "C12" },
    { Name: "Muster Verlag", Country: "Deutschland", Hall: "Halle 3.1", Stand: "B54" },
  ];
  const avail = availableFrom(cols, rows, [{ key: "city", label: "City", sample: "Berlin", fill: 0.8, plumbing: false }]);
  const plan = resolvePlan(parseRequest("company, CEO name, email, website, booth number, city, favourite colour, only German companies"), avail);
  eq(plan.items.map((i) => `${i.label}>${i.source.type}${i.source.type === "column" ? ":" + i.source.id : ""}`),
    ["Company>column:c1", "CEO name>person", "Email>contact", "Website>company", "Booth number>column:c4", "City>feed"], "resolved (Url with slugs is not a website)");
  eq(plan.unresolved, ["Favourite colour"], "unmatched wish reported, not invented");
  eq([plan.companyColId, plan.countryColId], ["c1", "c2"], "company and country columns");

  const lead: LeadResult = {
    id: "x", name: "Muster Verlag", website: "https://muster.de", websiteSource: "exhibitor-page", pages: [], notes: [],
    people: [{ name: "Anna Meier", role: "ceo", roleRaw: "Geschäftsführerin", sourceUrl: "https://muster.de/impressum", evidence: "", confidence: "high" }],
    companyEmail: "info@muster.de", companyEmailSource: "https://muster.de/kontakt",
  };
  const out = planRows(rows, { ...plan, items: plan.items.filter((i) => i.source.type !== "feed") }, cols, (row) => (row.Name === "Muster Verlag" ? lead : undefined), "event.buchmesse.de listing");
  eq(out.length, 1, "German only, one row per company");
  eq(Object.keys(out[0]).slice(0, 6), ["Company", "Company (source)", "Company (confidence)", "CEO name", "CEO name (source)", "CEO name (confidence)"], "exact columns with source and confidence");
  eq([out[0]["CEO name"], out[0]["CEO name (confidence)"]], ["Anna Meier", "High"], "person cell");
  eq([out[0].Email, out[0]["Email (confidence)"]], ["info@muster.de", "Company mailbox, not a person"], "contact email falls back to the general mailbox, labelled");
  eq(out[0]["Website (confidence)"], "High", "website from the exhibitor page");
  const founderOnly: LeadResult = { ...lead, people: [{ ...lead.people[0], role: "owner", roleRaw: "Co-Founder" }] };
  const out2 = planRows(rows, plan, cols, () => founderOnly, "x");
  eq([out2[0]["CEO name"], out2[0]["CEO name (confidence)"]], ["Anna Meier", "High (title: Co-Founder)"], "CEO asked, founder stands in, title shown");

  const p2 = followUp(plan, "also add the country", avail);
  eq(p2.items.at(-1)?.label, "Country", "follow-up adds");
  const p3 = followUp(p2, "remove email", avail);
  eq(p3.items.some((i) => i.label === "Email"), false, "follow-up removes");
  const p4 = followUp(p3, "only the first 20", avail);
  eq([p4.limit, p4.items.length], [20, p3.items.length], "follow-up changes the limit only");

  const q = availableFrom([{ id: "t", name: "Text", ink: "", on: true, sample: "" }, { id: "n", name: "Name", ink: "", on: true, sample: "" }, { id: "g", name: "Tags", ink: "", on: true, sample: "" }],
    [{ Text: "“The world as we have created it…”", Name: "Albert Einstein", Tags: "change" }], []);
  eq(resolvePlan(parseRequest("quote text and author"), q).items.map((i) => `${i.label}>${i.source.type === "column" ? i.source.id : "?"}`), ["Quote text>t", "Author>n"], "free-form wishes and synonyms");
  const ai = fromAi({ columns: [{ label: "Firm", source: "field:Name" }, { label: "Boss", source: "person:ceo:name" }, { label: "Secret", source: "field:Password" }], limit: 10 }, avail, "x");
  eq([ai?.items.map((i) => i.label), ai?.unresolved, ai?.limit], [["Firm", "Boss"], ["Secret"], 10], "AI plan checked against real fields");
  return "wishes ok (26 checks)";
}
