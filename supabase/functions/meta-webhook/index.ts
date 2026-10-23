// Meta Lead Ads webhook (one endpoint for every client's Facebook page).
//
//   Callback URL:  {SUPABASE_URL}/functions/v1/meta-webhook
//   Verify token:  META_VERIFY_TOKEN
//   Field:         Page -> leadgen
//
// Meta sends only the leadgen_id; we fetch the answers with the page token
// stored when the client connected their page.
import {
  admin, GRAPH, insertLead, integrationByExternalId, json, pickFields, verifyMetaSignature,
} from "../_shared/leads.ts";

interface LeadgenChange {
  field: string;
  value: { leadgen_id: string; page_id: string; form_id?: string; ad_id?: string; created_time?: number };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Webhook verification handshake
  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" &&
      url.searchParams.get("hub.verify_token") === Deno.env.get("META_VERIFY_TOKEN");
    return ok
      ? new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 })
      : new Response("Forbidden", { status: 403 });
  }

  const raw = await req.text();
  if (!(await verifyMetaSignature(raw, req.headers.get("x-hub-signature-256")))) {
    return new Response("Bad signature", { status: 401 });
  }

  let body: { entry?: { changes?: LeadgenChange[] }[] };
  try { body = JSON.parse(raw); } catch { return json({ ok: false }, 400); }

  const formNames = new Map<string, string>();

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen") continue;
      const v = change.value;
      try {
        const integ = await integrationByExternalId("meta", String(v.page_id));
        if (!integ) { console.warn("No workspace for page", v.page_id); continue; }

        const { data: secret } = await admin.from("integration_secrets")
          .select("data").eq("integration_id", integ.id).maybeSingle();
        const pageToken = (secret?.data as { page_access_token?: string } | null)?.page_access_token;
        if (!pageToken) { console.error("Missing page token for", integ.id); continue; }

        const fields = "created_time,field_data,ad_name,adset_name,campaign_name,form_id,platform,is_organic";
        const res = await fetch(`${GRAPH}/${v.leadgen_id}?fields=${fields}&access_token=${pageToken}`);
        const lead = await res.json();
        if (lead.error) { console.error("Graph error", lead.error); continue; }

        const answers: Record<string, unknown> = {};
        for (const f of lead.field_data ?? []) answers[f.name] = (f.values ?? []).join(", ");
        const p = pickFields(answers);

        const formId = String(lead.form_id ?? v.form_id ?? "");
        if (formId && !formNames.has(formId)) {
          const fr = await fetch(`${GRAPH}/${formId}?fields=name&access_token=${pageToken}`);
          const fj = await fr.json();
          formNames.set(formId, fj.name ?? "");
        }

        await insertLead(integ, {
          source: "meta",
          source_detail: lead.campaign_name ?? formNames.get(formId) ?? integ.name,
          external_id: String(v.leadgen_id),
          name: p.name, phone: p.phone, email: p.email, city: p.city,
          budget: p.budget, message: p.message, project_name: p.project_name,
          extra: {
            ...p.extra,
            _meta: {
              form: formNames.get(formId) || formId, ad: lead.ad_name, adset: lead.adset_name,
              campaign: lead.campaign_name, platform: lead.platform, organic: lead.is_organic,
            },
          },
        });
      } catch (e) {
        console.error("meta lead failed", v.leadgen_id, e);
      }
    }
  }
  // Always 200 so Meta doesn't keep retrying payloads we chose to skip.
  return json({ ok: true });
});
