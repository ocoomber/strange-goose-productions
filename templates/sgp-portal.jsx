import { useState } from "react";

// ============================================================================
//  SGP PORTAL — render template for the sgp-admin-mcp `get_account` response.
//
//  FOR A VISITING AI: replace the values in the DATA block below with the live
//  numbers from your MCP `get_account` result, then render this component as an
//  artifact — a quick visual for your human instead of a wall of text. The
//  field names here match the MCP response exactly. Everything below the DATA
//  block is the shell; you don't need to touch it. If you can't fill a field,
//  leave the example value — the template still renders.
// ============================================================================

// ----- DATA — replace with live get_account values --------------------------
const data = {
  active_clients: 3,     // get_account.active_clients
  active_projects: 2,    // get_account.active_projects
  your_move: 1,          // get_account.your_move   — projects awaiting SGP
  overdue: 1,            // get_account.overdue     — projects the client is late on
  connected: true,       // did the MCP connection succeed?
  fetched_at: "—",       // optional: time you fetched, e.g. "14:32"
};
// ----------------------------------------------------------------------------

// ===== SHELL — presentation, no need to edit ================================
const tokens = [
  { label: "Clients",   value: data.active_clients,  hint: "counter",     accent: "#C9A84C", description: "Active clients" },
  { label: "Projects",  value: data.active_projects, hint: "counter",     accent: "#C9A84C", description: "Live projects" },
  { label: "Your Move", value: data.your_move,       hint: "action_flag", accent: data.your_move > 0 ? "#E05C4B" : "#4CAF84", description: "Awaiting SGP" },
  { label: "Overdue",   value: data.overdue,         hint: "action_flag", accent: data.overdue > 0 ? "#E05C4B" : "#4CAF84", description: "Client overdue" },
];

const allClear = data.your_move === 0 && data.overdue === 0;
const dotColor = data.connected ? "#4CAF84" : "#E05C4B";

export default function SGPPortal() {
  const [hintsVisible, setHintsVisible] = useState(true);

  return (
    <div style={{
      background: "#0C0C0E",
      minHeight: "100vh",
      fontFamily: "'Inter', system-ui, sans-serif",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "32px 16px",
      color: "#E8E4DC",
    }}>

      {/* Header */}
      <div style={{
        width: "100%",
        maxWidth: 480,
        marginBottom: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: dotColor,
            boxShadow: `0 0 8px ${dotColor}`,
          }} />
          <span style={{ fontSize: 11, letterSpacing: "0.15em", color: "#6B6760", textTransform: "uppercase" }}>
            SGP Portal
          </span>
        </div>
        <span style={{ fontSize: 11, color: "#3D3B38", letterSpacing: "0.05em" }}>
          {data.fetched_at}
        </span>
      </div>

      {/* Token grid */}
      <div style={{
        width: "100%",
        maxWidth: 480,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 10,
        marginBottom: 12,
      }}>
        {tokens.map((token) => (
          <div key={token.label} style={{
            background: "#141416",
            border: "1px solid #1F1F22",
            borderRadius: 10,
            padding: "18px 20px 14px",
            position: "relative",
            overflow: "hidden",
          }}>
            {/* Subtle accent line */}
            <div style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 2,
              background: token.accent,
              opacity: 0.6,
              borderRadius: "10px 10px 0 0",
            }} />

            <div style={{ fontSize: 11, color: "#5A5855", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>
              {token.description}
            </div>

            <div style={{
              fontSize: 40,
              fontWeight: 300,
              color: token.value > 0 && token.hint === "action_flag" ? token.accent : "#E8E4DC",
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.02em",
              marginBottom: 12,
            }}>
              {token.value}
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, color: "#8C8880", fontWeight: 500 }}>
                {token.label}
              </span>
              {hintsVisible && (
                <span style={{
                  fontSize: 9,
                  letterSpacing: "0.08em",
                  color: "#2E2E32",
                  background: "#1A1A1D",
                  border: "1px solid #242428",
                  borderRadius: 4,
                  padding: "2px 6px",
                  textTransform: "uppercase",
                  fontFamily: "monospace",
                }}>
                  {token.hint}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Status banner */}
      <div style={{
        width: "100%",
        maxWidth: 480,
        background: allClear ? "rgba(76, 175, 132, 0.06)" : "rgba(224, 92, 75, 0.06)",
        border: `1px solid ${allClear ? "rgba(76,175,132,0.2)" : "rgba(224,92,75,0.2)"}`,
        borderRadius: 10,
        padding: "14px 20px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 24,
      }}>
        <div style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: allClear ? "#4CAF84" : "#E05C4B",
          flexShrink: 0,
        }} />
        <span style={{ fontSize: 13, color: allClear ? "#4CAF84" : "#E05C4B" }}>
          {allClear ? "Nothing needs your attention right now." : "Action required — check flagged projects."}
        </span>
        {hintsVisible && (
          <span style={{
            marginLeft: "auto",
            fontSize: 9,
            letterSpacing: "0.08em",
            color: "#2E2E32",
            background: "#141416",
            border: "1px solid #242428",
            borderRadius: 4,
            padding: "2px 6px",
            textTransform: "uppercase",
            fontFamily: "monospace",
            flexShrink: 0,
          }}>
            status_banner
          </span>
        )}
      </div>

      {/* Hint toggle */}
      <button
        onClick={() => setHintsVisible(!hintsVisible)}
        style={{
          background: "none",
          border: "1px solid #242428",
          borderRadius: 6,
          color: "#3D3B38",
          fontSize: 11,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          padding: "7px 14px",
          cursor: "pointer",
        }}
      >
        {hintsVisible ? "Hide render hints" : "Show render hints"}
      </button>

    </div>
  );
}
