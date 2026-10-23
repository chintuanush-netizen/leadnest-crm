// Universal lead webhook: landing pages, website forms, property portals,
// Zapier / Pabbly / Make, Elementor, WordPress, Webflow, etc.
//
//   POST {SUPABASE_URL}/functions/v1/ingest?token=<integration token>
//
// Accepts JSON (object or array), form-urlencoded or multipart.
// Plain HTML forms can pass a hidden "_redirect" field to land on a thank-you page.
import { corsHeaders, insertLead, integrationByToken, json, pickFields } from "../_shared/leads.ts";

type Payload = Record<string, unknown>;

function flatten(obj: unknown, out: Payload = {}): Payload {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Payload)) {
      if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, out);
      else if (!(k in out)) out[k] = Array.isArray(v) ? v.join(", ") : v;
    }
  }
  return out;
}

async function readPayloads(req: Request): Promise<Payload[]> {
  const url = new URL(req.url);
  const base: Payload = {};
  url.searchParams.forEach((v, k) => { if (k !== "token") base[k] = v; });
  if (req.method === "GET") return [base];

  const ct = req.headers.get("content-type") ?? "";
  const text = await req.text();
  let parsed: unknown = null;

  if (ct.includes("application/x-www-form-urlencoded")) {
    parsed = Object.fromEntries(new URLSearchParams(text));
  } else if (ct.includes("multipart/form-data")) {
    const fd = await new Response(text, { headers: { "content-type": ct } }).formData();
    const o: Payload = {};
    fd.forEach((v, k) => { o[k] = typeof v === "string" ? v : ""; });
    parsed = o;
  } else {
    try { parsed = JSON.parse(text); } catch { parsed = Object.fromEntries(new URLSearchParams(text)); }
  }

  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.map((p) => ({ ...base, ...flatten(p) }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? url.pathname.split("/").pop() ?? null;
  const integ = await integrationByToken(token, ["webhook", "portal"]);
  if (!integ) return json({ ok: false, error: "Unknown or missing token" }, 401);
  if (!integ.active) return json({ ok: false, error: "This source is paused" }, 403);

  let payloads: Payload[];
  try { payloads = await readPayloads(req); }
  catch { return json({ ok: false, error: "Could not read request body" }, 400); }

  const redirect = typeof payloads[0]?._redirect === "string" ? String(payloads[0]._redirect) : null;
  const results = [];

  for (const raw of payloads) {
    // honeypot fields: bots fill them, people don't
    if (raw._gotcha || raw._honeypot) { results.push({ ok: true, skipped: "spam" }); continue; }

    const f = pickFields(raw);
    if (!f.phone && !f.email) {
      results.push({ ok: false, error: "A phone number or email is required" });
      continue;
    }
    try {
      const r = await insertLead(integ, {
        source: integ.type === "portal" ? "portal" : "website",
        source_detail: f.source_detail ?? integ.name,
        external_id: f.external_id,
        name: f.name, phone: f.phone, email: f.email, city: f.city,
        budget: f.budget, message: f.message, project_name: f.project_name,
        extra: f.extra, utm: f.utm,
      });
      results.push({ ok: true, lead_id: r.id, duplicate: r.duplicate });
    } catch (e) {
      console.error("ingest insert failed", e);
      results.push({ ok: false, error: "Could not save lead" });
    }
  }

  if (redirect && /^https?:\/\//.test(redirect)) {
    return new Response(null, { status: 303, headers: { ...corsHeaders, Location: redirect } });
  }
  const allFailed = results.every((r) => !r.ok);
  return json(results.length === 1 ? results[0] : { ok: !allFailed, results }, allFailed ? 422 : 200);
});
