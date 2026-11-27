// Admin → Controls → the "Live Pulse" monitor tile (2026-11-27). Same size as the other Controls tiles;
// in the icon spot a pill with a pulsing dot + the number live now, under the label "38 / 100 live".
// Colour by the share of the limit (adapters/livePulseCount.ts): green < 60 %, amber ≥ 60 %, red ≥ 70 %;
// unknown / failed read = grey "—" (no pulse). Tap = the Live Pulse panel, as before.
import type { CSSProperties } from "react";
import { useT, tpl } from "../i18n";
import { mono } from "../ui";
import { LEVEL_COLOR, liveLevel, useLiveCount } from "../adapters/livePulseCount";

const tile: CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "14px 6px", borderRadius: 14,
  background: "var(--surface)", boxShadow: "var(--shadow)", cursor: "pointer", minHeight: 44, minWidth: 0,
  fontFamily: "var(--font-ui)", color: "var(--text)",
};
const lbl: CSSProperties = { fontSize: 11, fontWeight: 700, color: "var(--text)", textAlign: "center", lineHeight: 1.2 };

export default function AdminPulseTile({ onOpen, enabled = true }: { onOpen: () => void; enabled?: boolean }) {
  const t = useT();
  const { count } = useLiveCount(enabled);
  const level = liveLevel(count);
  const color = LEVEL_COLOR[level];
  const known = level !== "unknown" && !!count;
  return (
    <button type="button" onClick={onOpen} data-testid="admin-ctrl-pulse" data-level={level}
      aria-label={known ? tpl(t.rd_pulse_tile_aria, { n: count.live, limit: count.limit }) : t.rd_pulse_ctrl}
      style={{ ...tile, border: `1.5px solid ${known ? color : "var(--border)"}` }}>
      <span data-testid="admin-pulse-pill" style={{
        height: 34, minWidth: 34, boxSizing: "border-box", padding: "0 9px", borderRadius: 999, display: "inline-flex", alignItems: "center",
        justifyContent: "center", gap: 5, border: `1.5px solid ${color}`, background: "var(--surface-2)", color,
        fontFamily: mono, fontSize: 14, fontWeight: 800, whiteSpace: "nowrap",
      }}>
        <span aria-hidden className={known ? "sfl-lpt-dot" : undefined} style={{ width: 7, height: 7, borderRadius: 4, background: "currentColor", flexShrink: 0 }} />
        <span data-testid="admin-pulse-num">{known ? count.live : "—"}</span>
      </span>
      <span style={lbl}>{t.rd_pulse_ctrl}</span>
      <span data-testid="admin-pulse-line" style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text-muted)", textAlign: "center", lineHeight: 1.2, marginTop: -4 }}>
        {known ? tpl(t.rd_pulse_tile_line, { n: count.live, limit: count.limit }) : t.rd_pulse_tile_unknown}
      </span>
    </button>
  );
}
