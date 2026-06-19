// sgp-admin-mcp — Model Context Protocol server onto the SGP admin panel.
//
// Lets Owen's AI assistant work conversationally across every client and
// project: search clients, check project status, see who needs to hear from
// him, read/add chase-log notes, and paste doc/video links into a stage. It
// deliberately does NOT cover anything that changes a project's state for a
// client (advancing a stage, releasing deliverables, marking complete) or
// account lifecycle (create/archive/delete a client) — those stay admin-panel
// only, since a wrong AI action there would email or unblock a real client.
//
// AUTH: same pattern as sgp-portal-mcp — Owen generates an "MCP key" in the
// admin panel (stored hashed). This server hashes the presented key, finds
// the owning profile, and obtains a real session for them via the Admin API.
// All data reads/writes run through that session, so the existing
// `is_admin()` RLS policies are the security boundary. A key is rejected here
// unless its owning profile has role = 'admin' (an accidentally-pasted client
// MCP key does not get admin powers).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  ADMIN_URL, sha256Hex, statusOf, shapeProjectSummary, shapeProjectDetail,
  attentionNeeded, type StageRow, type ProjectRow, type ApprovalRow, type NoteRow,
} from "./lib.ts";
import { SGP_PORTAL_TEMPLATE_JSX } from "./template.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const PROTOCOL_VERSION = "2025-11-25";
const SERVER_INFO = { name: "strange-goose-admin", version: "1.0.0" };
const SERVER_INSTRUCTIONS =
  "This connects Strange Goose Productions' admin to their own portal data " +
  "across all clients and projects. Use these tools to search clients, check " +
  "project status, see what needs admin attention (your_move / overdue), read " +
  "or add chase-log notes, and paste document/video links into a stage. This " +
  "server deliberately cannot advance a stage, release deliverables, mark a " +
  "project complete, or create/archive/delete a client account — do those in " +
  "the admin panel itself (link given by get_account / each project).";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, mcp-protocol-version, mcp-session-id",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------------
// Auth: MCP key → admin profile → real admin session (cached per key)
// ---------------------------------------------------------------------------

type AdminCtx = { adminId: string; email: string };
const sessionCache = new Map<string, { accessToken: string; exp: number }>();
const inflight = new Map<string, Promise<string>>();

// Most clients send the key as a Bearer header. Claude.ai's web "custom
// connector" UI only takes a URL (no header field), so we also accept the
// key as a ?key= query param on the endpoint URL itself.
function extractToken(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  const q = new URL(req.url).searchParams.get("key");
  return q ? q.trim() : null;
}

// Look up the (non-revoked) key by hash → the owning profile, and require it
// to be an admin account. Service role is used ONLY here and for session
// minting — never to read portal data.
async function resolveAdmin(token: string): Promise<AdminCtx | null> {
  const hash = await sha256Hex(token);
  const { data } = await admin
    .from("mcp_tokens")
    .select("id, client_id, revoked_at, profiles!inner(email, role)")
    .eq("token_hash", hash)
    .is("revoked_at", null)
    .maybeSingle();
  if (!data) return null;
  const profile = (data as { profiles?: { email?: string; role?: string } }).profiles;
  if (!profile?.email || profile.role !== "admin") return null;
  admin.from("mcp_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", data.id)
    .then(() => {}, () => {});
  return { adminId: data.client_id as string, email: profile.email };
}

// Mint a real session for the admin via the Admin API. Cached until shortly
// before expiry. GoTrue magic-link tokens are single-use, so a concurrent
// mint for the same admin can lose a race — retry with backoff.
async function mintOnce(email: string): Promise<{ accessToken: string; exp: number } | null> {
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkErr || !link?.properties?.hashed_token) {
    throw new Error("generateLink failed: " + (linkErr?.message ?? "no hashed_token"));
  }
  const th = link.properties.hashed_token;
  for (const type of ["magiclink", "email"] as const) {
    const { data, error } = await admin.auth.verifyOtp({ token_hash: th, type });
    if (data.session?.access_token) {
      return { accessToken: data.session.access_token, exp: data.session.expires_at ?? 0 };
    }
    if (error && !/expired|invalid/i.test(error.message)) break;
  }
  return null;
}

async function adminAccessToken(token: string, email: string): Promise<string> {
  const hash = await sha256Hex(token);
  const hit = sessionCache.get(hash);
  if (hit && hit.exp - 60 > Date.now() / 1000) return hit.accessToken;

  let p = inflight.get(hash);
  if (!p) {
    p = (async () => {
      let s: { accessToken: string; exp: number } | null = null;
      for (let i = 0; i < 4 && !s; i++) {
        if (i) await new Promise((r) => setTimeout(r, 150 * i + Math.random() * 200));
        s = await mintOnce(email);
      }
      if (!s?.accessToken) throw new Error("Could not establish a session for this admin.");
      sessionCache.set(hash, { accessToken: s.accessToken, exp: s.exp });
      return s.accessToken;
    })().finally(() => inflight.delete(hash));
    inflight.set(hash, p);
  }
  return p;
}

// A supabase client that acts AS the admin — RLS (is_admin()) scopes every query.
function adminDb(accessToken: string): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const STAGE_SELECT = "id, stage_index, name, state, note, video_id, doc_links, deliverable_links, pending_since";
const CLIENT_SELECT = "id, email, display_name, archived";

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
function ok(summary: string, data: unknown): ToolResult {
  return { content: [{ type: "text", text: summary + "\n\n```json\n" + JSON.stringify(data, null, 2) + "\n```" }] };
}
function toolError(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

type Tool = {
  description: string;
  inputSchema: Record<string, unknown>;
  run: (db: SupabaseClient, args: Record<string, unknown>, ctx: AdminCtx) => Promise<ToolResult>;
};

type ProjectJoined = ProjectRow & {
  client_id: string;
  archived?: boolean;
  stages: StageRow[];
  approvals: ApprovalRow[];
  profiles?: { email?: string; display_name?: string | null; archived?: boolean } | null;
};

async function loadProjects(db: SupabaseClient, clientId?: string, includeArchived = false): Promise<ProjectJoined[]> {
  let q = db
    .from("projects")
    .select(`id, title, status, created_at, completed_at, client_id, archived,
      profiles(email, display_name, archived),
      stages(${STAGE_SELECT}),
      approvals(stage_id, stage_name, approved_at)`)
    .order("created_at", { ascending: false });
  if (clientId) q = q.eq("client_id", clientId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  // Mirror the admin panel's live view (admin/index.html loadData): by default
  // hide projects that are themselves archived OR belong to an archived client,
  // so the AI's queues/counts/attention match the web dashboard and don't
  // resurface work Owen has deliberately put aside. Callers can opt in to
  // archived rows (list_projects / get_client expose an include_archived flag).
  const rows = (data ?? []) as unknown as ProjectJoined[];
  if (includeArchived) return rows;
  return rows.filter((p) => !p.archived && !p.profiles?.archived);
}

const TOOLS: Record<string, Tool> = {
  get_account: {
    description: "Confirm the admin connection and a one-line summary of the whole portal (client count, active/complete projects, items needing attention). Use this first to verify the connection.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async (db) => {
      const { data: clients } = await db.from("profiles").select("id, archived").eq("role", "client");
      const projects = await loadProjects(db);
      const active = projects.filter((p) => p.status !== "complete").length;
      const att = attentionNeeded(projects.map((p) => ({ project: p, stages: p.stages ?? [], approvals: p.approvals ?? [], client: p.profiles })));
      return ok(
        `Connected to the SGP admin panel — ${(clients ?? []).filter((c) => !c.archived).length} active client(s), ${active} active project(s), ${att.your_move.length} on you, ${att.overdue.length} overdue.`,
        {
          admin_panel: ADMIN_URL,
          active_clients: (clients ?? []).filter((c) => !c.archived).length,
          active_projects: active,
          your_move: att.your_move.length,
          overdue: att.overdue.length,
          render_hint: {
            template_jsx: SGP_PORTAL_TEMPLATE_JSX,
            description: "Optional. Render this JSX as an artifact, replacing the values in its `data` block with the fields from this response — a quick visual instead of a wall of text. Safe to ignore if you can't render artifacts.",
          },
        },
      );
    },
  },

  list_clients: {
    description: "Search/list clients. Defaults to active (non-archived) clients only.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        search: { type: "string", description: "Match against name or email (case-insensitive substring)." },
        include_archived: { type: "boolean", description: "Include archived clients too. Default false." },
      },
    },
    run: async (db, args) => {
      let q = db.from("profiles").select(CLIENT_SELECT).eq("role", "client").order("email");
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      let rows = (data ?? []) as { id: string; email: string; display_name: string | null; archived: boolean }[];
      if (!args.include_archived) rows = rows.filter((c) => !c.archived);
      const search = String(args.search ?? "").trim().toLowerCase();
      if (search) rows = rows.filter((c) => c.email.toLowerCase().includes(search) || (c.display_name ?? "").toLowerCase().includes(search));
      return ok(`${rows.length} client(s).`, rows.map((c) => ({ id: c.id, email: c.email, name: c.display_name, archived: c.archived })));
    },
  },

  get_client: {
    description: "One client's detail plus a summary of every project of theirs (status, progress, what's pending). Archived projects are excluded unless include_archived is set.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        client_id: { type: "string", description: "From list_clients." },
        include_archived: { type: "boolean", description: "Include this client's archived projects too. Default false." },
      },
      required: ["client_id"],
    },
    run: async (db, args) => {
      const id = String(args.client_id ?? "");
      if (!id) return toolError("Provide client_id.");
      const { data: client } = await db.from("profiles").select(CLIENT_SELECT).eq("id", id).eq("role", "client").maybeSingle();
      if (!client) return toolError("No client found with that id.");
      const projects = await loadProjects(db, id, !!args.include_archived);
      const out = projects.map((p) => shapeProjectSummary(p, p.stages ?? [], p.approvals ?? [], p.profiles));
      return ok(`${client.display_name || client.email} — ${out.length} project(s).`, { client: { id: client.id, email: client.email, name: client.display_name, archived: client.archived }, projects: out });
    },
  },

  list_projects: {
    description: "List projects across all clients, optionally filtered by status (you/client/stalled/complete) or a text search on title/client. Archived projects (and projects of archived clients) are excluded unless include_archived is set.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        status: { type: "string", description: "you | client | stalled | complete — omit for all." },
        search: { type: "string", description: "Match against project title or client name/email." },
        include_archived: { type: "boolean", description: "Include archived projects (and projects of archived clients) too. Default false." },
      },
    },
    run: async (db, args) => {
      const projects = await loadProjects(db, undefined, !!args.include_archived);
      let out = projects.map((p) => ({ p, summary: shapeProjectSummary(p, p.stages ?? [], p.approvals ?? [], p.profiles) }));
      if (args.status) out = out.filter(({ p }) => statusOf(p, p.stages ?? []) === args.status);
      const search = String(args.search ?? "").trim().toLowerCase();
      if (search) out = out.filter(({ p }) => p.title.toLowerCase().includes(search) || (p.profiles?.email ?? "").toLowerCase().includes(search) || (p.profiles?.display_name ?? "").toLowerCase().includes(search));
      return ok(`${out.length} project(s).`, out.map((o) => o.summary));
    },
  },

  get_project: {
    description: "Full detail for one project by id: every stage including locked ones, approval dates, the chase log, and an admin panel deep link.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { project_id: { type: "string", description: "From list_projects." } },
      required: ["project_id"],
    },
    run: async (db, args) => {
      const id = String(args.project_id ?? "");
      if (!id) return toolError("Provide project_id.");
      const { data: project } = await db.from("projects").select("id, title, status, created_at, completed_at, client_id, profiles(email, display_name)").eq("id", id).maybeSingle();
      if (!project) return toolError("No project found with that id.");
      const { data: stages } = await db.from("stages").select(STAGE_SELECT).eq("project_id", id).order("stage_index");
      const { data: approvals } = await db.from("approvals").select("stage_id, stage_name, approved_at").eq("project_id", id);
      const { data: notes } = await db.from("project_notes").select("body, created_at").eq("project_id", id).order("created_at", { ascending: false });
      const detail = shapeProjectDetail(
        project as unknown as ProjectRow,
        (stages ?? []) as StageRow[],
        (approvals ?? []) as ApprovalRow[],
        (notes ?? []) as NoteRow[],
        (project as unknown as { profiles?: { email?: string; display_name?: string | null } }).profiles,
      );
      return ok(`${project.title} — ${detail.status}`, detail);
    },
  },

  get_attention_needed: {
    description: "What needs admin attention right now: projects where the ball is in SGP's court (your_move), and projects overdue waiting on the client (overdue).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async (db) => {
      const projects = await loadProjects(db);
      const att = attentionNeeded(projects.map((p) => ({ project: p, stages: p.stages ?? [], approvals: p.approvals ?? [], client: p.profiles })));
      const summary = `${att.your_move.length} project(s) on you, ${att.overdue.length} overdue waiting on the client.`;
      return ok(summary, att);
    },
  },

  add_chase_note: {
    description: "Add a chase-log note to a project (admin-only, never seen by the client) — e.g. 'Emailed client to chase feedback, no reply yet.'",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        project_id: { type: "string" },
        note: { type: "string", description: "The note text." },
      },
      required: ["project_id", "note"],
    },
    run: async (db, args, ctx) => {
      const projectId = String(args.project_id ?? "");
      const body = String(args.note ?? "").trim();
      if (!projectId || !body) return toolError("Provide project_id and note.");
      const { error } = await db.from("project_notes").insert({ project_id: projectId, body, author_id: ctx.adminId });
      if (error) return toolError(error.message);
      return ok("Note added.", { project_id: projectId, note: body });
    },
  },

  update_stage_links: {
    description: "Paste/update a stage's document links, YouTube video id, and/or note — without advancing it (the stage's state is untouched). Use this to load up a stage before sending it to the client from the admin panel. Refuses on an already-approved stage (frozen).",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        project_id: { type: "string" },
        stage_index: { type: "number", description: "1-7." },
        doc_links: { type: "array", items: { type: "object", properties: { label: { type: "string" }, url: { type: "string" } }, required: ["url"] }, description: "Replaces the stage's document links entirely." },
        video_id: { type: "string", description: "YouTube video id (the part after watch?v=)." },
        note: { type: "string" },
      },
      required: ["project_id", "stage_index"],
    },
    run: async (db, args) => {
      const projectId = String(args.project_id ?? "");
      const stageIndex = Number(args.stage_index);
      if (!projectId || !stageIndex) return toolError("Provide project_id and stage_index.");
      const { data: stage } = await db.from("stages").select("id, state").eq("project_id", projectId).eq("stage_index", stageIndex).maybeSingle();
      if (!stage) return toolError("No such stage on that project.");
      if (stage.state === "approved") return toolError("That stage is already approved and its content is frozen — it can no longer be edited.");
      const patch: Record<string, unknown> = {};
      if (args.doc_links !== undefined) patch.doc_links = args.doc_links;
      if (args.video_id !== undefined) patch.video_id = args.video_id;
      if (args.note !== undefined) patch.note = args.note;
      if (Object.keys(patch).length === 0) return toolError("Provide at least one of doc_links, video_id, note.");
      const { error } = await db.from("stages").update(patch).eq("id", stage.id);
      if (error) return toolError(error.message);
      return ok(`Stage ${stageIndex} updated.`, { project_id: projectId, stage_index: stageIndex, ...patch });
    },
  },
};

// ---------------------------------------------------------------------------
// JSON-RPC / MCP dispatch
// ---------------------------------------------------------------------------

const rpcResult = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

async function handleRpc(
  msg: { method?: string; id?: unknown; params?: Record<string, unknown> },
  token: string | null,
) {
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
      return null;
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, {
        tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })),
      });
    case "tools/call": {
      const name = params?.name as string;
      const tool = TOOLS[name];
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${name}`);
      if (!token) {
        return rpcResult(id, toolError("Not connected: add your SGP admin MCP key. Generate one in the admin panel under 'MCP access'."));
      }
      try {
        const ctx = await resolveAdmin(token);
        if (!ctx) {
          return rpcResult(id, toolError("Your MCP key is invalid, revoked, or isn't an admin key. Generate a new one in the admin panel."));
        }
        const accessToken = await adminAccessToken(token, ctx.email);
        const db = adminDb(accessToken);
        const result = await tool.run(db, (params?.arguments as Record<string, unknown>) ?? {}, ctx);
        return rpcResult(id, result);
      } catch (e) {
        console.error(`tool ${name} failed:`, e);
        return rpcResult(id, toolError(`Error: ${(e as Error).message}`));
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method === "GET") {
    return json({ server: SERVER_INFO, protocolVersion: PROTOCOL_VERSION, transport: "streamable-http", tools: Object.keys(TOOLS), note: "POST JSON-RPC 2.0 here (MCP). Authenticate with your SGP admin MCP key as a Bearer token, or append ?key=YOUR_KEY to this URL (for clients like Claude.ai's web connector that can't send custom headers)." });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const token = extractToken(req);
  let body: unknown;
  try { body = await req.json(); } catch { return json(rpcError(null, -32700, "Parse error")); }

  const out = await handleRpc(body as Record<string, unknown>, token);
  if (out === null) return new Response(null, { status: 202, headers: corsHeaders });
  return json(out);
});
