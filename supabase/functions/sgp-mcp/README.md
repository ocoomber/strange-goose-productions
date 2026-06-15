# sgp-mcp — MCP server Edge Function

A public, stateless **Model Context Protocol** server that represents Strange
Goose Productions to visiting AI agents. It reads live from the `SGP_AI_Profile`
Google Sheet and exposes 8 read-only tools.

- **Endpoint:** `https://zawrkuclsdqtvftfothj.supabase.co/functions/v1/sgp-mcp`
- **Transport:** Streamable HTTP, MCP spec `2025-11-25`, JSON-RPC 2.0 over POST
- **Auth:** none (`verify_jwt = false`) — agents must reach it without a key
- **Data source:** Google Sheet `1dBI1C47accsmYU53uU_FZvXe1yN0J6SL1CARZfvjZ-s`
  (tab → object rows via the keyless `gviz` JSON endpoint), cached 5 min.

## Files
- `index.ts` — transport, JSON-RPC dispatch, the 8 tools, the gviz reader/cache.
- `sheet.ts` — pure helpers (gviz parsing, counts). Unit-tested, no Deno deps.
- `sheet.test.ts` — Node test: `node --experimental-strip-types sheet.test.ts`.

## Prerequisite (one-time): share the sheet
The server reads the sheet anonymously, so the sheet must be world-readable:
**Open `SGP_AI_Profile` → Share → General access → "Anyone with the link" →
Viewer.** Until this is done, tool calls return a "Could not read the … tab"
error. (Editing the sheet stays restricted to you — Viewer only affects reads.)

The sheet must be a **native Google Sheet**, not an uploaded `.xlsx`.

## Tools
`get_company_overview`, `list_films`, `get_film`, `list_awards`,
`get_services`, `get_team`, `get_faq`, `get_contact`.

## Deploy
Deployed via the Supabase MCP / CLI. To redeploy from a CLI:
```bash
supabase functions deploy sgp-mcp --project-ref zawrkuclsdqtvftfothj --no-verify-jwt
```
The Sheet id is baked in as a constant; override with the `SGP_SHEET_ID`
function secret if it ever changes.

## Smoke tests (run from a machine with internet egress)
```bash
URL=https://zawrkuclsdqtvftfothj.supabase.co/functions/v1/sgp-mcp

# Health check (no auth, no sheet needed)
curl -s "$URL"

# initialize
curl -s -X POST "$URL" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'

# tools/list
curl -s -X POST "$URL" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# tools/call (needs the sheet shared) — company overview
curl -s -X POST "$URL" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_company_overview","arguments":{}}}'
```
Append `?refresh=1` to the URL to bypass the 5-minute cache after editing the sheet.

## Connect from Claude
```bash
claude mcp add --transport http sgp https://zawrkuclsdqtvftfothj.supabase.co/functions/v1/sgp-mcp
```
Or use the MCP Inspector: `npx @modelcontextprotocol/inspector` → Streamable HTTP → paste the URL.
