"use client";

import { AlertTriangle, ArrowUp, Check, Download, Loader2, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface ChatAction { id: string; label: string; primary?: boolean; disabled?: boolean }
export interface ChatChip { label: string; hint: string }
export interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  text: string;
  tone?: "ok" | "warn" | "err";
  chips?: ChatChip[];
  actions?: ChatAction[];
  busy?: boolean;
  progress?: { done: number; of: number | null };
}

const EXAMPLES = [
  "https://event.buchmesse.de/marketplace/exhibitors?pageNumber=1&limit=36\nCompany, CEO name, email, LinkedIn, booth number",
  "https://event.buchmesse.de/marketplace/exhibitors?pageNumber=1&limit=36\nFirma, Geschäftsführer, E-Mail, Halle und Stand, nur aus Deutschland, die ersten 50",
];

function Thread({ messages, onAction }: { messages: ChatMsg[]; onAction: (id: string) => void }) {
  const end = useRef<HTMLDivElement>(null);
  const last = messages[messages.length - 1];
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages.length, last?.text, last?.progress?.done]);
  return (
    <div className="thread" role="log" aria-live="polite" aria-label="Conversation">
      {messages.map((m) => (
        <div key={m.id} className={`msg ${m.role}${m.tone ? ` ${m.tone}` : ""}`}>
          {m.role === "assistant" && (
            <span className="avatar" aria-hidden="true">
              {m.busy ? <Loader2 size={14} className="spin" /> : m.tone === "err" ? <AlertTriangle size={14} /> : m.tone === "ok" ? <Check size={14} /> : <Sparkles size={14} />}
            </span>
          )}
          <div className="bubble">
            {m.text.split("\n").map((line, i) => (line ? <p key={i}>{line}</p> : <br key={i} />))}
            {m.progress && (
              <div className={`meter${m.progress.of ? "" : " indeterminate"}`} aria-hidden="true">
                <i style={{ transform: `scaleX(${m.progress.of ? Math.min(1, m.progress.done / m.progress.of) : 0})` }} />
              </div>
            )}
            {m.chips && m.chips.length > 0 && (
              <ul className="chips" aria-label="Columns in your export">
                {m.chips.map((c) => <li key={c.label} title={c.hint}><b>{c.label}</b><span>{c.hint}</span></li>)}
              </ul>
            )}
            {m.actions && m.actions.length > 0 && (
              <div className="msg-actions">
                {m.actions.map((a) => (
                  <button key={a.id} type="button" className={`btn btn-sm ${a.primary ? "btn-primary" : "btn-quiet"}`} disabled={a.disabled} onClick={() => onAction(a.id)}>
                    {a.id.startsWith("export") || a.id.startsWith("download") ? <Download size={13} aria-hidden="true" /> : null}{a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
      <div ref={end} />
    </div>
  );
}

export function Composer({ onSend, disabled, placeholder, big, autoFocus, initial = "" }: {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder: string;
  big?: boolean;
  autoFocus?: boolean;
  initial?: string;
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(big ? 240 : 160, el.scrollHeight)}px`;
  }, [text, big]);
  const send = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText("");
  };
  return (
    <form className={`composer${big ? " big" : ""}`} onSubmit={(e) => { e.preventDefault(); send(); }}>
      <label className="visually-hidden" htmlFor={big ? "ask-home" : "ask"}>Your request</label>
      <textarea
        id={big ? "ask-home" : "ask"} ref={ref} value={text} rows={big ? 3 : 2} placeholder={placeholder} autoFocus={autoFocus} spellCheck
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
      />
      <button type="submit" className="send" disabled={disabled || !text.trim()} aria-label="Send">
        {disabled ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <ArrowUp size={16} aria-hidden="true" />}
      </button>
    </form>
  );
}

/** The home screen: a conversation that starts with a link and what she needs. */
export function ChatHome({ messages, onSend, onAction, busy, children }: {
  messages: ChatMsg[];
  onSend: (text: string) => void;
  onAction: (id: string) => void;
  busy: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="chathome">
      <div className="chathome-inner">
        {!messages.length && (
          <header className="chathome-head">
            <h1>Which site, and what do you need?</h1>
            <p>Paste a directory link and say what your export should contain, the way you&rsquo;d tell a colleague. I&rsquo;ll read the site, look up each company&rsquo;s decision-makers if you ask for them, and give you the file.</p>
          </header>
        )}
        {children}
        {messages.length > 0 && <Thread messages={messages} onAction={onAction} />}
        <Composer big autoFocus onSend={onSend} disabled={busy}
          placeholder={"https://… exhibitor list\nCompany, CEO name, email, LinkedIn, booth number"} />
        {!messages.length && (
          <div className="chat-examples">
            <span>Try</span>
            {EXAMPLES.map((e) => (
              <button key={e} type="button" className="example" onClick={() => onSend(e)}>
                {e.split("\n")[1]}
                <small>{new URL(e.split("\n")[0]).hostname}</small>
              </button>
            ))}
          </div>
        )}
        <p className="chat-fine">Only information published on the pages read is used; an empty cell means it wasn&rsquo;t found. Check a site&rsquo;s terms before taking large amounts of its data.</p>
      </div>
    </div>
  );
}

/** The conversation in the side panel, once a site is open. */
export function ChatPanel({ messages, onSend, onAction, busy }: {
  messages: ChatMsg[];
  onSend: (text: string) => void;
  onAction: (id: string) => void;
  busy: boolean;
}) {
  return (
    <section className="section chatpanel" aria-label="Your request">
      <div className="section-head"><h2>Your request</h2></div>
      {messages.length > 0 && <Thread messages={messages} onAction={onAction} />}
      <Composer onSend={onSend} disabled={busy}
        placeholder={messages.some((m) => m.role === "user") ? "Change it: “also add country”, “remove phone”, “only the first 100”…" : "What do you need? e.g. company, CEO name, email, LinkedIn"} />
    </section>
  );
}
