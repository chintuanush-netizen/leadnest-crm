import { useCallback, useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { useSession } from "../context/Session";
import type { Project } from "../lib/types";
import { contactLink, planState } from "../lib/plan";

export default function SettingsPage() {
  const { current, isAdmin, refresh, session } = useSession();
  const ws = current!;
  const [name, setName] = useState(ws.name);
  const [projects, setProjects] = useState<Project[]>([]);
  const [pName, setPName] = useState("");
  const [pLoc, setPLoc] = useState("");
  const [msg, setMsg] = useState("");
  const [myName, setMyName] = useState("");
  const resetMode = new URLSearchParams(window.location.search).has("reset");
  const [pw, setPw] = useState("");
  const [pwMsg, setPwMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(resetMode ? { kind: "ok", text: "Choose a new password for your account." } : null);

  const loadProjects = useCallback(async () => {
    const { data } = await supabase.from("projects").select("id, name, location").eq("workspace_id", ws.id).order("name");
    setProjects((data ?? []) as Project[]);
  }, [ws.id]);
  useEffect(() => { loadProjects(); setName(ws.name); }, [loadProjects, ws.name]);
  useEffect(() => {
    supabase.from("profiles").select("full_name").eq("id", session!.user.id).single()
      .then(({ data }) => setMyName(data?.full_name ?? ""));
  }, [session]);

  function flash(t: string) { setMsg(t); setTimeout(() => setMsg(""), 2000); }

  async function saveWorkspace(e: FormEvent) {
    e.preventDefault();
    await supabase.from("workspaces").update({ name }).eq("id", ws.id);
    await refresh(); flash("Saved");
  }
  async function toggleAuto() {
    await supabase.from("workspaces").update({ auto_assign: !ws.auto_assign }).eq("id", ws.id);
    await refresh();
  }
  async function addProject(e: FormEvent) {
    e.preventDefault();
    if (!pName.trim()) return;
    await supabase.from("projects").insert({ workspace_id: ws.id, name: pName.trim(), location: pLoc.trim() || null });
    setPName(""); setPLoc(""); loadProjects();
  }
  async function removeProject(id: string) {
    if (!confirm("Delete this project? Leads keep their data but lose the project tag.")) return;
    await supabase.from("projects").delete().eq("id", id);
    loadProjects();
  }
  async function saveMyName(e: FormEvent) {
    e.preventDefault();
    await supabase.from("profiles").update({ full_name: myName }).eq("id", session!.user.id);
    flash("Saved");
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return setPwMsg({ kind: "error", text: "Use at least 8 characters." });
    const { error } = await supabase.auth.updateUser({ password: pw });
    setPw("");
    setPwMsg(error ? { kind: "error", text: error.message } : { kind: "ok", text: "Password updated." });
  }
  const plan = planState(ws);

  return (
    <div className="page narrow-page">
      <header className="page-head"><h1>Settings</h1>{msg && <span className="pill green">{msg}</span>}</header>

      <form className="card" onSubmit={saveMyName}>
        <h3>Your profile</h3>
        <div className="row gap">
          <input className="grow" value={myName} onChange={(e) => setMyName(e.target.value)} placeholder="Your name" />
          <button className="btn">Save</button>
        </div>
      </form>

      <form className="card" onSubmit={changePassword}>
        <h3>Password</h3>
        <div className="row gap">
          <input className="grow" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (8+ characters)" autoComplete="new-password" autoFocus={resetMode} />
          <button className="btn">Update</button>
        </div>
        {pwMsg && <div className={`notice ${pwMsg.kind} small`}>{pwMsg.text}</div>}
      </form>

      {isAdmin && (
        <>
          <form className="card" onSubmit={saveWorkspace}>
            <h3>Workspace</h3>
            <div className="row gap">
              <input className="grow" value={name} onChange={(e) => setName(e.target.value)} required />
              <button className="btn">Save</button>
            </div>
            <label className="switch-row">
              <input type="checkbox" checked={ws.auto_assign} onChange={toggleAuto} />
              <span><b>Auto-assign new leads</b><br /><span className="muted small">Round-robin between sales agents. Repeat enquiries go back to the same agent.</span></span>
            </label>
          </form>

          <section className="card">
            <h3>Projects</h3>
            <p className="muted small">Tag leads by project so each sales team sees the right enquiries. Sources can tag leads automatically, and website forms can send a <code>project</code> field.</p>
            {projects.map((p) => (
              <div key={p.id} className="member-row">
                <div className="grow"><b>{p.name}</b>{p.location && <div className="muted small">{p.location}</div>}</div>
                <button className="link danger small" onClick={() => removeProject(p.id)}>Delete</button>
              </div>
            ))}
            <form className="row gap wrap" onSubmit={addProject}>
              <input className="grow" placeholder="Project name" value={pName} onChange={(e) => setPName(e.target.value)} />
              <input className="grow" placeholder="Location (optional)" value={pLoc} onChange={(e) => setPLoc(e.target.value)} />
              <button className="btn">Add project</button>
            </form>
          </section>

          <section className="card">
            <h3>Plan</h3>
            <p className="muted">
              {ws.plan === "trial"
                ? `${plan.label}. Your trial ends on ${new Date(ws.trial_ends_at).toLocaleDateString("en-IN", { dateStyle: "medium" })}.`
                : plan.label + "."}
            </p>
            <a className="btn" href={contactLink(ws, ws.plan === "active" ? "renew or change my plan" : "choose a plan")} target="_blank" rel="noreferrer">
              {ws.plan === "active" ? "Renew or change plan" : "Choose a plan"} on WhatsApp
            </a>
          </section>
        </>
      )}
    </div>
  );
}
