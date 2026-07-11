// Announcements seller UI — dismissible banner (Dashboard content column) +
// 🔔 bell list bottom-sheet. The banner is IN-FLOW (no portal needed). The
// sheet mirrors the AdminPanel bottom-sheet and renders at the phone root in
// RedesignApp — inside the [data-redesign] token scope, so var() tokens apply
// (the RaffleWheel fixed-palette lesson is only for document.body portals).
import type { CSSProperties } from "react";
import { pickAnnMessage, type Announcement } from "../adapters/useAnnouncements";
import { useT } from "../i18n";
import { useLang } from "../i18n/langContext";

export function BellIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9Z" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 19.5a2.2 2.2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString([], { month: "short", day: "numeric" });
};

const msgStyle: CSSProperties = { fontSize: 12.5, fontWeight: 600, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" };

// Accent banner card — shown above the TODAY bar while the newest ACTIVE
// announcement hasn't been dismissed on this device. U8: renders IN-FLOW inside
// the [data-redesign] token scope (unlike the RaffleWheel body-portal), so it
// uses the accent tokens and follows the seller's chosen accent/theme.
export function AnnouncementBanner({ ann, onDismiss }: { ann: Announcement; onDismiss: (id: string) => void }) {
  const t = useT();
  const lang = useLang();
  return (
    <div style={{ background: "var(--accent)", borderRadius: 14, padding: "11px 13px 10px", marginBottom: 11, color: "var(--accent-text)", boxShadow: "0 6px 18px var(--accent-soft)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ fontSize: 13, lineHeight: 1 }}>📢</span>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", opacity: 0.92 }}>{t.rd_ann_banner_label}</span>
        <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.75, marginLeft: "auto", flexShrink: 0 }}>{fmtDate(ann.createdAt)}</span>
      </div>
      <div style={{ ...msgStyle, margin: "7px 1px 9px" }}>{pickAnnMessage(ann, lang)}</div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={() => onDismiss(ann.id)} style={{ border: "none", background: "rgba(255,255,255,.18)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,.4)", color: "var(--accent-text)", fontSize: 11.5, fontWeight: 700, padding: "6px 13px", borderRadius: 8, cursor: "pointer", fontFamily: "var(--font-ui)" }}>
          {t.rd_ann_got_it} ✓
        </button>
      </div>
    </div>
  );
}

// 🔔 list bottom-sheet — last 10 announcements, newest first; the active one
// gets a subtle "Active now" chip. Rendered at the phone root (RedesignApp).
export function AnnouncementsSheet({ list, onClose, loading = false }: { list: Announcement[]; onClose: () => void; loading?: boolean }) {
  const t = useT();
  const lang = useLang();
  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 9, background: "rgba(8,6,24,.5)", backdropFilter: "blur(2px)", display: "flex", alignItems: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxHeight: "76%", background: "var(--surface)", borderRadius: "22px 22px 0 0", display: "flex", flexDirection: "column", boxShadow: "0 -16px 40px rgba(0,0,0,.3)", animation: "sflSheet .26s cubic-bezier(.22,1,.36,1)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px 13px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17, color: "var(--text)" }}>
            <span style={{ color: "var(--accent-fg)", display: "flex" }}><BellIcon /></span>
            {t.rd_ann_title}
          </span>
          <button onClick={onClose} aria-label={t.rd_close} title={t.rd_close} style={{ width: 30, height: 30, borderRadius: 9, border: "none", background: "var(--surface-2)", color: "var(--text-dim)", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>
        <div className="sfl-scroll" style={{ padding: "14px 16px calc(22px + env(safe-area-inset-bottom))" }}>
          {list.length === 0 && (
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", textAlign: "center", padding: "26px 0" }}>{loading ? t.rd_ann_loading : t.rd_ann_none}</div>
          )}
          {list.map((a) => (
            <div key={a.id} style={{ background: "var(--surface-2)", border: a.active ? "1px solid var(--accent)" : "1px solid var(--border)", borderRadius: 12, padding: "10px 12px", marginBottom: 9 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)" }}>{fmtDate(a.createdAt)}</span>
                {a.active && <span style={{ fontSize: 9.5, fontWeight: 800, color: "var(--accent-fg)", background: "var(--accent-soft)", padding: "2px 7px", borderRadius: 6 }}>{t.rd_ann_active_now}</span>}
              </div>
              <div style={{ ...msgStyle, color: "var(--text)" }}>{pickAnnMessage(a, lang)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
