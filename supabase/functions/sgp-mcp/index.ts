// sgp-mcp — Model Context Protocol server for Strange Goose Productions.
//
// A public, stateless remote MCP server (Streamable HTTP transport, spec
// 2025-11-25) that represents SGP to visiting AI agents. It answers questions
// about who SGP are, what they've made, what they've won, and how to engage —
// read live from the `SGP_AI_Profile` Google Sheet that Owen maintains.
//
// Self-contained (no shared imports), matching the repo's other Edge Functions.
// Deployed public (verify_jwt = false); agents reach it without a Supabase key.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { awardCounts, eqi, kvFromRows, parseGviz, type Row, slugify } from "./sheet.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// The native Google Sheet id (NOT an .xlsx). Override with the SGP_SHEET_ID
// env var. Must be shared "Anyone with the link → Viewer" so gviz can read it.
// (Not a secret — the sheet is public-facing by design.)
const SHEET_ID = Deno.env.get("SGP_SHEET_ID") ?? "1dBI1C47accsmYU53uU_FZvXe1yN0J6SL1CARZfvjZ-s";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const PROTOCOL_VERSION = "2025-11-25";
const SERVER_INFO = { name: "strange-goose-productions", version: "1.0.0" };

const SERVER_INSTRUCTIONS =
  "Strange Goose Productions (SGP) is an award-winning Scottish film " +
  "production company. Use these tools to answer questions about SGP: who " +
  "they are, their filmography, festival awards and selections, services for " +
  "hire, the team, and how to get in touch. All data is read live from SGP's " +
  "own records. Prefer get_company_overview for a general introduction.";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, mcp-protocol-version, mcp-session-id",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

// ---------------------------------------------------------------------------
// Google Sheet reader (gviz JSON, keyless) — with a small in-memory cache
// ---------------------------------------------------------------------------

const cache = new Map<string, { ts: number; rows: Row[] }>();

function gvizUrl(tab: string): string {
  return (
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq` +
    `?tqx=out:json&headers=1&sheet=${encodeURIComponent(tab)}`
  );
}

async function getTab(tab: string, refresh = false): Promise<Row[]> {
  const hit = cache.get(tab);
  if (!refresh && hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.rows;
  const res = await fetch(gvizUrl(tab));
  if (!res.ok) {
    throw new Error(
      `Could not read the "${tab}" tab (HTTP ${res.status}). Is the sheet ` +
        `shared "Anyone with the link → Viewer" and is it a native Google Sheet?`,
    );
  }
  const rows = parseGviz(await res.text());
  cache.set(tab, { ts: Date.now(), rows });
  return rows;
}

// Key-value tab (Company, Dashboard): { field, value } → dict.
async function getKV(
  tab: string,
  keyCol: string,
  valCol: string,
  refresh = false,
): Promise<Record<string, string | number | boolean>> {
  return kvFromRows(await getTab(tab, refresh), keyCol, valCol);
}

async function awardsForFilm(filmId: string, title: string, refresh = false) {
  const awards = await getTab("Awards", refresh);
  return awards.filter(
    (a) => eqi(a.film_id, filmId) || eqi(a.film_title, title),
  );
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(summary: string, data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: summary + "\n\n```json\n" + JSON.stringify(data, null, 2) + "\n```" }],
  };
}

const TOOLS: Record<
  string,
  {
    description: string;
    inputSchema: Record<string, unknown>;
    run: (args: Record<string, unknown>, refresh: boolean) => Promise<ToolResult>;
  }
> = {
  get_company_overview: {
    description:
      "Introduce Strange Goose Productions: who they are, their pitch and " +
      "approach, specialisms, and headline stats (total productions, wins, " +
      "nominations, official selections). Start here for a general overview.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async (_a, refresh) => {
      const company = await getKV("Company", "field", "value", refresh);
      let stats: Record<string, string | number | boolean> = {};
      try {
        stats = await getKV("Dashboard", "metric", "value", refresh);
      } catch { /* Dashboard optional */ }
      const name = company.trading_name ?? "Strange Goose Productions";
      const summary =
        `${name}` +
        (company.based_in ? ` — ${company.based_in}` : "") +
        (company.one_line_pitch ? `\n${company.one_line_pitch}` : "") +
        (company.short_bio ? `\n\n${company.short_bio}` : "");
      return ok(summary, { company, stats });
    },
  },

  list_films: {
    description:
      "List SGP's films (the filmography), newest data first. Optional " +
      "filters. Each entry includes a logline and award counts. Use get_film " +
      "for full detail on one title.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { type: "string", description: "e.g. 48 Hour Film, Short Film, Music Video" },
        status: { type: "string", description: "e.g. Completed, Festival Run, Unreleased" },
        year: { type: "number" },
        genre: { type: "string" },
        featured: { type: "boolean", description: "Only SGP's flagship films" },
      },
    },
    run: async (args, refresh) => {
      const films = await getTab("Films", refresh);
      const awards = await getTab("Awards", refresh);
      let list = films;
      if (args.type) list = list.filter((f) => eqi(f.type, args.type));
      if (args.status) list = list.filter((f) => eqi(f.status, args.status));
      if (args.year !== undefined) list = list.filter((f) => Number(f.year) === Number(args.year));
      if (args.genre) list = list.filter((f) => eqi(f.genre, args.genre));
      if (args.featured === true) list = list.filter((f) => eqi(f.featured, "yes"));
      const out = list.map((f) => {
        const fa = awards.filter((a) => eqi(a.film_id, f.film_id) || eqi(a.film_title, f.title));
        return {
          film_id: f.film_id, title: f.title, year: f.year, type: f.type,
          genre: f.genre, status: f.status, logline: f.logline,
          youtube_url: f.youtube_url, ...awardCounts(fa),
        };
      });
      return ok(`${out.length} film(s).`, out);
    },
  },

  get_film: {
    description:
      "Full detail for a single SGP film by film_id or title: synopsis, " +
      "credits, links, and its complete list of awards and festival selections.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        film_id: { type: "string" },
        title: { type: "string" },
      },
    },
    run: async (args, refresh) => {
      const films = await getTab("Films", refresh);
      const q = (args.film_id ?? args.title ?? "") as string;
      if (!q) return { content: [{ type: "text", text: "Provide film_id or title." }], isError: true };
      const film = films.find(
        (f) => eqi(f.film_id, q) || eqi(f.title, q) || eqi(f.film_id, slugify(q)),
      );
      if (!film) {
        return {
          content: [{ type: "text", text: `No film found matching "${q}".` }],
          isError: true,
        };
      }
      const fa = await awardsForFilm(String(film.film_id ?? ""), String(film.title ?? ""), refresh);
      return ok(
        `${film.title} (${film.year ?? "—"})`,
        { ...film, awards: fa, award_counts: awardCounts(fa) },
      );
    },
  },

  list_awards: {
    description:
      "SGP's awards, nominations and festival official selections, with " +
      "totals. Optional filters by film, result (Win/Nomination/Official " +
      "Selection), year, or qualifying status (e.g. Academy-qualifying).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        film: { type: "string", description: "film_id or title" },
        result: { type: "string", description: "Win, Nomination, or Official Selection" },
        year: { type: "number" },
        qualifying: { type: "boolean", description: "Only Academy/BAFTA-qualifying results" },
      },
    },
    run: async (args, refresh) => {
      let awards = await getTab("Awards", refresh);
      if (args.film) awards = awards.filter((a) => eqi(a.film_id, args.film) || eqi(a.film_title, args.film));
      if (args.result) awards = awards.filter((a) => eqi(a.result, args.result));
      if (args.year !== undefined) awards = awards.filter((a) => Number(a.year) === Number(args.year));
      if (args.qualifying === true) awards = awards.filter((a) => String(a.qualifying ?? "").trim() !== "");
      return ok(
        `${awards.length} result(s).`,
        { totals: awardCounts(awards), awards },
      );
    },
  },

  get_services: {
    description: "What SGP offers for hire and how they work with clients.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async (_a, refresh) => ok("SGP services.", await getTab("Services", refresh)),
  },

  get_team: {
    description: "The people behind SGP — roles and short bios.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async (_a, refresh) => ok("SGP team.", await getTab("Team", refresh)),
  },

  get_faq: {
    description: "Answers to common questions about working with SGP.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async (_a, refresh) => ok("SGP FAQ.", await getTab("FAQ", refresh)),
  },

  get_contact: {
    description:
      "How to get in touch with SGP and whether they're available for hire: " +
      "contact email, website, social links, and service area.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async (_a, refresh) => {
      const c = await getKV("Company", "field", "value", refresh);
      const contact = {
        contact_email: c.contact_email, website: c.website,
        youtube: c.youtube, instagram: c.instagram,
        available_for_hire: c.available_for_hire, service_area: c.service_area,
      };
      return ok(
        `Contact ${c.trading_name ?? "SGP"} at ${c.contact_email ?? "info@strangegoose.co.uk"}.`,
        contact,
      );
    },
  },
};

// ---------------------------------------------------------------------------
// JSON-RPC / MCP dispatch
// ---------------------------------------------------------------------------

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}
function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handleRpc(msg: { method?: string; id?: unknown; params?: Record<string, unknown> }, refresh: boolean) {
  const { method, id, params } = msg;

  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS,
      });

    case "notifications/initialized":
    case "notifications/cancelled":
      return null; // notifications get no response

    case "ping":
      return rpcResult(id, {});

    case "tools/list":
      return rpcResult(id, {
        tools: Object.entries(TOOLS).map(([name, t]) => ({
          name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });

    case "tools/call": {
      const name = params?.name as string;
      const tool = TOOLS[name];
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${name}`);
      try {
        const result = await tool.run((params?.arguments as Record<string, unknown>) ?? {}, refresh);
        return rpcResult(id, result);
      } catch (e) {
        // Surface data/sheet errors as a tool error (not a protocol error) so
        // the agent can relay them gracefully.
        console.error(`tool ${name} failed:`, e);
        return rpcResult(id, {
          content: [{ type: "text", text: `Error: ${(e as Error).message}` }],
          isError: true,
        });
      }
    }

    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // A bare GET is handy for a browser/health check.
  if (req.method === "GET") {
    return json({
      server: SERVER_INFO,
      protocolVersion: PROTOCOL_VERSION,
      transport: "streamable-http",
      tools: Object.keys(TOOLS),
      note: "POST JSON-RPC 2.0 messages here (MCP).",
    });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const refresh = new URL(req.url).searchParams.get("refresh") === "1";

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(rpcError(null, -32700, "Parse error"), 200);
  }

  const out = await handleRpc(body as Record<string, unknown>, refresh);
  if (out === null) return new Response(null, { status: 202, headers: corsHeaders });
  return json(out);
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
