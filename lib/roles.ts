/** Job titles (English and German) -> the decision-maker roles a publishing-services sales team cares about. */

export type Role = "owner" | "ceo" | "md" | "purchasing" | "decision";

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner / founder",
  ceo: "CEO",
  md: "Managing director / publisher",
  purchasing: "Purchasing / licensing",
  decision: "Senior decision-maker",
};

// Order matters: the first match wins, most specific first.
const PATTERNS: Array<[Role, RegExp]> = [
  ["purchasing", /\b(einkauf\w*|purchas\w+|procurement|head of buying|buyer|rights\s*(?:&|and|und)\s*licens\w+|licens(?:e|ing) manager|lizenz\w*|rechte\w*|responsable des achats|achats|acheteur|acheteuse|acquisti|compras|zakup\w*)\b/iu],
  ["ceo", /\b(ceo|chief executive|vorstandsvorsitzende[rn]?|gesch[aä]ftsf[uü]hrer(?:in)?|general manager|president|praesident|präsident(?:in)?|pdg|directeur g[ée]n[ée]ral|directrice g[ée]n[ée]rale|pr[ée]sident(?:e)?|amministratore delegato|amministratrice delegata|presidente|director general|directora general|consejer[oa] delegad[oa]|prezes|dyrektor generalny|algemeen directeur|legale rappresentante|repr[ée]sentant(?:e)? l[ée]gal(?:e)?|representante legal)(?![\p{L}])/iu],
  ["owner", /\b(inhaber(?:in)?|owner|founder|co-?founder|gr[uü]nder(?:in)?|eigent[uü]mer(?:in)?|proprietor|g[ée]rant(?:e)?|fondat(?:eur|rice|ore)|co-?fondat(?:eur|rice|ore)|propri[ée]taire|titolare|fundador(?:a)?|cofundador(?:a)?|propietari[oa]|eigenaar|oprichter|w[łl]a[śs]ciciel\w*|za[łl]o[żz]yciel\w*)(?![\p{L}])/iu],
  ["md", /\b(managing director|gesch[aä]ftsleitung|verlagsleit\w*|verleger(?:in)?|publisher|publishing director|director|vorstand|programmleit\w*|head of|directeur de (?:la )?publication|directrice de (?:la )?publication|directeur [ée]ditorial|directrice [ée]ditoriale|[ée]diteur|[ée]ditrice|direttore editoriale|direttrice editoriale|editore|direttore|direttrice|director editorial|directora editorial|uitgever|directeur|directrice|dyrektor\w*)(?![\p{L}])/iu],
  ["decision", /\b(editor[- ]in[- ]chief|chefredakt\w+|chief \w+ officer|cfo|coo|cto|cmo|cdo|leiter(?:in)?|leitung|vice president|vp|r[ée]dacteur en chef|r[ée]dactrice en chef|caporedattore|redattore capo|jefe de redacci[óo]n)(?![\p{L}])/iu],
];

// Titles that contain a role word but are not company decision-makers.
const NOT_DECISION = /\b(ip owner|product owner|rights owner|copyright owner|brand owner|account manager|assistant|assistent\w*|praktikant\w*|intern|trainee|volont\w*|werkstudent\w*|student)\b/i;

export function roleOf(text: string): Role | null {
  if (NOT_DECISION.test(text)) return null;
  for (const [role, re] of PATTERNS) if (re.test(text)) return role;
  return null;
}

/** A title that mentions a role word but is not a company decision-maker ("IP Owner", "Assistant to the CEO"). */
export const isExcludedTitle = (text: string) => NOT_DECISION.test(text);

/** Does this text contain any role keyword at all (used to find hard cases for AI)? */
export const hasRoleWord = (text: string) => roleOf(text) !== null;

export function selfCheck(): string {
  const eq = (a: unknown, b: unknown, m: string) => {
    if (a !== b) throw new Error(`roles: ${m}: ${String(a)} != ${String(b)}`);
  };
  eq(roleOf("Geschäftsführer"), "ceo", "gf");
  eq(roleOf("Managing Director"), "md", "md");
  eq(roleOf("Inhaberin"), "owner", "owner");
  eq(roleOf("Head of Purchasing"), "purchasing", "purchasing");
  eq(roleOf("Einkaufsleiter"), "purchasing", "einkauf");
  eq(roleOf("Author / IP Owner"), null, "IP owner is not a company owner");
  eq(roleOf("Founder & Publisher"), "owner", "founder");
  eq(roleOf("Assistant to the CEO"), null, "assistant");
  eq(roleOf("Sales representative"), null, "non decision");
  eq(roleOf("Directeur de la publication"), "md", "fr publication director");
  eq(roleOf("Gérante"), "owner", "fr gérante");
  eq(roleOf("Amministratore delegato"), "ceo", "it ceo");
  eq(roleOf("Director general"), "ceo", "es ceo");
  eq(roleOf("Fundadora"), "owner", "es founder");
  return "roles ok (14 checks)";
}
