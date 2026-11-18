// PICTURES ONLY — a drawing of the proposed "Who is checking" card (NOT built, NOT in the app).
// Styles copied from the panel (src/redesign/components/Pc711Panel.tsx): the plain `card`, the
// status line of the "Connected" card (dot + 15 px bold words in the state colour), its two-column
// details list, the card title of "Telegram alerts", and the red tint of the "logged out" card.
import type { CSSProperties } from "react";

export type DutyCardState = "normal" | "duty" | "dutyout" | "off";
const card: CSSProperties = { background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 14, padding: "13px 14px" };
const tint: Record<DutyCardState, CSSProperties> = {
  normal: card,
  off: card,
  duty: { ...card, background: "var(--warn-soft)", border: "1.5px solid var(--warn)" },
  dutyout: { ...card, background: "var(--danger-soft)", border: "1.5px solid var(--danger)" },
};
const COLOUR: Record<DutyCardState, string> = { normal: "var(--ok)", duty: "var(--warn)", dutyout: "var(--danger)", off: "var(--text-muted)" };
const WHY = { silent: "The Lenovo is silent", degraded: "The Lenovo's 7-11 tabs are dead" };
const dim: CSSProperties = { color: "var(--text-dim)" };
const val: CSSProperties = { color: "var(--text)", fontWeight: 600, minWidth: 0, overflowWrap: "anywhere" };

export default function DutyCardDrawing({ state, reason, hist }: { state: DutyCardState; reason: "silent" | "degraded"; hist: boolean }) {
  const onDuty = state === "duty" || state === "dutyout";
  const colour = COLOUR[state];
  return (
    <div data-testid="duty-card-wrap" style={{ marginTop: 14 }}>
      <div data-testid="duty-card" data-state={state} style={tint[state]}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>Who is checking</div>
        <div data-testid="duty-line" style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 8, fontSize: 15, fontWeight: 800, color: state === "off" ? "var(--text-dim)" : colour, lineHeight: 1.3 }}>
          <span aria-hidden style={{ width: 9, height: 9, borderRadius: 9, background: colour, flex: "0 0 9px", marginTop: 6 }} />
          <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
            {state === "normal" ? <>The Lenovo is checking <span style={{ color: "var(--text-dim)", fontWeight: 700, fontSize: 12.5, whiteSpace: "nowrap" }}>· Server: standby</span></>
              : state === "off" ? "Backup: off" : "The server is checking now"}
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px", marginTop: 10, fontSize: 12.5 }}>
          {onDuty ? <>
            <span style={dim}>Since</span><span data-testid="duty-since" style={val}>11/18 13:46 (22 min)</span>
            <span style={dim}>Why</span><span data-testid="duty-why" style={val}>{WHY[reason]}</span>
            <span style={dim}>Answered in this duty</span><span data-testid="duty-answered" style={val}>37 parcels</span>
          </> : <>
            <span style={dim}>Last call from the Lenovo</span><span data-testid="duty-lenovo" style={val}>4 s ago</span>
          </>}
        </div>
        {state === "dutyout" ? <div role="alert" data-testid="duty-out" style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)", fontSize: 13, fontWeight: 800, color: "var(--danger)", lineHeight: 1.4 }}>The server is logged out. Log in above.</div> : null}
      </div>
      {hist ? <div data-testid="duty-history" style={{ margin: "8px 2px 0", fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45, overflowWrap: "anywhere" }}>
        Last take-over: 11/17 03:12 → 03:58 (46 min). Why: the Lenovo was silent.
      </div> : null}
    </div>
  );
}
