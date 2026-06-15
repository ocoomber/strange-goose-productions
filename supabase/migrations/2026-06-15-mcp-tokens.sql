-- ============================================================
-- Strange Goose Productions — MCP client access keys (Stage 3)
-- Per-client "MCP keys" a client generates themselves from the portal and
-- adds to their AI tool. The sgp-portal-mcp server SHA-256-hashes an incoming
-- key and looks it up here to identify the client, then acts AS that client so
-- the existing RLS stays the security boundary. The plaintext is never stored.
-- Safe to run once.
-- ============================================================

create table if not exists public.mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique,   -- SHA-256 hex of the plaintext key (plaintext never stored)
  label text,                        -- client-chosen name, e.g. "Claude", "ChatGPT"
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists mcp_tokens_client_idx
  on public.mcp_tokens (client_id, created_at desc);

alter table public.mcp_tokens enable row level security;

-- A client sees only their own keys (metadata only — never the secret); admin sees all.
create policy "clients read own mcp tokens, admin all" on public.mcp_tokens
  for select using (client_id = auth.uid() or public.is_admin());

-- All writes go through the SECURITY DEFINER RPCs below; block direct writes.
revoke insert, update, delete on public.mcp_tokens from anon, authenticated;

-- ── Self-service RPCs ───────────────────────────────────────

-- Generate a new MCP key for the calling CLIENT. Returns the plaintext ONCE;
-- only its SHA-256 hash is stored. Client accounts only.
create or replace function public.create_mcp_token(p_label text default null)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := auth.uid();
  tok text;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if not exists (select 1 from public.profiles where id = uid and role = 'client') then
    raise exception 'Only client accounts can create MCP keys';
  end if;
  tok := 'sgp_' || encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.mcp_tokens (client_id, token_hash, label)
  values (uid, encode(extensions.digest(tok, 'sha256'), 'hex'), nullif(btrim(p_label), ''));
  return tok;
end $$;

-- Revoke one of the caller's own keys.
create or replace function public.revoke_mcp_token(p_token_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not signed in'; end if;
  update public.mcp_tokens set revoked_at = now()
  where id = p_token_id and client_id = uid and revoked_at is null;
  if not found then raise exception 'Key not found'; end if;
end $$;

-- User-facing RPCs: authenticated only (not anon).
revoke execute on function public.create_mcp_token(text) from public, anon;
grant  execute on function public.create_mcp_token(text) to authenticated;
revoke execute on function public.revoke_mcp_token(uuid) from public, anon;
grant  execute on function public.revoke_mcp_token(uuid) to authenticated;
