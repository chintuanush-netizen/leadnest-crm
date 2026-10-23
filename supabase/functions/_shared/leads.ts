// Shared helpers for every lead intake endpoint.
import { createClient } from "npm:@supabase/supabase-js@2";

export const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export interface Integration {
  id: string;
  workspace_id: string;
  type: "webhook" | "portal" | "meta" | "google" | "whatsapp";
  name: string;
  token: string;
  external_id: string | null;
  project_id: string | null;
  settings: Record<string, unknown>;
  active: boolean;
}

export interface LeadInput {
  source: string;
  source_detail?: string | null;
  external_id?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  budget?: string | null;
  message?: string | null;
  project_name?: string | null;
  extra?: Record<string, unknown>;
  utm?: Record<string, string>;
}

export async function integrationByToken(token: string | null, types: Integration["type"][]) {
  if (!token) return null;
  const { data } = await admin.from("integrations").select("*")
    .eq("token", token).in("type", types).maybeSingle();
  return (data as Integration | null);
}

export async function integrationByExternalId(type: Integration["type"], externalId: string) {
  const { data } = await admin.from("integrations").select("*")
    .eq("type", type).eq("external_id", externalId).eq("active", true).maybeSingle();
  return (data as Integration | null);
}

/** Normalise Indian and international numbers to +<country><number>. */
export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const hasPlus = s.startsWith("+");
  const d = s.replace(/\D/g, "");
  if (!d) return null;
  if (hasPlus) return "+" + d;
  if (d.length === 10) return "+91" + d;
  if (d.length === 11 && d.startsWith("0")) return "+91" + d.slice(1);
  if (d.length === 12 && d.startsWith("91")) return "+" + d;
  if (d.startsWith("00")) return "+" + d.slice(2);
  return "+" + d;
}

const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");

const ALIASES = {
  name: ["name", "fullname", "yourname", "customername", "leadname", "contactname", "clientname"],
  first: ["firstname", "fname"],
  last: ["lastname", "lname", "surname"],
  phone: ["phone", "phonenumber", "mobile", "mobilenumber", "mobileno", "phoneno", "contact",
    "contactnumber", "contactno", "whatsapp", "whatsappnumber", "tel", "telephone", "number"],
  email: ["email", "emailaddress", "emailid", "mail", "workemail"],
  city: ["city", "location", "preferredlocation", "yourcity"],
  budget: ["budget", "pricerange", "budgetrange"],
  message: ["message", "comments", "comment", "query", "requirement", "requirements", "remarks",
    "description", "notes", "enquiry"],
  project: ["project", "projectname", "property", "propertyname", "listing"],
  external_id: ["leadid", "enquiryid", "queryid", "uniqueid"],
  source_detail: ["source", "leadsource", "portal", "campaign", "campaignname"],
};

/**
 * Turns any flat key/value payload (landing page form, portal push, Zapier,
 * Meta field_data, Google user_column_data) into lead columns.
 * Anything not recognised is kept in `extra`, so no answer is ever lost.
 */
export function pickFields(raw: Record<string, unknown>) {
  const used = new Set<string>();
  const byNorm = new Map<string, string>();
  for (const k of Object.keys(raw)) {
    if (!k.startsWith("_") && !byNorm.has(norm(k))) byNorm.set(norm(k), k);
  }
  const get = (aliases: string[]): string | null => {
    for (const a of aliases) {
      const k = byNorm.get(a);
      if (k === undefined) continue;
      const v = raw[k];
      if (v !== null && v !== undefined && String(v).trim() !== "") {
        used.add(k);
        return String(v).trim();
      }
    }
    return null;
  };

  let name = get(ALIASES.name);
  const first = get(ALIASES.first);
  const last = get(ALIASES.last);
  if (!name && (first || last)) name = [first, last].filter(Boolean).join(" ");

  const phone = get(ALIASES.phone);
  const email = get(ALIASES.email);

  const utm: Record<string, string> = {};
  for (const k of Object.keys(raw)) {
    const n = k.toLowerCase();
    if (n.startsWith("utm_") || n === "gclid" || n === "fbclid") {
      if (raw[k]) utm[n] = String(raw[k]);
      used.add(k);
    }
  }

  const fields = {
    name,
    phone: normalizePhone(phone),
    email: email ? email.toLowerCase() : null,
    city: get(ALIASES.city),
    budget: get(ALIASES.budget),
    message: get(ALIASES.message),
    project_name: get(ALIASES.project),
    external_id: get(ALIASES.external_id),
    source_detail: get(ALIASES.source_detail),
  };

  const extra: Record<string, unknown> = {};
  for (const k of Object.keys(raw)) {
    if (!used.has(k) && !k.startsWith("_") && k !== "token") extra[k] = raw[k];
  }
  return { ...fields, utm, extra };
}

/** Insert a lead for an integration. Skips exact re-deliveries (same external id). */
export async function insertLead(integ: Integration, input: LeadInput) {
  if (input.external_id) {
    const { data: existing } = await admin.from("leads").select("id")
      .eq("workspace_id", integ.workspace_id).eq("source", input.source)
      .eq("external_id", input.external_id).maybeSingle();
    if (existing) return { id: existing.id as string, duplicate: true };
  }

  let projectId = integ.project_id;
  if (input.project_name) {
    const { data: p } = await admin.from("projects").select("id")
      .eq("workspace_id", integ.workspace_id).ilike("name", input.project_name).maybeSingle();
    if (p) projectId = p.id;
  }

  const row = {
    workspace_id: integ.workspace_id,
    integration_id: integ.id,
    project_id: projectId,
    source: input.source,
    source_detail: input.source_detail ?? integ.name,
    external_id: input.external_id ?? null,
    name: input.name ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    city: input.city ?? null,
    budget: input.budget ?? null,
    message: input.message ?? null,
    extra: input.extra ?? {},
    utm: input.utm ?? {},
  };

  const { data, error } = await admin.from("leads").insert(row).select("id").single();
  if (error) {
    if (error.code === "23505") return { id: null, duplicate: true };
    throw error;
  }
  return { id: data.id as string, duplicate: false };
}

/** Verify Meta's X-Hub-Signature-256 header (used by Lead Ads and WhatsApp webhooks). */
export async function verifyMetaSignature(rawBody: string, header: string | null): Promise<boolean> {
  const secret = Deno.env.get("META_APP_SECRET");
  if (!secret) return false; // refuse unsigned payloads until META_APP_SECRET is set
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const expected = header.slice(7);
  if (hex.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export const GRAPH = `https://graph.facebook.com/${Deno.env.get("META_GRAPH_VERSION") ?? "v23.0"}`;
