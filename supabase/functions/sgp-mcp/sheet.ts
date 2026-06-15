// Pure, runtime-agnostic helpers for the sgp-mcp server: gviz parsing and the
// small domain utilities. No Deno/fetch dependencies, so this module is unit-
// testable under Node (--experimental-strip-types) and imported by index.ts.

export type Row = Record<string, string | number | boolean>;

// Parse a Google Sheets gviz JSONP response into row objects keyed by header.
// Input looks like: /*O_o*/\ngoogle.visualization.Query.setResponse({...});
export function parseGviz(text: string): Row[] {
  const start = text.indexOf("setResponse(");
  if (start === -1) throw new Error("Unexpected gviz response");
  const open = text.indexOf("(", start);
  const close = text.lastIndexOf(")");
  const json = JSON.parse(text.slice(open + 1, close));
  if (json.status === "error") {
    throw new Error("gviz error: " + JSON.stringify(json.errors ?? json));
  }
  const cols: string[] = (json.table?.cols ?? []).map(
    (c: { label?: string; id?: string }, i: number) =>
      (c.label && c.label.trim()) || c.id || `col${i}`,
  );
  const rows: Row[] = [];
  for (const r of json.table?.rows ?? []) {
    const obj: Row = {};
    let hasValue = false;
    (r.c ?? []).forEach((cell: { v: unknown } | null, i: number) => {
      const key = cols[i];
      if (!key) return;
      let v = cell?.v;
      if (v === null || v === undefined || v === "") return;
      if (typeof v === "string") {
        v = v.trim();
        if (v === "") return;
      }
      obj[key] = v as string | number | boolean;
      hasValue = true;
    });
    if (hasValue) rows.push(obj);
  }
  return rows;
}

// Case-insensitive, trimmed equality (for matching titles / ids / filters).
export function eqi(a: unknown, b: unknown): boolean {
  return String(a ?? "").trim().toLowerCase() ===
    String(b ?? "").trim().toLowerCase();
}

export function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Tally Win / Nomination / Official Selection across a set of award rows.
export function awardCounts(awards: Row[]) {
  let wins = 0, nominations = 0, official_selections = 0;
  for (const a of awards) {
    const r = String(a.result ?? "").toLowerCase();
    if (r === "win") wins++;
    else if (r === "nomination") nominations++;
    else if (r === "official selection") official_selections++;
  }
  return { wins, nominations, official_selections };
}

// Turn a key-value tab (e.g. Company: {field,value}) into a dict.
export function kvFromRows(
  rows: Row[],
  keyCol: string,
  valCol: string,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const r of rows) {
    const k = r[keyCol];
    if (typeof k === "string" && k && r[valCol] !== undefined) out[k] = r[valCol];
  }
  return out;
}
