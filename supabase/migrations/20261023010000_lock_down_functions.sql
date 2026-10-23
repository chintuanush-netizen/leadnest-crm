-- Trigger functions: never callable over the API (triggers still fire).
revoke execute on function public.handle_new_user(), public.leads_before_insert(), public.leads_after_insert(),
  public.leads_after_update() from public, anon, authenticated;
-- RLS helpers and RPCs: signed-in users only.
revoke execute on function public.is_member(uuid), public.is_admin(uuid), public.shares_workspace(uuid),
  public.create_workspace(text), public.accept_invite(text) from public, anon;
grant execute on function public.is_member(uuid), public.is_admin(uuid), public.shares_workspace(uuid),
  public.create_workspace(text), public.accept_invite(text) to authenticated;
