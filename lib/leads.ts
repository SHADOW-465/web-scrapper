/**
 * Decision-maker lookup, browser side: which column holds the company, one
 * lookup per company, and the lead columns joined onto every row.
 * Pure functions (no I/O), so they are checked offline.
 */
import type { CompanyResult } from "./company";
import type { Column, Row } from "./model";
import type { Person } from "./people";

export type LeadResult = Omit<CompanyResult, "_hard">;

export interface LeadsConfig {
  on: boolean;
  nameCol: string;          // column holding the company name
  countryCol?: string;      // optional, helps tell same-named companies apart
  websiteCol?: string;      // optional, a website the listing already gives
  limit: number | null;     // only the first N companies (null: all)
  aiSearch: number;         // AI web searches this run may spend (each costs ~3-6K Groq tokens)
  listId?: string;          // UI only: which dataset the choice was made for
}

export interface LeadsState {
  config: LeadsConfig;
  results: Record<string, LeadResult>;
  attempts: Record<string, number>;   // times a company came back unfinished
  companyCount: number;
  aiSearchesUsed: number;
  aiRequests: number;
  aiTokens: number;
  quotaMessage?: string;              // Groq 429, shown to the user as is
  notices: string[];
  /** The AI pass: companies that still need AI are retried whenever the free limits allow. */
  aiTotal?: number;                   // companies that needed AI when the pass began
  aiWaitUntil?: number;               // daily limit hit: continue at about this time
  aiAttempts?: Record<string, number>;
}

export interface CompanyRef { id: string; name: string; country?: string; website?: string; profileUrl?: string }

export const newLeadsState = (config: LeadsConfig, results: Record<string, LeadResult> = {}): LeadsState => ({
  config, results: { ...results }, attempts: {}, companyCount: 0, aiSearchesUsed: 0, aiRequests: 0, aiTokens: 0, notices: [],
});

const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim();
const text = (v: unknown) => (v == null ? "" : typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** The key that identifies one company across rows (a company with 3 team members is one lookup). */
export const companyKey = (name: string, country?: string) => `${fold(name)}|${fold(country ?? "")}`.slice(0, 200);

/** Pick the columns that hold the company name, country and website, from names and sample values. */
export function guessLeadColumns(columns: Column[], rows: Row[]): Pick<LeadsConfig, "nameCol" | "countryCol" | "websiteCol"> | null {
  const on = columns.filter((c) => c.on);
  const sample = (c: Column) => rows.slice(0, 20).map((r) => text(r[c.name])).filter(Boolean);
  const textual = (c: Column) => {
    const v = sample(c);
    return v.length >= Math.min(3, rows.length) && v.filter((x) => /[A-Za-zÀ-ž]/.test(x) && x.length <= 160 && !/^https?:\/\//.test(x)).length >= v.length * 0.8;
  };
  const byName = (re: RegExp) => on.find((c) => re.test(c.name));
  const name =
    byName(/^(company|company name|exhibitor|exhibitor name|aussteller|firma|firmenname|unternehmen|organi[sz]ation|publisher|verlag|name)$/i) ??
    byName(/\b(company|exhibitor|aussteller|firma|unternehmen|organi[sz]ation|publisher|verlag)\b/i) ??
    on.find((c) => /\bname\b/i.test(c.name) && !/\b(first|last|vor|nach|contact|person|team|member)\b/i.test(c.name) && textual(c)) ??
    on.find(textual);
  if (!name) return null;
  const country = byName(/\b(country|land|staat|nation)\b/i);
  const website = on.find((c) => /\b(website|webseite|homepage|web|www|url|site)\b/i.test(c.name) && sample(c).some((v) => /^(https?:\/\/)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(v.trim())));
  return { nameCol: name.name, countryCol: country?.name, websiteCol: website?.name };
}

/** One lookup per company, in row order. `urls` are the rows' own pages on the marketplace, if known. */
export function companiesFrom(rows: Row[], urls: Array<string | undefined>, cfg: LeadsConfig): CompanyRef[] {
  const out: CompanyRef[] = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const name = text(r[cfg.nameCol]).trim();
    if (!name) return;
    const country = cfg.countryCol ? text(r[cfg.countryCol]).trim() || undefined : undefined;
    const id = companyKey(name, country);
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, name, country, website: cfg.websiteCol ? text(r[cfg.websiteCol]).trim() || undefined : undefined, profileUrl: urls[i] });
  });
  return cfg.limit && cfg.limit > 0 ? out.slice(0, cfg.limit) : out;
}

/* ------------------------------------------------------------ the lead columns */

export const LEAD_FIELDS = [
  "Website", "Website found via",
  "Decision-maker", "Decision-maker role", "Decision-maker email", "Decision-maker phone", "Decision-maker LinkedIn",
  "Decision-maker source", "Decision-maker confidence",
  "Other decision-makers",
  "Company email", "Company email source", "Company phone", "Company phone source", "Company LinkedIn",
  "Lookup notes",
] as const;
export type LeadField = (typeof LEAD_FIELDS)[number];

/** Lead column names, renamed where they would clash with a column the user already has. */
export function leadFieldNames(existing: string[]): Record<LeadField, string> {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  return Object.fromEntries(LEAD_FIELDS.map((f) => [f, taken.has(f.toLowerCase()) ? `${f} (lookup)` : f])) as Record<LeadField, string>;
}

const VIA: Record<string, string> = {
  listing: "Listed in the directory",
  "exhibitor-page": "Exhibitor page",
  "domain-check": "Name match (check)",
  "web-search": "Web search (check)",
  "ai-search": "AI web search (check)",
};
const CONF: Record<string, string> = { high: "High", medium: "Medium", low: "Low" };

const personLabel = (p: Person) => [p.name, p.roleRaw, p.email, p.linkedin].filter(Boolean).join(", ");

/** The lead cells for one company. Empty string = not found (never a guess). */
export function leadCells(r: LeadResult | undefined, names: Record<LeadField, string>): Row {
  const out: Row = {};
  for (const f of LEAD_FIELDS) out[names[f]] = "";
  if (!r) return out;
  const [p, ...more] = r.people;
  const set = (f: LeadField, v: string | undefined) => (out[names[f]] = v ?? "");
  set("Website", r.website);
  set("Website found via", r.website ? VIA[r.websiteSource ?? ""] ?? "" : "");
  if (p) {
    set("Decision-maker", p.name);
    set("Decision-maker role", p.roleRaw);
    set("Decision-maker email", p.email);
    set("Decision-maker phone", p.phone);
    set("Decision-maker LinkedIn", p.linkedin);
    set("Decision-maker source", p.sourceUrl);
    set("Decision-maker confidence", `${CONF[p.confidence] ?? p.confidence}${p.sourceKind === "ai" ? " (read by AI)" : ""}`);
  }
  set("Other decision-makers", more.slice(0, 5).map(personLabel).join("; "));
  set("Company email", r.companyEmail);
  set("Company email source", r.companyEmail ? r.companyEmailSource : "");
  set("Company phone", r.companyPhone);
  set("Company phone source", r.companyPhone ? r.companyPhoneSource : "");
  set("Company LinkedIn", r.companyLinkedin);
  set("Lookup notes", r.notes.join(" "));
  return out;
}

/** Rows with the lead columns joined in (every row of a company gets that company's leads). */
export function joinLeads(rows: Row[], cfg: LeadsConfig, results: Record<string, LeadResult>, names: Record<LeadField, string>): Row[] {
  return rows.map((r) => {
    const name = text(r[cfg.nameCol]).trim();
    const id = name ? companyKey(name, cfg.countryCol ? text(r[cfg.countryCol]).trim() || undefined : undefined) : "";
    return { ...r, ...leadCells(id ? results[id] : undefined, names) };
  });
}

/** Seconds a run is expected to take: ~6 companies in parallel per call, 2 calls at once, ~13 s per company. */
export const estimateSeconds = (companies: number) => Math.ceil((companies * 13) / 12) + 5;

export function selfCheck(): string {
  const eq = (a: unknown, b: unknown, m: string) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`leads: ${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  };
  const col = (name: string): Column => ({ id: name, name, ink: "#000", on: true, sample: "" });
  const rows: Row[] = [
    { Name: "Muster Verlag GmbH", Country: "Deutschland", Hall: "Halle 3.1" },
    { Name: "Muster Verlag GmbH", Country: "Deutschland", Hall: "Halle 3.1" },
    { Name: "Acme Books", Country: "UK", Hall: "Halle 6" },
    { Name: "", Country: "UK", Hall: "x" },
  ];
  const g = guessLeadColumns([col("Name"), col("Country"), col("Hall")], rows);
  eq(g, { nameCol: "Name", countryCol: "Country", websiteCol: undefined }, "guessed columns");
  const cfg: LeadsConfig = { on: true, nameCol: "Name", countryCol: "Country", limit: null, aiSearch: 0 };
  const comps = companiesFrom(rows, ["u1", "u2", "u3", "u4"], cfg);
  eq(comps.map((c) => [c.name, c.profileUrl]), [["Muster Verlag GmbH", "u1"], ["Acme Books", "u3"]], "one lookup per company");
  eq(companiesFrom(rows, [], { ...cfg, limit: 1 }).length, 1, "limit");

  const names = leadFieldNames(["Name", "Website"]);
  eq(names.Website, "Website (lookup)", "clash renamed");
  const res: LeadResult = {
    id: comps[0].id, name: "Muster Verlag GmbH", website: "https://muster.de", websiteSource: "exhibitor-page",
    people: [
      { name: "Anna Meier", role: "ceo", roleRaw: "Geschäftsführerin", email: "a.meier@muster.de", sourceUrl: "https://muster.de/impressum", evidence: "", confidence: "high", sourceKind: "company-site" },
      { name: "Jan Roth", role: "purchasing", roleRaw: "Head of Purchasing", sourceUrl: "https://muster.de/team", evidence: "", confidence: "medium" },
    ],
    companyEmail: "info@muster.de", companyEmailSource: "https://muster.de/kontakt", pages: [], notes: [],
  };
  const joined = joinLeads(rows, cfg, { [res.id]: res }, names);
  eq(joined[0]["Decision-maker"], "Anna Meier", "best person first");
  eq(joined[0]["Decision-maker confidence"], "High", "confidence label");
  eq(joined[1]["Decision-maker email"], "a.meier@muster.de", "every row of the company joined");
  eq(joined[0]["Other decision-makers"], "Jan Roth, Head of Purchasing", "others listed");
  eq(joined[2]["Decision-maker"], "", "not looked up -> empty, never a guess");
  eq(joined[0]["Hall"], "Halle 3.1", "original columns kept");
  eq(Object.keys(joined[0]).length, 3 + LEAD_FIELDS.length, "exactly the original columns plus the lead columns");
  return "leads ok (11 checks)";
}
