import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { useSession } from "../context/Session";
import type { Lead, Project } from "../lib/types";

function normalizePhone(raw: string): string | null {
  const s = raw.trim();
  const d = s.replace(/\D/g, "");
  if (!d) return null;
  if (s.startsWith("+")) return "+" + d;
  if (d.length === 10) return "+91" + d;
  if (d.length === 11 && d.startsWith("0")) return "+91" + d.slice(1);
  if (d.length === 12 && d.startsWith("91")) return "+" + d;
  return "+" + d;
}

interface Props { projects: Project[]; selfId: string; onClose: () => void; onCreated: (lead: Lead) => void }

export default function AddLeadModal({ projects, selfId, onClose, onCreated }: Props) {
  const { current, isAdmin } = useSession();
  const [f, setF] = useState({ name: "", phone: "", email: "", city: "", budget: "", message: "", project_id: "", source_detail: "Walk-in" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.phone && !f.email) return setError("Add a phone number or email");
    setBusy(true); setError("");
    const { data, error } = await supabase.from("leads").insert({
      workspace_id: current!.id,
      source: "manual",
      source_detail: f.source_detail || null,
      name: f.name || null,
      phone: normalizePhone(f.phone),
      email: f.email ? f.email.toLowerCase() : null,
      city: f.city || null,
      budget: f.budget || null,
      message: f.message || null,
      project_id: f.project_id || null,
      // agents only see their own leads, so keep manual entries with them
      assigned_to: isAdmin ? null : selfId,
    }).select("*").single();
    setBusy(false);
    if (error) return setError(error.message);
    onCreated(data as Lead);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal card" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Add a lead</h2>
        <div className="field-grid">
          <label>Name<input value={f.name} onChange={set("name")} autoFocus /></label>
          <label>Phone<input value={f.phone} onChange={set("phone")} inputMode="tel" placeholder="98xxxxxxxx" /></label>
          <label>Email<input type="email" value={f.email} onChange={set("email")} /></label>
          <label>City<input value={f.city} onChange={set("city")} /></label>
          <label>Budget<input value={f.budget} onChange={set("budget")} placeholder="e.g. 80L to 1Cr" /></label>
          <label>Came from
            <select value={f.source_detail} onChange={set("source_detail")}>
              {["Walk-in", "Referral", "Channel partner", "Hoarding / print", "Event", "Other"].map((o) => <option key={o}>{o}</option>)}
            </select>
          </label>
          {projects.length > 0 && (
            <label>Project
              <select value={f.project_id} onChange={set("project_id")}>
                <option value="">—</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
        </div>
        <label>Notes<textarea rows={3} value={f.message} onChange={set("message")} /></label>
        {error && <div className="notice error">{error}</div>}
        <div className="row gap end">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? "Saving…" : "Save lead"}</button>
        </div>
      </form>
    </div>
  );
}
