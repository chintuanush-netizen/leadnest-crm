// Google Ads lead form webhook.
//
//   Webhook URL:  {SUPABASE_URL}/functions/v1/google-leads?token=<integration token>
//   Key:          the google_key shown in the portal for that source
//
// Google posts { lead_id, user_column_data: [{column_id, string_value}], google_key, ... }
import { corsHeaders, insertLead, integrationByToken, json, pickFields } from "../_shared/leads.ts";

interface Column { column_id?: string; column_name?: string; string_value?: string }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const integ = await integrationByToken(new URL(req.url).searchParams.get("token"), ["google"]);
  if (!integ) return json({ error: "Unknown token" }, 401);

  const body = await req.json().catch(() => null);
  if (!body) return json({ error: "Invalid JSON" }, 400);
  const expectedKey = integ.settings?.google_key;
  if (!expectedKey || body.google_key !== expectedKey) return json({ error: "Invalid key" }, 403);
  if (!integ.active) return json({});

  const answers: Record<string, unknown> = {};
  for (const c of (body.user_column_data ?? []) as Column[]) {
    const key = c.column_id && !c.column_id.startsWith("QUESTION") ? c.column_id : (c.column_name ?? c.column_id);
    if (key) answers[key] = c.string_value ?? "";
  }
  const p = pickFields(answers);

  try {
    await insertLead(integ, {
      source: "google",
      source_detail: body.is_test ? "Google Ads test lead" : integ.name,
      external_id: body.lead_id ? String(body.lead_id) : null,
      name: p.name, phone: p.phone, email: p.email, city: p.city,
      budget: p.budget, message: p.message, project_name: p.project_name,
      extra: {
        ...p.extra,
        _google: {
          campaign_id: body.campaign_id, adgroup_id: body.adgroup_id, creative_id: body.creative_id,
          form_id: body.form_id, is_test: body.is_test ?? false,
        },
      },
      utm: body.gcl_id ? { gclid: String(body.gcl_id) } : {},
    });
  } catch (e) {
    console.error("google lead failed", e);
    return json({ error: "Could not save lead" }, 500);
  }
  return json({});
});
