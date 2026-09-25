import { denied, hasAccess } from "@/lib/access";
import { ndjson } from "@/lib/ndjson";
import { replayPages, type Replay } from "@/lib/replay";
import { open, TokenError } from "@/lib/token";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST { token, startIndex?, maxRows? } -> NDJSON `rows` batches, then
 * `done` or `continue` (with nextIndex) when the time budget runs out.
 * The client chains `continue` calls, so no dataset is too big for one function.
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
    const deadline = Date.now() + (maxDuration - 45) * 1000;
    let last = { done: false, nextIndex: startIndex };
    for await (const page of replayPages(replay, { startIndex, maxRows, deadline })) {
      emit({ type: "rows", rows: page.rows, total: page.total });
      last = page;
    }
    emit(last.done ? { type: "done" } : { type: "continue", nextIndex: last.nextIndex });
  });
}
