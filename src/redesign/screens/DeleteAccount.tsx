// Screen 16 — Delete Account (visual flow only — NO real deletion). dc.html v2 L954–981.
import { useState } from "react";
import { card } from "../ui";

const loseItem = (text: string) => (
  <div key={text} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: "var(--text-dim)" }}>
    <span style={{ color: "var(--danger)", fontWeight: 800 }}>✕</span> {text}
  </div>
);

export default function DeleteAccount({ onBack }: { onBack: () => void }) {
  const [confirm, setConfirm] = useState("");
  return (
    <div>
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{ background: "rgba(255,255,255,.18)", border: "none", width: 32, height: 32, borderRadius: 9, color: "#fff", fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, letterSpacing: "-.01em" }}>Delete account</div>
      </div>
      <div style={{ padding: "18px 16px 24px" }}>
        <div style={{ background: "var(--danger-soft, rgba(225,29,72,.08))", border: "1px solid var(--danger)", borderRadius: 16, padding: 18, textAlign: "center" }}>
          <div style={{ width: 54, height: 54, borderRadius: "50%", background: "rgba(225,29,72,.14)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M12 8v5" stroke="var(--danger)" strokeWidth="2.2" strokeLinecap="round" /><circle cx="12" cy="16.5" r="1.3" fill="var(--danger)" /><path d="M10.3 3.9 2.6 17.4A2 2 0 0 0 4.3 20.4h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" stroke="var(--danger)" strokeWidth="1.8" strokeLinejoin="round" /></svg>
          </div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17, color: "var(--text)" }}>This can't be undone</div>
          <div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 6, lineHeight: 1.55 }}>Deleting your account permanently removes your shop, orders, customers, and analytics.</div>
        </div>

        <div style={{ ...card, marginTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 11 }}>You'll lose</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {loseItem("3,947 orders & all order slips")}
            {loseItem("1,284 customer records")}
            {loseItem("Sales history & analytics")}
            {loseItem("Your Pro subscription")}
          </div>
        </div>

        <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)", margin: "16px 2px 6px", display: "block" }}>Type DELETE to confirm</label>
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" style={{ width: "100%", padding: "13px 14px", border: "1px solid var(--border-strong)", borderRadius: 12, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, letterSpacing: ".1em", outline: "none" }} />
        <button style={{ width: "100%", marginTop: 14, padding: "14px 0", border: "none", borderRadius: 13, background: "var(--danger)", color: "#fff", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Permanently delete account</button>
        <button onClick={onBack} style={{ width: "100%", marginTop: 10, padding: "13px 0", border: "1px solid var(--border-strong)", borderRadius: 13, background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>Keep my account</button>
      </div>
    </div>
  );
}
