// Unit tests for the pure admin-MCP helpers. No network/DB.
// Run: node --experimental-strip-types lib.test.ts
import {
  sha256Hex, projectDeepLink, statusOf, overdueDays, waitingSince,
  shapeProjectSummary, shapeProjectDetail, attentionNeeded,
  type StageRow, type ProjectRow, type ApprovalRow,
} from "./lib.ts";

let passed = 0;
const fails: string[] = [];
function check(name: string, cond: boolean) { cond ? passed++ : fails.push(name); }
function eq(name: string, a: unknown, b: unknown) {
  check(`${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`,
    JSON.stringify(a) === JSON.stringify(b));
}

const stage = (i: number, state: string, extra: Partial<StageRow> = {}): StageRow => ({
  id: `s${i}`, stage_index: i, name: `Stage ${i}`, state,
  note: null, video_id: null, doc_links: [], deliverable_links: [], pending_since: null, ...extra,
});
const project = (extra: Partial<ProjectRow> = {}): ProjectRow => ({
  id: "p1", title: "Q4 Advert", status: "active",
  created_at: "2026-06-01T00:00:00Z", completed_at: null, ...extra,
});
const client = { email: "jane@crossfire.com", display_name: "Jane Doe" };

async function run() {
  eq("sha256Hex(hello) matches Postgres",
    await sha256Hex("hello"),
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");

  eq("projectDeepLink", projectDeepLink("abc"),
    "https://www.strangegoose.co.uk/admin/#project/abc");

  // statusOf: no pending stage → "you"
  eq("statusOf you", statusOf(project(), [stage(1, "approved"), stage(2, "locked")]), "you");

  // statusOf: pending, recent → "client"
  const recent = new Date(Date.now() - 2 * 86400000).toISOString();
  eq("statusOf client", statusOf(project(), [stage(1, "approved"), stage(2, "pending", { pending_since: recent })]), "client");

  // statusOf: pending, >= 7 days → "stalled"
  const old = new Date(Date.now() - 9 * 86400000).toISOString();
  eq("statusOf stalled", statusOf(project(), [stage(1, "approved"), stage(2, "pending", { pending_since: old })]), "stalled");
  eq("overdueDays stalled >= 7", overdueDays([stage(2, "pending", { pending_since: old })]) >= 7, true);

  // statusOf: project marked complete wins regardless of stages
  eq("statusOf complete", statusOf(project({ status: "complete" }), [stage(1, "approved")]), "complete");

  // waitingSince falls back to created_at with no pending stage / approvals
  eq("waitingSince fallback", waitingSince(project(), [stage(1, "locked")], []), new Date("2026-06-01T00:00:00Z").getTime());

  // summary shape
  const sum = shapeProjectSummary(project(), [stage(1, "approved"), stage(2, "pending", { pending_since: recent })], [], client) as any;
  eq("summary progress", sum.progress, "1/7 stages approved");
  eq("summary client label", sum.client, "Jane Doe");
  eq("summary status", sum.status, "client");
  check("summary has admin_link", typeof sum.admin_link === "string" && sum.admin_link.includes("p1"));
  check("non-stalled summary has no overdue_days", sum.overdue_days === undefined);

  const stalledSum = shapeProjectSummary(project(), [stage(1, "approved"), stage(2, "pending", { pending_since: old })], [], client) as any;
  check("stalled summary has overdue_days", typeof stalledSum.overdue_days === "number" && stalledSum.overdue_days >= 7);

  // detail includes every stage (even locked, unlike the client-facing server) + chase log
  const approvals: ApprovalRow[] = [{ stage_id: "s1", stage_name: "Stage 1", approved_at: "2026-06-02T10:00:00Z" }];
  const detail = shapeProjectDetail(
    project(),
    [stage(2, "pending"), stage(1, "approved"), stage(3, "locked")],
    approvals,
    [{ body: "Chased by email", created_at: "2026-06-10T09:00:00Z" }],
    client,
  ) as any;
  eq("detail stage order", detail.stages.map((s: any) => s.stage), [1, 2, 3]);
  eq("detail includes locked stage", detail.stages[2].state, "locked");
  eq("detail approved_at on stage 1", detail.stages[0].approved_at, "2026-06-02T10:00:00Z");
  eq("detail chase log", detail.chase_log, [{ note: "Chased by email", created_at: "2026-06-10T09:00:00Z" }]);

  // attentionNeeded: splits "you" and "stalled", ignores "client"/"complete"
  const rows = [
    { project: project({ id: "p-you" }), stages: [stage(1, "approved")], approvals: [], client },
    { project: project({ id: "p-client" }), stages: [stage(1, "approved"), stage(2, "pending", { pending_since: recent })], approvals: [], client },
    { project: project({ id: "p-stalled" }), stages: [stage(1, "approved"), stage(2, "pending", { pending_since: old })], approvals: [], client },
    { project: project({ id: "p-done", status: "complete" }), stages: [stage(1, "approved")], approvals: [], client },
  ];
  const att = attentionNeeded(rows);
  eq("attentionNeeded your_move count", att.your_move.length, 1);
  eq("attentionNeeded your_move project", (att.your_move[0] as any).id, "p-you");
  eq("attentionNeeded overdue count", att.overdue.length, 1);
  eq("attentionNeeded overdue project", (att.overdue[0] as any).id, "p-stalled");

  if (fails.length) {
    console.error(`FAIL (${passed} passed, ${fails.length} failed):`);
    for (const f of fails) console.error("  ✗ " + f);
    process.exit(1);
  }
  console.log(`OK — all ${passed} assertions passed.`);
}
run();
