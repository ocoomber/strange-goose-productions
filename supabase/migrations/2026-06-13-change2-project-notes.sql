-- ============================================================
-- Phase 2 · Change 2: internal chase log (project_notes)
-- Private to the admin, append-only — extends the portal's tamper-proof
-- record to Owen's own contact attempts. The client never sees these.
-- Safe to run once. Paste into the Supabase SQL Editor.
-- ============================================================

create table if not exists public.project_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  author_id uuid references public.profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.project_notes enable row level security;

-- Only the admin may read or write chase notes.
create policy "admin reads project notes" on public.project_notes
  for select using (public.is_admin());
create policy "admin inserts project notes" on public.project_notes
  for insert with check (public.is_admin());

-- Immutable once saved: no UPDATE/DELETE policies, plus a belt-and-braces revoke.
revoke update, delete on public.project_notes from anon, authenticated;

create index if not exists project_notes_project_idx
  on public.project_notes (project_id, created_at desc);
