// BLACKLIST — the small icon (Settings tile, live sheet) and the dates sheet opened by tapping a
// blacklisted buyer's name on a live comment row. Display only: the sheet never writes anything and
// never touches the order (the order still prints as usual).
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";
import { useLang } from "../i18n/langContext";
import { displayBuyer, formatBlacklistDay, type BlEntry } from "../adapters/blacklist";

export function BlacklistIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.6" stroke="currentColor" strokeWidth="2" />
      <path d="M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const stat: CSSProperties = { flex: 1, minWidth: 0, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 8px", textAlign: "center" };

export default function BlacklistSheet({ entry, onClose }: { entry: BlEntry; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const node = (
    <div onClick={onClose} data-testid="bl-sheet-overlay" style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.5)", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center" }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t.rd_bl_tap_title} data-testid="bl-sheet"
        style={{ width: "100%", maxWidth: 520, boxSizing: "border-box", background: "var(--surface-2)", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: "10px 14px calc(18px + env(safe-area-inset-bottom))", maxHeight: "80vh", overflowY: "auto", boxShadow: "0 -14px 40px rgba(0,0,0,.35)" }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: "var(--border-strong)", margin: "0 auto 12px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 2px 12px" }}>
          <span style={{ color: "var(--danger)", display: "flex", flexShrink: 0 }}><BlacklistIcon size={18} /></span>
          <span data-testid="bl-sheet-buyer" style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", minWidth: 0, overflowWrap: "anywhere" }}>{displayBuyer(entry.platform, entry.label)}</span>
          <span style={{ fontSize: 11.5, color: "var(--text-muted)", flexShrink: 0 }}>{entry.platform === "tiktok" ? "TikTok" : "Facebook"}</span>
          <button type="button" onClick={onClose} data-testid="bl-sheet-close" style={{ marginLeft: "auto", minHeight: 44, border: "none", background: "transparent", color: "var(--accent-fg)", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "var(--font-ui)", flexShrink: 0 }}>{t.rd_bl_close}</button>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <div style={stat} data-testid="bl-stat-ret">
            <div style={{ fontSize: 20, fontWeight: 800, color: entry.returned ? "var(--danger)" : "var(--text-muted)", fontFamily: "var(--font-display)" }}>{entry.returned}</div>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)", marginTop: 2 }}>{t.rd_bl_return}</div>
          </div>
          <div style={stat} data-testid="bl-stat-notout">
            <div style={{ fontSize: 20, fontWeight: 800, color: entry.notCheckedOut ? "var(--danger)" : "var(--text-muted)", fontFamily: "var(--font-display)" }}>{entry.notCheckedOut}</div>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)", marginTop: 2 }}>{t.rd_bl_not_out}</div>
          </div>
        </div>
        {entry.rows.map((r) => (
          <div key={r.id} data-testid="bl-date" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", marginBottom: 8 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{r.reason === "returned" ? t.rd_bl_return : t.rd_bl_not_out}</span>
            <span style={{ fontSize: 12.5, color: "var(--text-dim)", fontFamily: "var(--font-mono)", flexShrink: 0 }}>{formatBlacklistDay(r.day, lang, true)}</span>
          </div>
        ))}
        <div data-testid="bl-alert-only" style={{ fontSize: 12, color: "var(--text-muted)", padding: "4px 2px 0", lineHeight: 1.4 }}>{t.rd_bl_alert_only}</div>
      </div>
    </div>
  );
  // Into the [data-redesign] root (BuyerAlertSheet pattern) — the theme tokens live there.
  return createPortal(node, (typeof document !== "undefined" && document.querySelector("[data-redesign]")) || document.body);
}
