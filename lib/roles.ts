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
  ["purchasing", /\b(einkauf\w*|purchas\w+|procurement|head of buying|buyer|rights\s*(?:&|and|und)\s*licens\w+|licens(?:e|ing) manager|lizenz\w*|rechte\w*)\b/i],
  ["ceo", /\b(ceo|chief executive|vorstandsvorsitzende[rn]?|gesch[aä]ftsf[uü]hrer(?:in)?|general manager|president|praesident|präsident)\b/i],
  ["owner", /\b(inhaber(?:in)?|owner|founder|co-?founder|gr[uü]nder(?:in)?|eigent[uü]mer(?:in)?|proprietor)\b/i],
  ["md", /\b(managing director|gesch[aä]ftsleitung|verlagsleit\w*|verleger(?:in)?|publisher|publishing director|director|vorstand|programmleit\w*|head of)\b/i],
  ["decision", /\b(editor[- ]in[- ]chief|chefredakt\w+|chief \w+ officer|c[a-z]o|leiter(?:in)?|leitung|manager)\b/i],
];

export function roleOf(text: string): Role | null {
  for (const [role, re] of PATTERNS) if (re.test(text)) return role;
  return null;
}

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
  eq(roleOf("Author / IP Owner"), "owner", "owner in title");
  eq(roleOf("Sales representative"), null, "non decision");
  return "roles ok (7 checks)";
}
