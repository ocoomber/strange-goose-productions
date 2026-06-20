# SGP Client Portal — Project Memory

> Read this first if you're picking up the client portal. Architecture, live
> state, and the things that bite. Setup detail is in `admin/SETUP.md`; the
> authoritative DB is `supabase/schema.sql`; the MCP servers are in
> `MCP_SERVER_NOTES.md`.

## What this is
An authenticated client portal bolted onto the static SGP site (GitHub Pages,
repo `ocoomber/strange-goose-productions`, deploys on push to `main`). Clients
log in, follow their project through a fixed 7-stage pipeline, and record
permanent, timestamped approvals. Owen runs an admin panel to create
accounts/projects, paste links/videos, and advance stages. **Purpose: dispute
protection** — every client action is account-tied, timestamped, and immutable,
enforced in the database (not just the UI).

## Stack & layout
- **Frontend:** vanilla HTML/CSS/JS, no build step, no frameworks.
  - `client/index.html` — client portal (single page, hash routing)
  - `admin/index.html` — admin panel (single page)
  - `admin/report.html` — printable end-of-project record (browser print)
  - `site/portal.js` — shared: Supabase init, auth, `STAGE_ACTIONS`, helpers
    (`el`, `fmtDate`, `ytEmbed`, `parseYouTubeId`, `linkList`, `safeUrl`)
  - `site/portal.css` — shared styles, extends tokens from `site/styles.css`
  - No-login preview/demo files (`client/preview.html`, `admin/preview.html`)
    were one-off standalone handoffs for the redesign and have been deleted;
    `index.html` is the single source of truth for both. The admin's old inert
    `DEMO_MODE`/`buildDemo()` block has likewise been stripped from
    `admin/index.html`. Don't leave such handoff files committed once done.
- **Backend:** Supabase free tier, project ref `zawrkuclsdqtvftfothj`.
  - `SUPABASE_URL` + anon/publishable key are hardcoded near the top of
    `site/portal.js` — **public by design; RLS is the boundary.**
  - **Edge Functions** (Deno):
    - `notify` — DB Webhook target; emails on approvals INSERT (→ Owen) and
      stages locked→pending (→ client). Server-to-server, guarded by an
      `x-webhook-secret` header.
    - `create-client` — admin-only; provisions a client account + temp password.
    - `manage-client` — admin-only; `update` / `archive` / `unarchive` /
      `delete`. Archive bans login **and** revokes the client's MCP keys.
    - `resend-notification` — admin-only; re-sends the "ready for you" email for
      a pending stage (no data change).
    - `sgp-portal-mcp` / `sgp-admin-mcp` — see `MCP_SERVER_NOTES.md`.
  - **Email:** Resend, domain `strangegoose.co.uk` verified, from
    `portal@strangegoose.co.uk`.
  - **Edge Function secrets:** `RESEND_API_KEY`, `ADMIN_EMAIL`, `WEBHOOK_SECRET`
    (+ auto-provided `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` /
    `SUPABASE_ANON_KEY`). None live in the repo.

## Sign-in
Owen provisions every account (temp password, `must_change_password=true`). A
client signs in two ways:
- **Email + temp password**, then forced to choose a new password.
- **Google** — buttons on the login and first-login screens. On a Google
  session the boot logic auto-clears `must_change_password`.

"Allow new users to sign up" is **OFF** in Supabase Auth, so a Google login with
an un-provisioned email is rejected; `admin.createUser` bypasses that toggle.
Accounts are created with `email_confirm: true`, so Supabase auto-links the
Google identity to the existing account by verified-email match (one user, two
identities). Canonical domain is **non-www** (`https://strangegoose.co.uk`);
Auth redirect URLs must list **both** www and non-www `/client/` plus `/**`
wildcards, or OAuth falls back to the homepage with the token stuck in the hash.

## Data model (see `schema.sql` for the authoritative version)
- `profiles` (1:1 with auth.users): role admin|client, `must_change_password`,
  `archived`. Auto-created by the `handle_new_user` trigger.
- `projects`: client_id → profiles, title, status active|complete, `archived`
  (per-project archive flag), `completed_at`.
- `stages`: 7 per project (seeded by `seed_stages` — **all 7 start locked**,
  including stage 1; Owen submits each to advance locked→pending). stage_index
  1–7, state locked|pending|approved, `doc_links` jsonb, `video_id`, `note`,
  `deliverable_links` jsonb (stage 7), `pending_since` (drives overdue logic).
- `approvals`: append-only, immutable (stage_id unique, denormalised
  stage_name + approved_at; **no UPDATE/DELETE granted to anyone**).
- `project_notes`: admin-only chase log, append-only, never seen by the client.
- `mcp_tokens`: hashed MCP keys (see `MCP_SERVER_NOTES.md`).

### The 7 stages (`STAGE_ACTIONS` in portal.js)
1. Brief agreed — Approve brief
2. Edit v1 — Confirm feedback sent (round 1 of 2)
3. Edit v2 — Confirm feedback sent (round 2 of 2)
4. Picture lock — Acknowledge (boundary: further edits chargeable)
5. Colour and sound — Confirm feedback sent (1 round)
6. Final approval — Accept final version (anchors the final invoice)
7. Deliverables — All files downloaded and checked (completes project) — a
   file-handover confirm, **not** an approval; the client never sees an Approve
   button here.

### Key DB rules (triggers + RPCs, all SECURITY DEFINER)
- `guard_stage_update`: blocks reverting approved stages; freezes
  doc_links/video_id/note once approved; enforces in-order locked→pending;
  pending→approved only via an approvals insert (GUC flag); stamps
  `pending_since`.
- `handle_approval`: validates owner + pending stage, fills denormalised fields,
  flips the stage to approved.
- `complete_on_deliverables`: stage-7 approval → project status complete.
- `stamp_completed_at`: stamps `completed_at` on first complete.
- `guard_profile_update`: non-admins can't change their own role/email/id.
- Admin-only RPCs: `revert_last_approval` (undo one accidental approval) and
  `delete_project` (hard-delete, **refused if any approval exists** — archive
  instead). Both are `authenticated`-only (see Security posture).
- **RLS:** clients see only their own **non-archived** projects and
  **non-locked** stages of those; admin sees all via `is_admin()`.

### Status model (derived in code, not stored)
`OVERDUE_DAYS = 7`. `statusOf` → `you` (nothing pending, SGP's move) / `client`
(waiting on client) / `stalled` (waiting, overdue) / `complete`. Defined in
`admin/index.html` (`statusOf`/`overdueDays`/`waitingSince`/`pendingStageOf`)
and **ported verbatim** to `supabase/functions/sgp-admin-mcp/lib.ts` — **keep
both in sync if the rules change.** Overdue is admin-only; the chase log never
appears on the PDF record.

## Completion / deliverables flow
Release and completion are separate: client accepts final (stage 6) → Owen adds
deliverable links to stage 7 and clicks **Release deliverables** (locked→pending,
client emailed) → client clicks **All files downloaded and checked** (stage 7
approved → project auto-completes), or Owen clicks **Mark complete** if the
client ghosts. On complete, the panel prompts Owen to generate the PDF record.

## Security posture (public repo)
The repo is public (it hosts the live site) — treat everything in it as
world-readable. That's fine: **no secrets are in the repo or its git history**
(a `.gitignore` guards `.env`/`*.key`). The `SUPABASE_URL` + anon key in
`portal.js` are public by design — **RLS is the real boundary, so the whole
portal's safety depends on RLS staying enabled on every `public` table.**

Hardening in place:
- **Browser-called Edge Functions** (`create-client`, `manage-client`,
  `resend-notification`) reflect a two-host origin allowlist (apex + www), not
  `*`. `notify` keeps `*` on purpose (webhook target, no browser Origin).
- **SECURITY DEFINER footgun (don't reintroduce):** a function whose admin check
  is `if auth.uid() is not null and not is_admin()` lets the **anon** role
  straight through (uid is null when logged out), and Postgres grants EXECUTE to
  PUBLIC by default — which once made the approval-deleting RPCs callable by any
  anonymous holder of the public anon key. Fix lives in the EXECUTE-grant block
  at the end of `schema.sql` (revoke from public/anon; re-grant data-mutating
  RPCs to `authenticated` only). **If you re-create any of these functions, that
  block must run again** or the PUBLIC grant returns.
- **MCP keys** act AS the owning profile so RLS is the boundary; archived
  clients are rejected and their keys revoked on archive (see
  `MCP_SERVER_NOTES.md`).
- Leaked-password protection (HaveIBeenPwned) is off — Pro-only; low priority
  since accounts use admin-issued temp passwords.

## Keep-alive (free-tier auto-pause)
Free-tier Supabase pauses after **7 days with zero API requests**, taking the
whole portal offline (the static site is unaffected).
`.github/workflows/supabase-keepalive.yml` pings the REST API every 3 days. But
GitHub disables scheduled workflows after 60 days of no repo activity, so **once
the site goes static and stops getting pushes, move the ping to an external cron**
(e.g. cron-job.org GETting the same `/rest/v1/profiles?select=id&limit=1` URL
with the public `apikey` header every ~2 days) and disable the GitHub workflow.
Or go Supabase Pro ($25/mo), which removes auto-pause entirely. **Not yet
migrated.**

## Gotchas
- **Sandbox egress** often blocks `*.supabase.co`, so live RLS/REST tests fail
  here. Verify via Owen's browser, or call live functions through the DB with
  `pg_net` (see `MCP_SERVER_NOTES.md`).
- After changing an Edge Function, **redeploy it** — website pushes don't touch
  Supabase. Deploy via the Supabase MCP `deploy_edge_function` (preserve each
  function's `verify_jwt`: `false` for the MCP servers, `true` elsewhere) or by
  pasting into the dashboard editor.
- After changing schema/triggers, give Owen the SQL for the SQL Editor — but
  remember `auth.uid()` is null there, and that allowance is a footgun on
  data-mutating functions (see Security posture).
- **Verify pattern:** `node --check` the inline `<script>` of a page;
  `node --experimental-strip-types --check` the TS Edge Functions; run the MCP
  unit suites with `node --experimental-strip-types <fn>/lib.test.ts`.
- **Push to `main` deploys live.** If a push is rejected because the remote is
  ahead, `git pull --rebase origin main` first. Never force-push.
