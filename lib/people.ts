/**
 * Find decision-makers in a fetched web page. Deterministic; no AI.
 *
 * Hard rules (tested): nothing is returned that is not written on the page.
 *  - a name is a line fragment of 2-4 capitalised words, copied as written;
 *  - an email/LinkedIn URL belongs to a person only if it sits next to that
 *    person (same line/card) or its address contains their name;
 *  - generic mailboxes (info@, office@ ...) are company contacts, never a person's;
 *  - no address is ever constructed from a name.
 */
import { parseHTML } from "linkedom";
import { roleOf, type Role } from "./roles";

export type Confidence = "high" | "medium" | "low";

export interface Person {
  name: string;
  role: Role;
  roleRaw: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  sourceUrl: string;
  evidence: string;
  confidence: Confidence;
}

export interface PageFacts {
  people: Person[];
  companyEmails: string[];
  companyPhones: string[];
  companyLinkedin?: string;
  /** Lines that mention a role but where no clean name could be isolated (candidates for AI). */
  unresolved: string[];
  text: string;
}

export const GENERIC_MAIL = /^(info|kontakt|contact|office|mail|sales|hello|hallo|service|support|verlag|team|post|redaktion|presse|press|vertrieb|buchhaltung|rechnung|bestellung|order|orders|admin|webmaster|datenschutz|privacy|jobs|karriere)$/i;
const NOT_NAME = /\b(gmbh|ag|kg|ug|ltd|llc|inc|verlag|verlage|publishing|publishers?|press|books?|media|group|holding|limited|company|co\.|s\.r\.o|b\.v|sp\.|z o\.o|team|contact|kontakt|impressum|imprint|telefon|phone|email|e-mail|str\.|straße|strasse|platz|weg|germany|deutschland|handelsregister|amtsgericht|ust|vat|haftung|rights|sales|marketing|director|manager|managing|chief|officer|head|editor|owner|founder|inhaber|gesch[aä]ftsf[uü]hrer\w*|vorstand|leiter\w*|leitung|einkauf\w*|ceo|cfo|cto|coo|publisher|verleger\w*|vertretungsberechtigt\w*|vertreten|durch|und|and|der|die|das|von|the|of|for|ist|is|zu|im|in|am|an|bei|mit|alle|all)\b/i;
const NAME_TOKEN = /^(?:[A-ZÄÖÜÉÈÁÀÅØŁŚŻŹĆŃ][\p{L}'’.-]{1,}|van|von|de|der|den|la|le|di|da|zu|zur|bin|al|el)$/u;
const TITLE = /^(?:dr\.?|prof\.?|mag\.?|dipl\.?(?:-\w+\.?)?|ing\.?|mr\.?|mrs\.?|ms\.?|herr|frau)$/i;

const norm = (s: string) => s.replace(/[\u00a0\s]+/g, " ").trim();
export const normalise = (s: string) => norm(s).toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");

/** Could this string be a person's name? Returns it cleaned, or null. */
export function asName(s: string): string | null {
  const t = norm(s).replace(/^[,;:–—-]+|[,;:–—-]+$/g, "").trim();
  if (!t || t.length > 60 || /[0-9@/\\|<>(){}[\]]/.test(t)) return null;
  const tokens = t.split(" ").filter((w) => !TITLE.test(w));
  if (tokens.length < 2 || tokens.length > 4) return null;
  if (!tokens.every((w) => NAME_TOKEN.test(w))) return null;
  if (tokens.some((w) => NOT_NAME.test(w))) return null;
  if (!/^[A-ZÄÖÜÉÈÁÀÅØŁŚŻŹĆŃ]/u.test(tokens[0])) return null;
  return t;
}

/** Text of a page with one line per visible block. Scripts and styles removed. */
export function pageLines(html: string): string[] {
  const { document } = parseHTML(html);
  document.querySelectorAll("script,style,noscript,template,svg,head").forEach((n) => n.remove());
  document.querySelectorAll("p,div,li,ul,ol,tr,td,th,h1,h2,h3,h4,h5,h6,section,article,br,dt,dd,address,header,footer,main,aside,nav,blockquote,figcaption").forEach((n) => n.append("\n"));
  const text = (document.body?.textContent || document.documentElement?.textContent || "").replace(/[\u00a0\t ]+/g, " ");
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?:\+|00)\d[\d\s()./-]{7,17}\d|\(?0\d{2,5}\)?[\s/.-]?\d[\d\s/.-]{5,12}\d/g;

const emailsIn = (s: string) => [...s.matchAll(EMAIL_RE)].map((m) => m[0].replace(/\.$/, ""));
const phonesIn = (s: string) => [...s.matchAll(PHONE_RE)].map((m) => norm(m[0])).filter((p) => p.replace(/\D/g, "").length >= 8 && p.replace(/\D/g, "").length <= 15);

const slugName = (name: string) => normalise(name).split(" ").filter((w) => w.length > 1 && !TITLE.test(w));
/** Does the address itself contain the person's surname (e.g. a.meier@..., meier@...)? */
function emailBelongsTo(email: string, name: string): boolean {
  const local = normalise(email.split("@")[0]).replace(/[^a-z]/g, "");
  const parts = slugName(name);
  const last = parts[parts.length - 1]?.replace(/[^a-z]/g, "");
  return !!last && last.length >= 3 && local.includes(last);
}

interface Hit { name: string; roleRaw: string; role: Role; evidence: string; adjacent: boolean }

/** Pull "Name … Role" pairs out of lines. */
function hitsFromLines(lines: string[], unresolved: string[]): Hit[] {
  const hits: Hit[] = [];
  const ROLEWORD = /(gesch[aä]ftsf[uü]hrer(?:in)?|inhaber(?:in)?|vertretungsberechtigt\w*|vorstand\w*|verlagsleit\w*|verleger(?:in)?|managing director|general manager|chief executive(?: officer)?|ceo|founder|co-?founder|gr[uü]nder(?:in)?|owner|publisher|publishing director|head of [a-z]+(?: (?:&|and|of) [a-z]+)?|director(?: of [a-z]+)?|einkauf\w*|purchasing(?: (?:manager|director|lead))?|procurement|rights\s*(?:&|and|und)\s*licensing(?: (?:manager|director))?|programmleit\w*|editor[- ]in[- ]chief|chefredakt\w+|[A-Z][a-z]+ manager)/i;
  const seen = new Set<string>();
  const push = (h: Hit) => {
    const k = normalise(h.name);
    if (seen.has(k)) return;
    seen.add(k);
    hits.push(h);
  };

  lines.forEach((line, i) => {
    const m = line.match(ROLEWORD);
    if (!m || line.length > 400) return;
    const role = roleOf(m[0]);
    if (!role) return;
    const before = line.slice(0, m.index!);
    const after = line.slice(m.index! + m[0].length);
    const found: string[] = [];

    // "Geschäftsführer: Anna Meier, Peter Schulz und Jan Roth"  /  "Anna Meier, CEO"  /  "Anna Meier – Head of Purchasing"
    const lists = [after.replace(/^\s*[:\-–—,]?\s*/, ""), before.replace(/[\s:\-–—,|(]+$/, "")];
    for (const seg of lists) {
      for (const piece of seg.split(/\s*(?:,|;|\/|\||&|\bund\b|\band\b|\bsowie\b)\s*/i)) {
        const name = asName(piece);
        if (name) found.push(name);
      }
      if (found.length) break;
    }
    let adjacent = false;
    if (!found.length) {
      // Card layout: the name is the line right before or after a role-only line.
      for (const j of [i - 1, i + 1, i - 2]) {
        const cand = lines[j];
        const name = cand ? asName(cand) : null;
        if (name) {
          found.push(name);
          adjacent = true;
          break;
        }
      }
    }
    if (!found.length) {
      unresolved.push(line.slice(0, 240));
      return;
    }
    for (const name of found.slice(0, 4)) push({ name, roleRaw: norm(m[0]), role, evidence: norm(line).slice(0, 240), adjacent });
  });
  return hits;
}

function jsonLdPeople(html: string, pageUrl: string): Person[] {
  const out: Person[] = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const walk = (node: unknown, depth = 0) => {
      if (!node || typeof node !== "object" || depth > 6) return;
      if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
      const o = node as Record<string, unknown>;
      const type = String(o["@type"] ?? "");
      if (/Person/i.test(type) && typeof o.name === "string") {
        const name = asName(o.name);
        const jobTitle = typeof o.jobTitle === "string" ? o.jobTitle : "";
        const role = roleOf(jobTitle);
        if (name && role) {
          out.push({
            name, role, roleRaw: jobTitle, sourceUrl: pageUrl, confidence: "high",
            evidence: `JSON-LD: ${name}, ${jobTitle}`,
            email: typeof o.email === "string" && !GENERIC_MAIL.test(o.email.replace(/^mailto:/, "").split("@")[0]) ? o.email.replace(/^mailto:/, "") : undefined,
            phone: typeof o.telephone === "string" ? norm(o.telephone) : undefined,
          });
        }
      }
      for (const key of ["founder", "founders", "employee", "employees", "member", "contactPoint", "@graph", "author", "publisher", "owner"]) walk(o[key], depth + 1);
    };
    walk(data);
  }
  return out;
}

/** Everything useful and verifiable on one page. */
export function extractFacts(html: string, pageUrl: string): PageFacts {
  const { document } = parseHTML(html);
  const lines = pageLines(html);
  const text = lines.join("\n");
  const unresolved: string[] = [];

  const people: Person[] = [...jsonLdPeople(html, pageUrl)];
  for (const h of hitsFromLines(lines, unresolved)) {
    if (people.some((p) => normalise(p.name) === normalise(h.name))) continue;
    people.push({ name: h.name, role: h.role, roleRaw: h.roleRaw, sourceUrl: pageUrl, evidence: h.evidence, confidence: h.adjacent ? "medium" : "high" });
  }

  // mailto / tel / linkedin links
  const mails = new Set<string>();
  const phones = new Set<string>();
  const personLinks: Array<{ url: string; context: string }> = [];
  let companyLinkedin: string | undefined;
  document.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href") ?? "";
    if (/^mailto:/i.test(href)) {
      const e = decodeURIComponent(href.slice(7).split("?")[0]).trim();
      if (/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(e)) mails.add(e);
    } else if (/^tel:/i.test(href)) {
      const p = norm(decodeURIComponent(href.slice(4)));
      if (p.replace(/\D/g, "").length >= 8) phones.add(p);
    } else if (/linkedin\.com\/(in|company)\//i.test(href)) {
      const url = href.split("?")[0].replace(/\/$/, "");
      if (/\/company\//i.test(url)) companyLinkedin ??= url;
      else {
        let ctx = a;
        for (let i = 0; i < 3 && ctx.parentElement && (ctx.parentElement.textContent ?? "").length < 160; i++) ctx = ctx.parentElement;
        personLinks.push({ url, context: normalise(ctx.textContent ?? "") });
      }
    }
  });
  for (const e of emailsIn(text)) mails.add(e);
  for (const p of phonesIn(lines.filter((l) => /\b(tel|telefon|phone|fon|mobil|mobile)\b/i.test(l)).join("\n"))) phones.add(p);

  // Attach contacts to a person only with evidence on the page.
  for (const p of people) {
    const idx = lines.findIndex((l) => norm(l).includes(p.name));
    const near = idx >= 0 ? lines.slice(Math.max(0, idx - 1), idx + 3).join(" ") : "";
    p.email ??= [...mails, ...emailsIn(near)].find((e) => !GENERIC_MAIL.test(e.split("@")[0]) && (emailBelongsTo(e, p.name) || near.includes(e)));
    p.phone ??= phonesIn(near)[0];
    const lk = personLinks.find((l) => slugName(p.name).every((w) => l.context.includes(w)) || (slugName(p.name).at(-1) ?? "###").length > 2 && l.url.toLowerCase().includes(slugName(p.name).at(-1)!));
    p.linkedin ??= lk?.url;
  }

  return {
    people,
    companyEmails: [...mails].filter((e) => !/\.(png|jpe?g|gif|svg|webp)$/i.test(e)),
    companyPhones: [...phones],
    companyLinkedin,
    unresolved: unresolved.slice(0, 6),
    text,
  };
}

/** True if `value` is written on the page (whitespace and case insensitive). */
export const appearsIn = (text: string, value: string) => normalise(text).includes(normalise(value));

/** Validate a person proposed by AI against the page text. Returns null unless every claim is written there. */
export function guardAiPerson(
  proposed: { name?: unknown; role?: unknown; email?: unknown },
  text: string,
  sourceUrl: string,
): Person | null {
  const name = typeof proposed.name === "string" ? asName(proposed.name) : null;
  if (!name || !appearsIn(text, name)) return null;
  const roleRaw = typeof proposed.role === "string" ? proposed.role.trim() : "";
  const role = roleOf(roleRaw);
  if (!role) return null;
  // The role words must be written in the same sentence/line as the name, within ~160 characters.
  const flat = text.replace(/[ \t\u00a0]+/g, " ");
  const at = normalise(flat).indexOf(normalise(name));
  const before = flat.slice(Math.max(0, at - 160), at).split(/[\n.!?]\s/).pop()!.split("\n").pop()!;
  const after = flat.slice(at + name.length, at + name.length + 160).split(/[\n!?]|\.\s/)[0];
  const window = `${before}${name}${after}`;
  if (!roleOf(window)) return null;
  let email: string | undefined;
  if (typeof proposed.email === "string" && appearsIn(text, proposed.email) && !GENERIC_MAIL.test(proposed.email.split("@")[0])) email = proposed.email;
  return { name, role, roleRaw, email, sourceUrl, evidence: window.trim().slice(0, 240), confidence: "medium" };
}

export function selfCheck(): string {
  const eq = (a: unknown, b: unknown, m: string) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`people: ${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  };
  const imprint = `<html><body><h1>Impressum</h1><p>Muster Verlag GmbH, Hauptstraße 1, 60311 Frankfurt</p>
    <p>Geschäftsführer: Anna Meier und Dr. Peter Schulz</p><p>Tel: +49 69 1234567</p>
    <p>E-Mail: info@muster-verlag.de</p><p>Anna Meier: <a href="mailto:a.meier@muster-verlag.de">a.meier@muster-verlag.de</a></p>
    <a href="https://www.linkedin.com/in/anna-meier-123/">LinkedIn Anna Meier</a>
    <a href="https://www.linkedin.com/company/muster-verlag">Wir auf LinkedIn</a></body></html>`;
  const f = extractFacts(imprint, "https://muster-verlag.de/impressum");
  eq(f.people.map((p) => p.name), ["Anna Meier", "Dr. Peter Schulz"], "names");
  eq(f.people.some((p) => p.name === "Anna Meier" && p.role === "ceo" && p.confidence === "high"), true, "anna ceo high");
  eq(f.people.find((p) => p.name === "Anna Meier")?.email, "a.meier@muster-verlag.de", "personal email attached");
  eq(f.people.find((p) => p.name === "Anna Meier")?.linkedin, "https://www.linkedin.com/in/anna-meier-123", "linkedin attached");
  eq(f.people.some((p) => /Peter Schulz/.test(p.name)), true, "second person");
  eq(f.people.find((p) => /Peter Schulz/.test(p.name))?.email, undefined, "no email invented for Peter");
  eq(f.people.find((p) => /Peter Schulz/.test(p.name))?.linkedin, undefined, "no linkedin invented for Peter");
  eq(f.people.every((p) => !p.email || appearsIn(f.text, p.email)), true, "every email is on the page");
  eq(f.companyEmails.includes("info@muster-verlag.de"), true, "generic mailbox kept as company contact");
  eq(f.people.some((p) => p.email === "info@muster-verlag.de"), false, "generic mailbox never a person's");
  eq(f.companyLinkedin, "https://www.linkedin.com/company/muster-verlag", "company linkedin");

  // card layout: name on one line, role on the next
  const card = `<div class="team"><div><div class="n">Jan Roth</div><div class="r">Head of Purchasing</div></div><div><div>Lena Berg</div><div>Sales Representative</div></div></div>`;
  const c = extractFacts(card, "https://x.de/team");
  eq(c.people.map((p) => `${p.name}|${p.role}|${p.confidence}`), ["Jan Roth|purchasing|medium"], "card layout, non-decision ignored");

  // nothing to find -> nothing invented
  eq(extractFacts("<html><body><p>Wir lieben Bücher. Besuchen Sie uns!</p></body></html>", "https://x.de").people, [], "empty page");

  // AI guard
  const text = "Our team. Maria Lopez is our Managing Director. Reach her at maria@acme.com. Bob Fake";
  eq(guardAiPerson({ name: "Maria Lopez", role: "Managing Director", email: "maria@acme.com" }, text, "u")?.email, "maria@acme.com", "ai ok");
  eq(guardAiPerson({ name: "Maria Lopez", role: "Managing Director", email: "m.lopez@acme.com" }, text, "u")?.email, undefined, "ai email not on page dropped");
  eq(guardAiPerson({ name: "John Smith", role: "CEO" }, text, "u"), null, "ai name not on page dropped");
  eq(guardAiPerson({ name: "Bob Fake", role: "CEO" }, text + " " + "x".repeat(400) + " CEO", "u"), null, "ai role too far dropped");
  return "people ok (16 checks)";
}
