// Settings for a workspace's WhatsApp number: access token, WABA ID and the
// automatic first reply. Called from Lead sources → WhatsApp (admins only).
// Deploy WITH jwt verification.
//
//   { action: "status",    integration_id }
//   { action: "save",      integration_id, access_token?, waba_id?, autoreply? }
//   { action: "templates", integration_id }
//   { action: "test",      integration_id, to }
import { createClient } from "npm:@supabase/supabase-js@2";
import { admin, corsHeaders, GRAPH, json } from "../_shared/leads.ts";
import { type AutoReplySettings, PARAM_KEYS, paramValue, sendTemplate } from "../_shared/whatsapp.ts";

const SOURCES = ["meta", "google", "website", "portal"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authed = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await authed.auth.getUser();
  if (!user) return json({ error: "Not signed in" }, 401);

  const body = await req.json().catch(() => ({}));
  const { action, integration_id } = body;
  if (!integration_id) return json({ error: "integration_id is required" }, 400);

  const { data: integ } = await admin.from("integrations").select("id, workspace_id, type, external_id, settings")
    .eq("id", integration_id).maybeSingle();
  if (!integ || integ.type !== "whatsapp") return json({ error: "WhatsApp source not found" }, 404);

  const { data: member } = await admin.from("workspace_members").select("role")
    .eq("workspace_id", integ.workspace_id).eq("user_id", user.id).maybeSingle();
  if (!member || !["owner", "admin"].includes(member.role)) return json({ error: "Only workspace admins can change WhatsApp settings" }, 403);

  const { data: secretRow } = await admin.from("integration_secrets").select("data").eq("integration_id", integ.id).maybeSingle();
  const secret = (secretRow?.data ?? {}) as Record<string, string>;
  const settings = (integ.settings ?? {}) as Record<string, any>;
  const phoneId = integ.external_id as string;

  try {
    if (action === "status") {
      return json({ has_token: Boolean(secret.access_token), phone: settings.phone_display ?? null, waba_id: settings.waba_id ?? "", autoreply: settings.autoreply ?? null });
    }

    if (action === "save") {
      const next = { ...settings };
      if (typeof body.access_token === "string" && body.access_token.trim()) {
        const token = body.access_token.trim();
        const r = await fetch(`${GRAPH}/${phoneId}?fields=display_phone_number,verified_name&access_token=${encodeURIComponent(token)}`);
        const j = await r.json();
        if (j.error) return json({ error: `WhatsApp did not accept this token for phone number ID ${phoneId}: ${j.error.message}` }, 400);
        next.phone_display = [j.verified_name, j.display_phone_number].filter(Boolean).join(" · ");
        await admin.from("integration_secrets").upsert({ integration_id: integ.id, data: { ...secret, access_token: token }, updated_at: new Date().toISOString() });
      }
      if (typeof body.waba_id === "string") next.waba_id = body.waba_id.replace(/\D/g, "");
      if (body.autoreply) {
        const a = body.autoreply as Partial<AutoReplySettings>;
        const clean: AutoReplySettings = {
          enabled: Boolean(a.enabled),
          template: String(a.template ?? "").trim(),
          language: String(a.language ?? "en").trim() || "en",
          params: (a.params ?? []).filter((k) => (PARAM_KEYS as readonly string[]).includes(k)).slice(0, 10),
          param_names: (a.param_names ?? []).map(String).slice(0, 10),
          sources: (a.sources ?? []).filter((s) => SOURCES.includes(s)),
        };
        if (clean.enabled && !clean.template) return json({ error: "Pick a template before turning the automatic reply on." }, 400);
        if (clean.enabled && !secret.access_token && !body.access_token) return json({ error: "Add the WhatsApp access token first." }, 400);
        next.autoreply = clean;
      }
      await admin.from("integrations").update({ settings: next }).eq("id", integ.id);
      return json({ ok: true, phone: next.phone_display ?? null });
    }

    if (action === "templates") {
      if (!secret.access_token) return json({ error: "Add the WhatsApp access token first." }, 400);
      if (!settings.waba_id) return json({ error: "Add your WhatsApp Business Account ID first." }, 400);
      const out: unknown[] = [];
      let next: string | null = `${GRAPH}/${settings.waba_id}/message_templates?fields=name,language,status,category,components,parameter_format&limit=100&access_token=${encodeURIComponent(secret.access_token)}`;
      while (next && out.length < 500) {
        const r: Response = await fetch(next);
        const j = await r.json();
        if (j.error) return json({ error: j.error.message }, 400);
        for (const t of j.data ?? []) {
          if (t.status !== "APPROVED") continue;
          const bodyC = (t.components ?? []).find((c: any) => c.type === "BODY");
          const header = (t.components ?? []).find((c: any) => c.type === "HEADER");
          const text: string = bodyC?.text ?? "";
          const vars = [...new Set([...text.matchAll(/\{\{\s*([\w]+)\s*\}\}/g)].map((m) => m[1]))];
          out.push({
            name: t.name, language: t.language, category: t.category, text, vars,
            header: header ? { format: header.format, has_vars: /\{\{/.test(header.text ?? "") } : null,
            has_buttons_with_vars: (t.components ?? []).some((c: any) => c.type === "BUTTONS" && JSON.stringify(c).includes("{{")),
          });
        }
        next = j.paging?.next ?? null;
      }
      return json({ templates: out });
    }

    if (action === "test") {
      const cfg = settings.autoreply as AutoReplySettings | undefined;
      if (!cfg?.template) return json({ error: "Save a template first." }, 400);
      if (!secret.access_token) return json({ error: "Add the WhatsApp access token first." }, 400);
      const to = String(body.to ?? "").replace(/\D/g, "");
      if (to.length < 10) return json({ error: "Enter the phone number with country code, e.g. 91 98765 43210." }, 400);
      const [{ data: ws }, { data: me }] = await Promise.all([
        admin.from("workspaces").select("name").eq("id", integ.workspace_id).maybeSingle(),
        admin.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
      ]);
      const ctx = { name: "Ravi Kumar", company: ws?.name ?? "our team", project: "Sample Project", agent: me?.full_name };
      const res = await sendTemplate({
        phoneNumberId: phoneId, token: secret.access_token, to: to.length === 10 ? "91" + to : to,
        template: cfg.template, language: cfg.language, values: (cfg.params ?? []).map((k) => paramValue(k, ctx)), names: cfg.param_names,
      });
      return res.ok ? json({ ok: true }) : json({ error: res.error }, 400);
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "WhatsApp request failed" }, 502);
  }
});
