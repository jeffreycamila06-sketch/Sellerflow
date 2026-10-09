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

// readable (fb_polish_v2): the text color comes from the theme (--btag-old-fg / --btag-new-fg:
// the same dark text in light mode, a light text in dark mode — 4.5:1 or better in both).
const READABLE: Record<BuyerTag, CSSProperties> = {
  old: { ...STYLE.old, color: "var(--btag-old-fg, #166534)" },
  new: { ...STYLE.new, color: "var(--btag-new-fg, #991b1b)" },
};

export default function BuyerTagPill({ tag, readable = false }: { tag: BuyerTag; readable?: boolean }) {
  const t = useT();
  return <span data-testid="buyer-tag" data-tag={tag} style={(readable ? READABLE : STYLE)[tag]}>{tag === "old" ? t.rd_bt_old : t.rd_bt_new}</span>;
}
