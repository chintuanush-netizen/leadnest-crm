import { useSession } from "../context/Session";
import { supabase } from "../lib/supabase";
import { contactLink, planState } from "../lib/plan";
import { Logo } from "../components/Layout";

/** Shown instead of the app when a workspace's trial or plan has ended. Leads keep arriving meanwhile. */
export default function LockedScreen() {
  const { current, workspaces, setCurrent, isAdmin } = useSession();
  const ws = current!;
  const st = planState(ws);
  const paused = ws.plan === "suspended";
  return (
    <div className="center-screen">
      <div className="card narrow locked">
        <Logo />
        <h2>{paused ? "This account is paused" : st.label}</h2>
        <p className="muted">
          {paused
            ? `${ws.name} has been paused. Contact Leadnest to turn it back on.`
            : `Your access to ${ws.name} has ended. ${isAdmin ? "Choose a plan with Leadnest to continue." : "Ask your account owner to renew the plan."}`}
        </p>
        <div className="notice ok small">Your leads are safe. Every source keeps collecting new enquiries while you renew.</div>
        {isAdmin && <a className="btn primary block" href={contactLink(ws, "renew my plan")} target="_blank" rel="noreferrer">Renew on WhatsApp</a>}
        {workspaces.length > 1 && (
          <label>Switch workspace
            <select value={ws.id} onChange={(e) => setCurrent(e.target.value)}>
              {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
        )}
        <button className="btn ghost block" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    </div>
  );
}
