# MCP Project — Handover Notes

_Last updated: 2026-06-15. For a new session picking this up._

## TL;DR
Built across three stages. **`sgp-portal-mcp` (the client portal MCP) is live
and is the main deliverable. `sgp-mcp` (the public profile MCP) was
decommissioned 2026-06-17** — see "Decommission: sgp-mcp" below. The only
things left are Owen-side testing/content and two deferred features (direct AI
approval, client messaging).

---

## The three stages (all done, all on `main`)

1. **Spreadsheet design** — `MCP_SPREADSHEET_DESIGN.md`. Owen's data lives in a
   **native** Google Sheet `SGP_AI_Profile` (id in `supabase/functions/sgp-mcp/index.ts`
   and its README), shared *Anyone with the link → Viewer*. 10 tabs, 12 films,
   77 award rows migrated. Owen is still
   filling narrative blanks (loglines, synopses, company bio, services, FAQ,
   team bios).

2. **Public profile MCP** — `supabase/functions/sgp-mcp/`. Lets *any* visiting
   agent ask about SGP; reads the sheet live via the keyless **gviz** endpoint.
   Advertised via `llms.txt` + a `<meta name="mcp-server">` in `index.html`.
   ⚠️ **Pivot insight:** cold discovery by unknown agents isn't a real MCP use
   case yet (MCP needs deliberate per-user config). This server stays, but the
   value is in #3.

3. **Client portal MCP** — `supabase/functions/sgp-portal-mcp/`. An existing
   client connects their AI assistant to *their own* portal projects. This is
   the live, correct use case. **A new interface onto the existing portal — the
   portal itself was not changed** (only an additive "MCP access" UI section).

---

## Deployed / live infrastructure

- **Supabase project:** `sgp-portal` (project ref + region in `PORTAL_NOTES.md`;
  full endpoint URLs in `MCP_SERVER_NOTES.md` and the two function READMEs).
- **Edge Functions** (both public, `verify_jwt = false`):
  - `sgp-mcp` (v2) → `…/functions/v1/sgp-mcp`
  - `sgp-portal-mcp` (v4) → `…/functions/v1/sgp-portal-mcp`
- **DB:** migration `supabase/migrations/2026-06-15-mcp-tokens.sql` is **applied**
  — `mcp_tokens` table + `create_mcp_token(label)` / `revoke_mcp_token(id)`
  SECURITY DEFINER RPCs.
- **Site (GitHub Pages from `main`):** `llms.txt`, `index.html` meta pointer,
  `client/index.html` → **Client Portal → "MCP access"** (generate/list/revoke keys).
- Both MCP servers are also documented in `MCP_SERVER_NOTES.md`; the portal one in
  `supabase/functions/sgp-portal-mcp/README.md`.

---

## Decommission: sgp-mcp (2026-06-17)

There is no public/cold-discovery MCP server running for SGP right now.
`sgp-mcp` was redeployed with a stub that returns `410 Gone` for every request
(no MCP tool exists to delete an Edge Function outright, so this is the kill
switch). Site pointers were removed: `llms.txt` no longer has the "Live data —
MCP server" section, and `index.html` no longer has the `<link
rel="mcp-server">` / `<meta name="mcp-server">` tags. The original code stays
in `supabase/functions/sgp-mcp/` for reference, marked decommissioned in its
README.

**Future plan (not yet built):** Owen intends to recreate a similar
public-profile system later using a Google Sheet **published to the web**
(File → Share → Publish to web), rather than the "Anyone with the link" +
gviz read approach this version used.

---

## Portal MCP — how it works (key facts)

- **Auth:** client self-generates an **MCP key** in the portal (`#mcp` route).
  Only its SHA-256 hash is stored; plaintext shown once. On each call the server
  hashes the incoming key → finds the (non-revoked) `mcp_tokens` row → the
  client → **mints a real client session** (GoTrue `generateLink` → `verifyOtp`,
  cached ~50 min, with in-flight dedup + backoff retry). All reads run through
  that session, so the **portal's existing RLS is the security boundary**.
  Service role is used only to look up the key and mint the session.
- **Tools (7, read-only):** `get_account`, `list_projects`, `get_project`,
  `get_pending_actions`, `list_deliverables`, `get_approval_history`,
  `get_portal_link`.
- **Approvals stay human:** pending stages return an `approve_in_portal` deep
  link (`…/client/#project/<id>`); the human approves in the portal.
- **Future direct-AI-approval seam (built, disabled):** `ALLOW_DIRECT_APPROVAL`
  flag + `performApproval()` in `index.ts`. To enable: flip the flag, add an
  additive `approvals.source text default 'portal'` column, set it on insert
  (e.g. `mcp:chatgpt`), and surface it in the `notify` email. Because the MCP
  acts *as the client*, the existing `handle_approval()` trigger + notify
  webhook already work for AI-made approvals.
- `create_mcp_token` is restricted to `role = 'client'` (admins can't mint keys).

---

## Working in this environment (IMPORTANT)

- **Sandbox egress is blocked** — this container cannot reach `supabase.co`,
  `docs.google.com`, or `deno.land`. So:
  - **To call the live functions, use `pg_net` from the DB:** Supabase MCP
    `execute_sql` → `select net.http_post(url, body::jsonb, headers:=…)`, then
    read results from `net._http_response` (the function runs on Supabase's
    network, which has egress).
  - **Deno can't be installed.** Run the pure-logic tests with Node:
    `node --experimental-strip-types supabase/functions/<fn>/*.test.ts`.
  - Deploy via Supabase MCP `deploy_edge_function`; apply SQL via `apply_migration`.
  - `get_logs` (service `edge-function`) shows request lines, not `console.error`
    reliably — surface errors in tool responses when debugging.
- **GitHub:** use the `mcp__github__*` tools (no `gh` CLI). Repo scope is
  `ocoomber/strange-goose-productions`.

---

## Verified (end-to-end, via pg_net)
Portal MCP: tenant isolation (Client A's key cannot read Client B's project —
RLS-blocked), bad/revoked keys rejected, self-service key gen + revoke RPCs,
concurrent cold-cache bursts all succeed, all 7 tools correctly client-scoped.
Public MCP: 12 films / 17 wins / 11 selections returned live from the sheet.
Unit tests green (`sgp-mcp`: 14, `sgp-portal-mcp`: 17, incl. token-hash parity
with Postgres). Test data was created and **cleaned up** — production is clean.

---

## Next steps / pending

1. **Owen to test the portal MCP as a client** (needs a `client`-role account):
   Portal → MCP access → generate key → `claude mcp add --transport http
   sgp-portal <url> --header "Authorization: Bearer <key>"` → ask "what needs my
   approval?". (Offer to spin up a throwaway client + project to demo.)
2. **Owen still filling the `SGP_AI_Profile` blanks** (for the public `sgp-mcp`).
3. **Deferred — direct AI approval:** flip the seam (see above).
4. **Deferred — client→SGP messaging:** needs a new client-insertable table +
   reuse the `notify` Edge Function to email Owen. (Was explicitly deferred.)
5. **Optional — admin token oversight UI** (admin already has RLS read on
   `mcp_tokens`).
6. **Free-tier keep-alive:** the Supabase project pauses after ~7 days of no
   activity. Agent traffic counts; otherwise see the cron-job.org migration note
   in `PORTAL_NOTES.md` once the repo stops getting pushes.
7. **Deferred — custom domain** `mcp.strangegoose.co.uk` (DNS/paid).

---

## Gotchas / lessons (don't relearn these)

- **gviz only works on NATIVE Google Sheets**, not an uploaded `.xlsx`. The file
  had to be converted (File → Save as Google Sheets).
- **Sheet `Dashboard` formulas** (`COUNTUNIQUE`, `COUNTIF`) don't survive the
  xlsx→Sheets conversion. `sgp-mcp` therefore computes headline stats in code
  from the Films/Awards tabs, not from the Dashboard tab.
- **Hand-inserted `auth.users` break GoTrue** unless the token columns
  (`confirmation_token`, `recovery_token`, `email_change`,
  `email_change_token_new`, …) are `''`, not `NULL`. Bit us when creating test
  clients via SQL.
- **GoTrue magic-link tokens are single-use** → concurrent session mints for the
  same user race ("Email link is invalid or has expired"). Mitigated with
  in-flight promise dedup + backoff retry. If it ever proves flaky under real
  load, the robust alternatives are: sign a user JWT with `SUPABASE_JWT_SECRET`
  (watch out for projects on the new asymmetric signing keys), or a DB-backed
  shared session cache.
- **MCP key plaintext is never stored** — only `sha256` hex. The Deno Web-Crypto
  hash matches Postgres `encode(digest(...,'sha256'),'hex')` (unit-tested).

---

## Key files
- `MCP_SPREADSHEET_DESIGN.md`, `MCP_SERVER_NOTES.md`, this file.
- `supabase/functions/sgp-mcp/{index.ts,sheet.ts,sheet.test.ts,README.md}`
- `supabase/functions/sgp-portal-mcp/{index.ts,lib.ts,lib.test.ts,README.md}`
- `supabase/migrations/2026-06-15-mcp-tokens.sql`
- `client/index.html` (MCP access section), `llms.txt`, `index.html` (meta pointer)
- Portal reference: `PORTAL_NOTES.md`, `supabase/schema.sql`, `admin/SETUP.md`
