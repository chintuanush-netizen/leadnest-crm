export type Role = "owner" | "admin" | "agent";
export type LeadStatus =
  | "new" | "contacted" | "site_visit_scheduled" | "site_visit_done"
  | "negotiation" | "booked" | "lost" | "junk";
export type IntegrationType = "webhook" | "portal" | "meta" | "google" | "whatsapp";

export interface Workspace {
  id: string;
  name: string;
  plan: string;
  trial_ends_at: string;
  paid_until: string | null;
  auto_assign: boolean;
  role: Role;
}

export interface Lead {
  id: string;
  workspace_id: string;
  integration_id: string | null;
  project_id: string | null;
  source: string;
  source_detail: string | null;
  external_id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  budget: string | null;
  message: string | null;
  extra: Record<string, unknown>;
  utm: Record<string, string>;
  status: LeadStatus;
  assigned_to: string | null;
  duplicate_of: string | null;
  next_follow_up: string | null;
  ai_score?: "hot" | "warm" | "cold" | null;
  ai_summary?: string | null;
  ai_next_step?: string | null;
  ai_scored_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Project { id: string; name: string; location: string | null }

export interface Member {
  user_id: string;
  role: Role;
  profiles: { email: string; full_name: string | null } | null;
}

export interface Integration {
  id: string;
  workspace_id: string;
  type: IntegrationType;
  name: string;
  token: string;
  external_id: string | null;
  project_id: string | null;
  settings: Record<string, string>;
  active: boolean;
  last_lead_at: string | null;
  lead_count: number;
  created_at: string;
}

export interface Activity {
  id: number;
  lead_id: string;
  actor_id: string | null;
  type: string;
  body: string | null;
  meta: Record<string, unknown>;
  created_at: string;
}

export interface Invite { id: string; email: string; role: Role; token: string; created_at: string; accepted_at: string | null }
