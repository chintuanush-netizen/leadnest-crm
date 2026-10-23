import { useEffect, useRef, useState } from "react";
import type { Lead } from "../lib/types";
import { waLink } from "../lib/format";
import { aiAvailable, AiError, draftWhatsApp, scoreLeads, WA_GOALS, WA_LANGS, type LeadCtx } from "../lib/ai";

export const SCORE_LABEL = { hot: "Hot", warm: "Warm", cold: "Cold" } as const;

export function useAiAvailable() {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => { let alive = true; aiAvailable().then((v) => alive && setOk(v)); return () => { alive = false; }; }, []);
  return ok;
}

export function AiTag({ score }: { score?: Lead["ai_score"] }) {
  if (!score) return null;
  return <span className={`ai-tag ${score}`}>{SCORE_LABEL[score]}</span>;
}

const errText = (e: unknown) => (e instanceof AiError ? e.message : "AI request failed. Try again.");

/** Score + one-line summary + next step, saved on the lead. */
export function AiScoreCard({ lead, ctx, wsId, onSave }: {
  lead: Lead; ctx: LeadCtx; wsId: string; onSave: (patch: Partial<Lead>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function run() {
    setBusy(true); setErr("");
    try {
      const [s] = await scoreLeads([{ lead, ctx }], wsId);
      if (!s) throw new AiError("empty", "AI could not score this lead. Try again.");
      onSave({ ai_score: s.score, ai_summary: s.summary, ai_next_step: s.next_step, ai_scored_at: new Date().toISOString() });
    } catch (e) { setErr(errText(e)); }
    setBusy(false);
  }

  return (
    <section className="ai-card">
      <div className="ai-card-head">
        <span className="ai-mark" aria-hidden>✦</span>
        <b>AI insight</b>
        {lead.ai_score && <AiTag score={lead.ai_score} />}
        <span className="grow" />
        {lead.ai_score && <button className="link small" onClick={run} disabled={busy}>{busy ? "Scoring…" : "Re-score"}</button>}
      </div>
      {lead.ai_score ? (
        <>
          <p className="ai-summary">{lead.ai_summary}</p>
          {lead.ai_next_step && <p className="ai-next"><span className="muted">Next step</span> {lead.ai_next_step}</p>}
        </>
      ) : (
        <div className="row gap wrap">
          <span className="muted small grow">Hot, warm or cold, with a one-line summary and the best next step.</span>
          <button className="btn small" onClick={run} disabled={busy}>{busy ? "Scoring…" : "Score this lead"}</button>
        </div>
      )}
      {err && <div className="notice error small">{err}</div>}
    </section>
  );
}

/** Drafts a WhatsApp message the salesperson can edit and send. */
export function WhatsAppWriter({ lead, ctx, wsId, sender }: { lead: Lead; ctx: LeadCtx; wsId: string; sender: string }) {
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState(lead.status === "new" ? "first" : lead.status === "site_visit_scheduled" ? "reminder" : lead.status === "site_visit_done" ? "thanks" : "visit");
  const [lang, setLang] = useState("English");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const ctl = useRef<AbortController | null>(null);

  useEffect(() => () => ctl.current?.abort(), []);

  async function run() {
    ctl.current?.abort();
    const c = new AbortController(); ctl.current = c;
    setBusy(true); setErr(""); setText("");
    try {
      const out = await draftWhatsApp(lead, ctx, goal, lang, sender, { wsId, signal: c.signal, onText: setText });
      setText(out.trim());
    } catch (e) { if (!(e instanceof AiError && e.code === "cancelled")) setErr(errText(e)); }
    setBusy(false);
  }

  if (!open) {
    return <button className="btn ghost block ai-open" onClick={() => setOpen(true)}><span className="ai-mark">✦</span> Write a WhatsApp message</button>;
  }

  const send = lead.phone ? `${waLink(lead.phone)}?text=${encodeURIComponent(text)}` : "";
  return (
    <section className="ai-card">
      <div className="ai-card-head">
        <span className="ai-mark" aria-hidden>✦</span><b>WhatsApp message</b><span className="grow" />
        <button className="icon-btn" onClick={() => { ctl.current?.abort(); setOpen(false); }} aria-label="Close">✕</button>
      </div>
      <div className="field-grid">
        <label>Purpose
          <select value={goal} onChange={(e) => setGoal(e.target.value)}>
            {WA_GOALS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
        </label>
        <label>Language
          <select value={lang} onChange={(e) => setLang(e.target.value)}>
            {WA_LANGS.map((l) => <option key={l}>{l}</option>)}
          </select>
        </label>
      </div>
      {(text || busy) && (
        <textarea className="wa-draft" rows={6} value={busy && !text ? "Writing…" : text} readOnly={busy} onChange={(e) => setText(e.target.value)} />
      )}
      {err && <div className="notice error small">{err}</div>}
      <div className="row gap wrap">
        {busy ? (
          <button className="btn" onClick={() => ctl.current?.abort()}>Stop</button>
        ) : (
          <button className={`btn ${text ? "" : "primary"}`} onClick={run}>{text ? "Rewrite" : "Write message"}</button>
        )}
        {text && !busy && (
          <>
            <button className="btn" onClick={() => { navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>{copied ? "Copied ✓" : "Copy"}</button>
            {send && <a className="btn primary" href={send} target="_blank" rel="noreferrer">Open in WhatsApp</a>}
          </>
        )}
      </div>
      <p className="muted small ai-foot">Check the message before sending. Anything in [brackets] needs filling in.</p>
    </section>
  );
}
