import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type { Member, Workspace } from "../lib/types";

interface Ctx {
  session: Session | null;
  loading: boolean;
  workspaces: Workspace[];
  current: Workspace | null;
  members: Member[];
  isAdmin: boolean;
  isPlatformAdmin: boolean;
  setCurrent: (id: string) => void;
  refresh: () => Promise<void>;
  refreshMembers: () => Promise<void>;
}

const SessionCtx = createContext<Ctx | null>(null);
const KEY = "leadnest.workspace";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [wsReady, setWsReady] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(() => {
    try { return localStorage.getItem(KEY); } catch { return null; }
  });
  const [members, setMembers] = useState<Member[]>([]);
  const [isPlatformAdmin, setPlatformAdmin] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const uid = session?.user.id;

  useEffect(() => {
    if (!uid) { setPlatformAdmin(false); return; }
    supabase.rpc("is_platform_admin").then(({ data }) => setPlatformAdmin(data === true));
  }, [uid]);

  const refresh = useCallback(async () => {
    if (!uid) { setWorkspaces([]); setWsReady(true); return; }
    const { data } = await supabase.from("workspace_members")
      .select("role, workspaces(id, name, plan, trial_ends_at, paid_until, auto_assign)")
      .eq("user_id", uid);
    const list: Workspace[] = ((data ?? []) as any[])
      .filter((r) => r.workspaces)
      .map((r) => ({ ...r.workspaces, role: r.role }));
    list.sort((a, b) => a.name.localeCompare(b.name));
    setWorkspaces(list);
    setWsReady(true);
  }, [uid]);

  useEffect(() => { setWsReady(false); refresh(); }, [refresh]);

  const current = workspaces.find((w) => w.id === currentId) ?? workspaces[0] ?? null;

  const refreshMembers = useCallback(async () => {
    if (!current) { setMembers([]); return; }
    const { data } = await supabase.from("workspace_members")
      .select("user_id, role, profiles(email, full_name)")
      .eq("workspace_id", current.id);
    setMembers((data ?? []) as unknown as Member[]);
  }, [current?.id]);

  useEffect(() => { refreshMembers(); }, [refreshMembers]);

  const setCurrent = (id: string) => {
    setCurrentId(id);
    try { localStorage.setItem(KEY, id); } catch { /* storage unavailable */ }
  };

  const value: Ctx = {
    session,
    loading: !authReady || (Boolean(session) && !wsReady),
    workspaces,
    current,
    members,
    isAdmin: current?.role === "owner" || current?.role === "admin",
    isPlatformAdmin,
    setCurrent,
    refresh,
    refreshMembers,
  };
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionCtx);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
