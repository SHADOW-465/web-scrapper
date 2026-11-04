import { denied, hasAccess } from "@/lib/access";
import { aiWebsiteCandidates, fetchPage, lookupCompany, publicResult, resolveHardCases, type CompanyInput, type CompanyResult, type WebsiteSearch } from "@/lib/company";
import { AiQuotaError, aiEnabled, searchEnabled, takeUsage } from "@/lib/groq";
import { ndjson } from "@/lib/ndjson";
import { safeMessage } from "@/lib/redact";

export const runtime = "nodejs";
export const maxDuration = 90; // a batch must finish well inside this; the client sends the rest in the next call

const BATCH = 12;      // companies per call
const PARALLEL = 6;    // companies looked up at once
const BUDGET_MS = 50_000;   // start no new company after this
const HARD_MS = 70_000;     // no page fetch starts after this; such companies are sent back as pending

interface Body {
  companies?: Array<{ id?: unknown; name?: unknown; country?: unknown; website?: unknown; profileUrl?: unknown }>;
  fairHost?: unknown;   // the marketplace's own host, never treated as a company website
  useAi?: unknown;
  aiSearch?: unknown;   // how many AI web searches this batch may spend (0-3); the browser keeps the run's budget
}

/**
 * POST { companies:[{id,name,country?,website?,profileUrl?}], fairHost?, useAi? } -> NDJSON:
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
      profileUrl: typeof c.profileUrl === "string" && /^https?:\/\//i.test(c.profileUrl) ? c.profileUrl.slice(0, 500) : undefined,
    }))
    .filter((c) => c.id && c.name)
    .slice(0, BATCH);
  if (!companies.length) return Response.json({ error: "no_companies", message: "No companies were sent." }, { status: 400 });
  const fairHost = typeof body.fairHost === "string" ? body.fairHost.slice(0, 120) : undefined;
  const useAi = body.useAi !== false && aiEnabled();
  let searchesLeft = useAi ? Math.max(0, Math.min(3, Number(body.aiSearch) || 0)) : 0;

  return ndjson(async (emit, signal) => {
    const deadline = Date.now() + BUDGET_MS;
    let quota: string | undefined;
    let quotaScope: "day" | "minute" | undefined;
    let searchesUsed = 0;
    // AI web search, one at a time (8K tokens/min on the free tier), only while budget, time and quota allow.
    let searchLock: Promise<unknown> = Promise.resolve();
    // Companies whose website search was wanted but not done (no budget, a limit, out of time): queued for later.
    const searchSkipped = new Set<string>();
    const search: WebsiteSearch | undefined = searchEnabled()
      ? (name, country) => {
          const next = searchLock.then(async () => {
            if (!useAi || searchesLeft <= 0 || (quota && quotaScope === "day") || Date.now() > deadline - 15_000) {
              searchSkipped.add(name);
              return [];
            }
            searchesLeft--;
            searchesUsed++;
            try {
              return await aiWebsiteCandidates(name, country);
            } catch (e) {
              if (e instanceof AiQuotaError) {
                quota = e.message;
                quotaScope = e.scope;
                searchSkipped.add(name);
              } else emit({ type: "notice", message: `AI web search failed: ${safeMessage(e)}` });
              return [];
            }
          });
          searchLock = next.catch(() => undefined);
          return next;
        }
      : undefined;
    const queue = [...companies];
    const done: CompanyResult[] = [];
    const hardStop = Date.now() + HARD_MS;
    const late: CompanyInput[] = [];
    await Promise.all(
      Array.from({ length: PARALLEL }, async () => {
        while (queue.length && Date.now() < deadline && !signal.aborted) {
          const c = queue.shift()!;
          let cut = false;
          // Past the hard stop no new page is fetched, so the call ends inside the function limit.
          const fetcher = (u: string, cap?: number) => {
            if (Date.now() > hardStop || signal.aborted) {
              cut = true;
              return Promise.resolve(null);
            }
            return fetchPage(u, cap);
          };
          try {
            const r = await lookupCompany(c, fetcher, fairHost, search);
            if (cut) late.push(c); // incomplete: not "nothing found", just not finished
            else {
              done.push(r);
              emit({ type: "company", ...publicResult(r) });
            }
          } catch (e) {
            emit({ type: "company", id: c.id, name: c.name, people: [], pages: [], notes: [`Lookup failed: ${safeMessage(e)}`] });
          }
        }
      }),
    );
    queue.unshift(...late);

    // Hard cases: AI reads names where code found a role but no clear name (10 companies per request).
    const namesRead = new Set<string>();
    if (useAi && !(quota && quotaScope === "day") && Date.now() < deadline + 10_000) {
      try {
        const before = done.map((d) => d.people.length);
        await resolveHardCases(done, (ids) => ids.forEach((id) => namesRead.add(id)));
        done.forEach((d, i) => {
          if (d.people.length > before[i]) emit({ type: "company", ...publicResult(d) }); // the updated row replaces the earlier one
        });
      } catch (e) {
        if (e instanceof AiQuotaError) {
          quota = e.message; // shown to the user, not hidden
          quotaScope = e.scope;
        } else emit({ type: "notice", message: `AI step skipped: ${safeMessage(e)}` });
      }
    }
    // What AI still has to do, per company: sent so the browser can queue it for when the limits allow.
    if (aiEnabled()) {
      for (const d of done) {
        const needs: Array<"search" | "names"> = [];
        if (!d.website && searchSkipped.has(d.name)) needs.push("search");
        if (!d.people.length && d._hard?.length && !namesRead.has(d.id)) needs.push("names");
        if (needs.length) emit({ type: "company", ...publicResult(d), needsAi: needs });
      }
    }
    emit({ type: "ai", enabled: aiEnabled(), quotaMessage: quota, quotaScope, searches: searchesUsed, ...takeUsage() });
    emit({ type: "done", pending: queue.map((c) => c.id) });
  });
}
