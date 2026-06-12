-- ============================================================
-- Strange Goose Productions — Client Portal schema
-- Paste this whole file into the Supabase SQL Editor and run it.
-- Safe to run once on a fresh project.
-- ============================================================

-- ── Tables ──────────────────────────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'client' check (role in ('admin','client')),
  must_change_password boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id),
  title text not null,
  status text not null default 'active' check (status in ('active','complete')),
  created_at timestamptz not null default now()
);

create table public.stages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  stage_index int not null check (stage_index between 1 and 7),
  name text not null,
  state text not null default 'locked' check (state in ('locked','pending','approved')),
  doc_links jsonb not null default '[]',          -- [{"label":"...","url":"..."}]
  video_id text,                                  -- YouTube video ID
  deliverable_links jsonb not null default '[]',  -- stage 7 only
  unique (project_id, stage_index)
);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null unique references public.stages(id),  -- no cascade: stages with approvals cannot be deleted
  project_id uuid not null references public.projects(id),
  client_id uuid not null references public.profiles(id),
  stage_name text not null,   -- denormalised so the record is self-contained
  approved_at timestamptz not null default now()
);

-- ── Helpers ─────────────────────────────────────────────────

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and role = 'admin') $$;

-- Auto-create a profile row for every new auth user
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Stage machine ───────────────────────────────────────────

-- Seed the 7 fixed stages when a project is created (stage 1 starts pending)
create or replace function public.seed_stages()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  names text[] := array[
    'Brief agreed',
    'Edit v1',
    'Edit v2',
    'Picture lock — Edit v3',
    'Colour and sound',
    'Final approval',
    'Deliverables'
  ];
  i int;
begin
  for i in 1..7 loop
    insert into public.stages (project_id, stage_index, name, state)
    values (new.id, i, names[i], case when i = 1 then 'pending' else 'locked' end);
  end loop;
  return new;
end $$;

create trigger on_project_created
  after insert on public.projects
  for each row execute function public.seed_stages();

-- Guard every stage update: approvals are irreversible, stages advance in order,
-- and pending → approved only happens via an approvals insert (flagged via GUC).
create or replace function public.guard_stage_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.project_id <> old.project_id or new.stage_index <> old.stage_index then
    raise exception 'Stage identity cannot change';
  end if;
  if old.state = 'approved' and new.state <> 'approved' then
    raise exception 'Approved stages cannot be reverted';
  end if;
  if old.state <> new.state then
    if old.state = 'pending' and new.state = 'approved' then
      if coalesce(current_setting('sgp.approving', true), '') <> '1' then
        raise exception 'Stages are approved by the client via an approval record';
      end if;
    elsif old.state = 'locked' and new.state = 'pending' then
      if new.stage_index > 1 and not exists (
        select 1 from public.stages s
        where s.project_id = new.project_id
          and s.stage_index = new.stage_index - 1
          and s.state = 'approved'
      ) then
        raise exception 'Previous stage must be approved before advancing';
      end if;
    else
      raise exception 'Invalid stage transition: % → %', old.state, new.state;
    end if;
  end if;
  return new;
end $$;

create trigger guard_stage_update
  before update on public.stages
  for each row execute function public.guard_stage_update();

-- Validate an approval, fill denormalised fields, and mark the stage approved
create or replace function public.handle_approval()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  st public.stages%rowtype;
  owner uuid;
begin
  select * into st from public.stages where id = new.stage_id;
  if not found then
    raise exception 'Unknown stage';
  end if;
  if st.state <> 'pending' then
    raise exception 'Only the pending stage can be approved';
  end if;
  select client_id into owner from public.projects where id = st.project_id;
  if owner <> auth.uid() then
    raise exception 'Only the project''s client can approve';
  end if;
  new.client_id := auth.uid();
  new.project_id := st.project_id;
  new.stage_name := st.name;
  new.approved_at := now();
  perform set_config('sgp.approving', '1', true);
  update public.stages set state = 'approved' where id = new.stage_id;
  perform set_config('sgp.approving', '', true);
  return new;
end $$;

create trigger on_approval
  before insert on public.approvals
  for each row execute function public.handle_approval();

-- Non-admins may only flip their own must_change_password / display_name.
-- auth.uid() is null outside the API (SQL editor / service role) — allow those.
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.id <> old.id or new.role <> old.role or new.email <> old.email then
      raise exception 'Not allowed';
    end if;
  end if;
  return new;
end $$;

create trigger guard_profile_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ── Row Level Security ──────────────────────────────────────

alter table public.profiles  enable row level security;
alter table public.projects  enable row level security;
alter table public.stages    enable row level security;
alter table public.approvals enable row level security;

-- profiles
create policy "read own profile or admin reads all" on public.profiles
  for select using (id = auth.uid() or public.is_admin());
create policy "update own profile or admin" on public.profiles
  for update using (id = auth.uid() or public.is_admin());

-- projects
create policy "clients read own projects, admin all" on public.projects
  for select using (client_id = auth.uid() or public.is_admin());
create policy "admin inserts projects" on public.projects
  for insert with check (public.is_admin());
create policy "admin updates projects" on public.projects
  for update using (public.is_admin());

-- stages: clients never see locked stages; only admin writes
create policy "clients read visible stages, admin all" on public.stages
  for select using (
    public.is_admin() or (
      state <> 'locked' and exists (
        select 1 from public.projects p
        where p.id = project_id and p.client_id = auth.uid()
      )
    )
  );
create policy "admin updates stages" on public.stages
  for update using (public.is_admin());

-- approvals: append-only; clients insert for their own pending stage
-- (handle_approval trigger does the authoritative validation)
create policy "read own approvals, admin all" on public.approvals
  for select using (client_id = auth.uid() or public.is_admin());
create policy "client inserts approval" on public.approvals
  for insert with check (auth.uid() is not null);

-- No UPDATE or DELETE policies on approvals — and belt-and-braces revoke:
revoke update, delete on public.approvals from anon, authenticated;
-- Projects and stages are never deleted through the API either:
revoke delete on public.projects, public.stages from anon, authenticated;

-- ============================================================
-- AFTER RUNNING: create Owen's auth user (Authentication → Add user),
-- then promote it to admin by running:
--
--   update public.profiles
--   set role = 'admin', must_change_password = false
--   where email = 'info@strangegoose.co.uk';
-- ============================================================
