-- ============================================================
-- Phase 2 · Change 4 (four-state status model) — foundation
-- Adds stages.pending_since: the moment a stage became the client's
-- turn (locked → pending). The admin panel derives "stalled" from this
-- (client's turn for longer than the overdue threshold). No status
-- column is stored — the four states are computed in the UI.
--
-- Safe to run once on the live project. Paste into the SQL Editor.
-- ============================================================

-- 1. New column ------------------------------------------------
alter table public.stages
  add column if not exists pending_since timestamptz;

-- 2. Backfill existing pending stages so they aren't all treated as
--    "just became pending". Best proxy for "awaiting since": when this
--    stage was unlocked = the previous stage's approval time; for stage 1
--    (no previous), the project's creation time.
update public.stages s
set pending_since = coalesce(
  (select a.approved_at
     from public.approvals a
     join public.stages ps on ps.id = a.stage_id
    where ps.project_id = s.project_id
      and ps.stage_index = s.stage_index - 1),
  (select p.created_at from public.projects p where p.id = s.project_id)
)
where s.state = 'pending' and s.pending_since is null;

-- 3. seed_stages: stamp stage 1 as pending-since-now on project creation.
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
    insert into public.stages (project_id, stage_index, name, state, pending_since)
    values (new.id, i, names[i],
            case when i = 1 then 'pending' else 'locked' end,
            case when i = 1 then now() else null end);
  end loop;
  return new;
end $$;

-- 4. guard_stage_update: stamp pending_since on a valid locked → pending.
create or replace function public.guard_stage_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('sgp.resetting', true), '') = '1' then
    return new;  -- admin reset via reset_project(), see below
  end if;
  if new.project_id <> old.project_id or new.stage_index <> old.stage_index then
    raise exception 'Stage identity cannot change';
  end if;
  if old.state = 'approved' and new.state <> 'approved' then
    raise exception 'Approved stages cannot be reverted';
  end if;
  if old.state = 'approved' then
    if new.doc_links is distinct from old.doc_links
       or new.video_id is distinct from old.video_id
       or new.note is distinct from old.note then
      raise exception 'Cannot change the content of an approved stage';
    end if;
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
      new.pending_since := now();
    else
      raise exception 'Invalid stage transition: % → %', old.state, new.state;
    end if;
  end if;
  return new;
end $$;

-- 5. reset_project: keep pending_since correct when relocking/re-pending.
create or replace function public.reset_project(p_project uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Admin only';
  end if;
  delete from public.approvals where project_id = p_project;
  perform set_config('sgp.resetting', '1', true);
  update public.stages
  set state = case when stage_index = 1 then 'pending' else 'locked' end,
      pending_since = case when stage_index = 1 then now() else null end
  where project_id = p_project;
  perform set_config('sgp.resetting', '', true);
  update public.projects set status = 'active' where id = p_project;
end $$;

-- 6. revert_last_approval: same — re-pending a stage stamps pending_since.
create or replace function public.revert_last_approval(p_project uuid)
returns void language plpgsql security definer set search_path = public as $$
declare k int;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Admin only';
  end if;
  select max(stage_index) into k from public.stages
  where project_id = p_project and state = 'approved';
  if k is null then
    raise exception 'No approved stage to undo';
  end if;
  delete from public.approvals a using public.stages s
  where a.stage_id = s.id and s.project_id = p_project and s.stage_index >= k;
  perform set_config('sgp.resetting', '1', true);
  update public.stages
  set state = case when stage_index = k then 'pending'
                   when stage_index > k then 'locked'
                   else state end,
      pending_since = case when stage_index = k then now()
                           when stage_index > k then null
                           else pending_since end
  where project_id = p_project;
  perform set_config('sgp.resetting', '', true);
  update public.projects set status = 'active' where id = p_project;
end $$;
