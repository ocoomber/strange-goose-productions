// Unit tests for the pure portal-MCP helpers. No network/DB.
// Run: node --experimental-strip-types lib.test.ts
import {
  sha256Hex, projectDeepLink, shapeStage, shapeProjectSummary,
  shapeProjectDetail, pendingActions, type StageRow, type ProjectRow,
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
const project: ProjectRow = { id: "p1", title: "Q4 Advert", status: "active", created_at: "2026-06-01T00:00:00Z", completed_at: null };

async function run() {
  // Hash parity with Postgres encode(digest('hello','sha256'),'hex')
  eq("sha256Hex(hello) matches Postgres",
    await sha256Hex("hello"),
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");

  eq("projectDeepLink", projectDeepLink("abc"),
    "https://www.strangegoose.co.uk/client/#project/abc");

  // pending stage → action with portal approve link
  const pend = shapeStage(stage(2, "pending"), "p1") as any;
  check("pending stage has action.needed", pend.action?.needed === true);
  eq("pending stage approve link", pend.action.approve_in_portal,
    "https://www.strangegoose.co.uk/client/#project/p1");
  check("pending stage explains what", typeof pend.action.what === "string" && pend.action.what.length > 0);

  // approved stage → approved_at, no action
  const appr = shapeStage(stage(1, "approved"), "p1",
    { stage_id: "s1", stage_name: "Stage 1", approved_at: "2026-06-02T10:00:00Z" }) as any;
  eq("approved stage approved_at", appr.approved_at, "2026-06-02T10:00:00Z");
  check("approved stage has no action", appr.action === undefined);

  // video + docs surfaced
  const rich = shapeStage(stage(3, "pending", { video_id: "abc123XYZ_0", doc_links: [{ label: "Brief", url: "https://x/y" }] }), "p1") as any;
  eq("video url", rich.video_url, "https://youtu.be/abc123XYZ_0");
  eq("documents passthrough", rich.documents, [{ label: "Brief", url: "https://x/y" }]);

  // summary: 1 approved, stage 2 pending
  const stages = [stage(1, "approved"), stage(2, "pending")];
  const sum = shapeProjectSummary(project, stages) as any;
  eq("summary approved_stages", sum.approved_stages, 1);
  eq("summary progress", sum.progress, "1/7 stages approved");
  check("summary awaiting_you", sum.awaiting_you === true);
  eq("summary current_stage", sum.current_stage, { stage: 2, name: "Stage 2" });

  // detail orders stages + includes portal link
  const detail = shapeProjectDetail(project, [stage(2, "pending"), stage(1, "approved")],
    [{ stage_id: "s1", stage_name: "Stage 1", approved_at: "2026-06-02T10:00:00Z" }]) as any;
  eq("detail stage order", detail.stages.map((s: any) => s.stage), [1, 2]);
  eq("detail portal_link", detail.portal_link, "https://www.strangegoose.co.uk/client/#project/p1");

  // pendingActions across projects (only the one with a pending stage)
  const acts = pendingActions([
    { project, stages: [stage(1, "approved"), stage(2, "pending")] },
    { project: { ...project, id: "p2", title: "Done" }, stages: [stage(1, "approved")] },
  ]);
  eq("pendingActions count", acts.length, 1);
  eq("pendingActions project", (acts[0] as any).project_id, "p1");

  if (fails.length) {
    console.error(`FAIL (${passed} passed, ${fails.length} failed):`);
    for (const f of fails) console.error("  ✗ " + f);
    process.exit(1);
  }
  console.log(`OK — all ${passed} assertions passed.`);
}
run();
