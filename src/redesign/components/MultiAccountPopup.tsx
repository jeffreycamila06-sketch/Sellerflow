// Shared "Add — Multi Account" Telegram popup — extracted VERBATIM from the old
// ManageChannels screen so both the full-screen editor AND the compact manage-mode
// ChannelManageBody open the EXACT same dialog (no forked design). Title + body are
// passed in (TikTok vs Facebook wording); the Telegram box (@SellerFlowLive) + Cancel /
// OK are shared. OK is a real <a> to Telegram → iOS-safe. position:fixed so it also
// covers the viewport when rendered inside the LiveConnectModal portal.
import { type CSSProperties } from "react";
import { useT } from "../i18n";
import { TELEGRAM_URL } from "../../lib/telegram";

export default function MultiAccountPopup({ open, onClose, title, body }: {
  open: boolean;
  onClose: () => void;
  title: string;
  body: string;
}) {
  const t = useT();
  if (!open) return null;
  const overlay: CSSProperties = { position: "fixed", inset: 0, zIndex: 1400, background: "rgba(8,6,24,.55)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 28 };
  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={overlay} data-testid="cm-multi-popup">
      <div style={{ width: "100%", maxWidth: 300, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 20, boxShadow: "0 24px 60px rgba(0,0,0,.4)", overflow: "hidden" }}>
        <div style={{ padding: "22px 20px 18px" }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17, color: "var(--text)", lineHeight: 1.25 }}>{title}</div>
          <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.55, marginTop: 9 }}>{body}</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 14, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, padding: 9 }}>
            <span style={{ width: 18, height: 18, borderRadius: 5, background: "#0088cc", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><svg width="11" height="11" viewBox="0 0 24 24" fill="#fff"><path d="M21.5 4.3 3.2 11.4c-1 .4-1 1.8.1 2.1l4.6 1.4 1.8 5.6c.2.7 1.1.9 1.6.3l2.5-2.6 4.7 3.4c.6.4 1.4.1 1.6-.6l3-15c.2-1-.7-1.8-1.6-1.3Z" /></svg></span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{t.rd_ch_tg_handle}</span>
          </div>
        </div>
        <div style={{ display: "flex", borderTop: "1px solid var(--border)" }}>
          <button onClick={onClose} style={{ flex: 1, padding: "15px 0", border: "none", borderRight: "1px solid var(--border)", background: "transparent", color: "var(--text-dim)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, cursor: "pointer" }} data-testid="cm-multi-cancel">{t.rd_ch_cancel}</button>
          <a href={TELEGRAM_URL} target="_blank" rel="noreferrer noopener" onClick={onClose} style={{ flex: 1, padding: "15px 0", background: "#0088cc", color: "#fff", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, cursor: "pointer", textAlign: "center", textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }} data-testid="cm-multi-ok">{t.rd_ch_ok}<span style={{ fontSize: 15 }}>→</span></a>
        </div>
      </div>
    </div>
  );
}
