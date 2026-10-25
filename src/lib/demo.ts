// Demo mode: an in-memory stand-in for the Supabase client so the CRM can be
// clicked through with sample data, without a Supabase project.
// Enabled when VITE_DEMO=1 or when no Supabase URL/key is configured.

type Row = Record<string, any>;

const DEMO_ON = import.meta.env.VITE_DEMO === "1" || !(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
type Listener = { event: string; table: string; filter?: string; cb: (p: any) => void };

const now = Date.now();
const ago = (mins: number) => new Date(now - mins * 60000).toISOString();
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

const WS = "ws-demo";
const ME = "u-owner";
const A1 = "u-agent-1";
const A2 = "u-agent-2";

const db: Record<string, Row[]> = {
  profiles: [
    { id: ME, email: "anush@leadnest.in", full_name: "Anush" },
    { id: A1, email: "ravi@demo-realty.in", full_name: "Ravi Kumar" },
    { id: A2, email: "priya@demo-realty.in", full_name: "Priya Sharma" },
  ],
  workspaces: [
    { id: WS, name: "Demo Realty", plan: "trial", trial_ends_at: new Date(now + 11 * 864e5).toISOString(), paid_until: null, auto_assign: true, created_at: ago(60 * 24 * 3) },
    { id: "ws-skyline", name: "Skyline Builders", plan: "active", trial_ends_at: ago(60 * 24 * 20), paid_until: new Date(now + 40 * 864e5).toISOString(), auto_assign: false, created_at: ago(60 * 24 * 34) },
    { id: "ws-green", name: "Green Acres Realty", plan: "trial", trial_ends_at: new Date(now - 2 * 864e5).toISOString(), paid_until: null, auto_assign: false, created_at: ago(60 * 24 * 16) },
  ],
  workspace_members: [
    { workspace_id: WS, user_id: ME, role: "owner" },
    { workspace_id: WS, user_id: A1, role: "agent" },
    { workspace_id: WS, user_id: A2, role: "agent" },
  ],
  workspace_invites: [
    { id: "inv-1", workspace_id: WS, email: "sales@demo-realty.in", role: "agent", token: "demo-invite-token", created_at: ago(300), accepted_at: null },
  ],
  projects: [
    { id: "p-1", workspace_id: WS, name: "Skyline Residences", location: "Kokapet" },
    { id: "p-2", workspace_id: WS, name: "Green Acres Villas", location: "Tukkuguda" },
    { id: "p-3", workspace_id: WS, name: "Highway Plots Phase 1", location: "Sadasivapet" },
  ],
  integrations: [
    { id: "i-1", workspace_id: WS, type: "meta", name: "Demo Realty (Facebook page)", token: "tok-meta", external_id: "104882312345678", project_id: null, settings: {}, active: true, last_lead_at: ago(12), lead_count: 214, created_at: ago(60 * 24 * 20) },
    { id: "i-2", workspace_id: WS, type: "google", name: "Google Ads", token: "tok-google", external_id: null, project_id: "p-1", settings: { google_key: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6" }, active: true, last_lead_at: ago(95), lead_count: 63, created_at: ago(60 * 24 * 14) },
    { id: "i-3", workspace_id: WS, type: "webhook", name: "Website", token: "tok-web", external_id: null, project_id: null, settings: {}, active: true, last_lead_at: ago(240), lead_count: 41, created_at: ago(60 * 24 * 10) },
    { id: "i-4", workspace_id: WS, type: "portal", name: "99acres", token: "tok-99", external_id: null, project_id: "p-1", settings: {}, active: true, last_lead_at: ago(60 * 26), lead_count: 18, created_at: ago(60 * 24 * 7) },
    { id: "i-5", workspace_id: WS, type: "whatsapp", name: "WhatsApp", token: "tok-wa", external_id: "112233445566778", project_id: null, settings: {}, active: true, last_lead_at: ago(60 * 5), lead_count: 27, created_at: ago(60 * 24 * 5) },
  ],
  leads: [],
  lead_activities: [],
};

const SAMPLE: any[][] = [
  // name, phone, source, detail, city, budget, status, project, minutesAgo, assigned
  ["Srikanth Reddy", "+919848012345", "meta", "3BHK Launch Offer form", "Hyderabad", "1Cr to 1.5Cr", "new", "p-1", 12, A1],
  ["Lakshmi Prasanna", "+919701234567", "meta", "Villa enquiry form", "Hyderabad", "2Cr+", "new", "p-2", 38, A2],
  ["Mohammed Imran", "+919866543210", "google", "Search: flats in kokapet", "Hyderabad", "80L to 1Cr", "contacted", "p-1", 95, A1],
  ["Kavya Rao", "+918977001122", "whatsapp", "Hi, is the 3BHK still available?", "Secunderabad", null, "new", null, 300, A2],
  ["Venkatesh Naidu", "+919440112233", "website", "Project landing page", "Hyderabad", "50L to 80L", "site_visit_scheduled", "p-3", 240, A1],
  ["Anil Kumar", "+14085551234", "meta", "NRI campaign form", "San Jose", "1.5Cr to 2Cr", "contacted", "p-1", 60 * 7, A2],
  ["Deepika Varma", "+919000456789", "portal", "99acres", "Hyderabad", "1Cr to 1.5Cr", "site_visit_done", "p-1", 60 * 26, A1],
  ["Rajesh Goud", "+919391234567", "meta", "Plot offer form", "Sangareddy", "20L to 30L", "negotiation", "p-3", 60 * 30, A2],
  ["Sneha Patil", "+919959876543", "google", "Lead form: Villas Tukkuguda", "Hyderabad", "2Cr+", "booked", "p-2", 60 * 50, A1],
  ["Harsha Vardhan", "+919849998877", "meta", "3BHK Launch Offer form", "Hyderabad", "80L to 1Cr", "lost", "p-1", 60 * 72, A2],
  ["Test Test", "+919999999999", "website", "Project landing page", null, null, "junk", null, 60 * 80, null],
  ["Bhavana Chowdary", "+917702345678", "meta", "Villa enquiry form", "Vijayawada", "2Cr+", "contacted", "p-2", 60 * 100, A1],
  ["Suresh Babu", "+919676543210", "whatsapp", "Please share brochure and price", "Hyderabad", null, "new", null, 60 * 120, null],
  ["Pooja Iyer", "+919885012345", "manual", "Walk-in", "Hyderabad", "1Cr to 1.5Cr", "site_visit_scheduled", "p-1", 60 * 150, A2],
];

SAMPLE.forEach(([name, phone, source, detail, city, budget, status, project, mins, assigned], idx) => {
  const id = `lead-${idx + 1}`;
  const integ = ({ meta: "i-1", google: "i-2", website: "i-3", portal: "i-4", whatsapp: "i-5" } as Record<string, string>)[source] ?? null;
  const extra: Row = {};
  if (source === "meta") {
    extra["when_are_you_planning_to_buy?"] = idx % 2 ? "Within 3 months" : "3 to 6 months";
    extra.preferred_configuration = project === "p-2" ? "4BHK villa" : "3BHK";
    extra._meta = { campaign: "Leads | Hyderabad | Oct", adset: "Kokapet 5km 28-55", ad: "Launch offer v2", form: detail, platform: "instagram" };
  }
  if (source === "google") extra.gclid = "Cj0KCQjw" + idx;
  db.leads.push({
    id, workspace_id: WS, integration_id: integ, project_id: project, source, source_detail: source === "whatsapp" ? null : detail,
    external_id: null, name, phone, email: name.toLowerCase().replace(/[^a-z]/g, ".") + "@gmail.com", city, budget,
    message: source === "whatsapp" ? detail : null, extra,
    utm: source === "website" ? { utm_source: "facebook", utm_medium: "paid", utm_campaign: "oct-launch" } : {},
    status, assigned_to: assigned, duplicate_of: null,
    next_follow_up: status === "site_visit_scheduled" ? new Date(now + 864e5 * (idx % 3 + 1)).toISOString() : null,
    created_at: ago(mins), updated_at: ago(Math.max(1, mins - 20)),
  });
  db.lead_activities.push({ id: idx * 10 + 1, lead_id: id, workspace_id: WS, actor_id: null, type: "created", body: `Lead received from ${source}`, meta: {}, created_at: ago(mins) });
  if (assigned) db.lead_activities.push({ id: idx * 10 + 2, lead_id: id, workspace_id: WS, actor_id: null, type: "assigned", body: null, meta: { to: assigned }, created_at: ago(mins) });
  if (status !== "new") {
    db.lead_activities.push({ id: idx * 10 + 3, lead_id: id, workspace_id: WS, actor_id: assigned, type: "status", body: null, meta: { from: "new", to: status }, created_at: ago(Math.max(1, mins - 20)) });
    db.lead_activities.push({ id: idx * 10 + 4, lead_id: id, workspace_id: WS, actor_id: assigned, type: "note", body: "Called, interested. Shared brochure and price sheet on WhatsApp.", meta: {}, created_at: ago(Math.max(1, mins - 15)) });
  }
});

let actSeq = 1000;

// ---------- realtime ----------
const listeners = new Set<Listener>();
function emit(table: string, event: string, newRow: Row | null, oldRow: Row | null) {
  listeners.forEach((l) => {
    if (l.table !== table || (l.event !== "*" && l.event !== event)) return;
    if (l.filter) {
      const [col, rest] = l.filter.split("=");
      const val = rest?.replace(/^eq\./, "");
      const row = newRow ?? oldRow;
      if (row && String(row[col]) !== val) return;
    }
    setTimeout(() => l.cb({ eventType: event, new: newRow ?? {}, old: oldRow ?? {} }), 0);
  });
}

// ---------- joins used by the app ----------
function decorate(table: string, row: Row): Row {
  if (table === "workspace_members") {
    return {
      ...row,
      workspaces: db.workspaces.find((w) => w.id === row.workspace_id) ?? null,
      profiles: (() => { const p = db.profiles.find((x) => x.id === row.user_id); return p ? { email: p.email, full_name: p.full_name } : null; })(),
    };
  }
  return { ...row };
}

function withDefaults(table: string, r: Row): Row {
  const base: Row = { id: uid(), created_at: new Date().toISOString() };
  if (table === "leads") Object.assign(base, { status: "new", extra: {}, utm: {}, source: "manual", updated_at: base.created_at, assigned_to: null, duplicate_of: null, next_follow_up: null, project_id: null, integration_id: null, external_id: null, source_detail: null });
  if (table === "integrations") Object.assign(base, { token: uid().replace(/-/g, ""), settings: {}, active: true, last_lead_at: null, lead_count: 0, external_id: null });
  if (table === "workspace_invites") Object.assign(base, { token: uid().replace(/-/g, ""), accepted_at: null });
  if (table === "lead_activities") Object.assign(base, { id: ++actSeq, meta: {} });
  return { ...base, ...r };
}

function logLeadChanges(before: Row, after: Row) {
  if (before.status !== after.status) {
    const a = withDefaults("lead_activities", { lead_id: after.id, workspace_id: after.workspace_id, actor_id: ME, type: "status", meta: { from: before.status, to: after.status } });
    db.lead_activities.push(a); emit("lead_activities", "INSERT", a, null);
  }
  if (before.assigned_to !== after.assigned_to) {
    const a = withDefaults("lead_activities", { lead_id: after.id, workspace_id: after.workspace_id, actor_id: ME, type: "assigned", meta: { to: after.assigned_to } });
    db.lead_activities.push(a); emit("lead_activities", "INSERT", a, null);
  }
}

// round-robin for new leads, like the real trigger
let rr = 0;
function autoAssign(row: Row) {
  const ws = db.workspaces.find((w) => w.id === row.workspace_id);
  if (!ws?.auto_assign || row.assigned_to) return;
  const agents = db.workspace_members.filter((m) => m.workspace_id === row.workspace_id && m.role === "agent");
  if (agents.length) row.assigned_to = agents[rr++ % agents.length].user_id;
}

// ---------- query builder ----------
class Query implements PromiseLike<any> {
  private filters: ((r: Row) => boolean)[] = [];
  private orderBy: { col: string; asc: boolean } | null = null;
  private rng: [number, number] | null = null;
  private op: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row | Row[] | null = null;
  private head = false;
  private wantCount = false;
  private one: "single" | "maybe" | null = null;
  private returning = false;

  constructor(private table: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op !== "select") this.returning = true;
    if (opts?.head) this.head = true;
    if (opts?.count) this.wantCount = true;
    return this;
  }
  insert(v: Row | Row[]) { this.op = "insert"; this.payload = v; return this; }
  update(v: Row) { this.op = "update"; this.payload = v; return this; }
  delete() { this.op = "delete"; return this; }
  upsert(v: Row | Row[]) { return this.insert(v); }

  eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this; }
  neq(c: string, v: any) { this.filters.push((r) => r[c] !== v); return this; }
  is(c: string, v: any) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  in(c: string, v: any[]) { this.filters.push((r) => v.includes(r[c])); return this; }
  gte(c: string, v: any) { this.filters.push((r) => r[c] != null && r[c] >= v); return this; }
  lte(c: string, v: any) { this.filters.push((r) => r[c] != null && r[c] <= v); return this; }
  ilike(c: string, pat: string) {
    const re = new RegExp("^" + pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$", "i");
    this.filters.push((r) => re.test(String(r[c] ?? ""))); return this;
  }
  or(expr: string) {
    const parts = expr.split(",").map((p) => {
      const [col, op, ...rest] = p.split(".");
      const val = rest.join(".");
      if (op === "ilike") {
        const re = new RegExp("^" + val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$", "i");
        return (r: Row) => re.test(String(r[col] ?? ""));
      }
      return (r: Row) => String(r[col]) === val;
    });
    this.filters.push((r) => parts.some((f) => f(r))); return this;
  }
  order(col: string, o?: { ascending?: boolean }) { this.orderBy = { col, asc: o?.ascending !== false }; return this; }
  range(a: number, b: number) { this.rng = [a, b]; return this; }
  limit(n: number) { this.rng = [0, n - 1]; return this; }
  single() { this.one = "single"; return this; }
  maybeSingle() { this.one = "maybe"; return this; }

  private run(): { data: any; error: any; count?: number | null } {
    const rows = db[this.table] ?? (db[this.table] = []);
    const match = (r: Row) => this.filters.every((f) => f(decorate(this.table, r)));

    if (this.op === "insert") {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload!]).map((r) => withDefaults(this.table, r));
      list.forEach((r) => {
        if (this.table === "leads") {
          autoAssign(r);
          const a = withDefaults("lead_activities", { lead_id: r.id, workspace_id: r.workspace_id, actor_id: null, type: "created", body: `Lead received from ${r.source}` });
          db.lead_activities.push(a);
        }
        rows.push(r); emit(this.table, "INSERT", r, null);
      });
      return this.finish(list);
    }
    if (this.op === "update") {
      const changed: Row[] = [];
      rows.forEach((r, i) => {
        if (!match(r)) return;
        const before = { ...r };
        const after = { ...r, ...(this.payload as Row) };
        if (this.table === "leads") { after.updated_at = new Date().toISOString(); logLeadChanges(before, after); }
        rows[i] = after; changed.push(after); emit(this.table, "UPDATE", after, before);
      });
      return this.finish(changed);
    }
    if (this.op === "delete") {
      const gone = rows.filter(match);
      db[this.table] = rows.filter((r) => !match(r));
      gone.forEach((r) => emit(this.table, "DELETE", null, r));
      return this.finish(gone);
    }

    let out = rows.filter(match).map((r) => decorate(this.table, r));
    const count = out.length;
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      out.sort((a, b) => (a[col] === b[col] ? 0 : (a[col] ?? "") > (b[col] ?? "") ? 1 : -1) * (asc ? 1 : -1));
    }
    if (this.rng) out = out.slice(this.rng[0], this.rng[1] + 1);
    if (this.head) return { data: null, error: null, count };
    return this.finish(out, this.wantCount ? count : null);
  }

  private finish(list: Row[], count: number | null = null) {
    const clone = JSON.parse(JSON.stringify(list));
    if (this.op !== "select" && !this.returning) return { data: null, error: null, count };
    if (this.one) {
      if (!clone.length) return this.one === "maybe" ? { data: null, error: null } : { data: null, error: { message: "No rows found", code: "PGRST116" } };
      return { data: clone[0], error: null, count };
    }
    return { data: clone, error: null, count };
  }

  then<T1 = any, T2 = never>(ok?: ((v: any) => T1 | PromiseLike<T1>) | null, bad?: ((e: any) => T2 | PromiseLike<T2>) | null) {
    return new Promise((res) => setTimeout(() => res(this.run()), 60)).then(ok, bad);
  }
}

// ---------- auth ----------
const session: any = {
  access_token: "demo", token_type: "bearer", expires_in: 3600,
  user: { id: ME, email: "anush@leadnest.in", user_metadata: { full_name: "Anush" } },
};
let current: any = session;
const authSubs = new Set<(e: string, s: any) => void>();
const setAuth = (s: any, e: string) => { current = s; authSubs.forEach((cb) => cb(e, s)); };

const auth = {
  getSession: async () => ({ data: { session: current }, error: null }),
  onAuthStateChange: (cb: (e: string, s: any) => void) => {
    authSubs.add(cb);
    return { data: { subscription: { unsubscribe: () => authSubs.delete(cb) } } };
  },
  signOut: async () => { setAuth(null, "SIGNED_OUT"); return { error: null }; },
  signInWithPassword: async () => { setAuth(session, "SIGNED_IN"); return { data: { session }, error: null }; },
  signUp: async () => { setAuth(session, "SIGNED_IN"); return { data: { session, user: session.user }, error: null }; },
  signInWithOtp: async () => { setAuth(session, "SIGNED_IN"); return { data: {}, error: null }; },
  resetPasswordForEmail: async () => ({ data: {}, error: null }),
  updateUser: async () => ({ data: { user: session.user }, error: null }),
};

// ---------- channels ----------
function channel(_name: string) {
  const mine: Listener[] = [];
  const ch: any = {
    on(_type: string, f: { event: string; table: string; filter?: string }, cb: (p: any) => void) {
      mine.push({ event: f.event, table: f.table, filter: f.filter, cb }); return ch;
    },
    subscribe() { mine.forEach((l) => listeners.add(l)); return ch; },
    _remove() { mine.forEach((l) => listeners.delete(l)); },
  };
  return ch;
}

// ---------- test-lead webhooks (Integrations → Send test lead) ----------
// Side effects only when the app actually runs in demo mode (dropped from live builds).
if (DEMO_ON) {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/functions/v1/")) {
      const token = new URL(url, location.href).searchParams.get("token");
      const integ = db.integrations.find((i) => i.token === token);
      if (integ) {
        let body: Row = {};
        try { body = JSON.parse(String(init?.body ?? "{}")); } catch { /* ignore */ }
        const name = body.name ?? body.user_column_data?.find((c: Row) => c.column_id === "FULL_NAME")?.string_value ?? "Test Lead";
        const source = integ.type === "webhook" ? "website" : integ.type;
        await new Query("leads").insert({
          workspace_id: integ.workspace_id, integration_id: integ.id, project_id: integ.project_id, source, source_detail: integ.name,
          name, phone: "+919999999999", email: body.email ?? null, city: body.city ?? null, budget: body.budget ?? null, message: body.message ?? null,
        });
        integ.lead_count += 1; integ.last_lead_at = new Date().toISOString();
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return realFetch(input as any, init);
  };

  // a live lead lands shortly after opening, to show the real-time inbox
  setTimeout(() => {
    new Query("leads").insert({
      workspace_id: WS, integration_id: "i-1", project_id: "p-1", source: "meta", source_detail: "3BHK Launch Offer form",
      name: "Naveen Chandra", phone: "+919912345678", email: "naveen.c@gmail.com", city: "Hyderabad", budget: "1Cr to 1.5Cr",
      extra: { "when_are_you_planning_to_buy?": "Within 3 months", preferred_configuration: "3BHK",
               _meta: { campaign: "Leads | Hyderabad | Oct", adset: "Kokapet 5km 28-55", ad: "Launch offer v2", form: "3BHK Launch Offer form", platform: "facebook" } },
    }).then(() => {});
  }, 8000);
}

export const demoClient: any = {
  from: (t: string) => new Query(t),
  rpc: async (fn: string, args: Row) => {
    if (fn === "create_workspace") {
      const id = uid();
      db.workspaces.push({ id, name: args.p_name, plan: "trial", trial_ends_at: new Date(Date.now() + 14 * 864e5).toISOString(), auto_assign: true });
      db.workspace_members.push({ workspace_id: id, user_id: ME, role: "owner" });
      return { data: id, error: null };
    }
    if (fn === "accept_invite") return { data: WS, error: null };
    if (fn === "is_platform_admin") return { data: true, error: null };
    if (fn === "admin_overview") {
      const fake: Record<string, [string, number, number]> = { "ws-skyline": ["owner@skylinebuilders.in", 812, 64], "ws-green": ["sales@greenacres.in", 37, 0] };
      const data = db.workspaces.map((w) => {
        const own = db.leads.filter((l) => l.workspace_id === w.id);
        const f = fake[w.id];
        return {
          id: w.id, name: w.name, created_at: w.created_at, plan: w.plan, trial_ends_at: w.trial_ends_at, paid_until: w.paid_until,
          owner_email: f ? f[0] : "anush@leadnest.in", members: f ? 4 : 3,
          leads: f ? f[1] : own.length, leads_7d: f ? f[2] : own.filter((l) => l.created_at > ago(60 * 24 * 7)).length,
          last_lead: f ? (f[2] ? ago(40) : ago(60 * 24 * 3)) : own.map((l) => l.created_at).sort().pop() ?? null,
          sources: f ? 3 : db.integrations.length,
        };
      });
      return { data, error: null };
    }
    if (fn === "admin_set_plan") {
      const w = db.workspaces.find((x) => x.id === args.p_workspace);
      if (w) { w.plan = args.p_plan; if (args.p_trial_ends_at) w.trial_ends_at = args.p_trial_ends_at; w.paid_until = args.p_paid_until; }
      return { data: null, error: null };
    }
    return { data: null, error: { message: `Unknown function ${fn}` } };
  },
  channel,
  removeChannel: (ch: any) => { ch?._remove?.(); return Promise.resolve("ok"); },
  auth,
  functions: {
    invoke: async (name: string, opts?: { body?: any }) => {
      if (name === "whatsapp-setup") {
        const a = opts?.body?.action;
        if (a === "status") return { data: { has_token: true, phone: "Demo Realty · +91 90000 00000", waba_id: "102345678901234", autoreply: null }, error: null };
        if (a === "templates") return { data: { templates: [
          { name: "new_lead_welcome", language: "en", category: "MARKETING", vars: ["1", "2"], header: null, has_buttons_with_vars: false,
            text: "Hi {{1}}, thank you for your interest in {{2}}! Our property expert will call you shortly. Reply here with a good time to talk." },
          { name: "site_visit_invite", language: "en", category: "MARKETING", vars: ["customer_name", "project_name"], header: null, has_buttons_with_vars: false,
            text: "Hello {{customer_name}}, would you like to visit {{project_name}} this weekend? Reply YES and we'll book a slot for you." },
        ] }, error: null };
        return { data: { ok: true, phone: "Demo Realty · +91 90000 00000" }, error: null };
      }
      return { data: null, error: { message: "Facebook connect needs the live Meta app. In demo mode a page is already connected." } };
    },
  },
};
