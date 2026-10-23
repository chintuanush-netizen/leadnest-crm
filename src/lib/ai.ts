// Leadnest AI: one way to ask Claude, plus the prompts for each feature.
// Live app  -> Supabase edge function "ai" (holds the Anthropic API key).
// Demo mode -> the claude.ai artifact "sample" capability (viewer's own Claude).
import { isDemo, supabase } from "./supabase";
import { SOURCES, statusInfo, STATUSES } from "./format";
import type { Activity, Lead, LeadStatus } from "./types";

export type Turn = { role: "user" | "assistant"; content: string };
type Tier = "quick" | "default";
interface AskOpts { wsId: string; tier?: Tier; onText?: (text: string) => void; signal?: AbortSignal; fresh?: boolean }

export class AiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

let samplePromise: Promise<any> | null = null;
function getSample(): Promise<any> {
  const c = (window as any).claude;
  if (!c?.use) return Promise.resolve(null);
  return (samplePromise ??= c.use("sample").catch(() => null));
}

/** Is AI usable here? (Demo: only inside the claude.ai viewer.) */
export async function aiAvailable(): Promise<boolean> {
  if (!isDemo) return true;
  return Boolean(await getSample());
}

export async function ask(input: string | Turn[], o: AskOpts): Promise<string> {
  if (isDemo) {
    const sample = await getSample();
    if (!sample) throw new AiError("unavailable", "AI works when this demo is opened inside Claude.");
    try {
      const { text } = await sample(input, {
        modelTier: o.tier ?? "default",
        signal: o.signal,
        onText: o.onText ? ({ text }: { text: string }) => o.onText!(text) : undefined,
        cache: o.fresh ? false : undefined,
      });
      return text;
    } catch (e: any) {
      throw new AiError(e?.code ?? "error", friendly(e?.code));
    }
  }
  const { data, error } = await supabase.functions.invoke("ai", { body: { workspace_id: o.wsId, input, tier: o.tier ?? "default" } });
  if (error || !data?.text) {
    let msg = "AI request failed. Try again.";
    try { const b = await (error as any)?.context?.json?.(); if (b?.error) msg = b.error; } catch { /* keep default */ }
    throw new AiError("error", msg);
  }
  o.onText?.(data.text);
  return data.text as string;
}

export async function askJson<T>(prompt: string, o: AskOpts): Promise<T> {
  const text = await ask(prompt + "\n\nReply with ONLY the JSON, no other text.", o);
  const parsed = parseJson(text);
  if (parsed === undefined) throw new AiError("invalid_json", "AI gave an unreadable answer. Try again.");
  return parsed as T;
}

function parseJson(t: string): unknown {
  const tries = [t, t.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]];
  const a = t.search(/[[{]/), b = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (a >= 0 && b > a) tries.push(t.slice(a, b + 1));
  for (const s of tries) { if (!s) continue; try { return JSON.parse(s); } catch { /* next */ } }
  return undefined;
}

function friendly(code?: string): string {
  switch (code) {
    case "not_granted": return "AI was not allowed for this page. Allow it from the artifact's permissions to use it.";
    case "rate_limited": return "Too many AI requests right now. Wait a minute and try again.";
    case "cancelled": return "Stopped.";
    case "sampling_disabled": return "AI is not available on this account.";
    default: return "AI request failed. Try again.";
  }
}

// ---------- shared context ----------
export const nowIST = () =>
  new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" });

const fmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";

export interface LeadCtx { project?: string; owner?: string; activities?: Activity[]; describe?: (a: Activity) => string }

export function leadBlock(l: Lead, c: LeadCtx = {}): string {
  const lines = [
    `Name: ${l.name ?? "Unknown"}`,
    l.city && `City: ${l.city}`,
    l.budget && `Budget: ${l.budget}`,
    `Source: ${SOURCES[l.source] ?? l.source}${l.source_detail ? ` (${l.source_detail})` : ""}`,
    c.project && `Project: ${c.project}`,
    `Status: ${statusInfo(l.status).label}`,
    c.owner && `Owner: ${c.owner}`,
    `Received: ${fmt(l.created_at)}`,
    l.next_follow_up && `Next follow-up: ${fmt(l.next_follow_up)}`,
    l.duplicate_of && `Repeat enquiry: yes`,
    l.message && `Their message: ${l.message}`,
  ];
  for (const [k, v] of Object.entries(l.extra ?? {})) if (!k.startsWith("_") && v !== "" && v != null) lines.push(`${k.replace(/[_-]+/g, " ")}: ${v}`);
  const acts = (c.activities ?? []).slice(0, 12).map((a) => `- ${fmt(a.created_at)}: ${c.describe ? c.describe(a) : a.body ?? a.type}`);
  if (acts.length) lines.push("History (newest first):", ...acts);
  return lines.filter(Boolean).join("\n");
}

// ---------- 1. score + summary ----------
export interface Score { id: string; score: "hot" | "warm" | "cold"; summary: string; next_step: string }

const SCORE_RULES = `Score each real estate lead for an Indian builder's sales team:
- hot: clear buying intent now (budget fits, buying within ~3 months, asked for price/site visit/brochure, visit done or negotiating, actively replying)
- warm: genuine interest but slower or unclear (3-6+ months, no budget given, contacted but no commitment yet)
- cold: weak or bad (test/junk entries, wrong number, lost, no response, far-off timeline, budget far below the project)
summary: one short line (max 18 words) on who they are and what they want.
next_step: one concrete action for the salesperson (max 14 words), e.g. "Call before 7pm today and offer Saturday site visit".`;

export async function scoreLeads(items: { lead: Lead; ctx: LeadCtx }[], wsId: string): Promise<Score[]> {
  const blocks = items.map(({ lead, ctx }) => `### id: ${lead.id}\n${leadBlock(lead, ctx)}`).join("\n\n");
  const out = await askJson<Score[]>(
    `${SCORE_RULES}\n\nNow: ${nowIST()} IST.\n\nLeads:\n\n${blocks}\n\nReturn a JSON array with one object per lead: {"id": string, "score": "hot"|"warm"|"cold", "summary": string, "next_step": string}.`,
    { wsId, tier: "quick", fresh: true },
  );
  const ok = new Set(items.map((i) => i.lead.id));
  return (Array.isArray(out) ? out : []).filter((s) => s && ok.has(String(s.id)) && ["hot", "warm", "cold"].includes(s.score))
    .map((s) => ({ id: String(s.id), score: s.score, summary: String(s.summary ?? ""), next_step: String(s.next_step ?? "") }));
}

// ---------- 2. WhatsApp writer ----------
export const WA_GOALS = [
  { value: "first", label: "First follow-up" },
  { value: "visit", label: "Invite for site visit" },
  { value: "brochure", label: "Share brochure & price" },
  { value: "reminder", label: "Remind about visit" },
  { value: "revive", label: "Re-engage a cold lead" },
  { value: "thanks", label: "Thank you after visit" },
];
export const WA_LANGS = ["English", "Telugu", "Hindi", "Telugu + English mix", "Hindi + English mix"];

export function draftWhatsApp(lead: Lead, ctx: LeadCtx, goal: string, lang: string, sender: string, o: AskOpts) {
  const g = WA_GOALS.find((x) => x.value === goal)?.label ?? goal;
  return ask(
    `Write a WhatsApp message from ${sender || "the sales team"} to this property enquiry.
Goal: ${g}
Language: ${lang}${/Telugu|Hindi/.test(lang) && !/mix/.test(lang) ? " (native script)" : ""}${/mix/.test(lang) ? " (written in English letters, natural everyday mix)" : ""}
Rules: warm and personal, sounds like a real person not a bot; 40-90 words; at most one emoji; use their first name; mention the project if known; end with one easy question or a clear next step; no hashtags; do not invent prices, offers, dates or amenities that are not in the data; if a detail is needed but unknown, write it as [brackets] for the salesperson to fill.
Output only the message text.

Now: ${nowIST()} IST.

Lead:
${leadBlock(lead, ctx)}`,
    { ...o, fresh: true },
  );
}

// ---------- 3. notes cleanup ----------
export interface TidyResult { note: string; status: LeadStatus | null; next_follow_up: string | null; follow_up_label: string | null }

export async function tidyNote(raw: string, lead: Lead, ctx: LeadCtx, wsId: string): Promise<TidyResult> {
  const statuses = STATUSES.map((s) => `${s.value} (${s.label})`).join(", ");
  const r = await askJson<any>(
    `A salesperson typed this rough call note about a real estate lead (it may mix Telugu/Hindi/English, typos, shorthand):
"""${raw}"""

Lead:
${leadBlock(lead, { ...ctx, activities: [] })}

Now: ${nowIST()} IST (Asia/Kolkata, UTC+05:30).

Return JSON:
{"note": clean, factual note in English, 1-3 short sentences, keep every fact (budget, config, timing, objections, family members, visit plans),
 "status": the status this note implies, or null if it does not change; one of: ${statuses},
 "next_follow_up": ISO 8601 date-time with +05:30 offset if the note mentions or clearly implies a next call/visit time (e.g. "call sunday evening" = that Sunday 18:00), else null,
 "follow_up_label": that time in words like "Sun 26 Oct, 6:00 pm", else null}`,
    { wsId, tier: "default", fresh: true },
  );
  const valid = STATUSES.some((s) => s.value === r?.status);
  const d = r?.next_follow_up ? new Date(r.next_follow_up) : null;
  return {
    note: String(r?.note || raw).trim(),
    status: valid && r.status !== lead.status ? r.status : null,
    next_follow_up: d && !isNaN(d.getTime()) ? d.toISOString() : null,
    follow_up_label: r?.follow_up_label ? String(r.follow_up_label) : null,
  };
}

// ---------- 4. ask your leads ----------
export function leadsTable(leads: Lead[], project: (id: string | null) => string, owner: (id: string | null) => string): string {
  const head = "name | phone | source | source detail | project | status | owner | city | budget | received | next follow-up | AI score | repeat";
  const rows = leads.map((l) => [
    l.name ?? "", l.phone ?? "", SOURCES[l.source] ?? l.source, l.source_detail ?? "", project(l.project_id), statusInfo(l.status).label,
    owner(l.assigned_to), l.city ?? "", l.budget ?? "", fmt(l.created_at), fmt(l.next_follow_up), l.ai_score ?? "", l.duplicate_of ? "yes" : "",
  ].map((v) => String(v).replace(/\|/g, "/")).join(" | "));
  return [head, ...rows].join("\n");
}

export function askLeads(turns: Turn[], table: string, total: number, o: AskOpts) {
  const rules = `You answer questions about this real estate CRM's leads, for the sales team.
Use ONLY the table below. Count carefully. If the answer is not in the data, say so plainly.
Keep answers short: lead with the answer, then a few bullet points ("- ") naming leads as "Name (phone)". Use **bold** sparingly. No tables.
Now: ${nowIST()} IST. "Today" means that date in IST.
The table has ${total} lead(s), newest first:

${table}`;
  const [first, ...rest] = turns;
  return ask([{ role: "user", content: `${rules}\n\nQuestion: ${first.content}` }, ...rest], { ...o, fresh: true });
}
