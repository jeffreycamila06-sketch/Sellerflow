// Screen 9 — Support (contact + user guide). dc.html v2 L733–757.
// Visual/sample only — Telegram contact is a static link (Phase 5).
import { headerBar, headerTitle } from "../ui";

const GUIDE = [
  "Connecting TikTok & Facebook live",
  "How \"mine\" auto-capture works",
  "Printing slips & shipping orders",
  "Renewing your subscription",
];

export default function Support({ onLegal }: { onLegal: () => void }) {
  return (
    <div>
      <div style={headerBar}><div style={headerTitle}>Support</div></div>
      <div style={{ padding: "16px 14px 22px" }}>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 16, boxShadow: "var(--shadow)", textAlign: "center" }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17, color: "var(--text)" }}>Need a hand?</div>
          <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 5, lineHeight: 1.5 }}>We reply within minutes on Telegram during live hours.</div>
          <button style={{ width: "100%", marginTop: 14, padding: "13px 0", border: "none", borderRadius: 12, background: "#0088cc", color: "#fff", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M21.5 4.3 3.2 11.4c-1 .4-1 1.8.1 2.1l4.6 1.4 1.8 5.6c.2.7 1.1.9 1.6.3l2.5-2.6 4.7 3.4c.6.4 1.4.1 1.6-.6l3-15c.2-1-.7-1.8-1.6-1.3Z" /></svg>
            Chat with @SellerFlowSupport
          </button>
        </div>

        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14.5, color: "var(--text)", margin: "18px 2px 10px" }}>User guide</div>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, boxShadow: "var(--shadow)", overflow: "hidden" }}>
          {GUIDE.map((g, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, borderBottom: i < GUIDE.length - 1 ? "1px solid var(--border)" : "none" }}>
              <span style={{ width: 30, height: 30, borderRadius: 9, background: "var(--accent-soft)", color: "var(--accent-fg)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13 }}>{i + 1}</span>
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>{g}</span>
              <span style={{ color: "var(--text-muted)" }}>›</span>
            </div>
          ))}
        </div>

        <div style={{ textAlign: "center", fontSize: 11.5, color: "var(--text-muted)", marginTop: 18 }}>SellerFlowLive v4.2 · <span onClick={onLegal} style={{ color: "var(--accent-fg)", fontWeight: 600, cursor: "pointer" }}>Privacy &amp; Terms</span></div>
      </div>
    </div>
  );
}
