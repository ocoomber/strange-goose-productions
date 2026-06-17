# MCP Project — Handover Notes

_Last updated: 2026-06-17. For a new session picking this up._

## TL;DR
Built across four stages. **`sgp-portal-mcp` (client portal, read-only) and
`sgp-admin-mcp` (admin panel, read + safe writes) are both live.** `sgp-mcp`
(the public profile MCP) was decommissioned 2026-06-17 — see "Decommission:
sgp-mcp" below. The only things left are Owen-side testing/content and a few
deferred features (direct AI approval, client messaging).

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

4. **Admin panel MCP** — `supabase/functions/sgp-admin-mcp/`. Owen connects
   his AI assistant to the *whole* admin panel — every client, every project —
   as an additional, conversational interface alongside the existing admin web
   panel (not a replacement for it). Same key→session→RLS auth pattern as #3,
   reusing the same `mcp_tokens` table, with `create_mcp_token` broadened to
   permit `role = 'admin'` and each server checking the owning profile's role
   so client and admin keys aren't interchangeable. Scope is **read + safe
   writes**: it can search/read everything plus add a chase-log note or edit a
   stage's doc links/video/note, but it cannot advance a stage, release
   deliverables, mark a project complete, or touch a client account — those
   stay admin-panel-only.

---

## Deployed / live infrastructure

- **Supabase project:** `sgp-portal` (project ref + region in `PORTAL_NOTES.md`;
  full endpoint URLs in `MCP_SERVER_NOTES.md` and the function READMEs).
- **Edge Functions** (all public, `verify_jwt = false`):
  - `sgp-mcp` (v2) → `…/functions/v1/sgp-mcp` (decommissioned, returns 410)
  - `sgp-portal-mcp` (v6) → `…/functions/v1/sgp-portal-mcp`
  - `sgp-admin-mcp` (v2) → `…/functions/v1/sgp-admin-mcp`
- **DB:** migration `supabase/migrations/2026-06-15-mcp-tokens.sql` is **applied**
  — `mcp_tokens` table + `create_mcp_token(label)` / `revoke_mcp_token(id)`
  SECURITY DEFINER RPCs. `supabase/migrations/2026-06-17-admin-mcp-tokens.sql`
  is also **applied** — broadens `create_mcp_token` to permit `role = 'admin'`.
  Both folded into `supabase/schema.sql`.
- **Site (GitHub Pages from `main`):** `llms.txt`, `index.html` meta pointer,
  `client/index.html` → **Client Portal → "MCP access"** (generate/list/revoke keys),
  `admin/index.html` → **MCP access** nav page (same pattern, admin's own keys).
- All three MCP servers are also documented in `MCP_SERVER_NOTES.md`; each
  function has its own README
  (`supabase/functions/sgp-portal-mcp/README.md`,
  `supabase/functions/sgp-admin-mcp/README.md`).

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
- **Auth transport (2026-06-17):** the key can arrive either as an
  `Authorization: Bearer <key>` header (CLI clients) or as a `?key=<key>`
  query param on the endpoint URL itself — added because Claude.ai's and
  ChatGPT's web/app "custom connector" settings only expose a URL field, no
  header field. We're building primarily for that web/app-connector user, with
  CLI as the secondary path. Both portal UIs generate the ready-to-copy
  URL-with-key form. See `extractToken()` in `index.ts` and the tradeoff note
  in `MCP_SERVER_NOTES.md`.
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
- `create_mcp_token` now permits `role in ('client', 'admin')` (broadened
  2026-06-17 so Owen can mint his own admin key too).

---

## Admin MCP — how it works (key facts)

- **Auth:** same pattern as the portal MCP, but the owning profile must have
  `role = 'admin'` (checked in `resolveAdmin()`); a client-owned key is
  rejected here, and an admin-owned key is rejected by `sgp-portal-mcp`'s
  `resolveClient()` (also added 2026-06-17) — keys aren't interchangeable
  between the two servers even though they share one table.
- **Tools (8):** read-only `get_account`, `list_clients`, `get_client`,
  `list_projects`, `get_project`, `get_attention_needed`; safe writes
  `add_chase_note`, `update_stage_links`.
- **Status model ported server-side:** `statusOf` / `overdueDays` /
  `waitingSince` in `supabase/functions/sgp-admin-mcp/lib.ts` mirror
  `admin/index.html`'s derived your_move/client/stalled/complete logic — keep
  both in sync if the rules ever change.
- **Why the scope stops where it does:** advancing a stage, releasing
  deliverables, marking complete, or any client account lifecycle change all
  email or unblock a real client — explicitly kept out of MCP reach per
  Owen's choice ("Read + safe writes"). `update_stage_links` is structurally
  safe: it never includes `state` in its patch and refuses outright on an
  already-approved stage.

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
Admin MCP: `tools/list` returns all 8 tools live (via pg_net smoke test).
Unit tests green (`sgp-mcp`: 14, `sgp-portal-mcp`: 17, `sgp-admin-mcp`: 22,
incl. token-hash parity with Postgres). Test data was created and **cleaned
up** — production is clean.

---

## Next steps / pending

0. **Next session: code review of the `?key=` query-param auth change**
   (commit `6e39799`, pushed to `main` 2026-06-17). Scope: `extractToken()` in
   both `sgp-admin-mcp/index.ts` and `sgp-portal-mcp/index.ts` (header-or-
   query-param key extraction), the matching UI changes in `admin/index.html`
   and `client/index.html` (URL-with-key generation + copy button), and the
   doc updates (both function READMEs, `MCP_SERVER_NOTES.md`,
   `admin/SETUP.md`). Verified so far: `node --check` / `--experimental-
   strip-types --check` on every changed file, both unit-test suites still
   green (17 + 22 assertions, unaffected since the change is isolated to
   `index.ts`, not `lib.ts`), both functions redeployed and ACTIVE
   (`sgp-admin-mcp` v2, `sgp-portal-mcp` v6). **Not yet done:** a live pg_net
   smoke test that actually calls either deployed endpoint with the key as a
   URL `?key=` param and *no* Authorization header, to confirm the query-param
   path works end-to-end in production rather than just passing static syntax
   checks — do this first in the review. Known accepted tradeoff to revisit:
   a key embedded in a URL can leak via browser history/connector-settings
   screens; logged in `MCP_SERVER_NOTES.md`.
1. **Owen to test the portal MCP as a client** (needs a `client`-role account):
   Portal → MCP access → generate key → either paste the generated
   `…/sgp-portal-mcp?key=<key>` URL into Claude.ai/ChatGPT's connector
   settings, or `claude mcp add --transport http sgp-portal <url> --header
   "Authorization: Bearer <key>"` → ask "what needs my approval?". (Offer to
   spin up a throwaway client + project to demo.)
2. **Owen to test the admin MCP**: Admin Panel → MCP access → generate key →
   either paste the generated `…/sgp-admin-mcp?key=<key>` URL into
   Claude.ai/ChatGPT's connector settings, or `claude mcp add --transport http
   sgp-admin <url> --header "Authorization: Bearer <key>"` → ask "what needs my
   attention?" or "show me Jane's projects."
3. **Owen still filling the `SGP_AI_Profile` blanks** (for the public `sgp-mcp`).
4. **Deferred — direct AI approval:** flip the seam (see above).
5. **Deferred — client→SGP messaging:** needs a new client-insertable table +
   reuse the `notify` Edge Function to email Owen. (Was explicitly deferred.)
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
- `supabase/functions/sgp-admin-mcp/{index.ts,lib.ts,lib.test.ts,README.md}`
- `supabase/migrations/2026-06-15-mcp-tokens.sql`,
  `supabase/migrations/2026-06-17-admin-mcp-tokens.sql`
- `client/index.html` (MCP access section), `admin/index.html` (MCP access
  page), `llms.txt`, `index.html` (meta pointer)
- Portal reference: `PORTAL_NOTES.md`, `supabase/schema.sql`, `admin/SETUP.md`
