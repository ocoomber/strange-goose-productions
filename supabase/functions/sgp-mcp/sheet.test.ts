// Unit tests for the pure sheet helpers. No network required.
// Run: node --experimental-strip-types sheet.test.ts
import { awardCounts, eqi, kvFromRows, parseGviz, slugify } from "./sheet.ts";

let passed = 0;
const fails: string[] = [];
function check(name: string, cond: boolean) {
  if (cond) passed++;
  else fails.push(name);
}
function eq(name: string, a: unknown, b: unknown) {
  check(`${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`,
    JSON.stringify(a) === JSON.stringify(b));
}

// Build a Google gviz JSONP response from headers + row arrays. `null` => empty cell.
function gviz(headers: string[], rows: (string | number | boolean | null)[][]): string {
  const cols = headers.map((h, i) => ({ id: String.fromCharCode(65 + i), label: h, type: "string" }));
  const r = rows.map((row) => ({ c: row.map((v) => (v === null ? null : { v })) }));
  return `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify(
    { version: "0.6", reqId: "0", status: "ok", table: { cols, rows: r } },
  )});`;
}

// --- parseGviz: headers, trimming, null cells, integer values, empty rows ---
{
  const text = gviz(
    ["film_id", "title", "year", "featured"],
    [
      ["dream-house", "  Dream House ", 2024, "no"],
      ["roadtrippin", "Roadtrippin'", 2025, null], // null cell omitted
      [null, null, null, null], // fully-empty row dropped
    ],
  );
  const rows = parseGviz(text);
  eq("parseGviz row count", rows.length, 2);
  eq("parseGviz trims strings", rows[0].title, "Dream House");
  eq("parseGviz keeps integer year", rows[0].year, 2024);
  eq("parseGviz omits null cell", "featured" in rows[1], false);
}

// --- parseGviz: gviz error status throws ---
{
  let threw = false;
  try {
    parseGviz(`google.visualization.Query.setResponse({"status":"error","errors":[{"reason":"x"}]});`);
  } catch { threw = true; }
  check("parseGviz throws on gviz error", threw);
}

// --- kvFromRows: Company-style key/value tab ---
{
  const kv = kvFromRows(
    [{ field: "contact_email", value: "info@strangegoose.co.uk" }, { field: "total_wins", value: 17 }],
    "field", "value",
  );
  eq("kvFromRows email", kv.contact_email, "info@strangegoose.co.uk");
  eq("kvFromRows number", kv.total_wins, 17);
}

// --- eqi / slugify ---
check("eqi case/space insensitive", eqi("  Family Time ", "family time"));
eq("slugify apostrophe", slugify("Roadtrippin'"), "roadtrippin");
eq("slugify spaces", slugify("Getting Over Going Under"), "getting-over-going-under");

// --- awardCounts against the real migrated figures (12 films / 77 results) ---
// The full result list from the migration: 17 Win, 49 Nomination, 11 Official Selection.
const realResults: string[] = [
  ...Array(17).fill("Win"),
  ...Array(49).fill("Nomination"),
  ...Array(11).fill("Official Selection"),
];
{
  const totals = awardCounts(realResults.map((result) => ({ result })));
  eq("award totals", totals, { wins: 17, nominations: 49, official_selections: 11 });
  eq("award total rows", realResults.length, 77);
}

// --- per-film filter + counts (Family Time: 8 wins, 11 noms) via a gviz round-trip ---
{
  const ft = [
    ...Array(8).fill(["family-time", "Family Time", "Win"]),
    ...Array(11).fill(["family-time", "Family Time", "Nomination"]),
    ...Array(1).fill(["family-time", "Family Time", "Official Selection"]),
    ["unravelling", "Unravelling", "Win"],
  ];
  const rows = parseGviz(gviz(["film_id", "film_title", "result"], ft));
  const onlyFT = rows.filter((a) => eqi(a.film_id, "family-time"));
  eq("Family Time filtered count", onlyFT.length, 20);
  eq("Family Time counts", awardCounts(onlyFT), { wins: 8, nominations: 11, official_selections: 1 });
}

if (fails.length) {
  console.error(`FAIL (${passed} passed, ${fails.length} failed):`);
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log(`OK — all ${passed} assertions passed.`);
