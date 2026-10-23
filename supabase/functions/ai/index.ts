// AI endpoint: lead scoring, WhatsApp drafts, notes cleanup and "Ask your leads".
// The browser builds the prompt from data the signed-in user can already see
// (row-level security applies to those reads); this function checks the caller
// belongs to the workspace and forwards the prompt to Claude.
//
// Secrets: ANTHROPIC_API_KEY (required), AI_MODEL, AI_MODEL_QUICK (optional)
import { createClient } from "npm:@supabase/supabase-js@2";
import { admin, corsHeaders, json } from "../_shared/leads.ts";

const MODEL = Deno.env.get("AI_MODEL") ?? "claude-sonnet-5-5";
const MODEL_QUICK = Deno.env.get("AI_MODEL_QUICK") ?? "claude-haiku-5-5";
const MAX_INPUT_CHARS = 200_000;

type Turn = { role: "user" | "assistant"; content: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "AI is not set up yet: add the ANTHROPIC_API_KEY secret." }, 503);

  const authed = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await authed.auth.getUser();
  if (!user) return json({ error: "Not signed in" }, 401);

  const body = await req.json().catch(() => ({}));
  const { workspace_id, input, tier } = body as { workspace_id?: string; input?: string | Turn[]; tier?: string };
  if (!workspace_id || !input) return json({ error: "workspace_id and input are required" }, 400);

  const { data: member } = await admin.from("workspace_members").select("role")
    .eq("workspace_id", workspace_id).eq("user_id", user.id).maybeSingle();
  if (!member) return json({ error: "Not a member of this workspace" }, 403);

  const messages: Turn[] = typeof input === "string" ? [{ role: "user", content: input }] : input;
  const size = messages.reduce((n, m) => n + String(m.content ?? "").length, 0);
  if (!messages.length || size > MAX_INPUT_CHARS) return json({ error: "Request is empty or too large" }, 413);

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: tier === "quick" ? MODEL_QUICK : MODEL,
      max_tokens: 1500,
      system: "You are the assistant inside Leadnest CRM, a lead inbox used by real estate builders, developers and channel partners in India. Be concise, practical and accurate. Never invent leads, numbers or facts that are not in the data you are given.",
      messages,
    }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: out?.error?.message ?? `AI request failed (${r.status})` }, 502);
  const text = (out.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
  return json({ text });
});
