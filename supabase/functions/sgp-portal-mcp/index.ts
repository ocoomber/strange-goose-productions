// sgp-portal-mcp — Model Context Protocol server onto the SGP client portal.
//
// Lets an existing SGP client's AI assistant check project status, review
// deliverables, see approval history, and be handed a link to approve — without
// logging into the portal manually. Stateless Streamable HTTP (spec 2025-11-25).
//
// AUTH: the client generates an "MCP key" in the portal (stored hashed). They
// put it in their AI tool; this server hashes it, finds the client, and obtains
// a real CLIENT session for them. All data reads go through that session, so the
// portal's existing Row Level Security is the security boundary — no hand-rolled
// scoping. Approvals stay human for now (we return a portal deep link); the
// `performApproval` seam below is where direct AI approval would later plug in.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  PORTAL_URL, projectDeepLink, sha256Hex, shapeProjectDetail,
  shapeProjectSummary, pendingActions, type StageRow, type ProjectRow,
} from "./lib.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const PROTOCOL_VERSION = "2025-11-25";
const SERVER_INFO = { name: "strange-goose-portal", version: "1.0.0" };
const SERVER_INSTRUCTIONS =
  "This connects an existing Strange Goose Productions client to their own " +
  "projects in SGP's client portal. Use these tools to check project status " +
  "and progress, review deliverables, see approval history, and find out what " +
  "needs the client's action. Approvals are made by the client in the portal: " +
  "when a stage needs sign-off, give the human the `approve_in_portal` link to " +
  "open and approve. Only the connected client's own data is accessible.";

// Approval is human-in-portal for now. Flip to true (and add an `approvals.source`
// column) to enable direct AI approval, logged with its source.
const ALLOW_DIRECT_APPROVAL = false;

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
// Auth: MCP key → client → real client session (cached per key)
// ---------------------------------------------------------------------------

type Client = { clientId: string; email: string };
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

// Look up the (non-revoked) key by hash → the owning client. Service role is used
// ONLY here and for session minting — never to read project data.
async function resolveClient(token: string): Promise<Client | null> {
  const hash = await sha256Hex(token);
  const { data } = await admin
    .from("mcp_tokens")
    .select("id, client_id, revoked_at, profiles!inner(email, role)")
    .eq("token_hash", hash)
    .is("revoked_at", null)
    .maybeSingle();
  if (!data) return null;
  const profile = (data as { profiles?: { email?: string; role?: string } }).profiles;
  // This server is for clients only — an admin's key belongs on sgp-admin-mcp.
  if (!profile?.email || profile.role !== "client") return null;
  // best-effort last_used stamp
  admin.from("mcp_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", data.id)
    .then(() => {}, () => {});
  return { clientId: data.client_id as string, email: profile.email };
}

// Mint a real client session via the Admin API (works regardless of the
// project's JWT signing scheme). Cached until shortly before expiry.
// One generateLink→verifyOtp cycle. GoTrue magic-link tokens are single-use, so
// this can lose a race against a concurrent mint for the same user — the caller
// retries.
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

async function clientAccessToken(token: string, email: string): Promise<string> {
  const hash = await sha256Hex(token);
  const hit = sessionCache.get(hash);
  if (hit && hit.exp - 60 > Date.now() / 1000) return hit.accessToken;

  // De-duplicate concurrent cold-cache mints for the same key into one promise
  // (handles same-instance bursts). GoTrue magic-link tokens are single-use, so
  // cross-instance concurrent mints can invalidate each other — retry with
  // backoff + jitter until a generate→verify pair lands cleanly.
  let p = inflight.get(hash);
  if (!p) {
    p = (async () => {
      let s: { accessToken: string; exp: number } | null = null;
      for (let i = 0; i < 4 && !s; i++) {
        if (i) await new Promise((r) => setTimeout(r, 150 * i + Math.random() * 200));
        s = await mintOnce(email);
      }
      if (!s?.accessToken) throw new Error("Could not establish a session for this client.");
      sessionCache.set(hash, { accessToken: s.accessToken, exp: s.exp });
      return s.accessToken;
    })().finally(() => inflight.delete(hash));
    inflight.set(hash, p);
  }
  return p;
}

// A supabase client that acts AS the client — RLS scopes every query.
function clientDb(accessToken: string): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const STAGE_SELECT = "id, stage_index, name, state, note, video_id, doc_links, deliverable_links, pending_since";

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
  run: (db: SupabaseClient, args: Record<string, unknown>, ctx: Client) => Promise<ToolResult>;
};

async function loadProjectsWithStages(db: SupabaseClient) {
  const { data, error } = await db
    .from("projects")
    .select(`id, title, status, created_at, completed_at, stages(${STAGE_SELECT})`)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as (ProjectRow & { stages: StageRow[] })[];
}

const TOOLS: Record<string, Tool> = {
  get_account: {
    description: "Confirm whose account is connected (name, email) and a one-line summary of their projects. Use this first to verify the connection.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async (db) => {
      const { data: profile } = await db.from("profiles").select("display_name, email").maybeSingle();
      const projects = await loadProjectsWithStages(db);
      const active = projects.filter((p) => p.status !== "complete").length;
      return ok(
        `Connected as ${profile?.display_name || profile?.email || "client"} — ${projects.length} project(s), ${active} active.`,
        { account: profile, project_count: projects.length, active_projects: active },
      );
    },
  },

  list_projects: {
    description: "List the client's projects with status and progress (approved stages out of 7), and whether each is awaiting the client's action.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async (db) => {
      const projects = await loadProjectsWithStages(db);
      const out = projects.map((p) => shapeProjectSummary(p, p.stages ?? []));
      return ok(`${out.length} project(s).`, out);
    },
  },

  get_project: {
    description: "Full detail for one project by id: every visible stage (state, notes, video, documents, deliverables), approval dates, and an approve-in-portal link for any stage awaiting the client.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { project_id: { type: "string", description: "The project's id (from list_projects)." } },
      required: ["project_id"],
    },
    run: async (db, args) => {
      const id = String(args.project_id ?? "");
      if (!id) return toolError("Provide project_id.");
      const { data: project } = await db.from("projects").select("id, title, status, created_at, completed_at").eq("id", id).maybeSingle();
      if (!project) return toolError("No project found with that id (or it isn't on your account).");
      const { data: stages } = await db.from("stages").select(STAGE_SELECT).eq("project_id", id).order("stage_index");
      const { data: approvals } = await db.from("approvals").select("stage_id, stage_name, approved_at").eq("project_id", id);
      return ok(`${project.title} — ${project.status}`, shapeProjectDetail(project as ProjectRow, (stages ?? []) as StageRow[], approvals ?? []));
    },
  },

  get_pending_actions: {
    description: "What currently needs the client's action across all their projects — each pending stage, what it's asking for, and the portal link to approve it.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async (db) => {
      const projects = await loadProjectsWithStages(db);
      const acts = pendingActions(projects.map((p) => ({ project: p, stages: p.stages ?? [] })));
      const summary = acts.length ? `${acts.length} item(s) awaiting you.` : "Nothing is awaiting your action right now.";
      return ok(summary, acts);
    },
  },

  list_deliverables: {
    description: "Final deliverable files released across the client's projects (download links).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async (db) => {
      const projects = await loadProjectsWithStages(db);
      const out: unknown[] = [];
      for (const p of projects) {
        for (const s of p.stages ?? []) {
          if ((s.deliverable_links ?? []).length) {
            out.push({ project_id: p.id, project_title: p.title, stage: s.stage_index, name: s.name, deliverables: s.deliverable_links });
          }
        }
      }
      return ok(out.length ? `${out.length} project(s) with deliverables.` : "No deliverables released yet.", out);
    },
  },

  get_approval_history: {
    description: "The client's approval audit trail — which stages they've signed off and when, across all their projects.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async (db) => {
      const { data, error } = await db
        .from("approvals")
        .select("stage_name, approved_at, projects(title)")
        .order("approved_at", { ascending: false });
      if (error) throw new Error(error.message);
      const out = (data ?? []).map((a: { stage_name: string; approved_at: string; projects?: { title?: string } }) => ({
        project: a.projects?.title, stage_name: a.stage_name, approved_at: a.approved_at,
      }));
      return ok(`${out.length} approval(s) on record.`, out);
    },
  },

  get_portal_link: {
    description: "The client portal URL (and a per-project deep link if a project_id is given) for the human to sign in and act.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { project_id: { type: "string", description: "Optional: deep-link straight to this project." } },
    },
    run: async (_db, args) => {
      const id = args.project_id ? String(args.project_id) : "";
      return ok("Portal link.", { portal: PORTAL_URL, project_link: id ? projectDeepLink(id) : undefined });
    },
  },
};

// Reserved seam for future direct AI approval (disabled). When enabled, this
// inserts the approval AS the client (auth.uid() = client), so handle_approval()
// + the notify webhook work exactly as the portal's own approve button.
async function performApproval(db: SupabaseClient, stageId: string): Promise<ToolResult> {
  if (!ALLOW_DIRECT_APPROVAL) {
    return toolError("Direct approval isn't enabled. Open the approve_in_portal link and approve in the portal.");
  }
  const { error } = await db.from("approvals").insert({ stage_id: stageId });
  if (error) return toolError(error.message);
  return ok("Approved.", { stage_id: stageId });
}
void performApproval;

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
      // Authenticate the connection (token → client → session) lazily.
      if (!token) {
        return rpcResult(id, toolError("Not connected: add your SGP MCP key. Generate one in the client portal under 'MCP access'."));
      }
      try {
        const client = await resolveClient(token);
        if (!client) {
          return rpcResult(id, toolError("Your MCP key is invalid or has been revoked. Generate a new one in the client portal."));
        }
        const accessToken = await clientAccessToken(token, client.email);
        const db = clientDb(accessToken);
        const result = await tool.run(db, (params?.arguments as Record<string, unknown>) ?? {}, client);
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
    return json({ server: SERVER_INFO, protocolVersion: PROTOCOL_VERSION, transport: "streamable-http", tools: Object.keys(TOOLS), note: "POST JSON-RPC 2.0 here (MCP). Authenticate with your SGP MCP key as a Bearer token, or append ?key=YOUR_KEY to this URL (for clients like Claude.ai's web connector that can't send custom headers)." });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const token = extractToken(req);
  let body: unknown;
  try { body = await req.json(); } catch { return json(rpcError(null, -32700, "Parse error")); }

  const out = await handleRpc(body as Record<string, unknown>, token);
  if (out === null) return new Response(null, { status: 202, headers: corsHeaders });
  return json(out);
});
