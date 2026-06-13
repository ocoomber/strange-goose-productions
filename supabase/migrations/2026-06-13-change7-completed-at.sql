-- ============================================================
-- Phase 2 · Change 7/8: projects.completed_at
-- A reliable completion timestamp so completion records can be searched
-- and bulk-exported by date range. Set automatically whenever a project
-- becomes complete (client confirms deliverables OR Owen marks complete).
-- Safe to run once. Paste into the Supabase SQL Editor.
-- ============================================================

alter table public.projects
  add column if not exists completed_at timestamptz;

-- Stamp completed_at the moment a project transitions into 'complete'.
create or replace function public.stamp_completed_at()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'complete' and old.status is distinct from 'complete' then
    new.completed_at := now();
  end if;
  return new;
end $$;

drop trigger if exists stamp_completed_at on public.projects;
create trigger stamp_completed_at
  before update on public.projects
  for each row execute function public.stamp_completed_at();

-- Backfill existing complete projects: best available date is the stage-7
-- approval time (client-confirmed completion), else fall back to now().
update public.projects p
set completed_at = coalesce(
  (select a.approved_at
     from public.approvals a
     join public.stages s on s.id = a.stage_id
    where s.project_id = p.id and s.stage_index = 7),
  now())
where p.status = 'complete' and p.completed_at is null;

-- Trigger functions are never called directly via the API.
revoke execute on function public.stamp_completed_at() from public, anon, authenticated;

-- Change 7 review note: global archive search (project name, client name,
-- date range) needs no further schema change. project name = projects.title,
-- client name/email via the profiles FK, date range via created_at /
-- completed_at. An index on completed_at keeps date-range scans cheap.
create index if not exists projects_completed_at_idx
  on public.projects (completed_at desc);
