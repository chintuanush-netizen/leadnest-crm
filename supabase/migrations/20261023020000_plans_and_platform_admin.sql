-- Plans: trial | active | suspended. Only Leadnest platform admins (or server-side code) may change them.
alter table public.workspaces add column if not exists paid_until timestamptz;
alter table public.workspaces add constraint workspaces_plan_check check (plan in ('trial', 'active', 'suspended'));

create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;  -- no policies: invisible over the API
-- Add platform admins by email (SQL editor):
--   insert into public.platform_admins (user_id) select id from auth.users where email = 'you@example.com';

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

create or replace function public.workspaces_protect_plan() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_platform_admin()
     and (new.plan is distinct from old.plan
          or new.trial_ends_at is distinct from old.trial_ends_at
          or new.paid_until is distinct from old.paid_until) then
    raise exception 'Plan and trial dates can only be changed by Leadnest';
  end if;
  return new;
end $$;
create trigger workspaces_protect_plan before update on public.workspaces
  for each row execute function public.workspaces_protect_plan();

create or replace function public.admin_overview()
returns table (
  id uuid, name text, created_at timestamptz, plan text, trial_ends_at timestamptz, paid_until timestamptz,
  owner_email text, members bigint, leads bigint, leads_7d bigint, last_lead timestamptz, sources bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed'; end if;
  return query
  select w.id, w.name, w.created_at, w.plan, w.trial_ends_at, w.paid_until,
    (select p.email from workspace_members m join profiles p on p.id = m.user_id
      where m.workspace_id = w.id and m.role = 'owner' order by m.created_at limit 1),
    (select count(*) from workspace_members m where m.workspace_id = w.id),
    (select count(*) from leads l where l.workspace_id = w.id),
    (select count(*) from leads l where l.workspace_id = w.id and l.created_at > now() - interval '7 days'),
    (select max(l.created_at) from leads l where l.workspace_id = w.id),
    (select count(*) from integrations i where i.workspace_id = w.id)
  from workspaces w
  order by w.created_at desc;
end $$;

create or replace function public.admin_set_plan(p_workspace uuid, p_plan text, p_trial_ends_at timestamptz, p_paid_until timestamptz)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed'; end if;
  if p_plan not in ('trial', 'active', 'suspended') then raise exception 'Unknown plan %', p_plan; end if;
  update workspaces set plan = p_plan, trial_ends_at = coalesce(p_trial_ends_at, trial_ends_at), paid_until = p_paid_until
   where id = p_workspace;
end $$;

revoke execute on function public.workspaces_protect_plan() from public, anon, authenticated;
revoke execute on function public.is_platform_admin(), public.admin_overview(),
  public.admin_set_plan(uuid, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.is_platform_admin(), public.admin_overview(),
  public.admin_set_plan(uuid, text, timestamptz, timestamptz) to authenticated;
