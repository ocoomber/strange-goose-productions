# MCP Server — Architecture & Operations Notes

SGP runs **two live** MCP servers today, both Supabase Edge Functions (Deno),
stateless Streamable HTTP (spec `2025-11-25`):

| Server | Function | Audience | Auth | Data | Scope |
|--------|----------|----------|------|------|-------|
| **Client portal** | `sgp-portal-mcp` | An existing client's AI assistant | the client's own **MCP key** | the client's portal data (via RLS) | read-only |
| **Admin panel** | `sgp-admin-mcp` | Owen's AI assistant | his own **MCP key** | all clients/projects (via `is_admin()` RLS) | read + safe writes |
| ~~Public profile~~ | ~~`sgp-mcp`~~ | — | — | — | **decommissioned 2026-06-17** |

> **Note on cold discovery:** the public `sgp-mcp` was built first for agents to
> *discover* SGP, but in practice MCP needs deliberate per-user configuration —
> that use case never materialized. It's been decommissioned (the deployed
> function now returns `410 Gone`; site pointers in `index.html` and `llms.txt`
> removed). There is no public MCP server right now. A future replacement may
> read from a Google Sheet **published to the web**, instead of the
> "Anyone with the link" + gviz approach used before — not yet built.
> `sgp-portal-mcp` and `sgp-admin-mcp` are the two that stayed/went live — a
> known client (or Owen) connecting their AI to their own portal data. See
> `supabase/functions/sgp-portal-mcp/README.md` and
> `supabase/functions/sgp-admin-mcp/README.md`.

## Auth transport: header or `?key=` query param

Both servers accept the MCP key either as `Authorization: Bearer <key>` (what
Claude Code / most MCP clients send) **or** as a `?key=<key>` query param on
the endpoint URL itself. The latter exists because Claude.ai's and ChatGPT's
web/app "custom connector" settings only have a URL field, no header field —
so the key has to be baked into the URL. Both portal UIs generate this
URL-with-key form (alongside the plain header instructions) ready to copy.
Tradeoff: a key embedded in a URL can end up in browser history/settings
screens, slightly weaker than a header — acceptable here since revoking a key
is one click in either portal.

## sgp-admin-mcp (admin panel)

Gives Owen an AI-conversational alternative to the admin web panel, in
addition to it (not a replacement). Same `mcp_tokens` table and auth pattern
as the client portal MCP — Owen generates his own key in the admin panel
("MCP access"), the server hashes it, finds the owning profile, and mints a
real admin session via the GoTrue admin API. The owning profile's `role`
column is checked (`admin` here, `client` on the portal server) so a key
minted on one side can't be used on the other.

**Deliberately out of scope** (kept admin-panel-only): advancing a stage,
releasing deliverables, marking a project complete, reverting an approval,
deleting a project, or any client account lifecycle change (create/archive/
delete). The only writes available are adding a chase-log note and editing a
stage's doc links / video id / note (refuses on an already-approved/frozen
stage, never touches `state`). See
`supabase/functions/sgp-admin-mcp/README.md` for the full tool list.

---

## sgp-mcp (public profile) — DECOMMISSIONED

Lets visiting AI agents converse about Strange Goose Productions, answered live
from the `SGP_AI_Profile` Google Sheet. Followed `MCP_SPREADSHEET_DESIGN.md`.
Kept below for reference only — see the status note above.

## What it is
- A single **Supabase Edge Function** (Deno): `supabase/functions/sgp-mcp/`.
- A public, **stateless** remote MCP server over **Streamable HTTP**
  (spec `2025-11-25`, JSON-RPC 2.0 over POST). No sessions, no auth.
- **Endpoint:** `https://zawrkuclsdqtvftfothj.supabase.co/functions/v1/sgp-mcp`

## How data flows
```
AI agent ──JSON-RPC──▶ sgp-mcp Edge Function ──gviz JSON──▶ SGP_AI_Profile (Google Sheet)
                         │  (5-min per-tab cache)
                         └─ Owen edits the sheet → reflected on next cache miss
```
- The function reads each tab via Google's keyless `gviz` endpoint
  (`/gviz/tq?tqx=out:json&headers=1&sheet=<Tab>`), so **no Google Cloud project
  or API key** is needed — the sheet just has to be shared *Anyone with the
  link → Viewer*.
- Reads are cached in-memory for 5 minutes per tab (warm instances). Edits to
  the sheet appear within the TTL, or immediately with `?refresh=1`.

## Tools (8)
`get_company_overview`, `list_films`, `get_film`, `list_awards`,
`get_services`, `get_team`, `get_faq`, `get_contact`. Each returns a short
human summary plus the structured records as JSON. See the function README.

## Discoverability (removed)
- `llms.txt` (site root) no longer has a "Live data — MCP server" section.
- `index.html` `<head>` no longer carries the `<link rel="mcp-server">` /
  `<meta name="mcp-server">` pointers.

## Decommission status (2026-06-17)
- The deployed `sgp-mcp` Edge Function was redeployed with a stub that returns
  `410 Gone` for every request — there was no MCP-tool path to delete the
  function outright, so this is the kill switch. The original tool logic
  (`index.ts`, `sheet.ts`) stays in the repo under
  `supabase/functions/sgp-mcp/` for reference.
- Site pointers (`llms.txt`, `index.html`) removed.
- **Future:** a similar public-profile MCP may be rebuilt later reading from a
  Google Sheet **published to the web** (File → Share → Publish to web),
  rather than the "Anyone with the link" + gviz approach this version used.
