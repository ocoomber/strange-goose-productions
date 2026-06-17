# MCP Server — Architecture & Operations Notes

SGP runs **one live** MCP server today, a Supabase Edge Function (Deno),
stateless Streamable HTTP (spec `2025-11-25`):

| Server | Function | Audience | Auth | Data |
|--------|----------|----------|------|------|
| **Client portal** | `sgp-portal-mcp` | An existing client's AI assistant | the client's own **MCP key** | the client's portal data (via RLS) |
| ~~Public profile~~ | ~~`sgp-mcp`~~ | — | — | **decommissioned 2026-06-17** |

> **Note on cold discovery:** the public `sgp-mcp` was built first for agents to
> *discover* SGP, but in practice MCP needs deliberate per-user configuration —
> that use case never materialized. It's been decommissioned (the deployed
> function now returns `410 Gone`; site pointers in `index.html` and `llms.txt`
> removed). There is no public MCP server right now. A future replacement may
> read from a Google Sheet **published to the web**, instead of the
> "Anyone with the link" + gviz approach used before — not yet built.
> `sgp-portal-mcp` is the one that stayed live — a known client connecting
> their AI to their own projects. See `supabase/functions/sgp-portal-mcp/README.md`.

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
