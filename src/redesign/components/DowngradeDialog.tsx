// Admin plan DOWNGRADE confirm (sql/154). Shown BEFORE the plan is saved when the seller has
// more accounts (TikTok + Facebook + Instagram + Shopee) than the new plan allows. A checkbox
// list of every account; the newest ones are pre-checked so exactly N − M go. OK stays off
// until exactly N − M are checked. Cancel changes nothing (the plan stays too).
import { useState, type CSSProperties } from "react";
import { useT, tpl } from "../i18n";
import { acctId, defaultRemoval, fmtAcctDate, PLATFORM_LABEL, type SellerAccount } from "../adapters/adminAccounts";

const PLATFORM_COLOR: Record<string, string> = { tiktok: "#111827", facebook: "#1877f2", instagram: "#c13584", shopee: "#ee4d2d" };

export default function DowngradeDialog({ email, planLabel, limit, accounts, busy, onCancel, onConfirm }: {
  email: string;
  planLabel: string;          // the NEW plan, as shown on its button ("Basic")
  limit: number;              // M — what the new plan allows
  accounts: SellerAccount[];  // every account, oldest first
  busy: boolean;
  onCancel: () => void;
  onConfirm: (remove: SellerAccount[]) => void;
}) {
  const t = useT();
  const need = Math.max(0, accounts.length - limit); // N − M
  const [picked, setPicked] = useState<Set<string>>(() => new Set(defaultRemoval(accounts, need)));
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const exact = picked.size === need && need > 0;
  const btn: CSSProperties = { flex: 1, minHeight: 46, padding: "0 12px", borderRadius: 0, fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700 };

  return (
    <div data-testid="dg-overlay" onClick={(e) => { e.stopPropagation(); if (!busy) onCancel(); }}
      style={{ position: "absolute", inset: 0, zIndex: 31, background: "rgba(8,6,24,.6)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label={t.rd_adm_dg_title} data-testid="dg-dialog" onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 400, maxHeight: "100%", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, boxShadow: "0 24px 60px rgba(0,0,0,.45)", overflow: "hidden" }}>
        <div style={{ padding: "15px 16px 10px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "var(--text)" }}>{t.rd_adm_dg_title}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", overflowWrap: "anywhere" }}>{email}</div>
        </div>
        <div style={{ padding: "12px 16px 4px", overflowY: "auto", minHeight: 0 }}>
          <div data-testid="dg-lead" style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", lineHeight: 1.4 }}>
            {tpl(t.rd_adm_dg_lead, { n: accounts.length, m: limit, plan: planLabel })}
          </div>
          <div style={{ marginTop: 10, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            {accounts.map((a, i) => {
              const id = acctId(a);
              const on = picked.has(id);
              const date = fmtAcctDate(a.addedAt);
              return (
                <label key={id} data-testid={`dg-row-${id}`}
                  style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 48, padding: "7px 12px", cursor: busy ? "default" : "pointer", borderTop: i ? "1px solid var(--border)" : "none", background: on ? "var(--danger-soft)" : "transparent" }}>
                  <input type="checkbox" checked={on} disabled={busy} onChange={() => toggle(id)} data-testid={`dg-check-${id}`}
                    style={{ width: 20, height: 20, flexShrink: 0, accentColor: "var(--danger)" }} />
                  <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 800, color: "#fff", background: PLATFORM_COLOR[a.platform], padding: "3px 7px", borderRadius: 6 }}>{PLATFORM_LABEL[a.platform]}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--text)", overflowWrap: "anywhere", lineHeight: 1.25 }}>{a.platform === "tiktok" ? `@${a.name}` : a.name}</span>
                    {date && <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>{tpl(t.rd_adm_acct_since, { date })}</span>}
                  </span>
                </label>
              );
            })}
          </div>
          <div data-testid="dg-pick" style={{ marginTop: 9, fontSize: 12, fontWeight: 700, color: exact ? "var(--text-dim)" : "var(--danger)" }}>
            {tpl(t.rd_adm_dg_pick, { k: need, c: picked.size })}
          </div>
          <div style={{ margin: "6px 0 10px", fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.4 }}>{t.rd_adm_dg_keep}</div>
        </div>
        <div style={{ display: "flex", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
          <button type="button" data-testid="dg-cancel" onClick={onCancel} disabled={busy}
            style={{ ...btn, border: "none", borderRight: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-dim)", cursor: busy ? "default" : "pointer" }}>{t.rd_prd_cancel}</button>
          <button type="button" data-testid="dg-ok" disabled={!exact || busy} onClick={() => onConfirm(accounts.filter((a) => picked.has(acctId(a))))}
            style={{ ...btn, border: "none", background: "var(--danger)", color: "#fff", cursor: !exact || busy ? "default" : "pointer", opacity: !exact || busy ? 0.45 : 1 }}>{t.rd_adm_dg_ok}</button>
        </div>
      </div>
    </div>
  );
}
