# sgp-portal-mcp — client portal MCP server

A public, stateless **Model Context Protocol** server that lets an existing SGP
client's AI assistant work with *their own* projects in the client portal —
check status, review deliverables, see approval history, and be handed a link to
approve. A new interface onto the existing portal; it does **not** change the
portal's data model or rules.

- **Endpoint:** `https://zawrkuclsdqtvftfothj.supabase.co/functions/v1/sgp-portal-mcp`
- **Transport:** Streamable HTTP, MCP spec `2025-11-25`, JSON-RPC 2.0 over POST
- **Auth:** the client's own **MCP key** (see below) as a Bearer token

## How auth works (and why it's safe)
1. The client generates an **MCP key** in the portal (Client Portal → *MCP
   access*). Only a SHA-256 **hash** is stored (`mcp_tokens`); the plaintext is
   shown to them once.
2. On each call, the server hashes the presented key, looks up the (non-revoked)
   `mcp_tokens` row → the owning client, and mints a **real client session** for
   them via the GoTrue admin API (`generateLink` → `verifyOtp`, cached ~50 min,
   with backoff retry to survive concurrent cold-cache mints).
3. **All data reads run through that client session**, so the portal's existing
   Row Level Security is the security boundary — a key can only ever see its
   own client's data. The service role is used *only* to look up the key and
   mint the session, never to read project data.

## Tools (read-only)
`get_account`, `list_projects`, `get_project`, `get_pending_actions`,
`list_deliverables`, `get_approval_history`, `get_portal_link`.

## Approvals
Approvals stay **human-in-the-portal** for now: where a stage needs sign-off,
the tools return an `approve_in_portal` deep link
(`…/client/#project/<id>`) for the human to open and approve. The disabled
`performApproval()` seam + the `ALLOW_DIRECT_APPROVAL` flag are where direct AI
approval would later plug in — it inserts the approval *as the client* so the
existing `handle_approval()` trigger and notify-email webhook fire unchanged.
Enabling it should also add an `approvals.source` column so an AI-made approval
is logged with its origin (e.g. `mcp:chatgpt`).

## Files
- `index.ts` — transport, key→client→session auth, the 7 tools.
- `lib.ts` — pure helpers (token hashing, deep links, stage/project shaping).
- `lib.test.ts` — Node tests: `node --experimental-strip-types lib.test.ts`.

## Data model
Migration `supabase/migrations/2026-06-15-mcp-tokens.sql` adds the `mcp_tokens`
table (admin + owning-client read; writes only via RPCs) and two
SECURITY DEFINER RPCs the portal calls: `create_mcp_token(label)` (returns the
plaintext once) and `revoke_mcp_token(id)`.

## Deploy
Deployed via the Supabase MCP / CLI, public (no Supabase JWT — it authenticates
with the client's MCP key):
```bash
supabase functions deploy sgp-portal-mcp --project-ref zawrkuclsdqtvftfothj --no-verify-jwt
```

## Connect (client side)
```bash
claude mcp add --transport http sgp-portal \
  https://zawrkuclsdqtvftfothj.supabase.co/functions/v1/sgp-portal-mcp \
  --header "Authorization: Bearer <your-mcp-key>"
```
Then ask, e.g., "what's the status of my projects?" or "what needs my approval?"

## Test (from a host with egress, or via Postgres `pg_net`)
```bash
URL=https://zawrkuclsdqtvftfothj.supabase.co/functions/v1/sgp-portal-mcp
curl -s -X POST "$URL" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
curl -s -X POST "$URL" -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <your-mcp-key>' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_projects","arguments":{}}}'
```
