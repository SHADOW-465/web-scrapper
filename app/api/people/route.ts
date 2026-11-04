import { denied, hasAccess } from "@/lib/access";
import { lookupCompany, publicResult, resolveHardCases, type CompanyInput, type CompanyResult } from "@/lib/company";
import { AiQuotaError, aiEnabled, takeUsage } from "@/lib/groq";
import { ndjson } from "@/lib/ndjson";
import { safeMessage } from "@/lib/redact";

export const runtime = "nodejs";
export const maxDuration = 90; // a batch must finish well inside this; the client sends the rest in the next call

const BATCH = 12;      // companies per call
const PARALLEL = 6;    // companies looked up at once
const BUDGET_MS = 55_000;

interface Body {
  companies?: Array<{ id?: unknown; name?: unknown; country?: unknown; website?: unknown }>;
  fairHost?: unknown;   // the marketplace's own host, never treated as a company website
  useAi?: unknown;
}

/**
 * POST { companies:[{id,name,country?,website?}], fairHost?, useAi? } -> NDJSON:
 *   `company` per company as it finishes, an `ai` usage event, then `done` { pending: ids not reached in time }.
 */
export async function POST(req: Request) {
  if (!hasAccess(req)) return denied();
  const body = (await req.json().catch(() => ({}))) as Body;
  const companies: CompanyInput[] = (body.companies ?? [])
    .map((c) => ({
      id: String(c.id ?? ""),
      name: String(c.name ?? "").trim().slice(0, 160),
      country: typeof c.country === "string" ? c.country.slice(0, 60) : undefined,
      website: typeof c.website === "string" ? c.website.slice(0, 300) : undefined,
    }))
    .filter((c) => c.id && c.name)
    .slice(0, BATCH);
  if (!companies.length) return Response.json({ error: "no_companies", message: "No companies were sent." }, { status: 400 });
  const fairHost = typeof body.fairHost === "string" ? body.fairHost.slice(0, 120) : undefined;
  const useAi = body.useAi !== false && aiEnabled();

  return ndjson(async (emit, signal) => {
    const deadline = Date.now() + BUDGET_MS;
    const queue = [...companies];
    const done: CompanyResult[] = [];
    await Promise.all(
      Array.from({ length: PARALLEL }, async () => {
        while (queue.length && Date.now() < deadline && !signal.aborted) {
          const c = queue.shift()!;
          try {
            const r = await lookupCompany(c, undefined, fairHost);
            done.push(r);
            emit({ type: "company", ...publicResult(r) });
          } catch (e) {
            emit({ type: "company", id: c.id, name: c.name, people: [], pages: [], notes: [`Lookup failed: ${safeMessage(e)}`] });
          }
        }
      }),
    );

    // Hard cases: one Groq request for the companies where code found a role but no clear name.
    let quota: string | undefined;
    if (useAi && Date.now() < deadline + 10_000) {
      try {
        const before = done.map((d) => d.people.length);
        await resolveHardCases(done);
        done.forEach((d, i) => {
          if (d.people.length > before[i]) emit({ type: "company", ...publicResult(d) }); // the updated row replaces the earlier one
        });
      } catch (e) {
        if (e instanceof AiQuotaError) quota = e.message; // shown to the user, not hidden
        else emit({ type: "notice", message: `AI step skipped: ${safeMessage(e)}` });
      }
    }
    emit({ type: "ai", enabled: aiEnabled(), quotaMessage: quota, ...takeUsage() });
    emit({ type: "done", pending: queue.map((c) => c.id) });
  });
}
