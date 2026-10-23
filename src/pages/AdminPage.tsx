import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { planState } from "../lib/plan";
import { timeAgo } from "../lib/format";
import type { Workspace } from "../lib/types";

interface Row {
  id: string; name: string; created_at: string; plan: string; trial_ends_at: string; paid_until: string | null;
  owner_email: string | null; members: number; leads: number; leads_7d: number; last_lead: string | null; sources: number;
}

const addDays = (from: Date, n: number) => new Date(from.getTime() + n * 864e5).toISOString();
const addMonths = (from: Date, n: number) => { const d = new Date(from); d.setMonth(d.getMonth() + n); return d.toISOString(); };

/** Leadnest staff only (platform_admins): every client workspace, its usage and plan controls. */
export default function AdminPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("admin_overview");
    if (error) setError(error.message);
    setRows((data ?? []) as Row[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function setPlan(r: Row, plan: string, trial: string | null, paid: string | null) {
    setBusy(r.id); setError("");
    const { error } = await supabase.rpc("admin_set_plan", { p_workspace: r.id, p_plan: plan, p_trial_ends_at: trial, p_paid_until: paid });
    if (error) setError(error.message);
    await load(); setBusy(null);
  }
  const extendTrial = (r: Row) => setPlan(r, "trial", addDays(new Date(Math.max(Date.now(), Date.parse(r.trial_ends_at))), 14), null);
  const activate = (r: Row, months: number) => {
    const base = r.plan === "active" && r.paid_until && Date.parse(r.paid_until) > Date.now() ? new Date(r.paid_until) : new Date();
    setPlan(r, "active", null, addMonths(base, months));
  };
  const suspend = (r: Row) => { if (confirm(`Pause ${r.name}? Their team loses access; leads keep coming in.`)) setPlan(r, "suspended", null, r.paid_until); };
  const resume = (r: Row) => setPlan(r, r.paid_until ? "active" : "trial", null, r.paid_until);

  const shown = useMemo(() => (rows ?? []).filter((r) => !q || `${r.name} ${r.owner_email ?? ""}`.toLowerCase().includes(q.toLowerCase())), [rows, q]);
  const totals = useMemo(() => {
    const all = rows ?? [];
    const st = all.map((r) => planState(r as unknown as Workspace));
    return {
      clients: all.length,
      paying: all.filter((r) => r.plan === "active").length,
      trials: all.filter((r, i) => r.plan === "trial" && !st[i].locked).length,
      leads7: all.reduce((n, r) => n + Number(r.leads_7d), 0),
    };
  }, [rows]);

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Admin</h1><p className="muted">Every client on Leadnest CRM. Only Leadnest staff can see this page.</p></div>
        <input className="search" placeholder="Search client or email" value={q} onChange={(e) => setQ(e.target.value)} />
      </header>

      <section className="stats">
        <div className="stat"><span className="stat-value">{totals.clients}</span><span className="stat-label">Client workspaces</span></div>
        <div className="stat"><span className="stat-value">{totals.paying}</span><span className="stat-label">Paying</span></div>
        <div className="stat"><span className="stat-value">{totals.trials}</span><span className="stat-label">On free trial</span></div>
        <div className="stat"><span className="stat-value">{totals.leads7.toLocaleString("en-IN")}</span><span className="stat-label">Leads, last 7 days</span></div>
      </section>

      {error && <div className="notice error">{error}</div>}
      <section className="card flush admin-table-wrap">
        {!rows ? <div className="empty"><div className="spinner" /></div> : (
          <table className="admin-table">
            <thead><tr><th>Client</th><th>Plan</th><th>Leads</th><th>Last lead</th><th>Sources</th><th>Team</th><th>Actions</th></tr></thead>
            <tbody>
              {shown.map((r) => {
                const st = planState(r as unknown as Workspace);
                return (
                  <tr key={r.id}>
                    <td><b>{r.name}</b><div className="muted small">{r.owner_email ?? "no owner"} · joined {new Date(r.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</div></td>
                    <td><span className={`pill ${st.tone === "ok" ? "green" : st.tone === "warn" ? "amber" : "red"}`}>{st.label}</span></td>
                    <td>{Number(r.leads).toLocaleString("en-IN")}<div className="muted small">{r.leads_7d} this week</div></td>
                    <td className="small">{r.last_lead ? timeAgo(r.last_lead) : <span className="muted">none yet</span>}</td>
                    <td>{r.sources}</td>
                    <td>{r.members}</td>
                    <td>
                      <div className="row gap wrap">
                        {r.plan !== "active" && r.plan !== "suspended" && <button className="btn small" disabled={busy === r.id} onClick={() => extendTrial(r)}>+14 days trial</button>}
                        {r.plan !== "suspended" && (
                          <select className="small-select" value="" disabled={busy === r.id} onChange={(e) => e.target.value && activate(r, Number(e.target.value))}>
                            <option value="">{r.plan === "active" ? "Extend plan…" : "Activate plan…"}</option>
                            <option value="1">1 month</option><option value="3">3 months</option>
                            <option value="6">6 months</option><option value="12">12 months</option>
                          </select>
                        )}
                        {r.plan === "suspended"
                          ? <button className="btn small" disabled={busy === r.id} onClick={() => resume(r)}>Resume</button>
                          : <button className="link small danger" disabled={busy === r.id} onClick={() => suspend(r)}>Pause</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!shown.length && <tr><td colSpan={7} className="muted center pad">No clients match.</td></tr>}
            </tbody>
          </table>
        )}
      </section>
      <p className="muted small">Paused or expired workspaces see a renewal screen; their lead sources keep collecting. Client leads stay private: open a client's leads only if they invite you to their workspace.</p>
    </div>
  );
}
