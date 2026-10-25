// Automatic WhatsApp first reply, sent through each workspace's own
// WhatsApp Cloud API number using a Meta-approved message template.
import { admin, GRAPH } from "./leads.ts";

/** Stored on the WhatsApp integration as settings.autoreply */
export interface AutoReplySettings {
  enabled: boolean;
  template: string;          // approved template name
  language: string;          // e.g. "en", "en_US", "te"
  params: string[];          // what fills {{1}}, {{2}}… (or each named variable, in order)
  param_names?: string[];    // for templates with named variables ({{customer_name}})
  sources: string[];         // lead sources that trigger it, e.g. ["meta","google","website"]
}

export const PARAM_KEYS = ["first_name", "full_name", "project", "company", "agent"] as const;

export interface ParamContext { name?: string | null; project?: string | null; company: string; agent?: string | null }

export function paramValue(key: string, c: ParamContext): string {
  const full = (c.name ?? "").trim();
  switch (key) {
    case "first_name": return full.split(/\s+/)[0] || "there";
    case "full_name": return full || "there";
    case "project": return c.project || c.company;
    case "agent": return c.agent || c.company;
    case "company":
    default: return c.company;
  }
}

/** Sends a template message. `to` is any phone format; WhatsApp wants digits with country code. */
export async function sendTemplate(opts: {
  phoneNumberId: string; token: string; to: string; template: string; language: string;
  values: string[]; names?: string[];
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const to = opts.to.replace(/\D/g, "");
  const parameters = opts.values.map((v, i) => {
    const p: Record<string, string> = { type: "text", text: v.slice(0, 1000) };
    const n = opts.names?.[i];
    if (n && !/^\d+$/.test(n)) p.parameter_name = n;
    return p;
  });
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: opts.template,
      language: { code: opts.language || "en" },
      ...(parameters.length ? { components: [{ type: "body", parameters }] } : {}),
    },
  };
  try {
    const r = await fetch(`${GRAPH}/${opts.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (j.error) {
      const d = j.error.error_data?.details;
      return { ok: false, error: d ? `${j.error.message} (${d})` : j.error.message };
    }
    return { ok: true, id: j.messages?.[0]?.id ?? "" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not reach WhatsApp" };
  }
}

/** Called after a new lead is saved. Never throws: failures are logged on the lead's timeline. */
export async function autoReplyForLead(leadId: string): Promise<void> {
  try {
    const { data: lead } = await admin.from("leads")
      .select("id, workspace_id, name, phone, source, duplicate_of, project_id, assigned_to")
      .eq("id", leadId).maybeSingle();
    if (!lead || !lead.phone || lead.duplicate_of || lead.source === "whatsapp") return;

    const { data: wa } = await admin.from("integrations")
      .select("id, external_id, settings")
      .eq("workspace_id", lead.workspace_id).eq("type", "whatsapp").eq("active", true)
      .order("created_at").limit(5);
    const integ = (wa ?? []).find((i) => (i.settings as any)?.autoreply?.enabled);
    if (!integ?.external_id) return;
    const cfg = (integ.settings as any).autoreply as AutoReplySettings;
    if (!cfg.template || !(cfg.sources ?? []).includes(lead.source)) return;

    const { data: secret } = await admin.from("integration_secrets").select("data")
      .eq("integration_id", integ.id).maybeSingle();
    const token = (secret?.data as any)?.access_token as string | undefined;
    if (!token) return log(lead, false, "WhatsApp access token is missing. Add it in Lead sources → WhatsApp.");

    const [{ data: ws }, { data: proj }, { data: agent }] = await Promise.all([
      admin.from("workspaces").select("name").eq("id", lead.workspace_id).maybeSingle(),
      lead.project_id ? admin.from("projects").select("name").eq("id", lead.project_id).maybeSingle() : Promise.resolve({ data: null }),
      lead.assigned_to ? admin.from("profiles").select("full_name").eq("id", lead.assigned_to).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const ctx: ParamContext = { name: lead.name, company: ws?.name ?? "our team", project: (proj as any)?.name, agent: (agent as any)?.full_name };
    const values = (cfg.params ?? []).map((k) => paramValue(k, ctx));

    const res = await sendTemplate({
      phoneNumberId: integ.external_id, token, to: lead.phone,
      template: cfg.template, language: cfg.language, values, names: cfg.param_names,
    });
    await log(lead, res.ok, res.ok ? `Automatic WhatsApp reply sent (template "${cfg.template}")` : `Automatic WhatsApp reply failed: ${res.error}`,
      { auto_reply: true, template: cfg.template, ...(res.ok ? { message_id: res.id } : {}) });
  } catch (e) {
    console.error("autoReplyForLead", leadId, e);
  }
}

async function log(lead: { id: string; workspace_id: string }, ok: boolean, body: string, meta: Record<string, unknown> = {}) {
  await admin.from("lead_activities").insert({
    lead_id: lead.id, workspace_id: lead.workspace_id,
    type: ok ? "whatsapp" : "note", body, meta: { ...meta, ok },
  });
}

/** Run work after the response is sent when the runtime allows it. */
export function inBackground(p: Promise<unknown>): Promise<unknown> | void {
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) { rt.waitUntil(p); return; }
  return p;
}
