// Called from the client portal after "Continue with Facebook".
// Requires the signed-in user's Supabase JWT (deploy WITH jwt verification).
//
//   { action: "list_pages",   workspace_id, user_token }
//   { action: "connect_page", workspace_id, user_token, page_id, project_id? }
import { createClient } from "npm:@supabase/supabase-js@2";
import { admin, corsHeaders, GRAPH, json } from "../_shared/leads.ts";

interface Page { id: string; name: string; access_token: string }

async function longLivedUserToken(shortToken: string): Promise<string> {
  const qs = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: Deno.env.get("META_APP_ID")!,
    client_secret: Deno.env.get("META_APP_SECRET")!,
    fb_exchange_token: shortToken,
  });
  const r = await fetch(`${GRAPH}/oauth/access_token?${qs}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.access_token;
}

async function listPages(userToken: string): Promise<Page[]> {
  const pages: Page[] = [];
  let next: string | null = `${GRAPH}/me/accounts?fields=id,name,access_token&limit=100&access_token=${userToken}`;
  while (next) {
    const r: Response = await fetch(next);
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    pages.push(...(j.data ?? []));
    next = j.paging?.next ?? null;
  }
  return pages;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Who is calling?
  const authed = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await authed.auth.getUser();
  if (!user) return json({ error: "Not signed in" }, 401);

  const body = await req.json().catch(() => ({}));
  const { action, workspace_id, user_token, page_id, project_id } = body;
  if (!workspace_id || !user_token) return json({ error: "workspace_id and user_token are required" }, 400);

  const { data: member } = await admin.from("workspace_members").select("role")
    .eq("workspace_id", workspace_id).eq("user_id", user.id).maybeSingle();
  if (!member || !["owner", "admin"].includes(member.role)) {
    return json({ error: "Only workspace admins can connect Facebook pages" }, 403);
  }

  try {
    const longToken = await longLivedUserToken(user_token);
    const pages = await listPages(longToken);

    if (action === "list_pages") {
      return json({ pages: pages.map((p) => ({ id: p.id, name: p.name })) });
    }

    if (action === "connect_page") {
      const page = pages.find((p) => p.id === String(page_id));
      if (!page) return json({ error: "You don't manage that page" }, 404);

      // Subscribe our app to this page's leadgen events
      const sub = await fetch(`${GRAPH}/${page.id}/subscribed_apps`, {
        method: "POST",
        body: new URLSearchParams({ subscribed_fields: "leadgen", access_token: page.access_token }),
      });
      const sj = await sub.json();
      if (!sj.success) throw new Error(sj.error?.message ?? "Could not subscribe the page");

      const { data: existing } = await admin.from("integrations").select("id, workspace_id")
        .eq("type", "meta").eq("external_id", page.id).maybeSingle();
      if (existing && existing.workspace_id !== workspace_id) {
        return json({ error: "This page is already connected to another workspace" }, 409);
      }

      let integrationId = existing?.id as string | undefined;
      if (integrationId) {
        await admin.from("integrations")
          .update({ name: page.name, active: true, project_id: project_id ?? null })
          .eq("id", integrationId);
      } else {
        const { data: created, error } = await admin.from("integrations").insert({
          workspace_id, type: "meta", name: page.name, external_id: page.id,
          project_id: project_id ?? null, settings: { connected_by: user.email },
        }).select("id").single();
        if (error) throw error;
        integrationId = created.id;
      }

      // Page tokens derived from a long-lived user token don't expire.
      await admin.from("integration_secrets").upsert({
        integration_id: integrationId,
        data: { page_access_token: page.access_token },
        updated_at: new Date().toISOString(),
      });

      return json({ ok: true, integration_id: integrationId, page: { id: page.id, name: page.name } });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "Facebook request failed" }, 502);
  }
});
