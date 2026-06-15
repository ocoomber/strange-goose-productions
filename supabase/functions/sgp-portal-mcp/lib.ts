// Pure, runtime-agnostic helpers for sgp-portal-mcp: token hashing, the portal
// deep-link builder, per-stage action guidance, and shaping DB rows into clean
// tool output. No Deno/Supabase deps, so this is unit-testable under Node
// (--experimental-strip-types) and imported by index.ts.

export const PORTAL_URL = "https://www.strangegoose.co.uk/client/";

export function projectDeepLink(projectId: string): string {
  return `${PORTAL_URL}#project/${projectId}`;
}

// SHA-256 hex of a string. Must match Postgres
// `encode(digest(token,'sha256'),'hex')` so the server can look up a key by its
// stored hash. Uses Web Crypto (present in Deno and Node 18+).
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// What each stage means and the action the client takes — distilled from the
// portal's STAGE_ACTIONS (site/portal.js) so the AI can explain to its human
// what a pending stage is asking for.
export const STAGE_GUIDE: Record<number, { action: string; meaning: string }> = {
  1: { action: "Approve the brief", meaning: "Confirm the linked brief as the agreed basis for the project." },
  2: { action: "Confirm feedback sent (round 1 of 2)", meaning: "Watch Edit v1, send feedback to SGP by email, then confirm to proceed." },
  3: { action: "Confirm feedback sent (round 2 of 2)", meaning: "Watch Edit v2, send feedback by email, then confirm — final included feedback round." },
  4: { action: "Acknowledge picture lock", meaning: "Accept the locked picture; further edit changes from here are chargeable." },
  5: { action: "Confirm feedback sent (colour & sound)", meaning: "Review the colour & sound version, send feedback by email, then confirm — one included round." },
  6: { action: "Accept the final version", meaning: "Confirm you're happy with the finished film; SGP then issues the final invoice." },
  7: { action: "Confirm files received", meaning: "Download and check all deliverables, then confirm to complete the project." },
};

type Json = Record<string, unknown>;
export type StageRow = {
  id: string; stage_index: number; name: string; state: string;
  note: string | null; video_id: string | null;
  doc_links: { label?: string; url: string }[]; deliverable_links: { label?: string; url: string }[];
  pending_since: string | null;
};
export type ProjectRow = {
  id: string; title: string; status: string; created_at: string; completed_at: string | null;
};
export type ApprovalRow = { stage_id: string; stage_name: string; approved_at: string };

// Shape one stage for output. For a pending stage, attach an `action` block
// (what's needed + how to approve, via the portal deep link — approval stays
// human for now).
export function shapeStage(s: StageRow, projectId: string, approval?: ApprovalRow): Json {
  const out: Json = { stage: s.stage_index, name: s.name, state: s.state };
  if (s.note) out.note = s.note;
  if (s.video_id) out.video_url = `https://youtu.be/${s.video_id}`;
  if (s.doc_links?.length) out.documents = s.doc_links;
  if (s.deliverable_links?.length) out.deliverables = s.deliverable_links;
  if (approval) out.approved_at = approval.approved_at;
  if (s.state === "pending") {
    const g = STAGE_GUIDE[s.stage_index];
    out.action = {
      needed: true,
      what: g?.action ?? "Review and approve this stage",
      meaning: g?.meaning ?? "",
      how: "Approval is made by the client in the portal. Open the link, review, then approve.",
      approve_in_portal: projectDeepLink(projectId),
    };
  }
  return out;
}

export function approvalsByStage(approvals: ApprovalRow[]): Record<string, ApprovalRow> {
  const m: Record<string, ApprovalRow> = {};
  for (const a of approvals) m[a.stage_id] = a;
  return m;
}

// Compact summary for list_projects.
export function shapeProjectSummary(p: ProjectRow, stages: StageRow[]): Json {
  const approved = stages.filter((s) => s.state === "approved").length;
  const pending = stages.find((s) => s.state === "pending") || null;
  return {
    id: p.id,
    title: p.title,
    status: p.status,
    progress: `${approved}/7 stages approved`,
    approved_stages: approved,
    awaiting_you: !!pending,
    current_stage: pending ? { stage: pending.stage_index, name: pending.name } : null,
    created_at: p.created_at,
    completed_at: p.completed_at ?? undefined,
  };
}

// Full project detail for get_project.
export function shapeProjectDetail(p: ProjectRow, stages: StageRow[], approvals: ApprovalRow[]): Json {
  const byStage = approvalsByStage(approvals);
  const ordered = [...stages].sort((a, b) => a.stage_index - b.stage_index);
  return {
    id: p.id,
    title: p.title,
    status: p.status,
    created_at: p.created_at,
    completed_at: p.completed_at ?? undefined,
    portal_link: projectDeepLink(p.id),
    stages: ordered.map((s) => shapeStage(s, p.id, byStage[s.id])),
  };
}

// "What needs my action?" across projects: one entry per pending stage.
export function pendingActions(
  rows: { project: ProjectRow; stages: StageRow[] }[],
): Json[] {
  const out: Json[] = [];
  for (const { project, stages } of rows) {
    const pending = stages.find((s) => s.state === "pending");
    if (!pending) continue;
    const g = STAGE_GUIDE[pending.stage_index];
    out.push({
      project_id: project.id,
      project_title: project.title,
      stage: pending.stage_index,
      stage_name: pending.name,
      what: g?.action ?? "Review and approve this stage",
      meaning: g?.meaning ?? "",
      approve_in_portal: projectDeepLink(project.id),
    });
  }
  return out;
}
