# SGP MCP Servers — Architecture & Operations

Two live MCP servers let an AI assistant work conversationally with the portal
alongside the web UI. Both are Supabase Edge Functions (Deno), stateless
Streamable HTTP (spec `2025-11-25`, JSON-RPC 2.0 over POST), deployed with
`verify_jwt = false` (they do their own key auth). Portal context is in
`PORTAL_NOTES.md`.

| Server | Function | Audience | Data | Scope |
|--------|----------|----------|------|-------|
| **Client portal** | `sgp-portal-mcp` | a client's AI assistant | their own portal data (via RLS) | read-only |
| **Admin panel** | `sgp-admin-mcp` | Owen's AI assistant | all clients/projects (via `is_admin()` RLS) | read + safe writes |
| ~~Public profile~~ | ~~`sgp-mcp`~~ | — | — | **decommissioned** (returns 410) |

Endpoints: `https://zawrkuclsdqtvftfothj.supabase.co/functions/v1/<name>`.

## Auth model (both servers)
1. The owner self-generates an **MCP key** in their portal (`#mcp` route). Only
   its **SHA-256 hash** is stored in `mcp_tokens`; the plaintext is shown once.
2. On each call the server hashes the presented key, finds the (non-revoked)
   `mcp_tokens` row → the owning profile, and **checks the profile's `role`**
   (`client` for the portal server, `admin` for the admin server) so a key can't
   be used on the wrong server. The portal server also **rejects archived
   clients** (archiving bans interactive login, but minting a session would
   otherwise bypass that ban; RLS doesn't catch it because client-archive sets
   `profiles.archived`, not `projects.archived`).
3. It then **mints a real session for that profile** via the GoTrue admin API
   (`generateLink` → `verifyOtp`), cached ~50 min, and runs every read/write
   through that session. So the **portal's existing RLS / `is_admin()` is the
   security boundary** — no hand-rolled scoping. The service role is used *only*
   to look up the key and mint the session, never to read portal data.

**Key transport:** `Authorization: Bearer <key>` (CLI clients) **or** a
`?key=<key>` query param on the endpoint URL (for Claude.ai / ChatGPT web
"custom connector" settings, which only have a URL field, no header field). Both
portal UIs generate the ready-to-copy URL-with-key form. Tradeoff: a key in a
URL can leak via browser history / connector screens / request logs — acceptable
because revoking a key is one click in either portal.

**DB:** `mcp_tokens` table + `create_mcp_token(label)` / `revoke_mcp_token(id)`
SECURITY DEFINER RPCs (in `schema.sql`). `create_mcp_token` permits
`role in ('client','admin')`.

## Tools
- **`sgp-portal-mcp` (7, read-only):** `get_account`, `list_projects`,
  `get_project`, `get_pending_actions`, `list_deliverables`,
  `get_approval_history`, `get_portal_link`. Approvals stay human: a pending
  stage returns an `approve_in_portal` deep link.
- **`sgp-admin-mcp` (9):** read-only `get_account`, `list_clients`,
  `get_client`, `list_projects`, `get_project`, `get_attention_needed`,
  `get_render_template` (optional visual artifact template — see Render hints);
  safe writes `add_chase_note`, `update_stage_links`. `list_projects`/`get_client`
  take an `include_archived` flag (default false; otherwise archived projects
  are hidden to match the admin dashboard).

**Admin scope deliberately stops** at read + those two safe writes. It cannot
advance a stage, release deliverables, mark complete, revert an approval, delete
a project, or touch a client account — anything that emails or unblocks a real
client stays admin-panel-only. `update_stage_links` never touches `state` and
refuses an already-approved (frozen) stage.

**Status model is shared:** `statusOf` / `overdueDays` / `waitingSince` in
`sgp-admin-mcp/lib.ts` are ported from `admin/index.html` — **keep both in sync.**

## Render hints (optional visual template)

A visiting AI can render `get_account` data as a small dashboard artifact
(clients / projects / your-move / overdue) instead of a wall of text. Delivered
in two parts so the common path stays cheap:

1. **Advertisement** — `get_account`'s response carries a lightweight
   `render_hint` block of **structured fields** (not a prose note):
   `{ suggest_to_user: true, action: "offer_to_user", tool: "get_render_template",
   renders: "get_account", what, how }`. Directive (`suggest_to_user` / `action`)
   is deliberately kept separate from explanation (`what` / `how`) so a model
   pattern-matches the instruction reliably rather than parsing it out of a
   sentence; there's intentionally no opt-out phrasing. It's a few hundred
   bytes, purely additive, and an unaware client just ignores the extra key.
   No component code here.
2. **The template** — a separate read-only tool **`get_render_template`**
   returns the self-contained JSX as a string (`{ renders, template_jsx }`).
   The AI calls it only if it wants the visual, then drops the `get_account`
   fields into the template's top `data` block (field names match exactly) and
   renders it as an artifact.

**Why a tool, not inline in `get_account`:** the JSX is ~5 KB and would sit in
the context window of *every* `get_account` call whether used or not. Splitting
it out keeps `get_account` lean and makes fetching the template an explicit,
opt-in step.

**Why a tool, not a hosted URL:** Claude's `web_fetch` only fetches URLs that
came from a `web_search` result; a URL returned inside an MCP response is
blocked unconditionally (a client-side security policy, not fixable
server-side). So the component source is shipped in the tool response itself —
no fetch step.

Source of truth for the JSX is
`supabase/functions/sgp-admin-mcp/template.ts` (`SGP_PORTAL_TEMPLATE_JSX`);
edit the JSX there. The only escaping in that file is the two JSX template
literals (backticks → `` \` ``, `${` → `\${`).

## Working in this environment
- **Sandbox egress is blocked** (`supabase.co`, `deno.land`, etc). To call a
  live function, POST through the DB with `pg_net`: Supabase MCP `execute_sql` →
  `select net.http_post(url, body::jsonb, headers:=…)`, then read the reply from
  `net._http_response` (it runs on Supabase's network, which has egress). A
  no-auth `tools/list` POST is a good smoke test.
- **Deno can't be installed here.** Run the pure-logic tests with Node:
  `node --experimental-strip-types <fn>/lib.test.ts`.
- **Deploy** via the Supabase MCP `deploy_edge_function` (send `index.ts` **and**
  `lib.ts`; keep `verify_jwt: false`). Apply SQL via `apply_migration`.
- `get_logs` (service `edge-function`) shows request lines, not `console.error`
  reliably — surface errors in tool responses when debugging.

## Gotchas
- **GoTrue magic-link tokens are single-use** → concurrent session mints for the
  same user race ("Email link is invalid or has expired"). Mitigated with
  in-flight promise dedup + backoff retry. If it ever proves flaky under real
  load, the robust alternatives are signing a user JWT with `SUPABASE_JWT_SECRET`
  or a DB-backed shared session cache.
- **Hand-inserted `auth.users` break GoTrue** unless the token columns
  (`confirmation_token`, `recovery_token`, `email_change`, …) are `''`, not
  `NULL`. Bites when creating test clients via SQL.
- The Deno Web-Crypto SHA-256 hash matches Postgres
  `encode(digest(...,'sha256'),'hex')` (unit-tested) — that parity is what lets
  the server look a key up by its stored hash.

## Deferred / future
- **Direct AI approval** seam exists but is disabled: `ALLOW_DIRECT_APPROVAL`
  flag + `performApproval()` in `sgp-portal-mcp/index.ts`. To enable: flip the
  flag, add an additive `approvals.source` column, set it on insert, surface it
  in the `notify` email. The MCP acts *as the client*, so `handle_approval()` +
  the notify webhook already work for AI-made approvals.
- **Client→SGP messaging** (a client-insertable table + reuse `notify` to email
  Owen) — deferred.
- **Public-profile MCP** — `sgp-mcp` was decommissioned (cold agent discovery
  isn't a real MCP use case yet). Its code stays in `supabase/functions/sgp-mcp/`
  for reference. A future rebuild would read a Google Sheet **published to the
  web** rather than the old "Anyone with the link" + gviz approach.

## Key files
- `supabase/functions/sgp-portal-mcp/{index.ts,lib.ts,lib.test.ts,README.md}`
- `supabase/functions/sgp-admin-mcp/{index.ts,lib.ts,lib.test.ts,README.md}`
- `mcp_tokens` table + RPCs in `supabase/schema.sql`
- `client/index.html` / `admin/index.html` — "MCP access" UI (generate/revoke)
- Portal reference: `PORTAL_NOTES.md`, `admin/SETUP.md`
