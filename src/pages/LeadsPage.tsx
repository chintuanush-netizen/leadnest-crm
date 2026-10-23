import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useSession } from "../context/Session";
import type { Lead, Project } from "../lib/types";
import { download, memberName, SOURCES, STATUSES, statusInfo, timeAgo, toCsv } from "../lib/format";
import LeadDrawer from "../components/LeadDrawer";
import { AiTag, useAiAvailable } from "../components/AiPanels";
import { AiError, scoreLeads } from "../lib/ai";
import AddLeadModal from "../components/AddLeadModal";
import ImportModal from "../components/ImportModal";

const PAGE = 100;
type Range = "all" | "today" | "7d" | "30d";

function rangeStart(r: Range): string | null {
  if (r === "all") return null;
  const d = new Date();
  if (r === "today") d.setHours(0, 0, 0, 0);
  else d.setDate(d.getDate() - (r === "7d" ? 7 : 30));
  return d.toISOString();
}

export default function LeadsPage() {
  const { current, members, isAdmin, session } = useSession();
  const wsId = current!.id;

  const [leads, setLeads] = useState<Lead[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState({ today: 0, untouched: 0, visits: 0, booked: 0 });

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [project, setProject] = useState("");
  const [assignee, setAssignee] = useState("");
  const [range, setRange] = useState<Range>("all");

  const filtersRef = useRef({ q, status, source, project, assignee, range });
  filtersRef.current = { q, status, source, project, assignee, range };

  const buildQuery = useCallback(() => {
    let query = supabase.from("leads").select("*").eq("workspace_id", wsId);
    if (status) query = query.eq("status", status);
    if (source) query = query.eq("source", source);
    if (project) query = query.eq("project_id", project);
    if (assignee === "none") query = query.is("assigned_to", null);
    else if (assignee) query = query.eq("assigned_to", assignee);
    const start = rangeStart(range);
    if (start) query = query.gte("created_at", start);
    const term = q.trim().replace(/[,()]/g, " ");
    if (term) query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`);
    return query.order("created_at", { ascending: false });
  }, [wsId, q, status, source, project, assignee, range]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await buildQuery().range(0, PAGE - 1);
    setLeads((data ?? []) as Lead[]);
    setHasMore((data?.length ?? 0) === PAGE);
    setLoading(false);
  }, [buildQuery]);

  async function loadMore() {
    const { data } = await buildQuery().range(leads.length, leads.length + PAGE - 1);
    setLeads((prev) => [...prev, ...((data ?? []) as Lead[])]);
    setHasMore((data?.length ?? 0) === PAGE);
  }

  const loadStats = useCallback(async () => {
    const today = rangeStart("today")!;
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const count = (f: (qb: any) => any) =>
      f(supabase.from("leads").select("id", { count: "exact", head: true }).eq("workspace_id", wsId))
        .then((r: { count: number | null }) => r.count ?? 0);
    const [t, u, v, b] = await Promise.all([
      count((x) => x.gte("created_at", today)),
      count((x) => x.eq("status", "new")),
      count((x) => x.eq("status", "site_visit_scheduled")),
      count((x) => x.eq("status", "booked").gte("updated_at", monthStart.toISOString())),
    ]);
    setStats({ today: t, untouched: u, visits: v, booked: b });
  }, [wsId]);

  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load]);
  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => {
    supabase.from("projects").select("id, name, location").eq("workspace_id", wsId).order("name")
      .then(({ data }) => setProjects((data ?? []) as Project[]));
  }, [wsId]);

  // Live updates
  useEffect(() => {
    const channel = supabase.channel(`leads-${wsId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "leads", filter: `workspace_id=eq.${wsId}` },
        (payload) => {
          const lead = payload.new as Lead;
          const f = filtersRef.current;
          const matches = (!f.status || f.status === lead.status) && (!f.source || f.source === lead.source) &&
            (!f.project || f.project === lead.project_id) && !f.q;
          if (matches) setLeads((prev) => (prev.some((l) => l.id === lead.id) ? prev : [lead, ...prev]));
          setFresh((s) => new Set(s).add(lead.id));
          setTimeout(() => setFresh((s) => { const n = new Set(s); n.delete(lead.id); return n; }), 8000);
          notify(lead);
          loadStats();
        })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "leads", filter: `workspace_id=eq.${wsId}` },
        (payload) => {
          const lead = payload.new as Lead;
          setLeads((prev) => prev.map((l) => (l.id === lead.id ? lead : l)));
          loadStats();
        })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "leads" },
        (payload) => setLeads((prev) => prev.filter((l) => l.id !== (payload.old as Lead).id)))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [wsId, loadStats]);

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  }, []);

  const projectName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const memberById = useMemo(() => new Map(members.map((m) => [m.user_id, m])), [members]);
  const selectedLead = leads.find((l) => l.id === selected) ?? null;

  const ai = useAiAvailable();
  const [scoring, setScoring] = useState(false);
  const [aiMsg, setAiMsg] = useState("");
  const toScore = leads.filter((l) => !l.ai_score && !["junk", "lost", "booked"].includes(l.status)).slice(0, 20);

  async function scoreNew() {
    if (!toScore.length) return;
    setScoring(true); setAiMsg("");
    try {
      const items = toScore.map((lead) => ({
        lead,
        ctx: { project: lead.project_id ? projectName.get(lead.project_id) : undefined,
               owner: lead.assigned_to ? memberName(memberById.get(lead.assigned_to)) : undefined },
      }));
      const scores = await scoreLeads(items, wsId);
      const at = new Date().toISOString();
      await Promise.all(scores.map((s) => supabase.from("leads")
        .update({ ai_score: s.score, ai_summary: s.summary, ai_next_step: s.next_step, ai_scored_at: at }).eq("id", s.id)));
      const byId = new Map(scores.map((s) => [s.id, s]));
      setLeads((prev) => prev.map((l) => {
        const s = byId.get(l.id);
        return s ? { ...l, ai_score: s.score, ai_summary: s.summary, ai_next_step: s.next_step, ai_scored_at: at } : l;
      }));
      const hot = scores.filter((s) => s.score === "hot").length;
      setAiMsg(`Scored ${scores.length} lead${scores.length === 1 ? "" : "s"}: ${hot} hot.`);
    } catch (e) {
      setAiMsg(e instanceof AiError ? e.message : "AI request failed. Try again.");
    }
    setScoring(false);
  }

  function exportCsv() {
    const rows = leads.map((l) => ({
      created_at: l.created_at, name: l.name, phone: l.phone, email: l.email, city: l.city,
      budget: l.budget, project: l.project_id ? projectName.get(l.project_id) : "",
      source: SOURCES[l.source] ?? l.source, source_detail: l.source_detail,
      status: statusInfo(l.status).label, ai_score: l.ai_score ?? "", ai_next_step: l.ai_next_step ?? "", assigned_to: memberName(memberById.get(l.assigned_to ?? "")),
      repeat_enquiry: l.duplicate_of ? "yes" : "", message: l.message,
      utm_source: l.utm?.utm_source, utm_campaign: l.utm?.utm_campaign,
    }));
    download(`leads-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
  }

  const filtersActive = q || status || source || project || assignee || range !== "all";

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Leads</h1>
          <p className="muted"><span className="live-dot" /> Live. New leads appear here instantly.</p>
        </div>
        <div className="row gap">
          {ai && (
            <button className="btn ghost" onClick={scoreNew} disabled={scoring || !toScore.length}
              title={toScore.length ? `Score ${toScore.length} unscored lead(s) on screen` : "Every lead on screen is scored"}>
              <span className="ai-mark">✦</span> {scoring ? "Scoring…" : toScore.length ? `AI score ${toScore.length} lead${toScore.length === 1 ? "" : "s"}` : "All scored"}
            </button>
          )}
          {isAdmin && <button className="btn ghost" onClick={() => setImporting(true)}>Import</button>}
          <button className="btn ghost" onClick={exportCsv} disabled={!leads.length}>Export CSV</button>
          <button className="btn primary" onClick={() => setAdding(true)}>+ Add lead</button>
        </div>
      </header>

      {aiMsg && <div className="notice ai-note small"><span className="ai-mark">✦</span> {aiMsg}</div>}

      <section className="stats">
        <Stat label="Leads today" value={stats.today} onClick={() => { setRange("today"); setStatus(""); }} />
        <Stat label="Not contacted yet" value={stats.untouched} tone="red" onClick={() => { setStatus("new"); setRange("all"); }} />
        <Stat label="Site visits scheduled" value={stats.visits} onClick={() => { setStatus("site_visit_scheduled"); setRange("all"); }} />
        <Stat label="Booked this month" value={stats.booked} tone="green" onClick={() => { setStatus("booked"); setRange("all"); }} />
      </section>

      <section className="filters">
        <input className="search" placeholder="Search name, phone or email" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">All sources</option>
          {Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {projects.length > 0 && (
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {isAdmin && (
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Everyone</option>
            <option value="none">Unassigned</option>
            {members.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(m)}</option>)}
          </select>
        )}
        <select value={range} onChange={(e) => setRange(e.target.value as Range)}>
          <option value="all">All time</option>
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
        {filtersActive && (
          <button className="link" onClick={() => { setQ(""); setStatus(""); setSource(""); setProject(""); setAssignee(""); setRange("all"); }}>Clear</button>
        )}
      </section>

      <section className="lead-list card flush">
        <div className="lead-row head">
          <span>Lead</span><span>Source</span><span>Project</span><span>Status</span><span>Owner</span><span>Received</span>
        </div>
        {loading && <div className="empty"><div className="spinner" /></div>}
        {!loading && leads.length === 0 && (
          <div className="empty">
            {filtersActive ? "No leads match these filters." : (
              <>
                <h3>No leads yet</h3>
                <p className="muted">{isAdmin ? "Connect a lead source and they'll start flowing in here." : "Leads assigned to you will show up here."}</p>
                {isAdmin && <Link className="btn primary" to="/integrations">Connect a lead source</Link>}
              </>
            )}
          </div>
        )}
        {!loading && leads.map((l) => {
          const st = statusInfo(l.status);
          return (
            <button key={l.id} className={`lead-row ${fresh.has(l.id) ? "fresh" : ""} ${selected === l.id ? "selected" : ""}`} onClick={() => setSelected(l.id)}>
              <span className="lead-main">
                <span className="lead-name"><b>{l.name || "Unknown"}</b><AiTag score={l.ai_score} />{l.duplicate_of && <span className="tag">Repeat</span>}</span>
                <span className="muted small">{l.phone || l.email}</span>
              </span>
              <span className="lead-source">
                <span className={`src src-${l.source}`}>{SOURCES[l.source] ?? l.source}</span>
                <span className="muted small ellipsis">{l.source_detail}</span>
              </span>
              <span className="small ellipsis">{l.project_id ? projectName.get(l.project_id) : <span className="muted">—</span>}</span>
              <span><span className={`pill ${st.tone}`}>{st.label}</span></span>
              <span className="small ellipsis">{l.assigned_to ? memberName(memberById.get(l.assigned_to)) : <span className="muted">Unassigned</span>}</span>
              <span className="small muted" title={new Date(l.created_at).toLocaleString("en-IN")}>{timeAgo(l.created_at)}</span>
            </button>
          );
        })}
        {hasMore && !loading && <div className="center pad"><button className="btn ghost" onClick={loadMore}>Load more</button></div>}
      </section>

      {selectedLead && (
        <LeadDrawer
          lead={selectedLead}
          projects={projects}
          onClose={() => setSelected(null)}
          onChange={(updated) => setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)))}
          onDelete={(id) => { setLeads((prev) => prev.filter((l) => l.id !== id)); setSelected(null); loadStats(); }}
        />
      )}
      {importing && (
        <ImportModal projects={projects} onClose={() => setImporting(false)} onDone={() => { load(); loadStats(); }} />
      )}
      {adding && (
        <AddLeadModal
          projects={projects}
          selfId={session!.user.id}
          onClose={() => setAdding(false)}
          onCreated={(lead) => { setLeads((prev) => (prev.some((l) => l.id === lead.id) ? prev : [lead, ...prev])); setAdding(false); setSelected(lead.id); loadStats(); }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone, onClick }: { label: string; value: number; tone?: string; onClick: () => void }) {
  return (
    <button className={`stat ${tone ?? ""}`} onClick={onClick}>
      <span className="stat-value">{value.toLocaleString("en-IN")}</span>
      <span className="stat-label">{label}</span>
    </button>
  );
}

function notify(lead: Lead) {
  if (!("Notification" in window) || Notification.permission !== "granted" || document.hasFocus()) return;
  try {
    new Notification(`New lead: ${lead.name || lead.phone || "Unknown"}`, {
      body: `${SOURCES[lead.source] ?? lead.source}${lead.source_detail ? " · " + lead.source_detail : ""}`,
    });
  } catch { /* some browsers block constructor notifications */ }
}
