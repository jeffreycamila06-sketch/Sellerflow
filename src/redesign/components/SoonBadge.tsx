// Phase 5j — "Soon" badge for features with no real backend yet (F4). Intentional
// pill using design tokens (warn tint), not a broken/error look. `label` overrides
// the default text (e.g. "Soon · cross-device").
import type { CSSProperties } from "react";

const base: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 5,
  fontSize: 10.5, fontWeight: 800, letterSpacing: ".04em",
  color: "var(--warn)", background: "rgba(217,119,6,.14)",
  border: "1px solid var(--warn)", padding: "3px 9px", borderRadius: 999,
  fontFamily: "var(--font-ui)", whiteSpace: "nowrap",
};

export default function SoonBadge({ label = "Soon", style }: { label?: string; style?: CSSProperties }) {
  return (
    <span style={{ ...base, ...style }} title="Coming soon — not yet functional">
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--warn)" }} />
      {label}
    </span>
  );
}
