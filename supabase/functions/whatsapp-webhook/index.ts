// WhatsApp Cloud API webhook (one endpoint for every client's number).
//
//   Callback URL:  {SUPABASE_URL}/functions/v1/whatsapp-webhook
//   Verify token:  META_VERIFY_TOKEN
//   Field:         messages
//
// A first message from a new number creates a lead; later messages from the
// same number are added to that lead's timeline.
import {
  admin, insertLead, integrationByExternalId, json, normalizePhone, verifyMetaSignature,
} from "../_shared/leads.ts";

interface WaValue {
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id: string; profile?: { name?: string } }[];
  messages?: { id: string; from: string; type: string; text?: { body?: string };
    button?: { text?: string }; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } } }[];
}

function messageText(m: NonNullable<WaValue["messages"]>[number]): string {
  return m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ??
    m.interactive?.list_reply?.title ?? `[${m.type}]`;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
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
  let body: { entry?: { changes?: { field: string; value: WaValue }[] }[] };
  try { body = JSON.parse(raw); } catch { return json({ ok: false }, 400); }

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const v = change.value;
      const phoneNumberId = v.metadata?.phone_number_id;
      if (!phoneNumberId || !v.messages?.length) continue; // status updates etc.

      const integ = await integrationByExternalId("whatsapp", phoneNumberId);
      if (!integ) { console.warn("No workspace for WhatsApp number", phoneNumberId); continue; }

      for (const m of v.messages) {
        try {
          const phone = normalizePhone("+" + m.from);
          const profileName = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? null;
          const text = messageText(m);

          const { data: existing } = await admin.from("leads").select("id")
            .eq("workspace_id", integ.workspace_id).eq("phone", phone)
            .order("created_at", { ascending: false }).limit(1).maybeSingle();

          if (existing) {
            await admin.from("lead_activities").insert({
              lead_id: existing.id, workspace_id: integ.workspace_id,
              type: "whatsapp", body: text, meta: { message_id: m.id },
            });
          } else {
            await insertLead(integ, {
              source: "whatsapp", source_detail: integ.name, external_id: m.id,
              name: profileName, phone, message: text,
            });
          }
        } catch (e) {
          console.error("whatsapp message failed", m.id, e);
        }
      }
    }
  }
  return json({ ok: true });
});
