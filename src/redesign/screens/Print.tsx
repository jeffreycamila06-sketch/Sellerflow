// Screen 11 — Print Slip. dc.html v2 L829–856. Back arrow → Orders.
// The receipt is an intentional white "paper" mock (literal colors, theme-independent).
import { mono } from "../ui";

const dash = { borderTop: "1.5px dashed #bbb", margin: "12px 0" } as const;
const line = { display: "flex", justifyContent: "space-between" } as const;

export default function Print({ onBack, cur }: { onBack: () => void; cur: string }) {
  return (
    <div>
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{ background: "rgba(255,255,255,.18)", border: "none", width: 32, height: 32, borderRadius: 9, color: "#fff", fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, letterSpacing: "-.01em" }}>Print slip</div>
      </div>
      <div style={{ padding: "18px 16px 22px" }}>
        <div style={{ background: "#fff", borderRadius: 6, padding: "20px 18px", boxShadow: "0 8px 30px rgba(0,0,0,.18)", fontFamily: mono, color: "#1a1a1a", maxWidth: 300, margin: "0 auto" }}>
          <div style={{ textAlign: "center", borderBottom: "1.5px dashed #bbb", paddingBottom: 12 }}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17 }}>Maria's Live Shop</div>
            <div style={{ fontSize: 11, color: "#666", marginTop: 3 }}>@maria_shops · TikTok Live</div>
          </div>
          <div style={{ ...line, fontSize: 11.5, marginTop: 12, color: "#444" }}><span>ORDER</span><span style={{ fontWeight: 700, color: "#000" }}>#10472</span></div>
          <div style={{ ...line, fontSize: 11.5, marginTop: 4, color: "#444" }}><span>BUYER</span><span style={{ fontWeight: 700, color: "#000" }}>Maria Santos</span></div>
          <div style={{ ...line, fontSize: 11.5, marginTop: 4, color: "#444" }}><span>DATE</span><span>Jun 25, 9:41 PM</span></div>
          <div style={dash} />
          <div style={{ ...line, fontSize: 12, marginBottom: 7 }}><span>Matte Lipstick — Red ×2</span><span style={{ fontWeight: 700 }}>{cur}498</span></div>
          <div style={{ ...line, fontSize: 12 }}><span>Insulated Tumbler ×1</span><span style={{ fontWeight: 700 }}>{cur}399</span></div>
          <div style={dash} />
          <div style={{ ...line, fontSize: 15, fontWeight: 700 }}><span>TOTAL</span><span>{cur}897</span></div>
          <div style={{ textAlign: "center", fontSize: 10.5, color: "#777", marginTop: 14, borderTop: "1.5px dashed #bbb", paddingTop: 10 }}>Thank you for shopping live! 💜<br />Pay via GCash · 0917 555 0142</div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button style={{ flex: 1, padding: "13px 0", border: "none", borderRadius: 12, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 14px var(--accent-soft)" }}>Print to LAN printer</button>
        </div>
        <button style={{ width: "100%", marginTop: 10, padding: "12px 0", border: "1px solid var(--border-strong)", borderRadius: 12, background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Share as image</button>
      </div>
    </div>
  );
}
