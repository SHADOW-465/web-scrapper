"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

/** Width the server rendered the page at; the sheet scales it to fit. */
const PAGE_WIDTH = 1280;

export interface SheetHandle {
  post(message: Record<string, unknown>): void;
  window(): Window | null;
}

/**
 * The frozen page. `sandbox="allow-scripts"` without `allow-same-origin`
 * gives it an opaque origin: the snapshot can never touch this app's cookies,
 * storage, or DOM, and its CSP lets only our picker script run.
 */
const Sheet = forwardRef<SheetHandle, { html: string; title: string }>(function Sheet({ html, title }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useImperativeHandle(ref, () => ({
    post(message) {
      frame.current?.contentWindow?.postMessage({ source: "scrape-studio-host", ...message }, "*");
    },
    window: () => frame.current?.contentWindow ?? null,
  }));

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = size.w ? Math.min(1, size.w / PAGE_WIDTH) : 1;

  return (
    <div className="sheet" ref={box}>
      <iframe
        ref={frame}
        title={`Snapshot of ${title || "the page"}`}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={html}
        style={{ width: PAGE_WIDTH, height: size.h ? size.h / scale : "100%", transform: `scale(${scale})` }}
      />
    </div>
  );
});

export default Sheet;
