import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { useSession } from "../context/Session";
import type { Activity, Lead, LeadStatus, Project } from "../lib/types";
import { fmtDateTime, memberName, SOURCES, STATUSES, statusInfo, timeAgo, waLink } from "../lib/format";
import { AiScoreCard, useAiAvailable, WhatsAppWriter } from "./AiPanels";
import { AiError, tidyNote, type LeadCtx, type TidyResult } from "../lib/ai";

interface Props {
  lead: Lead;
  projects: Project[];
  onClose: () => void;
  onChange: (lead: Lead) => void;
  onDelete: (id: string) => void;
}

export default function LeadDrawer({ lead, projects, onClose, onChange, onDelete }: Props) {
  const { members, isAdmin, session } = useSession();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const memberById = new Map(members.map((m) => [m.user_id, m]));
  const ai = useAiAvailable();
  const [tidyBusy, setTidyBusy] = useState(false);
  const [suggest, setSuggest] = useState<TidyResult | null>(null);
  const aiCtx: LeadCtx = {
    project: projects.find((p) => p.id === lead.project_id)?.name,
    owner: lead.assigned_to ? memberName(memberById.get(lead.assigned_to)) : undefined,
    activities,
    describe: (a) => describe(a, memberById),
  };
  const myName = memberName(memberById.get(session!.user.id));

  async function tidy() {
    if (!note.trim()) return;
    setTidyBusy(true); setError(""); setSuggest(null);
    try {
      const r = await tidyNote(note, lead, aiCtx, lead.workspace_id);
      setNote(r.note);
      if (r.status || r.next_follow_up) setSuggest(r);
    } catch (e) { setError(e instanceof AiError ? e.message : "AI request failed. Try again."); }
    setTidyBusy(false);
  }

  function applySuggest() {
    if (!suggest) return;
    const patch: Partial<Lead> = {};
    if (suggest.status) patch.status = suggest.status;
    if (suggest.next_follow_up) patch.next_follow_up = suggest.next_follow_up;
    update(patch);
    setSuggest(null);
  }

  useEffect(() => {
    let alive = true;
    supabase.from("lead_activities").select("*").eq("lead_id", lead.id).order("created_at", { ascending: false })
      .then(({ data }) => { if (alive) setActivities((data ?? []) as Activity[]); });
    const ch = supabase.channel(`activity-${lead.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "lead_activities", filter: `lead_id=eq.${lead.id}` },
        (p) => setActivities((prev) => (prev.some((a) => a.id === (p.new as Activity).id) ? prev : [p.new as Activity, ...prev])))
      .subscribe();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { alive = false; supabase.removeChannel(ch); window.removeEventListener("keydown", onKey); };
  }, [lead.id]);

  async function update(patch: Partial<Lead>) {
    setError("");
    const optimistic = { ...lead, ...patch };
    onChange(optimistic);
    const { error } = await supabase.from("leads").update(patch).eq("id", lead.id);
    if (error) { setError(error.message); onChange(lead); }
  }

  async function addNote(e: FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setSaving(true);
    const { data, error } = await supabase.from("lead_activities").insert({
      lead_id: lead.id, workspace_id: lead.workspace_id, actor_id: session!.user.id, type: "note", body: note.trim(),
    }).select("*").single();
    setSaving(false);
    if (error) return setError(error.message);
    setActivities((prev) => (prev.some((a) => a.id === data.id) ? prev : [data as Activity, ...prev]));
    setNote("");
  }

  async function remove() {
    if (!confirm("Delete this lead permanently?")) return;
    const { error } = await supabase.from("leads").delete().eq("id", lead.id);
    if (error) return setError(error.message);
    onDelete(lead.id);
  }

  const followUpLocal = lead.next_follow_up ? toLocalInput(lead.next_follow_up) : "";
  const extras = Object.entries(lead.extra ?? {}).filter(([k, v]) => !k.startsWith("_") && v !== "" && v != null);
  const metaInfo = (lead.extra?._meta ?? null) as Record<string, string> | null;
  const utm = Object.entries(lead.utm ?? {});

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Lead details">
        <div className="drawer-head">
          <div>
            <h2>{lead.name || "Unknown"}</h2>
            <div className="muted small">
              {SOURCES[lead.source] ?? lead.source}{lead.source_detail ? ` · ${lead.source_detail}` : ""} · {fmtDateTime(lead.created_at)}
            </div>
            {lead.duplicate_of && <div className="notice warn small">This number has enquired before.</div>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {lead.phone && (
          <div className="quick-actions">
            <a className="btn primary" href={`tel:${lead.phone}`}>Call {lead.phone}</a>
            <a className="btn whatsapp" href={waLink(lead.phone)} target="_blank" rel="noreferrer">WhatsApp</a>
          </div>
        )}

        {ai && (
          <>
            <AiScoreCard lead={lead} ctx={aiCtx} wsId={lead.workspace_id} onSave={update} />
            {lead.phone && <WhatsAppWriter key={lead.id} lead={lead} ctx={aiCtx} wsId={lead.workspace_id} sender={myName} />}
          </>
        )}

        <div className="field-grid">
          <label>Status
            <select value={lead.status} onChange={(e) => update({ status: e.target.value as LeadStatus })}>
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label>Owner
            <select value={lead.assigned_to ?? ""} disabled={!isAdmin} onChange={(e) => update({ assigned_to: e.target.value || null })}>
              <option value="">Unassigned</option>
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(m)}</option>)}
            </select>
          </label>
          <label>Project
            <select value={lead.project_id ?? ""} onChange={(e) => update({ project_id: e.target.value || null })}>
              <option value="">—</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label>Next follow-up
            <input type="datetime-local" value={followUpLocal}
              onChange={(e) => update({ next_follow_up: e.target.value ? new Date(e.target.value).toISOString() : null })} />
          </label>
        </div>

        <dl className="details">
          {lead.email && <><dt>Email</dt><dd><a href={`mailto:${lead.email}`}>{lead.email}</a></dd></>}
          {lead.city && <><dt>City</dt><dd>{lead.city}</dd></>}
          {lead.budget && <><dt>Budget</dt><dd>{lead.budget}</dd></>}
          {lead.message && <><dt>Message</dt><dd className="pre">{lead.message}</dd></>}
          {extras.map(([k, v]) => <FragmentRow key={k} k={humanize(k)} v={String(v)} />)}
          {metaInfo?.campaign && <><dt>Campaign</dt><dd>{metaInfo.campaign}</dd></>}
          {metaInfo?.adset && <><dt>Ad set</dt><dd>{metaInfo.adset}</dd></>}
          {metaInfo?.ad && <><dt>Ad</dt><dd>{metaInfo.ad}</dd></>}
          {metaInfo?.form && <><dt>Form</dt><dd>{metaInfo.form}</dd></>}
          {metaInfo?.platform && <><dt>Platform</dt><dd>{metaInfo.platform}</dd></>}
          {utm.map(([k, v]) => <FragmentRow key={k} k={k} v={v} />)}
        </dl>

        {error && <div className="notice error">{error}</div>}

        <h3 className="section-title">Activity</h3>
        <form className="note-form" onSubmit={addNote}>
          <textarea placeholder="Add a note: call outcome, site visit feedback… Rough is fine, AI can tidy it." value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          <div className="row gap">
            {ai && (
              <button type="button" className="btn ghost" onClick={tidy} disabled={tidyBusy || !note.trim()} title="Clean up the note and pick up status / follow-up time">
                <span className="ai-mark">✦</span> {tidyBusy ? "Tidying…" : "Tidy with AI"}
              </button>
            )}
            <button className="btn" disabled={saving || tidyBusy || !note.trim()}>Add note</button>
          </div>
        </form>
        {suggest && (
          <div className="ai-suggest">
            <span><span className="ai-mark">✦</span> Suggested:{" "}
              {suggest.status && <>status <b>{statusInfo(suggest.status).label}</b></>}
              {suggest.status && suggest.next_follow_up && ", "}
              {suggest.next_follow_up && <>follow-up <b>{suggest.follow_up_label || fmtDateTime(suggest.next_follow_up)}</b></>}
            </span>
            <span className="row gap">
              <button className="btn small" onClick={applySuggest}>Apply</button>
              <button className="link small" onClick={() => setSuggest(null)}>Dismiss</button>
            </span>
          </div>
        )}
        <ol className="timeline">
          {activities.map((a) => (
            <li key={a.id} className={`tl-${a.type}`}>
              <div className="tl-body">{describe(a, memberById)}</div>
              <div className="muted small">
                {a.actor_id ? memberName(memberById.get(a.actor_id)) + " · " : ""}{timeAgo(a.created_at)}
              </div>
            </li>
          ))}
        </ol>

        {isAdmin && <button className="link danger small" onClick={remove}>Delete lead</button>}
      </aside>
    </div>
  );
}

function FragmentRow({ k, v }: { k: string; v: string }) {
  return <><dt>{k}</dt><dd>{v}</dd></>;
}

function humanize(k: string) {
  const s = k.replace(/[_-]+/g, " ").replace(/\?$/, "").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function describe(a: Activity, members: Map<string, any>): string {
  switch (a.type) {
    case "status": return `Status: ${statusInfo(String(a.meta.from)).label} → ${statusInfo(String(a.meta.to)).label}`;
    case "assigned": return a.meta.to ? `Assigned to ${memberName(members.get(String(a.meta.to)))}` : "Unassigned";
    case "whatsapp": return `WhatsApp: ${a.body ?? ""}`;
    default: return a.body ?? a.type;
  }
}

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}
