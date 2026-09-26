import { denied, hasAccess } from "@/lib/access";
import { ndjson } from "@/lib/ndjson";
import { PageError, replayPages, type Replay } from "@/lib/replay";
import { open, TokenError } from "@/lib/token";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST { token, startIndex?, maxRows? } -> NDJSON `rows` batches, then one of:
 *   `done`                      every page fetched
 *   `continue` { nextIndex }    time slice used up; call again from nextIndex
 *   `error` { message, nextIndex }  a page failed after retries; retry from nextIndex
 *
 * Each call works for about 25 seconds. Short calls are what make big
 * extractions reliable: a dropped connection costs one slice, not the run.
 */
export async function POST(req: Request) {
  if (!hasAccess(req)) return denied();
  const body = (await req.json().catch(() => ({}))) as { token?: string; startIndex?: number; maxRows?: number };
  let replay: Replay;
  try {
    replay = open<Replay>(String(body.token ?? ""));
  } catch (e) {
    return Response.json({ error: "bad_token", message: e instanceof TokenError ? e.message : "Scan the page again." }, { status: 400 });
  }
  const startIndex = Math.max(0, Math.floor(Number(body.startIndex) || 0));
  const maxRows = body.maxRows && body.maxRows > 0 ? Math.floor(body.maxRows) : undefined;

  return ndjson(async (emit) => {
    const deadline = Date.now() + 25_000;
    let last = { done: false, nextIndex: startIndex };
    try {
      for await (const page of replayPages(replay, { startIndex, maxRows, deadline })) {
        emit({ type: "rows", rows: page.rows, total: page.total, nextIndex: page.nextIndex });
        last = page;
      }
    } catch (e) {
      emit({ type: "error", message: e instanceof Error ? e.message : String(e), nextIndex: e instanceof PageError ? e.index : last.nextIndex });
      return;
    }
    emit(last.done ? { type: "done" } : { type: "continue", nextIndex: last.nextIndex });
  });
}
