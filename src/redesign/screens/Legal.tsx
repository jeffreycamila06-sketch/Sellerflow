// Screen 15 — Privacy & Terms. dc.html v2 L935–951.
import type { CSSProperties } from "react";
import { headerBar, headerTitle } from "../ui";

const h: CSSProperties = { fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, color: "var(--text)", marginBottom: 8 };
const p: CSSProperties = { fontSize: 13, color: "var(--text-dim)", lineHeight: 1.65, margin: "0 0 18px" };

export default function Legal() {
  return (
    <div>
      <div style={headerBar}><div style={headerTitle}>Privacy &amp; Terms</div></div>
      <div style={{ padding: "18px 18px 24px" }}>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", fontWeight: 600, marginBottom: 18 }}>Last updated Jun 1, 2026</div>
        <div style={h}>1. Data we collect</div>
        <p style={p}>SellerFlowLive captures public live-stream comments, buyer handles, and order details you create during live sessions. We store these to build order slips, analytics, and shipping records on your behalf.</p>
        <div style={h}>2. How we use it</div>
        <p style={p}>Data is used solely to operate your shop — detecting "mine" claims, generating slips, and reporting sales. We never sell customer data to third parties.</p>
        <div style={h}>3. Your rights</div>
        <p style={p}>You may export or permanently delete all shop and customer data at any time from Settings. Deletion is irreversible and completes within 30 days.</p>
        <div style={h}>4. Contact</div>
        <p style={{ ...p, margin: 0 }}>Questions? Reach us on Telegram <span style={{ color: "var(--accent-fg)", fontWeight: 700 }}>@SellerFlowLive1995</span> or email privacy@sellerflowlive.app.</p>
      </div>
    </div>
  );
}
