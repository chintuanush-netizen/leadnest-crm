import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Integration } from "../lib/types";

interface Template {
  name: string; language: string; category: string; text: string; vars: string[];
  header: { format: string; has_vars: boolean } | null; has_buttons_with_vars: boolean;
}
interface AutoReply { enabled: boolean; template: string; language: string; params: string[]; param_names?: string[]; sources: string[] }

const PARAMS: { key: string; label: string; sample: string }[] = [
  { key: "first_name", label: "Lead's first name", sample: "Ravi" },
  { key: "full_name", label: "Lead's full name", sample: "Ravi Kumar" },
  { key: "project", label: "Project name", sample: "Aad One" },
  { key: "company", label: "Your company name", sample: "" },
  { key: "agent", label: "Assigned sales person", sample: "Priya" },
];
const SOURCE_OPTS = [
  { key: "meta", label: "Meta Lead Ads" },
  { key: "google", label: "Google Ads" },
  { key: "website", label: "Website forms" },
  { key: "portal", label: "Portals / 3rd-party" },
];
const guessParam = (v: string, i: number) =>
  /first|name|customer|client/i.test(v) ? "first_name" : /project|property/i.test(v) ? "project" : /agent|exec|manager|rm/i.test(v) ? "agent" : /company|builder|brand/i.test(v) ? "company" : i === 0 ? "first_name" : i === 1 ? "project" : "company";

async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("whatsapp-setup", { body });
  if (error) {
    let msg = error.message;
    try { msg = (await (error as any).context.json()).error ?? msg; } catch { /* keep generic */ }
    throw new Error(msg);
  }
  return data;
}

export default function WhatsAppAutoReply({ integration: i, company, onSaved }: { integration: Integration; company: string; onSaved: () => void }) {
  const [status, setStatus] = useState<{ has_token: boolean; phone: string | null; waba_id: string } | null>(null);
  const [token, setToken] = useState("");
  const [waba, setWaba] = useState("");
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [cfg, setCfg] = useState<AutoReply>({ enabled: false, template: "", language: "en", params: [], sources: ["meta", "google", "website", "portal"] });
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    call({ action: "status", integration_id: i.id }).then((s) => {
      setStatus(s); setWaba(s.waba_id ?? "");
      if (s.autoreply) setCfg((c) => ({ ...c, ...s.autoreply }));
    }).catch((e) => setMsg({ kind: "error", text: e.message }));
  }, [i.id]);

  const tpl = templates?.find((t) => t.name === cfg.template && t.language === cfg.language) ?? null;
  const unsupported = tpl && ((tpl.header && (tpl.header.format !== "TEXT" || tpl.header.has_vars)) || tpl.has_buttons_with_vars);

  const preview = useMemo(() => {
    const text = tpl?.text;
    if (!text) return "";
    const vars = tpl!.vars;
    return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, v) => {
      const key = cfg.params[vars.indexOf(v)];
      const p = PARAMS.find((x) => x.key === key);
      return p ? (p.key === "company" ? company : p.sample) : `{{${v}}}`;
    });
  }, [tpl, cfg.params, company]);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label); setMsg(null);
    try { await fn(); } catch (e) { setMsg({ kind: "error", text: (e as Error).message }); }
    setBusy("");
  }

  const saveConnection = () => run("conn", async () => {
    const r = await call({ action: "save", integration_id: i.id, access_token: token || undefined, waba_id: waba });
    setToken(""); setStatus((s) => ({ has_token: Boolean(s?.has_token || token), phone: r.phone ?? s?.phone ?? null, waba_id: waba }));
    setMsg({ kind: "ok", text: "WhatsApp connection saved." });
  });

  const loadTemplates = () => run("tpl", async () => {
    const r = await call({ action: "templates", integration_id: i.id });
    setTemplates(r.templates);
    if (!r.templates.length) setMsg({ kind: "error", text: "No approved templates found on this WhatsApp Business Account. Create one in WhatsApp Manager → Message templates and wait for approval." });
  });

  function pickTemplate(value: string) {
    const [name, language] = value.split("|");
    const t = templates?.find((x) => x.name === name && x.language === language);
    setCfg((c) => ({ ...c, template: name ?? "", language: language ?? "en", params: t ? t.vars.map(guessParam) : [], param_names: t?.vars ?? [] }));
  }

  const save = (enabled: boolean) => run("save", async () => {
    const next = { ...cfg, enabled };
    await call({ action: "save", integration_id: i.id, autoreply: next });
    setCfg(next); onSaved();
    setMsg({ kind: "ok", text: enabled ? "Automatic reply is ON. New leads get the WhatsApp message within seconds." : "Saved. Automatic reply is off." });
  });

  const sendTest = () => run("test", async () => {
    await call({ action: "test", integration_id: i.id, to: testTo });
    setMsg({ kind: "ok", text: "Test message sent. Check WhatsApp on that phone." });
  });

  if (!status) return <div className="muted small">Loading WhatsApp settings…</div>;

  return (
    <section className="wa-auto">
      <div className="wa-auto-head">
        <b>Automatic first reply</b>
        <span className={`pill ${cfg.enabled ? "green" : "gray"}`}>{cfg.enabled ? "On" : "Off"}</span>
      </div>
      <p className="muted small">Every new lead gets a WhatsApp message from this number within seconds, before your team even calls. WhatsApp only allows Meta-approved templates for the first message.</p>

      <div className="wa-step">
        <div className="wa-step-title">1. Connection {status.has_token && <span className="pill green">Connected{status.phone ? ` · ${status.phone}` : ""}</span>}</div>
        <div className="field-grid">
          <label>Permanent access token
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={status.has_token ? "Saved. Paste a new one to replace it" : "EAAG…"} autoComplete="off" />
          </label>
          <label>WhatsApp Business Account ID
            <input value={waba} onChange={(e) => setWaba(e.target.value)} placeholder="e.g. 102345678901234" inputMode="numeric" />
          </label>
        </div>
        <p className="muted small">Create the token in Meta Business settings → Users → System users → Generate token, with <code>whatsapp_business_messaging</code> and <code>whatsapp_business_management</code>. The account ID is in WhatsApp Manager → Account tools.</p>
        <button className="btn" onClick={saveConnection} disabled={!!busy || (!token && waba === status.waba_id)}>{busy === "conn" ? "Checking…" : "Save connection"}</button>
      </div>

      <div className="wa-step">
        <div className="wa-step-title">2. Message template</div>
        {!templates ? (
          <div className="row gap wrap">
            {cfg.template && <span className="small">Current: <b>{cfg.template}</b> ({cfg.language})</span>}
            <button className="btn" onClick={loadTemplates} disabled={!!busy || !status.has_token}>{busy === "tpl" ? "Loading…" : cfg.template ? "Change template" : "Load my templates"}</button>
          </div>
        ) : (
          <>
            <label>Approved template
              <select value={cfg.template ? `${cfg.template}|${cfg.language}` : ""} onChange={(e) => pickTemplate(e.target.value)}>
                <option value="">Choose…</option>
                {templates.map((t) => <option key={t.name + t.language} value={`${t.name}|${t.language}`}>{t.name} ({t.language}, {t.category.toLowerCase()})</option>)}
              </select>
            </label>
            {tpl && tpl.vars.length > 0 && (
              <div className="field-grid">
                {tpl.vars.map((v, idx) => (
                  <label key={v}>Fill {`{{${v}}}`} with
                    <select value={cfg.params[idx] ?? ""} onChange={(e) => setCfg((c) => { const p = [...c.params]; p[idx] = e.target.value; return { ...c, params: p }; })}>
                      {PARAMS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            )}
            {tpl && <div className="wa-bubble">{preview}</div>}
            {unsupported && <div className="notice warn small">This template has an image/video header or variables in its buttons. Pick a template with a text-only header and plain buttons.</div>}
          </>
        )}
      </div>

      <div className="wa-step">
        <div className="wa-step-title">3. Send it for leads from</div>
        <div className="row gap wrap">
          {SOURCE_OPTS.map((s) => (
            <label key={s.key} className="inline small">
              <input type="checkbox" checked={cfg.sources.includes(s.key)}
                onChange={(e) => setCfg((c) => ({ ...c, sources: e.target.checked ? [...c.sources, s.key] : c.sources.filter((x) => x !== s.key) }))} />
              {s.label}
            </label>
          ))}
        </div>
        <p className="muted small">Repeat enquiries from the same number within 90 days, imported leads and leads that came in on WhatsApp are not messaged.</p>
      </div>

      {msg && <div className={`notice ${msg.kind} small`}>{msg.text}</div>}

      <div className="row gap wrap">
        {cfg.enabled
          ? <><button className="btn primary" onClick={() => save(true)} disabled={!!busy || !cfg.template || !!unsupported}>Save changes</button>
              <button className="btn ghost" onClick={() => save(false)} disabled={!!busy}>Turn off</button></>
          : <button className="btn primary" onClick={() => save(true)} disabled={!!busy || !cfg.template || !status.has_token || !!unsupported || !cfg.sources.length}>{busy === "save" ? "Saving…" : "Turn on automatic reply"}</button>}
      </div>

      {cfg.template && status.has_token && (
        <div className="wa-step">
          <div className="wa-step-title">Send a test</div>
          <div className="row gap wrap">
            <input className="grow" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Your WhatsApp number, e.g. 98765 43210" inputMode="tel" />
            <button className="btn" onClick={sendTest} disabled={!!busy || !testTo}>{busy === "test" ? "Sending…" : "Send test"}</button>
          </div>
          <p className="muted small">Uses the saved template with sample details (Ravi Kumar, Sample Project). Save first if you changed the template.</p>
        </div>
      )}
    </section>
  );
}
