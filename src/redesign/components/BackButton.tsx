// The ONE "‹ Back" of every sub-screen (Jeff 2026-11-11). Exactly the Back of the Live print pattern:
// at least 44 px high, top left of the header, text = rd_back (8 languages). Where it goes is decided
// by RedesignApp (back to where the screen was opened from — adapters/backNav.ts).
import type { CSSProperties, ReactNode } from "react";
import { useT } from "../i18n";

const style: CSSProperties = {
  display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,.18)", border: "none",
  padding: "9px 12px 9px 9px", minHeight: 44, borderRadius: 9, color: "#fff", fontSize: 13, fontWeight: 700,
  cursor: "pointer", fontFamily: "var(--font-ui)", flexShrink: 0,
};

export function BackButton({ onClick }: { onClick: () => void }) {
  const t = useT();
  return <button type="button" onClick={onClick} style={style} data-testid="back-btn">{t.rd_back}</button>;
}

/**
 * Puts the Back on the left of a header's content; the title (and the subtitle under it) sit on the
 * right. Without onBack the content renders exactly as before (no wrapper at all).
 */
export function HeaderWithBack({ onBack, children, alignTop = false }: { onBack?: () => void; children: ReactNode; alignTop?: boolean }) {
  if (!onBack) return <>{children}</>;
  return (
    <div style={{ display: "flex", alignItems: alignTop ? "flex-start" : "center", gap: 12 }} data-testid="back-row">
      <BackButton onClick={onBack} />
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}
