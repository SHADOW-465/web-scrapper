/**
 * Newline-delimited JSON streaming.
 *
 * Scans and fetches take seconds to minutes. Streaming lets the UI show real
 * progress, and a streamed response is not subject to the 4.5 MB Vercel
 * Function body limit that a large page snapshot would otherwise hit.
 */
export type Emit = (event: Record<string, unknown>) => void;

export function ndjson(work: (emit: Emit, signal: AbortSignal) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  const stream = new ReadableStream({
    async start(controller) {
      const emit: Emit = (event) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          /* client went away */
        }
      };
      try {
        await work(emit, abort.signal);
      } catch (e) {
        emit({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}

/** Client side: read an NDJSON response, calling `on` per event. */
export async function readNdjson(res: Response, on: (event: Record<string, unknown>) => void): Promise<void> {
  if (!res.body) throw new Error("Empty response");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) on(JSON.parse(line));
    }
  }
  if (buf.trim()) on(JSON.parse(buf));
}
