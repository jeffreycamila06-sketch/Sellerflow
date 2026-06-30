// iOS-only neutral popup (App Store 2.1b/3.1.1): shown in place of the upgrade/
// subscription prompts. NO price, plan, or "upgrade" wording — just a neutral notice
// + a Contact Support button that opens the Telegram SUPPORT CHAT (a person, not a
// pricing page). Used for both the free-cap hard stop and the expired-plan notice.
// Rendered ONLY when isIOS(); Android/web keep the original CapPopup / toast.
import type { CSSProperties } from "react";
import { useT } from "../i18n";

const TG_SUPPORT = "https://t.me/SellerFlowLive1995";

const overlay: CSSProperties = { position: "absolute", inset: 0, zIndex: 12, background: "rgba(8,6,24,.55)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 };
const modal: CSSProperties = { width: "100%", maxWidth: 340, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 20, boxShadow: "0 24px 60px rgba(0,0,0,.4)", padding: "24px 22px", textAlign: "center" };
const supportBtn: CSSProperties = { width: "100%", padding: "13px 0", border: "none", borderRadius: 12, background: "#0088cc", color: "#fff", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, cursor: "pointer", textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 6px 16px rgba(0,136,204,.35)" };
const outBtn: CSSProperties = { width: "100%", padding: "12px 0", border: "1px solid var(--border-strong)", borderRadius: 12, background: "transparent", color: "var(--text-dim)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", marginTop: 9 };

const tgPlane = <svg width="17" height="17" viewBox="0 0 24 24" fill="#fff"><path d="M21.5 4.3 3.2 11.4c-1 .4-1 1.8.1 2.1l4.6 1.4 1.8 5.6c.2.7 1.1.9 1.6.3l2.5-2.6 4.7 3.4c.6.4 1.4.1 1.6-.6l3-15c.2-1-.7-1.8-1.6-1.3Z" /></svg>;

export default function ContactSupportPopup({ title, message, onClose }: { title: string; message: string; onClose: () => void }) {
  const t = useT();
  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, color: "var(--text)", margin: "0 0 8px" }}>{title}</h3>
        <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.55, margin: "0 0 18px" }}>{message}</p>
        <a href={TG_SUPPORT} target="_blank" rel="noreferrer" onClick={onClose} style={supportBtn}>{tgPlane} {t.rd_ios_contact_support}</a>
        <button style={outBtn} onClick={onClose}>{t.rd_cap_later}</button>
      </div>
    </div>
  );
}
