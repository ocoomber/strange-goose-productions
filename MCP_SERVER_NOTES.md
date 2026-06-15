# MCP Server — Architecture & Operations Notes

SGP runs **two** MCP servers, both Supabase Edge Functions (Deno), both stateless
Streamable HTTP (spec `2025-11-25`):

| Server | Function | Audience | Auth | Data |
|--------|----------|----------|------|------|
| **Public profile** | `sgp-mcp` | Any visiting AI agent | none (public) | `SGP_AI_Profile` Google Sheet (gviz) |
| **Client portal** | `sgp-portal-mcp` | An existing client's AI assistant | the client's own **MCP key** | the client's portal data (via RLS) |

> **Note on cold discovery:** the public `sgp-mcp` was built first for agents to
> *discover* SGP. In practice MCP needs deliberate per-user configuration, so the
> live, valuable case is `sgp-portal-mcp` — a known client connecting their AI to
> their own projects. See `supabase/functions/sgp-portal-mcp/README.md`.

---

## sgp-mcp (public profile)

Lets visiting AI agents converse about Strange Goose Productions, answered live
from the `SGP_AI_Profile` Google Sheet. Follows `MCP_SPREADSHEET_DESIGN.md`.

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

## Discoverability
- `llms.txt` (site root) has a "Live data — MCP server" section with the
  endpoint and tools.
- `index.html` `<head>` carries `<link rel="mcp-server">` + `<meta
  name="mcp-server">` pointers. These go live when `main` is deployed (GitHub
  Pages).

## Operations
- **Logs:** Supabase dashboard → Edge Functions → `sgp-mcp` → Logs (the function
  `console.error`s any sheet-read failure).
- **Free-tier pause:** the Supabase project pauses after ~7 days of no activity.
  Agent traffic to this function counts as activity; the existing
  `supabase-keepalive.yml` REST ping is the backstop (see `PORTAL_NOTES.md` for
  the cron-job.org migration once the repo stops getting pushes).
- **Changing the sheet:** if the Sheet id ever changes, set the `SGP_SHEET_ID`
  function secret (overrides the baked-in constant). The tab names and
  `snake_case` headers must stay as designed — the tools read by those keys.

## Status / next
- Function deployed (`verify_jwt = false`), parser unit-tested.
- **Pending:** share the sheet *Anyone with the link → Viewer* (required before
  any `tools/call` can read data), then run the smoke tests in the README and a
  real Claude conversation. Merge to `main` to take the site pointers live.
