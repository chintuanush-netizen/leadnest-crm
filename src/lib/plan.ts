import type { Workspace } from "./types";

export const LEADNEST_WHATSAPP = "917330804558";
export const contactLink = (ws?: Workspace | null, why = "continue using Leadnest CRM") =>
  `https://wa.me/${LEADNEST_WHATSAPP}?text=${encodeURIComponent(`Hi, I'd like to ${why}${ws ? ` for "${ws.name}"` : ""}.`)}`;

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export interface PlanState { locked: boolean; label: string; tone: "ok" | "warn" | "bad"; daysLeft: number | null }

/** What a workspace's plan means right now. Leads keep arriving even when locked. */
export function planState(ws: Workspace): PlanState {
  const days = (iso: string | null) => (iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 864e5) : null);
  if (ws.plan === "suspended") return { locked: true, label: "Account paused", tone: "bad", daysLeft: null };
  if (ws.plan === "active") {
    const d = days(ws.paid_until);
    if (d === null) return { locked: false, label: "Active plan", tone: "ok", daysLeft: null };
    if (d <= 0) return { locked: true, label: `Plan ended ${fmt(ws.paid_until!)}`, tone: "bad", daysLeft: d };
    return { locked: false, label: d <= 7 ? `Plan renews in ${d} day${d === 1 ? "" : "s"}` : `Active until ${fmt(ws.paid_until!)}`, tone: d <= 7 ? "warn" : "ok", daysLeft: d };
  }
  const d = days(ws.trial_ends_at) ?? 0;
  if (d <= 0) return { locked: true, label: "Free trial ended", tone: "bad", daysLeft: d };
  return { locked: false, label: `Free trial: ${d} day${d === 1 ? "" : "s"} left`, tone: d <= 3 ? "warn" : "ok", daysLeft: d };
}
