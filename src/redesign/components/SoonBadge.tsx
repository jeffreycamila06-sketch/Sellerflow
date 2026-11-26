// Phase 5j — "Soon" badge for features with no real backend yet (F4). Intentional
// pill using design tokens (warn tint), not a broken/error look. `label` overrides
// the default text (e.g. "Soon · cross-device").
import type { CSSProperties } from "react";
import { useT } from "../i18n";

const base: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 5,
  fontSize: 10.5, fontWeight: 800, letterSpacing: ".04em",
  color: "var(--warn)", background: "rgba(217,119,6,.14)",
  border: "1px solid var(--warn)", padding: "3px 9px", borderRadius: 999,
  fontFamily: "var(--font-ui)", whiteSpace: "nowrap",
};

// `plain` = the word only, no hover note (the Seller Website teaser: no explanation).
// `testid` = its own test id (a second plain badge on one screen, e.g. the Invoicing card).
export default function SoonBadge({ label, style, plain = false, testid }: { label?: string; style?: CSSProperties; plain?: boolean; testid?: string }) {
  const t = useT();
  return (
    <span style={{ ...base, ...style }} title={plain ? undefined : t.rd_soon_title} data-testid={testid ?? (plain ? "soon-badge" : undefined)}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--warn)" }} />
      {label ?? t.rd_soon}
    </span>
  );
}
