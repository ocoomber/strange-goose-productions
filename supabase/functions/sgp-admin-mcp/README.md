# sgp-admin-mcp — admin panel MCP server

A stateless **Model Context Protocol** server that lets Owen's AI assistant
work conversationally across every client and project in the SGP admin
panel — search clients, check project status, see what needs his attention,
read/add chase-log notes, and paste doc/video links into a stage. A new
interface onto the existing admin panel; it does **not** change the data
model or rules, and it deliberately stops short of anything that changes a
project's state for a client.

- **Endpoint:** `https://zawrkuclsdqtvftfothj.supabase.co/functions/v1/sgp-admin-mcp`
- **Transport:** Streamable HTTP, MCP spec `2025-11-25`, JSON-RPC 2.0 over POST
- **Auth:** Owen's own **MCP key** (see below) as a Bearer token

## Scope — read + safe writes only
This server can **never**: advance a stage, release deliverables, mark a
project complete, revert an approval, delete a project, or create/archive/
delete a client account. Those stay admin-panel-only, since a wrong AI
action there would email or unblock a real client. The only writes it can
make are adding a chase-log note and editing a stage's doc links / video id /
note — and `update_stage_links` explicitly refuses on an already-approved
stage (frozen) and never touches `state`.

## How auth works (and why it's safe)
1. Owen generates an **MCP key** in the admin panel (Admin Panel → *MCP
   access*). Only a SHA-256 **hash** is stored (`mcp_tokens`); the plaintext
   is shown once.
2. On each call, the server hashes the presented key, looks up the
   (non-revoked) `mcp_tokens` row → the owning profile, and rejects it unless
   that profile's role is `admin` (an accidentally-pasted client MCP key does
   not get admin powers here — it belongs on `sgp-portal-mcp`).
3. It mints a **real admin session** via the GoTrue admin API
   (`generateLink` → `verifyOtp`, cached ~50 min, with backoff retry to
   survive concurrent cold-cache mints).
4. **All data reads/writes run through that admin session**, so the existing
   `is_admin()` Row Level Security policies are the security boundary. The
   service role is used *only* to look up the key and mint the session, never
   to read or write portal data directly.

## Tools
Read-only: `get_account`, `list_clients`, `get_client`, `list_projects`,
`get_project`, `get_attention_needed`.
Safe writes: `add_chase_note`, `update_stage_links`.

## Files
- `index.ts` — transport, key→admin→session auth, the 8 tools.
- `lib.ts` — pure helpers (token hashing, deep links, the your_move/overdue
  status model ported from `admin/index.html`).
- `lib.test.ts` — Node tests: `node --experimental-strip-types lib.test.ts`.

## Data model
Shares the `mcp_tokens` table and `create_mcp_token`/`revoke_mcp_token` RPCs
with `sgp-portal-mcp` (migration `2026-06-15-mcp-tokens.sql`, broadened to
admin accounts by `2026-06-17-admin-mcp-tokens.sql`). The owning profile's
`role` column is what keeps client and admin keys from being interchangeable.

## Deploy
Deployed via the Supabase MCP / CLI, public (no Supabase JWT — it
authenticates with Owen's MCP key):
```bash
supabase functions deploy sgp-admin-mcp --project-ref zawrkuclsdqtvftfothj --no-verify-jwt
```

## Connect (admin side)
```bash
claude mcp add --transport http sgp-admin \
  https://zawrkuclsdqtvftfothj.supabase.co/functions/v1/sgp-admin-mcp \
  --header "Authorization: Bearer <your-mcp-key>"
```
Then ask, e.g., "what needs my attention?" or "show me Jane's projects."

## Test (from a host with egress, or via Postgres `pg_net`)
```bash
URL=https://zawrkuclsdqtvftfothj.supabase.co/functions/v1/sgp-admin-mcp
curl -s -X POST "$URL" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
curl -s -X POST "$URL" -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <your-mcp-key>' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_attention_needed","arguments":{}}}'
```
