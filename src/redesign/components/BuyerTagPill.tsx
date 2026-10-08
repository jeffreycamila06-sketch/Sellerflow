// OLD (green) / NEW (red) pill — see adapters/buyerTag.ts. Fixed size, inline, never wraps.
import type { CSSProperties } from "react";
import { useT } from "../i18n";
import type { BuyerTag } from "../adapters/buyerTag";

const BASE: CSSProperties = {
  display: "inline-flex", alignItems: "center", fontSize: 9.5, fontWeight: 800, letterSpacing: ".04em",
  padding: "2px 6px", borderRadius: 5, lineHeight: 1, flexShrink: 0, whiteSpace: "nowrap",
};
const STYLE: Record<BuyerTag, CSSProperties> = {
  old: { ...BASE, background: "color-mix(in srgb, var(--ok) 16%, transparent)", color: "#166534" },
  new: { ...BASE, background: "var(--danger-soft)", color: "#991b1b" },
};

export default function BuyerTagPill({ tag }: { tag: BuyerTag }) {
  const t = useT();
  return <span data-testid="buyer-tag" data-tag={tag} style={STYLE[tag]}>{tag === "old" ? t.rd_bt_old : t.rd_bt_new}</span>;
}
