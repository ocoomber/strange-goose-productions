-- ============================================================
-- Strange Goose Productions — admin MCP access (Stage 4)
-- create_mcp_token() was restricted to role='client' (2026-06-15). Owen now
-- gets his own admin-side MCP server (sgp-admin-mcp), so admin accounts need
-- to mint keys too. Same table (mcp_tokens), same hash-only storage — the
-- owning profile's role is what the two MCP servers check to keep client and
-- admin keys from being interchangeable (sgp-portal-mcp now requires
-- role='client'; sgp-admin-mcp requires role='admin'). Safe to run once.
-- ============================================================

create or replace function public.create_mcp_token(p_label text default null)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := auth.uid();
  tok text;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if not exists (select 1 from public.profiles where id = uid and role in ('client', 'admin')) then
    raise exception 'Only client or admin accounts can create MCP keys';
  end if;
  tok := 'sgp_' || encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.mcp_tokens (client_id, token_hash, label)
  values (uid, encode(extensions.digest(tok, 'sha256'), 'hex'), nullif(btrim(p_label), ''));
  return tok;
end $$;
