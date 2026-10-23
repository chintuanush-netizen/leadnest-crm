-- =====================================================================
-- Leadnest CRM — multi-tenant real estate lead CRM
-- Every client (builder / developer / agent) is a "workspace".
-- Row Level Security guarantees a workspace only ever sees its own data.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Types ----------------------------------------------------
create type public.member_role as enum ('owner', 'admin', 'agent');

create type public.lead_status as enum (
  'new', 'contacted', 'site_visit_scheduled', 'site_visit_done',
  'negotiation', 'booked', 'lost', 'junk'
);

create type public.integration_type as enum ('webhook', 'portal', 'meta', 'google', 'whatsapp');

-- ---------- Profiles (mirror of auth.users) --------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  created_at  timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- backfill for users that existed before this migration
insert into public.profiles (id, email, full_name)
select id, email, split_part(email, '@', 1) from auth.users
on conflict (id) do nothing;

-- ---------- Workspaces (one per client) ------------------------------
create table public.workspaces (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  plan           text not null default 'trial',
  trial_ends_at  timestamptz not null default now() + interval '14 days',
  auto_assign    boolean not null default false,   -- round-robin new leads to agents
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  role          public.member_role not null default 'agent',
  created_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members(user_id);

create table public.workspace_invites (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  email         text not null,
  role          public.member_role not null default 'agent',
  token         text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  invited_by    uuid references public.profiles(id) on delete set null,
  accepted_at   timestamptz,
  created_at    timestamptz not null default now()
);

create table public.projects (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  name          text not null,
  location      text,
  created_at    timestamptz not null default now()
);
create index projects_workspace_idx on public.projects(workspace_id);

-- ---------- Integrations (lead sources) ------------------------------
create table public.integrations (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  type          public.integration_type not null,
  name          text not null,
  token         text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  external_id   text,                 -- Meta page_id / WhatsApp phone_number_id
  project_id    uuid references public.projects(id) on delete set null,
  settings      jsonb not null default '{}',   -- e.g. google_key
  active        boolean not null default true,
  last_lead_at  timestamptz,
  lead_count    integer not null default 0,
  created_at    timestamptz not null default now()
);
create index integrations_workspace_idx on public.integrations(workspace_id);
-- a Facebook page / WhatsApp number can belong to only one workspace
create unique index integrations_external_unique
  on public.integrations(type, external_id) where external_id is not null;

-- Secrets (page access tokens etc). No RLS policies => only the service role can read/write.
create table public.integration_secrets (
  integration_id  uuid primary key references public.integrations(id) on delete cascade,
  data            jsonb not null default '{}',
  updated_at      timestamptz not null default now()
);

-- ---------- Leads ----------------------------------------------------
create table public.leads (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  integration_id  uuid references public.integrations(id) on delete set null,
  project_id      uuid references public.projects(id) on delete set null,
  source          text not null default 'manual',   -- meta | google | whatsapp | website | portal | manual
  source_detail   text,                             -- campaign / form / portal name
  external_id     text,                             -- id in the source system (for dedupe)
  name            text,
  phone           text,
  email           text,
  city            text,
  budget          text,
  message         text,
  extra           jsonb not null default '{}',      -- any other form answers
  utm             jsonb not null default '{}',
  status          public.lead_status not null default 'new',
  assigned_to     uuid references public.profiles(id) on delete set null,
  duplicate_of    uuid references public.leads(id) on delete set null,
  next_follow_up  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index leads_workspace_created_idx on public.leads(workspace_id, created_at desc);
create index leads_workspace_phone_idx   on public.leads(workspace_id, phone);
create index leads_assigned_idx          on public.leads(assigned_to);
create unique index leads_external_unique
  on public.leads(workspace_id, source, external_id) where external_id is not null;

create table public.lead_activities (
  id            bigserial primary key,
  lead_id       uuid not null references public.leads(id) on delete cascade,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  actor_id      uuid references public.profiles(id) on delete set null,
  type          text not null,          -- created | status | assigned | note | whatsapp
  body          text,
  meta          jsonb not null default '{}',
  created_at    timestamptz not null default now()
);
create index lead_activities_lead_idx on public.lead_activities(lead_id, created_at);

-- ---------- Helper functions ----------------------------------------
create or replace function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from workspace_members
                 where workspace_id = ws and user_id = auth.uid());
$$;

create or replace function public.is_admin(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from workspace_members
                 where workspace_id = ws and user_id = auth.uid()
                   and role in ('owner', 'admin'));
$$;

create or replace function public.shares_workspace(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from workspace_members a
                 join workspace_members b on a.workspace_id = b.workspace_id
                 where a.user_id = auth.uid() and b.user_id = other);
$$;

-- ---------- Lead triggers: dedupe, auto-assign, activity log ---------
create or replace function public.leads_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_dup   uuid;
  v_auto  boolean;
  v_agent uuid;
begin
  -- repeat enquiry from the same number within 90 days
  if new.phone is not null then
    select id into v_dup from leads
     where workspace_id = new.workspace_id and phone = new.phone
       and duplicate_of is null and created_at > now() - interval '90 days'
     order by created_at desc limit 1;
    new.duplicate_of := v_dup;
    -- keep the repeat enquiry with the same sales person
    if v_dup is not null and new.assigned_to is null then
      select assigned_to into v_agent from leads where id = v_dup;
      new.assigned_to := v_agent;
    end if;
  end if;

  -- round-robin to the agent who received a lead least recently
  if new.assigned_to is null then
    select auto_assign into v_auto from workspaces where id = new.workspace_id;
    if v_auto then
      select m.user_id into v_agent
        from workspace_members m
        left join lateral (
          select max(l.created_at) as last_at from leads l
           where l.workspace_id = m.workspace_id and l.assigned_to = m.user_id
        ) x on true
       where m.workspace_id = new.workspace_id and m.role = 'agent'
       order by x.last_at asc nulls first
       limit 1;
      new.assigned_to := v_agent;
    end if;
  end if;
  return new;
end $$;

create trigger leads_before_insert before insert on public.leads
  for each row execute function public.leads_before_insert();

create or replace function public.leads_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into lead_activities (lead_id, workspace_id, actor_id, type, body, meta)
  values (new.id, new.workspace_id, auth.uid(), 'created',
          case when new.duplicate_of is not null
               then 'Repeat enquiry: this number enquired before'
               else 'Lead received' end,
          jsonb_build_object('source', new.source, 'source_detail', new.source_detail));

  if new.integration_id is not null then
    update integrations
       set lead_count = lead_count + 1, last_lead_at = now()
     where id = new.integration_id;
  end if;
  return new;
end $$;

create trigger leads_after_insert after insert on public.leads
  for each row execute function public.leads_after_insert();

create or replace function public.leads_before_update() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger leads_before_update before update on public.leads
  for each row execute function public.leads_before_update();

create or replace function public.leads_after_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    insert into lead_activities (lead_id, workspace_id, actor_id, type, body, meta)
    values (new.id, new.workspace_id, auth.uid(), 'status', null,
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into lead_activities (lead_id, workspace_id, actor_id, type, body, meta)
    values (new.id, new.workspace_id, auth.uid(), 'assigned', null,
            jsonb_build_object('to', new.assigned_to));
  end if;
  return new;
end $$;

create trigger leads_after_update after update on public.leads
  for each row execute function public.leads_after_update();

-- ---------- RPCs -----------------------------------------------------
create or replace function public.create_workspace(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Workspace name is required'; end if;

  insert into profiles (id, email)
  select id, email from auth.users where id = auth.uid()
  on conflict (id) do nothing;

  insert into workspaces (name, created_by) values (trim(p_name), auth.uid())
  returning id into v_id;
  insert into workspace_members (workspace_id, user_id, role) values (v_id, auth.uid(), 'owner');
  return v_id;
end $$;

create or replace function public.accept_invite(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_inv   workspace_invites;
  v_email text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select email into v_email from auth.users where id = auth.uid();

  select * into v_inv from workspace_invites
   where token = p_token and accepted_at is null;
  if not found then raise exception 'Invite not found or already used'; end if;
  if lower(v_inv.email) <> lower(v_email) then
    raise exception 'This invite was sent to %', v_inv.email;
  end if;

  insert into profiles (id, email) values (auth.uid(), v_email) on conflict (id) do nothing;
  insert into workspace_members (workspace_id, user_id, role)
  values (v_inv.workspace_id, auth.uid(), v_inv.role)
  on conflict (workspace_id, user_id) do update set role = excluded.role;
  update workspace_invites set accepted_at = now() where id = v_inv.id;
  return v_inv.workspace_id;
end $$;

-- ---------- Row Level Security --------------------------------------
alter table public.profiles            enable row level security;
alter table public.workspaces          enable row level security;
alter table public.workspace_members   enable row level security;
alter table public.workspace_invites   enable row level security;
alter table public.projects            enable row level security;
alter table public.integrations        enable row level security;
alter table public.integration_secrets enable row level security;
alter table public.leads               enable row level security;
alter table public.lead_activities     enable row level security;

-- profiles
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.shares_workspace(id));
create policy profiles_update on public.profiles for update
  using (id = auth.uid());

-- workspaces (created only via create_workspace RPC)
create policy workspaces_select on public.workspaces for select
  using (public.is_member(id));
create policy workspaces_update on public.workspaces for update
  using (public.is_admin(id));

-- members
create policy members_select on public.workspace_members for select
  using (public.is_member(workspace_id));
create policy members_update on public.workspace_members for update
  using (public.is_admin(workspace_id) and role <> 'owner')
  with check (role <> 'owner');
create policy members_delete on public.workspace_members for delete
  using (public.is_admin(workspace_id) and role <> 'owner');

-- invites
create policy invites_select on public.workspace_invites for select
  using (public.is_admin(workspace_id));
create policy invites_insert on public.workspace_invites for insert
  with check (public.is_admin(workspace_id) and role <> 'owner');
create policy invites_delete on public.workspace_invites for delete
  using (public.is_admin(workspace_id));

-- projects
create policy projects_select on public.projects for select
  using (public.is_member(workspace_id));
create policy projects_insert on public.projects for insert
  with check (public.is_admin(workspace_id));
create policy projects_update on public.projects for update
  using (public.is_admin(workspace_id));
create policy projects_delete on public.projects for delete
  using (public.is_admin(workspace_id));

-- integrations (admins only: they hold webhook tokens)
create policy integrations_select on public.integrations for select
  using (public.is_admin(workspace_id));
create policy integrations_insert on public.integrations for insert
  with check (public.is_admin(workspace_id));
create policy integrations_update on public.integrations for update
  using (public.is_admin(workspace_id));
create policy integrations_delete on public.integrations for delete
  using (public.is_admin(workspace_id));

-- leads: admins see everything, agents see only leads assigned to them
create policy leads_select on public.leads for select
  using (public.is_admin(workspace_id)
         or (public.is_member(workspace_id) and assigned_to = auth.uid()));
create policy leads_insert on public.leads for insert
  with check (public.is_member(workspace_id));
create policy leads_update on public.leads for update
  using (public.is_admin(workspace_id)
         or (public.is_member(workspace_id) and assigned_to = auth.uid()))
  with check (public.is_member(workspace_id));
create policy leads_delete on public.leads for delete
  using (public.is_admin(workspace_id));

-- activities: visible if the lead is visible; users may only add notes
create policy activities_select on public.lead_activities for select
  using (exists (select 1 from public.leads l where l.id = lead_id));
create policy activities_insert on public.lead_activities for insert
  with check (actor_id = auth.uid() and type = 'note'
              and exists (select 1 from public.leads l
                          where l.id = lead_id and l.workspace_id = lead_activities.workspace_id));

-- ---------- Realtime -------------------------------------------------
alter publication supabase_realtime add table public.leads, public.lead_activities;
