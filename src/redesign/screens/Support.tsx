// Screen 9 — Support (contact + user guide). dc.html v2 L733–757.
// Telegram contact is a static link; the 4 guide items are tap-to-expand accordions
// (inline body via rd_sup_g*_body, \n paragraph breaks rendered with pre-line).
import { useState } from "react";
import { headerBar, headerTitle } from "../ui";
import { useT } from "../i18n";
import { isIOS } from "../adapters/platform";
import { TELEGRAM_HANDLE, TELEGRAM_URL } from "../../lib/telegram";

export default function Support({ onLegal }: { onLegal: () => void }) {
  const t = useT();
  const GUIDE = [
    { title: t.rd_sup_g1, body: t.rd_sup_g1_body },
    { title: t.rd_sup_g2, body: t.rd_sup_g2_body },
    { title: t.rd_sup_g3, body: t.rd_sup_g3_body },
    // g4 = "Renewing your subscription" (prices + subscribe/renew) → hidden on iOS.
    ...(isIOS() ? [] : [{ title: t.rd_sup_g4, body: t.rd_sup_g4_body }]),
    { title: t.rd_sup_g5, body: t.rd_sup_g5_body },
  ];
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div>
      <div style={headerBar}><div className="sfl-anim-beat" style={headerTitle}>{t.rd_sup_title}</div></div>
      <div style={{ padding: "16px 14px 22px" }}>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 16, boxShadow: "var(--shadow)", textAlign: "center" }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17, color: "var(--text)" }}>{t.rd_sup_need}</div>
          <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 5, lineHeight: 1.5 }}>{t.rd_sup_reply}</div>
          <a href={TELEGRAM_URL} target="_blank" rel="noreferrer" style={{ width: "100%", marginTop: 14, padding: "13px 0", border: "none", borderRadius: 12, background: "#0088cc", color: "#fff", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, textDecoration: "none" }}>
            <svg className="sfl-anim-wiggle" width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M21.5 4.3 3.2 11.4c-1 .4-1 1.8.1 2.1l4.6 1.4 1.8 5.6c.2.7 1.1.9 1.6.3l2.5-2.6 4.7 3.4c.6.4 1.4.1 1.6-.6l3-15c.2-1-.7-1.8-1.6-1.3Z" /></svg>
            {t.rd_sup_chat} {TELEGRAM_HANDLE}
          </a>
        </div>

        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14.5, color: "var(--text)", margin: "18px 2px 10px" }}>{t.rd_sup_guide}</div>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, boxShadow: "var(--shadow)", overflow: "hidden" }}>
          {GUIDE.map((g, i) => {
            const isOpen = open === i;
            return (
              <div key={i} style={{ borderBottom: i < GUIDE.length - 1 ? "1px solid var(--border)" : "none" }}>
                <button onClick={() => setOpen(isOpen ? null : i)} aria-expanded={isOpen} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: 14, border: "none", background: "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)" }}>
                  <span style={{ width: 30, height: 30, borderRadius: 9, background: "var(--accent-soft)", color: "var(--accent-fg)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, flexShrink: 0 }}>{i + 1}</span>
                  <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>{g.title}</span>
                  <span style={{ color: "var(--text-muted)", fontSize: 12, transition: "transform .2s", transform: isOpen ? "rotate(180deg)" : "rotate(0deg)", display: "inline-block", flexShrink: 0 }}>▾</span>
                </button>
                {isOpen && (
                  <div style={{ padding: "0 14px 14px 56px", fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.6, whiteSpace: "pre-line" }}>{g.body}</div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ textAlign: "center", fontSize: 11.5, color: "var(--text-muted)", marginTop: 18 }}>{t.rd_sup_ver}<span onClick={onLegal} style={{ color: "var(--accent-fg)", fontWeight: 600, cursor: "pointer" }}>{t.lg_pt_title}</span></div>
      </div>
    </div>
  );
}
