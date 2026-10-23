import { useCallback, useEffect, useState, type FormEvent } from "react";
import { functionsUrl, supabase } from "../lib/supabase";
import { useSession } from "../context/Session";
import type { Integration, IntegrationType, Project } from "../lib/types";
import { randomKey, timeAgo } from "../lib/format";
import { facebookLogin, metaConfigured } from "../lib/facebook";

const TYPES: { type: IntegrationType; title: string; blurb: string; badge: string }[] = [
  { type: "meta", title: "Meta Lead Ads", blurb: "Facebook & Instagram instant forms, delivered the second someone submits.", badge: "f" },
  { type: "google", title: "Google Ads lead forms", blurb: "Lead form assets on Search, YouTube and Discovery campaigns.", badge: "G" },
  { type: "webhook", title: "Website / landing page", blurb: "Any HTML form, WordPress, Elementor, Webflow or custom page.", badge: "</>" },
  { type: "portal", title: "Property portal / 3rd-party app", blurb: "99acres, MagicBricks, Housing.com, Zapier, Pabbly, Make: anything that can post a webhook.", badge: "⇄" },
  { type: "whatsapp", title: "WhatsApp", blurb: "New chats on your WhatsApp Business (Cloud API) number become leads.", badge: "W" },
];

const typeInfo = (t: IntegrationType) => TYPES.find((x) => x.type === t)!;

function endpoint(i: Integration): string {
  if (i.type === "google") return `${functionsUrl}/google-leads?token=${i.token}`;
  return `${functionsUrl}/ingest?token=${i.token}`;
}

export default function IntegrationsPage() {
  const { current } = useSession();
  const wsId = current!.id;
  const [items, setItems] = useState<Integration[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [adding, setAdding] = useState<IntegrationType | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: ints }, { data: projs }] = await Promise.all([
      supabase.from("integrations").select("*").eq("workspace_id", wsId).order("created_at"),
      supabase.from("projects").select("id, name, location").eq("workspace_id", wsId).order("name"),
    ]);
    setItems((ints ?? []) as Integration[]);
    setProjects((projs ?? []) as Project[]);
  }, [wsId]);

  useEffect(() => { load(); }, [load]);

  async function toggle(i: Integration) {
    await supabase.from("integrations").update({ active: !i.active }).eq("id", i.id);
    load();
  }
  async function remove(i: Integration) {
    if (!confirm(`Remove "${i.name}"? Existing leads stay; new ones from this source stop.`)) return;
    await supabase.from("integrations").delete().eq("id", i.id);
    load();
  }
  async function setProject(i: Integration, projectId: string) {
    await supabase.from("integrations").update({ project_id: projectId || null }).eq("id", i.id);
    load();
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Lead sources</h1>
          <p className="muted">Connect every place your leads come from. Each source gets its own private link.</p>
        </div>
      </header>

      {items.length > 0 && (
        <section className="card flush">
          {items.map((i) => {
            const info = typeInfo(i.type);
            const isOpen = open === i.id;
            return (
              <div key={i.id} className="int-row">
                <div className="int-summary" onClick={() => setOpen(isOpen ? null : i.id)}>
                  <span className={`int-badge b-${i.type}`}>{info.badge}</span>
                  <div className="grow">
                    <b>{i.name}</b>
                    <div className="muted small">{info.title} · {i.lead_count.toLocaleString("en-IN")} leads{i.last_lead_at ? ` · last ${timeAgo(i.last_lead_at)}` : " · waiting for first lead"}</div>
                  </div>
                  <span className={`pill ${i.active ? "green" : "gray"}`}>{i.active ? "Live" : "Paused"}</span>
                  <span className="chev">{isOpen ? "▴" : "▾"}</span>
                </div>
                {isOpen && (
                  <div className="int-detail">
                    <label className="inline">Tag leads with project
                      <select value={i.project_id ?? ""} onChange={(e) => setProject(i, e.target.value)}>
                        <option value="">No project</option>
                        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </label>
                    <SetupHelp integration={i} />
                    <div className="row gap">
                      {(i.type === "webhook" || i.type === "portal" || i.type === "google") && <TestButton integration={i} onDone={load} />}
                      <button className="btn ghost" onClick={() => toggle(i)}>{i.active ? "Pause" : "Resume"}</button>
                      <button className="link danger" onClick={() => remove(i)}>Remove</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      <h3 className="section-title">Add a source</h3>
      <section className="type-grid">
        {TYPES.map((t) => (
          <button key={t.type} className="type-card card" onClick={() => setAdding(t.type)}>
            <span className={`int-badge b-${t.type}`}>{t.badge}</span>
            <b>{t.title}</b>
            <span className="muted small">{t.blurb}</span>
          </button>
        ))}
      </section>

      {adding === "meta" && <MetaConnect wsId={wsId} projects={projects} onClose={() => setAdding(null)} onDone={(id) => { setAdding(null); setOpen(id); load(); }} />}
      {adding && adding !== "meta" && (
        <AddSource type={adding} wsId={wsId} projects={projects} onClose={() => setAdding(null)} onDone={(id) => { setAdding(null); setOpen(id); load(); }} />
      )}
    </div>
  );
}

function Copy({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="copy-box">
      {label && <div className="muted small">{label}</div>}
      <div className="row">
        <code className="grow">{text}</code>
        <button className="btn small" onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}>
          {done ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function SetupHelp({ integration: i }: { integration: Integration }) {
  const url = endpoint(i);
  if (i.type === "meta") {
    return <p className="muted small">Connected to Facebook page <b>{i.name}</b> (ID {i.external_id}). Every Lead Ads form on this page now flows in automatically. To test, use Meta's Lead Ads Testing Tool.</p>;
  }
  if (i.type === "whatsapp") {
    return <p className="muted small">Listening on WhatsApp phone number ID <b>{i.external_id}</b>. The first message from a new number creates a lead; replies from known numbers are added to that lead's timeline.</p>;
  }
  if (i.type === "google") {
    return (
      <>
        <p className="small">In Google Ads, open your lead form asset → <b>Lead delivery</b> → <b>Webhook integration</b>, paste these two values, then click <b>Send test data</b>.</p>
        <Copy label="Webhook URL" text={url} />
        <Copy label="Key" text={i.settings.google_key ?? ""} />
      </>
    );
  }
  const htmlForm = `<form action="${url}" method="POST">
  <input name="name" placeholder="Name" required>
  <input name="phone" type="tel" placeholder="Phone" required>
  <input name="email" type="email" placeholder="Email">
  <input type="hidden" name="_redirect" value="https://YOUR-SITE.com/thank-you">
  <input type="text" name="_gotcha" style="display:none">
  <button>Get details</button>
</form>`;
  const jsSnippet = `fetch("${url}", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name, phone, email,
    ...Object.fromEntries(new URLSearchParams(location.search)) // keeps utm_* and gclid
  })
});`;
  return (
    <>
      <Copy label="Webhook URL (POST: JSON or form data)" text={url} />
      {i.type === "portal" ? (
        <p className="muted small">Paste this URL wherever the portal or tool asks for a webhook / CRM push URL. In Zapier or Pabbly, use a <b>Webhook → POST</b> action. Field names are matched automatically (name, phone / mobile, email, city, budget, message, project). Anything else is kept on the lead.</p>
      ) : (
        <>
          <p className="muted small">Plain HTML form (redirects to your thank-you page):</p>
          <pre className="code">{htmlForm}</pre>
          <p className="muted small">Or from JavaScript (captures UTM tags automatically):</p>
          <pre className="code">{jsSnippet}</pre>
        </>
      )}
    </>
  );
}

function TestButton({ integration: i, onDone }: { integration: Integration; onDone: () => void }) {
  const [state, setState] = useState<"" | "sending" | "ok" | "fail">("");
  async function send() {
    setState("sending");
    const sample = i.type === "google"
      ? { lead_id: `test-${Date.now()}`, google_key: i.settings.google_key, is_test: true,
          user_column_data: [{ column_id: "FULL_NAME", string_value: "Test Lead" }, { column_id: "PHONE_NUMBER", string_value: "+919999999999" }] }
      : { name: "Test Lead", phone: "9999999999", email: "test@example.com", city: "Hyderabad", budget: "80L to 1Cr", message: "Test from Leadnest", lead_id: `test-${Date.now()}` };
    try {
      const r = await fetch(endpoint(i), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sample) });
      setState(r.ok ? "ok" : "fail");
      onDone();
    } catch { setState("fail"); }
  }
  return (
    <button className="btn" onClick={send} disabled={state === "sending"}>
      {state === "sending" ? "Sending…" : state === "ok" ? "Test lead sent ✓" : state === "fail" ? "Test failed: retry" : "Send test lead"}
    </button>
  );
}

function AddSource({ type, wsId, projects, onClose, onDone }: {
  type: IntegrationType; wsId: string; projects: Project[]; onClose: () => void; onDone: (id: string) => void;
}) {
  const defaults: Record<string, string> = { webhook: "Website", portal: "99acres", google: "Google Ads", whatsapp: "WhatsApp" };
  const [name, setName] = useState(defaults[type] ?? "");
  const [projectId, setProjectId] = useState("");
  const [phoneId, setPhoneId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const row: Record<string, unknown> = { workspace_id: wsId, type, name, project_id: projectId || null };
    if (type === "google") row.settings = { google_key: randomKey(32) };
    if (type === "whatsapp") row.external_id = phoneId.trim();
    const { data, error } = await supabase.from("integrations").insert(row).select("id").single();
    setBusy(false);
    if (error) return setError(error.code === "23505" ? "This WhatsApp number is already connected to a workspace." : error.message);
    onDone(data.id);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal card" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{typeInfo(type).title}</h2>
        <label>Name this source
          {type === "portal" ? (
            <input list="portal-names" value={name} onChange={(e) => setName(e.target.value)} required />
          ) : (
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          )}
          <datalist id="portal-names">
            {["99acres", "MagicBricks", "Housing.com", "NoBroker", "Square Yards", "Zapier", "Pabbly", "Make"].map((p) => <option key={p} value={p} />)}
          </datalist>
        </label>
        {type === "whatsapp" && (
          <>
            <label>WhatsApp phone number ID
              <input value={phoneId} onChange={(e) => setPhoneId(e.target.value)} placeholder="e.g. 106540352242922" required />
            </label>
            <p className="muted small">Found in Meta Business Suite → WhatsApp Manager → Phone numbers (or the API Setup page). Your number must be on the WhatsApp Cloud API and added to the Leadnest Meta app.</p>
          </>
        )}
        <label>Tag leads with project <span className="muted">(optional)</span>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">No project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        {error && <div className="notice error">{error}</div>}
        <div className="row gap end">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? "Creating…" : "Create & get link"}</button>
        </div>
      </form>
    </div>
  );
}

function MetaConnect({ wsId, projects, onClose, onDone }: {
  wsId: string; projects: Project[]; onClose: () => void; onDone: (id: string) => void;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [pages, setPages] = useState<{ id: string; name: string }[]>([]);
  const [pageId, setPageId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function call(body: Record<string, unknown>) {
    const { data, error } = await supabase.functions.invoke("meta-connect", { body: { workspace_id: wsId, ...body } });
    if (error) {
      let msg = error.message;
      try { msg = (await (error as any).context.json()).error ?? msg; } catch { /* keep generic */ }
      throw new Error(msg);
    }
    return data;
  }

  async function login() {
    setBusy(true); setError("");
    try {
      const t = await facebookLogin();
      setToken(t);
      const data = await call({ action: "list_pages", user_token: t });
      setPages(data.pages ?? []);
      if (data.pages?.length === 1) setPageId(data.pages[0].id);
      if (!data.pages?.length) setError("No Facebook pages found. Make sure you selected your pages in the Facebook popup.");
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  async function connect() {
    setBusy(true); setError("");
    try {
      const data = await call({ action: "connect_page", user_token: token, page_id: pageId, project_id: projectId || null });
      onDone(data.integration_id);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <h2>Connect Meta Lead Ads</h2>
        {!metaConfigured ? (
          <div className="notice warn">Facebook connect isn't configured yet. Set <code>VITE_META_APP_ID</code> in the app's environment.</div>
        ) : !token ? (
          <>
            <p className="muted">Sign in with the Facebook account that manages your business page. We'll subscribe the page so every lead form submission arrives here instantly.</p>
            <button className="btn facebook block" onClick={login} disabled={busy}>{busy ? "Opening Facebook…" : "Continue with Facebook"}</button>
          </>
        ) : (
          <>
            <label>Facebook page
              <select value={pageId} onChange={(e) => setPageId(e.target.value)}>
                <option value="">Choose a page</option>
                {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label>Tag leads with project <span className="muted">(optional)</span>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">No project</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <button className="btn primary block" onClick={connect} disabled={busy || !pageId}>{busy ? "Connecting…" : "Connect page"}</button>
          </>
        )}
        {error && <div className="notice error">{error}</div>}
        <button className="link small" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
