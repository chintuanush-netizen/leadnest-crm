import { useCallback, useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { useSession } from "../context/Session";
import type { Invite, Role } from "../lib/types";
import { memberName, timeAgo } from "../lib/format";

const ROLE_HELP: Record<Role, string> = {
  owner: "Full control, billing",
  admin: "Sees all leads, manages sources and team",
  agent: "Sees only leads assigned to them",
};

export default function TeamPage() {
  const { current, members, refreshMembers, session } = useSession();
  const wsId = current!.id;
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("agent");
  const [error, setError] = useState("");
  const [lastLink, setLastLink] = useState("");

  const loadInvites = useCallback(async () => {
    const { data } = await supabase.from("workspace_invites").select("*")
      .eq("workspace_id", wsId).is("accepted_at", null).order("created_at", { ascending: false });
    setInvites((data ?? []) as Invite[]);
  }, [wsId]);
  useEffect(() => { loadInvites(); }, [loadInvites]);

  const inviteLink = (t: string) => `${window.location.origin}/invite/${t}`;

  async function invite(e: FormEvent) {
    e.preventDefault();
    setError("");
    const { data, error } = await supabase.from("workspace_invites")
      .insert({ workspace_id: wsId, email: email.trim().toLowerCase(), role, invited_by: session!.user.id })
      .select("*").single();
    if (error) return setError(error.message);
    setLastLink(inviteLink(data.token));
    setEmail("");
    loadInvites();
  }

  async function changeRole(userId: string, newRole: Role) {
    const { error } = await supabase.from("workspace_members").update({ role: newRole }).eq("workspace_id", wsId).eq("user_id", userId);
    if (error) setError(error.message);
    refreshMembers();
  }
  async function removeMember(userId: string) {
    if (!confirm("Remove this person from the workspace? Leads assigned to them stay with them until you reassign.")) return;
    const { error } = await supabase.from("workspace_members").delete().eq("workspace_id", wsId).eq("user_id", userId);
    if (error) setError(error.message);
    refreshMembers();
  }
  async function revoke(id: string) {
    await supabase.from("workspace_invites").delete().eq("id", id);
    loadInvites();
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Team</h1>
          <p className="muted">Invite your sales team. Agents only see the leads assigned to them.</p>
        </div>
      </header>

      <form className="card invite-form" onSubmit={invite}>
        <input type="email" placeholder="teammate@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="agent">Sales agent</option>
          <option value="admin">Admin</option>
        </select>
        <button className="btn primary">Create invite</button>
      </form>
      {lastLink && (
        <div className="notice ok">
          Invite created. Send this link to your teammate on WhatsApp or email:
          <div className="row gap"><code className="grow">{lastLink}</code>
            <button className="btn small" onClick={() => navigator.clipboard.writeText(lastLink)}>Copy</button>
          </div>
        </div>
      )}
      {error && <div className="notice error">{error}</div>}

      <section className="card flush">
        {members.map((m) => (
          <div key={m.user_id} className="member-row">
            <span className="avatar">{memberName(m).charAt(0).toUpperCase()}</span>
            <div className="grow">
              <b>{memberName(m)}</b>{m.user_id === session!.user.id && <span className="muted"> (you)</span>}
              <div className="muted small">{m.profiles?.email}</div>
            </div>
            {m.role === "owner" || m.user_id === session!.user.id ? (
              <span className="muted small" title={ROLE_HELP[m.role]}>{m.role}</span>
            ) : (
              <>
                <select value={m.role} onChange={(e) => changeRole(m.user_id, e.target.value as Role)} title={ROLE_HELP[m.role]}>
                  <option value="agent">Sales agent</option>
                  <option value="admin">Admin</option>
                </select>
                <button className="link danger small" onClick={() => removeMember(m.user_id)}>Remove</button>
              </>
            )}
          </div>
        ))}
      </section>

      {invites.length > 0 && (
        <>
          <h3 className="section-title">Pending invites</h3>
          <section className="card flush">
            {invites.map((i) => (
              <div key={i.id} className="member-row">
                <span className="avatar muted-bg">✉</span>
                <div className="grow"><b>{i.email}</b><div className="muted small">{i.role} · invited {timeAgo(i.created_at)}</div></div>
                <button className="btn small" onClick={() => navigator.clipboard.writeText(inviteLink(i.token))}>Copy link</button>
                <button className="link danger small" onClick={() => revoke(i.id)}>Revoke</button>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
