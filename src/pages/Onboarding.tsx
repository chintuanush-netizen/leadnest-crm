import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { useSession } from "../context/Session";
import { Logo } from "../components/Layout";

export default function Onboarding() {
  const { refresh, setCurrent } = useSession();
  const [name, setName] = useState("");
  const [project, setProject] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const { data, error } = await supabase.rpc("create_workspace", { p_name: name });
    if (error) { setBusy(false); return setError(error.message); }
    const wsId = data as string;
    if (project.trim()) {
      await supabase.from("projects").insert({ workspace_id: wsId, name: project.trim() });
    }
    setCurrent(wsId);
    await refresh();
    setBusy(false);
  }

  return (
    <div className="center-screen">
      <form className="card narrow" onSubmit={submit}>
        <Logo />
        <h2>Set up your workspace</h2>
        <p className="muted">This is where all your leads will live. You can invite your sales team next.</p>
        <label>Company name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cache Group" required /></label>
        <label>First project <span className="muted">(optional)</span>
          <input value={project} onChange={(e) => setProject(e.target.value)} placeholder="e.g. Aad One, Rajendra Nagar" />
        </label>
        {error && <div className="notice error">{error}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? "Creating…" : "Create workspace"}</button>
        <button type="button" className="link small" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </form>
    </div>
  );
}
