// Screen 15 — Privacy & Terms. dc.html v2 L935–951. i18n: uses useT() (Step 3).
import type { CSSProperties } from "react";
import { headerBar, headerTitle } from "../ui";
import { useT } from "../i18n";

const h: CSSProperties = { fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, color: "var(--text)", marginBottom: 8 };
const p: CSSProperties = { fontSize: 13, color: "var(--text-dim)", lineHeight: 1.65, margin: "0 0 18px" };

export default function Legal() {
  const t = useT();
  return (
    <div>
      <div style={headerBar}><div style={headerTitle}>{t.lg_pt_title}</div></div>
      <div style={{ padding: "18px 18px 24px" }}>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", fontWeight: 600, marginBottom: 18 }}>{t.lg_updated}</div>
        <div style={h}>{t.lg_collect_h}</div>
        <p style={p}>{t.lg_collect_p}</p>
        <div style={h}>{t.lg_use_h}</div>
        <p style={p}>{t.lg_use_p}</p>
        <div style={h}>{t.lg_rights_h}</div>
        <p style={p}>{t.lg_rights_p}</p>
        <div style={h}>{t.lg_contact_h}</div>
        <p style={{ ...p, margin: 0 }}>{t.lg_contact_pre}<span style={{ color: "var(--accent-fg)", fontWeight: 700 }}>@SellerFlowLive1995</span>{t.lg_contact_post}</p>
      </div>
    </div>
  );
}
