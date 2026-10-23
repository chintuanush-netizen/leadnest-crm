import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { useSession } from "../context/Session";
import { memberName } from "../lib/format";
import type { Lead, Project } from "../lib/types";
import { AiError, askLeads, leadsTable, type Turn } from "../lib/ai";
import { useAiAvailable } from "../components/AiPanels";

const MAX_LEADS = 400;
const SUGGESTIONS = [
  "Which new leads haven't been contacted yet?",
  "Who should we call first today, and why?",
  "How many leads came from each source this week?",
  "Which site visits are coming up?",
  "Summarise today's leads in 3 lines",
  "Which leads have a budget above 1 crore?",
];

export default function AskPage() {
  const { current, members } = useSession();
  const wsId = current!.id;
  const ai = useAiAvailable();
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ctl = useRef<AbortController | null>(null);
  const liveRef = useRef("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.from("leads").select("*").eq("workspace_id", wsId).order("created_at", { ascending: false }).range(0, MAX_LEADS - 1)
      .then(({ data }) => setLeads((data ?? []) as Lead[]));
    supabase.from("projects").select("id, name, location").eq("workspace_id", wsId).order("name")
      .then(({ data }) => setProjects((data ?? []) as Project[]));
    return () => ctl.current?.abort();
  }, [wsId]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [turns, live]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy || !leads) return;
    const next: Turn[] = [...turns, { role: "user" as const, content: q }].slice(-12);
    if (next[0].role !== "user") next.shift();
    setTurns(next); setDraft(""); setErr(""); setLive(""); liveRef.current = ""; setBusy(true);
    const c = new AbortController(); ctl.current = c;
    const pName = new Map(projects.map((p) => [p.id, p.name]));
    const mById = new Map(members.map((m) => [m.user_id, m]));
    const table = leadsTable(leads, (id) => (id ? pName.get(id) ?? "" : ""), (id) => (id ? memberName(mById.get(id)) : "Unassigned"));
    try {
      const answer = await askLeads(next, table, leads.length, { wsId, signal: c.signal, onText: (t) => { liveRef.current = t; setLive(t); } });
      setTurns([...next, { role: "assistant", content: answer.trim() }]);
    } catch (e) {
      if (e instanceof AiError && e.code === "cancelled") {
        if (liveRef.current) setTurns([...next, { role: "assistant", content: liveRef.current + " …(stopped)" }]);
      } else setErr(e instanceof AiError ? e.message : "AI request failed. Try again.");
    }
    setLive(""); setBusy(false);
  }

  function submit(e: FormEvent) { e.preventDefault(); send(draft); }

  return (
    <div className="page narrow-page ask-page">
      <header className="page-head">
        <div>
          <h1><span className="ai-mark">✦</span> Ask AI</h1>
          <p className="muted">Ask anything about your leads in plain words. {leads ? `Looking at your latest ${leads.length} lead${leads.length === 1 ? "" : "s"}.` : "Loading leads…"}</p>
        </div>
        {turns.length > 0 && !busy && <button className="btn ghost" onClick={() => { setTurns([]); setErr(""); }}>New chat</button>}
      </header>

      {ai === false && <div className="notice warn">AI works when this demo is opened inside Claude.</div>}

      <div className="chat">
        {turns.length === 0 && !busy && (
          <div className="suggest-grid">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="suggest" onClick={() => send(s)} disabled={!leads || ai === false}>{s}</button>
            ))}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`msg ${t.role}`}>{t.role === "assistant" ? <Rich text={t.content} /> : t.content}</div>
        ))}
        {busy && <div className="msg assistant">{live ? <Rich text={live} /> : <span className="muted">Thinking…</span>}</div>}
        {err && <div className="notice error">{err}</div>}
        <div ref={endRef} />
      </div>

      <form className="ask-bar" onSubmit={submit}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. Which Meta leads from today are still not called?"
          disabled={ai === false} aria-label="Ask about your leads" />
        {busy
          ? <button type="button" className="btn" onClick={() => ctl.current?.abort()}>Stop</button>
          : <button className="btn primary" disabled={!draft.trim() || !leads || ai === false}>Ask</button>}
      </form>
    </div>
  );
}

/** Minimal formatting for answers: paragraphs, "- " bullets, **bold**. */
function Rich({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={blocks.length}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
    list = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const m = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (m) { list.push(m[1]); continue; }
    flush();
    if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line.replace(/^#+\s*/, ""))}</p>);
  }
  flush();
  return <>{blocks}</>;
}

function inline(s: string): ReactNode {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <b key={i}>{part.slice(2, -2)}</b> : <Fragment key={i}>{part}</Fragment>);
}
