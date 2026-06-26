// Screen 17 — Create account (signup). dc.html v3 L378–431.
// Visual only — no real auth (Phase 5).
import type { CSSProperties } from "react";
import SoonBadge from "../components/SoonBadge";

const label: CSSProperties = { fontSize: 11.5, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 5 };
const input: CSSProperties = { width: "100%", padding: "12px 13px", border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 600, outline: "none" };
const groupLabel: CSSProperties = { fontSize: 11, letterSpacing: ".12em", fontWeight: 800, color: "var(--text-muted)", margin: "0 2px 9px" };
const groupCard: CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 15, boxShadow: "var(--shadow)", display: "flex", flexDirection: "column", gap: 12 };

export default function Signup({ onBack, onCreate, onLegal }: { onBack: () => void; onCreate: () => void; onLegal: () => void }) {
  return (
    <div style={{ minHeight: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ background: "var(--header-bg)", padding: "16px 16px 18px", color: "var(--on-header)", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,.18)", border: "none", padding: "7px 12px 7px 9px", borderRadius: 9, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" }}>‹ Back</button>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, letterSpacing: "-.01em" }}>Create account</div><SoonBadge /></div>
          <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>Self-serve signup isn’t live yet — accounts are set up via Telegram.</div>
        </div>
      </div>

      <div style={{ padding: "16px 16px 22px" }}>
        <div style={groupLabel}>SHOP PROFILE</div>
        <div style={groupCard}>
          <div><label style={label}>Shop name</label><input placeholder="e.g. Maria's Live Shop" style={input} /></div>
          <div style={{ display: "flex", gap: 9 }}>
            <div style={{ flex: 1, minWidth: 0 }}><label style={label}>Owner name</label><input placeholder="Full name" style={input} /></div>
            <div style={{ flex: 1, minWidth: 0 }}><label style={label}>Phone</label><input placeholder="0917 000 0000" style={{ ...input, fontFamily: "var(--font-mono)", fontSize: 13 }} /></div>
          </div>
          <div><label style={label}>Username handle</label><input placeholder="@your_handle" style={{ ...input, color: "var(--handle)", fontWeight: 700 }} /></div>
          <div><label style={label}>Email</label><input placeholder="you@email.com" style={input} /></div>
        </div>

        <div style={{ ...groupLabel, margin: "16px 2px 9px" }}>PASSWORD</div>
        <div style={groupCard}>
          <div><label style={label}>Password</label><input type="password" placeholder="Create a password" style={input} /></div>
          <div><label style={label}>Confirm password</label><input type="password" placeholder="Re-enter password" style={input} /></div>
        </div>

        <button onClick={onCreate} style={{ width: "100%", marginTop: 18, padding: "14px 0", border: "none", borderRadius: 13, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 14.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 6px 18px var(--accent-soft)" }}>Create account</button>
        <div style={{ textAlign: "center", fontSize: 11.5, color: "var(--text-muted)", marginTop: 11, lineHeight: 1.5 }}>By creating an account you agree to our <span onClick={onLegal} style={{ color: "var(--accent-fg)", fontWeight: 700, cursor: "pointer" }}>Terms</span></div>
        <div style={{ textAlign: "center", fontSize: 12.5, color: "var(--text-dim)", marginTop: 8 }}>Already have an account? <span onClick={onBack} style={{ fontWeight: 700, color: "var(--accent-fg)", cursor: "pointer" }}>Log in</span></div>
      </div>
    </div>
  );
}
