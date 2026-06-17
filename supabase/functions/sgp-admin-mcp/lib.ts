// Pure, runtime-agnostic helpers for sgp-admin-mcp: token hashing, admin deep
// links, and the status/overdue model ported from admin/index.html
// (statusOf/overdueDays/waitingSince/pendingStageOf — keep these in sync with
// that file if the rules ever change). No Deno/Supabase deps, so this is
// unit-testable under Node (--experimental-strip-types) and imported by
// index.ts.

export const ADMIN_URL = "https://www.strangegoose.co.uk/admin/";
export const OVERDUE_DAYS = 7;

export function projectDeepLink(projectId: string): string {
  return `${ADMIN_URL}#project/${projectId}`;
}

// SHA-256 hex of a string. Must match Postgres
// `encode(digest(token,'sha256'),'hex')` so the server can look up a key by
// its stored hash. Uses Web Crypto (present in Deno and Node 18+).
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Json = Record<string, unknown>;

export type StageRow = {
  id: string; stage_index: number; name: string; state: string;
  note: string | null; video_id: string | null;
  doc_links: { label?: string; url: string }[]; deliverable_links: { label?: string; url: string }[];
  pending_since: string | null;
};
export type ProjectRow = {
  id: string; title: string; status: string; created_at: string; completed_at: string | null;
  client_id?: string;
};
export type ApprovalRow = { stage_id: string; stage_name: string; approved_at: string };
export type NoteRow = { id?: string; body: string; created_at: string };
export type ClientRow = { id: string; email: string; display_name: string | null; archived: boolean };

export function pendingStageOf(stages: StageRow[]): StageRow | undefined {
  return stages.find((s) => s.state === "pending");
}

export function overdueDays(stages: StageRow[]): number {
  const ps = pendingStageOf(stages);
  if (!ps || !ps.pending_since) return 0;
  const ms = Date.now() - new Date(ps.pending_since).getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

// "you" = nothing pending, ball is in SGP's court; "client" = waiting on the
// client, not yet overdue; "stalled" = waiting on the client, overdue;
// "complete" = project finished. Mirrors admin/index.html's statusOf().
export function statusOf(project: ProjectRow, stages: StageRow[]): "you" | "client" | "stalled" | "complete" {
  if (project.status === "complete") return "complete";
  const ps = pendingStageOf(stages);
  if (!ps) return "you";
  return overdueDays(stages) >= OVERDUE_DAYS ? "stalled" : "client";
}

export function waitingSince(project: ProjectRow, stages: StageRow[], approvals: ApprovalRow[]): number {
  const ps = pendingStageOf(stages);
  if (ps && ps.pending_since) return new Date(ps.pending_since).getTime();
  const times = approvals.map((a) => new Date(a.approved_at).getTime());
  return times.length ? Math.max(...times) : new Date(project.created_at).getTime();
}

export function clientLabel(c?: { email?: string; display_name?: string | null } | null): string {
  if (!c) return "Unknown client";
  return c.display_name || c.email || "Unknown client";
}

// Compact summary for list_projects / get_attention_needed.
export function shapeProjectSummary(
  project: ProjectRow,
  stages: StageRow[],
  approvals: ApprovalRow[],
  client?: { email?: string; display_name?: string | null } | null,
): Json {
  const approved = stages.filter((s) => s.state === "approved").length;
  const status = statusOf(project, stages);
  const ps = pendingStageOf(stages);
  const out: Json = {
    id: project.id,
    title: project.title,
    client: clientLabel(client),
    client_email: client?.email,
    status,
    progress: `${approved}/7 stages approved`,
    current_stage: ps ? { stage: ps.stage_index, name: ps.name } : null,
    waiting_since: new Date(waitingSince(project, stages, approvals)).toISOString(),
    created_at: project.created_at,
    completed_at: project.completed_at ?? undefined,
    admin_link: projectDeepLink(project.id),
  };
  if (status === "stalled") out.overdue_days = overdueDays(stages);
  return out;
}

function shapeStage(s: StageRow, approval?: ApprovalRow): Json {
  const out: Json = { stage: s.stage_index, name: s.name, state: s.state };
  if (s.note) out.note = s.note;
  if (s.video_id) out.video_url = `https://youtu.be/${s.video_id}`;
  if (s.doc_links?.length) out.documents = s.doc_links;
  if (s.deliverable_links?.length) out.deliverables = s.deliverable_links;
  if (s.pending_since) out.pending_since = s.pending_since;
  if (approval) out.approved_at = approval.approved_at;
  return out;
}

export function approvalsByStage(approvals: ApprovalRow[]): Record<string, ApprovalRow> {
  const m: Record<string, ApprovalRow> = {};
  for (const a of approvals) m[a.stage_id] = a;
  return m;
}

// Full project detail for get_project: every stage (admin sees locked ones
// too), the chase log, and an admin deep link.
export function shapeProjectDetail(
  project: ProjectRow,
  stages: StageRow[],
  approvals: ApprovalRow[],
  notes: NoteRow[],
  client?: { email?: string; display_name?: string | null } | null,
): Json {
  const byStage = approvalsByStage(approvals);
  const ordered = [...stages].sort((a, b) => a.stage_index - b.stage_index);
  return {
    id: project.id,
    title: project.title,
    client: clientLabel(client),
    client_email: client?.email,
    status: statusOf(project, stages),
    created_at: project.created_at,
    completed_at: project.completed_at ?? undefined,
    admin_link: projectDeepLink(project.id),
    stages: ordered.map((s) => shapeStage(s, byStage[s.id])),
    chase_log: notes.map((n) => ({ note: n.body, created_at: n.created_at })),
  };
}

// "What needs me?" — projects with the ball in SGP's court (no pending
// stage) plus anything overdue waiting on the client.
export function attentionNeeded(
  rows: { project: ProjectRow; stages: StageRow[]; approvals: ApprovalRow[]; client?: { email?: string; display_name?: string | null } | null }[],
): { your_move: Json[]; overdue: Json[] } {
  const yourMove: Json[] = [];
  const overdue: Json[] = [];
  for (const { project, stages, approvals, client } of rows) {
    const status = statusOf(project, stages);
    if (status === "you") yourMove.push(shapeProjectSummary(project, stages, approvals, client));
    else if (status === "stalled") overdue.push(shapeProjectSummary(project, stages, approvals, client));
  }
  yourMove.sort((a, b) => new Date(a.waiting_since as string).getTime() - new Date(b.waiting_since as string).getTime());
  overdue.sort((a, b) => (b.overdue_days as number) - (a.overdue_days as number));
  return { your_move: yourMove, overdue };
}
