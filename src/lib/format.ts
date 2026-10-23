import type { LeadStatus, Member } from "./types";

export const STATUSES: { value: LeadStatus; label: string; tone: string }[] = [
  { value: "new", label: "New", tone: "red" },
  { value: "contacted", label: "Contacted", tone: "amber" },
  { value: "site_visit_scheduled", label: "Visit scheduled", tone: "blue" },
  { value: "site_visit_done", label: "Visit done", tone: "violet" },
  { value: "negotiation", label: "Negotiation", tone: "teal" },
  { value: "booked", label: "Booked", tone: "green" },
  { value: "lost", label: "Lost", tone: "gray" },
  { value: "junk", label: "Junk", tone: "gray" },
];
export const statusInfo = (s: string) => STATUSES.find((x) => x.value === s) ?? STATUSES[0];

export const SOURCES: Record<string, string> = {
  meta: "Meta", google: "Google Ads", whatsapp: "WhatsApp",
  website: "Website", portal: "Portal", manual: "Manual", import: "Import",
};

export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

export const waLink = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "")}`;

export const memberName = (m?: Member | null) =>
  m ? (m.profiles?.full_name || m.profiles?.email || "Teammate") : "Unassigned";

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}

export function download(filename: string, text: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function randomKey(len = 24): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, len);
}
