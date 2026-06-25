// Screen 10 — Admin panel + control bottom-sheets. dc.html v2 L760–826 (screen)
// and L1007–1125 (adminPanel sheet). Sample data only — no real seller mgmt.
import type { CSSProperties, ReactNode } from "react";
import { SELLERS, PLANS, PAYMENTS, avColor, initials, statusColor } from "../data";
import { headerBar, card, mono } from "../ui";

export type AdminPanelKind = "sellers" | "plans" | "payments" | "reports" | "system" | "broadcast";

const stat: CSSProperties = { ...card, padding: "13px 14px", borderRadius: 15 };
const statLbl: CSSProperties = { fontSize: 11, color: "var(--text-muted)", fontWeight: 600 };
const statNum: CSSProperties = { fontFamily: mono, fontWeight: 700, fontSize: 22, color: "var(--text)", marginTop: 3, letterSpacing: "-.02em" };
const ctrlTile: CSSProperties = { display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "14px 6px", border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", boxShadow: "var(--shadow)", cursor: "pointer" };
const ctrlChip: CSSProperties = { width: 34, height: 34, borderRadius: 10, background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-fg)" };
const ctrlLbl: CSSProperties = { fontSize: 11, fontWeight: 700, color: "var(--text)", textAlign: "center", lineHeight: 1.2 };
const tg = <svg width="16" height="16" viewBox="0 0 24 24" fill="#0088cc"><path d="M21.5 4.3 3.2 11.4c-1 .4-1 1.8.1 2.1l4.6 1.4 1.8 5.6c.2.7 1.1.9 1.6.3l2.5-2.6 4.7 3.4c.6.4 1.4.1 1.6-.6l3-15c.2-1-.7-1.8-1.6-1.3Z" /></svg>;

const cic = {
  sellers: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.7" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17 14.3a5.5 5.5 0 0 1 3.5 4.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>,
  plans: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 8a2 2 0 0 1 2-2h7l9 9-7 7-9-9V8Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><circle cx="8" cy="11" r="1.4" fill="currentColor" /></svg>,
  payments: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.7" /><path d="M3 10h18" stroke="currentColor" strokeWidth="1.7" /></svg>,
  broadcast: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 10v4a1 1 0 0 0 1 1h3l5 4V5L8 9H5a1 1 0 0 0-1 1Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M17 8a5 5 0 0 1 0 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>,
  reports: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 19V11M10 19V5M15 19v-6M20 19V9" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>,
  system: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 6h14M5 12h14M5 18h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><circle cx="9" cy="6" r="2" fill="var(--surface)" stroke="currentColor" strokeWidth="1.8" /><circle cx="15" cy="12" r="2" fill="var(--surface)" stroke="currentColor" strokeWidth="1.8" /><circle cx="9" cy="18" r="2" fill="var(--surface)" stroke="currentColor" strokeWidth="1.8" /></svg>,
};

function Ctrl({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return <div onClick={onClick} style={ctrlTile}><span style={ctrlChip}>{icon}</span><span style={ctrlLbl}>{label}</span></div>;
}

export default function Admin({ onOpenPanel }: { onOpenPanel: (k: AdminPanelKind) => void }) {
  return (
    <div>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div><div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19, letterSpacing: "-.01em" }}>Admin panel</div><div style={{ fontSize: 12, opacity: 0.85 }}>Owner control center</div></div>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <button title="Notifications" style={{ position: "relative", width: 32, height: 32, borderRadius: 9, border: "none", background: "rgba(255,255,255,.16)", color: "var(--on-header)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.7" /></svg>
              <span style={{ position: "absolute", top: 4, right: 5, width: 8, height: 8, borderRadius: "50%", background: "#fb7185", border: "1.5px solid var(--accent)" }} />
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, background: "rgba(255,255,255,.16)", padding: "6px 11px", borderRadius: 9 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#4ade80" }} />Systems OK</div>
          </div>
        </div>
      </div>
      <div style={{ padding: "14px 14px 22px" }}>
        <div style={{ ...card, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <div style={{ width: 50, height: 50, borderRadius: 15, background: "linear-gradient(150deg,#7c3aed,#4f46e5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 800, color: "#fff", fontFamily: "var(--font-display)" }}>JC</div>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 15.5, fontWeight: 700, color: "var(--text)" }}>Juan Dela Cruz</div><div style={{ fontSize: 12, fontWeight: 600, color: "var(--handle)" }}>Platform owner</div></div>
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 800, letterSpacing: ".03em", color: "var(--accent-text)", background: "var(--accent)", padding: "5px 9px", borderRadius: 7 }}><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 4 5v6c0 4.4 3.1 7.6 8 9 4.9-1.4 8-4.6 8-9V5l-8-3Z" /></svg>SUPER ADMIN</span>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 11, paddingTop: 11, borderTop: "1px solid var(--border)", lineHeight: 1.5 }}>Full access — controls all sellers, plans, payments, and platform settings.</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <div style={stat}><div style={statLbl}>Total sellers</div><div style={statNum}>12,480</div><div style={{ fontSize: 11, fontWeight: 700, color: "var(--ok)", marginTop: 3 }}>▲ 4.2% this week</div></div>
          <div style={stat}><div style={statLbl}>Monthly revenue</div><div style={statNum}>₱4.2M</div><div style={{ fontSize: 11, fontWeight: 700, color: "var(--ok)", marginTop: 3 }}>▲ 12% MoM</div></div>
          <div style={stat}><div style={statLbl}>New today</div><div style={statNum}>38</div><div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent-fg)", marginTop: 3 }}>sign-ups</div></div>
          <div style={stat}><div style={statLbl}>Open tickets</div><div style={statNum}>7</div><div style={{ fontSize: 11, fontWeight: 700, color: "var(--warn)", marginTop: 3 }}>3 urgent</div></div>
        </div>

        <div style={{ ...card, padding: "13px 14px", borderRadius: 15, marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 11 }}>Subscriptions</div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1, textAlign: "center", background: "var(--surface-2)", borderRadius: 10, padding: "10px 0" }}><div style={{ fontFamily: mono, fontWeight: 700, fontSize: 17, color: "var(--ok)" }}>9,842</div><div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, marginTop: 2 }}>Active</div></div>
            <div style={{ flex: 1, textAlign: "center", background: "var(--surface-2)", borderRadius: 10, padding: "10px 0" }}><div style={{ fontFamily: mono, fontWeight: 700, fontSize: 17, color: "var(--warn)" }}>418</div><div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, marginTop: 2 }}>Expiring</div></div>
            <div style={{ flex: 1, textAlign: "center", background: "var(--surface-2)", borderRadius: 10, padding: "10px 0" }}><div style={{ fontFamily: mono, fontWeight: 700, fontSize: 17, color: "var(--danger)" }}>2,220</div><div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, marginTop: 2 }}>Expired</div></div>
          </div>
        </div>

        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14.5, color: "var(--text)", margin: "2px 2px 10px" }}>Controls</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 9, marginBottom: 16 }}>
          <Ctrl icon={cic.sellers} label="Sellers" onClick={() => onOpenPanel("sellers")} />
          <Ctrl icon={cic.plans} label="Plans" onClick={() => onOpenPanel("plans")} />
          <Ctrl icon={cic.payments} label="Payments" onClick={() => onOpenPanel("payments")} />
          <Ctrl icon={cic.broadcast} label="Broadcast" onClick={() => onOpenPanel("broadcast")} />
          <Ctrl icon={cic.reports} label="Reports" onClick={() => onOpenPanel("reports")} />
          <Ctrl icon={cic.system} label="System" onClick={() => onOpenPanel("system")} />
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "2px 2px 10px" }}><span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14.5, color: "var(--text)" }}>Recent sellers</span><span style={{ fontSize: 12, fontWeight: 700, color: "var(--accent-fg)" }}>+ Add plan</span></div>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 15, boxShadow: "var(--shadow)", overflow: "hidden" }}>
          {SELLERS.map((s) => (
            <div key={s.shop} style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ width: 38, height: 38, borderRadius: 11, background: avColor(s.shop), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{initials(s.shop)}</div>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{s.shop}</div><div style={{ fontSize: 11, color: "var(--text-muted)" }}>{s.owner} · {s.plan}</div></div>
              <div style={{ textAlign: "right", flexShrink: 0 }}><div style={{ fontSize: 11, fontWeight: 800, color: statusColor(s.status) }}>{s.status}</div><div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 2 }}>{s.expiry}</div></div>
            </div>
          ))}
        </div>
        <button style={{ width: "100%", marginTop: 14, padding: "12px 0", border: "1px solid var(--border-strong)", borderRadius: 12, background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>{tg}Contact seller via Telegram</button>
      </div>
    </div>
  );
}

// ── Admin control bottom-sheet (overlay; rendered at the phone root) ─────────
const PANEL_TITLE: Record<AdminPanelKind, string> = { sellers: "Manage sellers", plans: "Subscription plans", payments: "Payments", reports: "Platform reports", system: "Assign plan by payment", broadcast: "Broadcast" };
const chipOn: CSSProperties = { fontSize: 11.5, fontWeight: 700, color: "var(--accent-text)", background: "var(--accent)", padding: "6px 11px", borderRadius: 8 };
const chipOff: CSSProperties = { fontSize: 11.5, fontWeight: 600, color: "var(--text-dim)", background: "var(--surface-2)", border: "1px solid var(--border)", padding: "6px 11px", borderRadius: 8 };
const miniStat: CSSProperties = { background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 13, padding: "12px 13px" };
const miniLbl: CSSProperties = { fontSize: 11, color: "var(--text-muted)", fontWeight: 600 };
const miniNum: CSSProperties = { fontFamily: mono, fontWeight: 700, fontSize: 19, color: "var(--text)", marginTop: 3 };
const sheetBtn: CSSProperties = { width: "100%", padding: "13px 0", border: "none", borderRadius: 12, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 14px var(--accent-soft)" };

const matchPlan = (amt: string) => { const a = +amt || 0; return a >= 1499 ? "Enterprise" : a >= 499 ? "Pro" : a >= 199 ? "Starter" : "—"; };

export function AdminPanel({ panel, onClose, assignAmount, onAssignAmount }: { panel: AdminPanelKind; onClose: () => void; assignAmount: string; onAssignAmount: (v: string) => void }) {
  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 9, background: "rgba(8,6,24,.5)", backdropFilter: "blur(2px)", display: "flex", alignItems: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxHeight: "86%", background: "var(--surface)", borderRadius: "22px 22px 0 0", display: "flex", flexDirection: "column", boxShadow: "0 -16px 40px rgba(0,0,0,.3)", animation: "sflSheet .26s cubic-bezier(.22,1,.36,1)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px 13px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17, color: "var(--text)" }}>{PANEL_TITLE[panel]}</span>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 9, border: "none", background: "var(--surface-2)", color: "var(--text-dim)", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>
        <div className="sfl-scroll" style={{ padding: "16px 16px calc(22px + env(safe-area-inset-bottom))" }}>

          {panel === "sellers" && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 11, padding: "10px 12px", marginBottom: 13 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="var(--text-muted)" strokeWidth="1.8" /><path d="m20 20-3.5-3.5" stroke="var(--text-muted)" strokeWidth="1.8" strokeLinecap="round" /></svg>
                <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Search seller or @handle</span>
              </div>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 15 }}>
                <span style={chipOn}>All · 12,480</span><span style={chipOff}>Active · 9,842</span><span style={chipOff}>Expiring · 418</span><span style={chipOff}>Expired · 2,220</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                <button style={{ ...sheetBtn, padding: "12px 0", borderRadius: 11, fontSize: 13 }}>+ Add seller</button>
                <div style={{ display: "flex", gap: 9 }}>
                  <button style={{ flex: 1, padding: "11px 0", border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Suspend</button>
                  <button style={{ flex: 1, padding: "11px 0", border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Message all</button>
                </div>
              </div>
            </div>
          )}

          {panel === "plans" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {PLANS.map((p) => (
                <div key={p.name} style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 14, background: "var(--surface-2)" }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                    <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "var(--text)" }}>{p.name}</span>
                    <span><span style={{ fontFamily: mono, fontWeight: 700, fontSize: 18, color: "var(--text)" }}>{p.price}</span><span style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.per}</span></span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--accent-fg)", fontWeight: 700, marginTop: 2 }}>{p.sellers}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 10 }}>
                    {p.feats.map((f) => (<span key={f} style={{ fontSize: 11.5, color: "var(--text-dim)" }}><span style={{ color: "var(--accent-fg)", fontWeight: 800 }}>✓</span> {f}</span>))}
                  </div>
                </div>
              ))}
              <button style={{ width: "100%", padding: "12px 0", border: "1px dashed var(--border-strong)", borderRadius: 12, background: "transparent", color: "var(--accent-fg)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>+ New plan</button>
            </div>
          )}

          {panel === "payments" && (
            <div>
              <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                <div style={{ ...miniStat, flex: 1 }}><div style={miniLbl}>Collected today</div><div style={miniNum}>₱48,200</div></div>
                <div style={{ ...miniStat, flex: 1 }}><div style={miniLbl}>Pending</div><div style={{ ...miniNum, color: "var(--warn)" }}>12</div></div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 9 }}>Recent transactions</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {PAYMENTS.map((t, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 11 }}>
                    <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{t.seller}</div><div style={{ fontSize: 11, color: "var(--text-muted)" }}>{t.method} · {t.time} ago</div></div>
                    <div style={{ textAlign: "right" }}><div style={{ fontFamily: mono, fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{t.amount}</div><div style={{ fontSize: 10.5, fontWeight: 800, color: t.status === "Paid" ? "var(--ok)" : "var(--warn)" }}>{t.status}</div></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {panel === "reports" && (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                <div style={miniStat}><div style={miniLbl}>MRR</div><div style={miniNum}>₱4.2M</div></div>
                <div style={miniStat}><div style={miniLbl}>Growth</div><div style={{ ...miniNum, color: "var(--ok)" }}>+12%</div></div>
                <div style={miniStat}><div style={miniLbl}>Churn</div><div style={{ ...miniNum, color: "var(--warn)" }}>2.1%</div></div>
                <div style={miniStat}><div style={miniLbl}>ARPU</div><div style={miniNum}>₱340</div></div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 9 }}>Reports</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {["Revenue by plan", "Seller growth", "Churn & renewals"].map((r) => (
                  <button key={r} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 13px", border: "1px solid var(--border)", borderRadius: 11, background: "var(--surface-2)", cursor: "pointer", fontFamily: "var(--font-ui)" }}><span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{r}</span><span style={{ color: "var(--text-muted)" }}>›</span></button>
                ))}
              </div>
              <button style={{ ...sheetBtn, marginTop: 13, padding: "12px 0", borderRadius: 11, fontSize: 13 }}>Export CSV</button>
            </div>
          )}

          {panel === "system" && (
            <div>
              <div style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.5, marginBottom: 15 }}>Enter the amount a new seller paid — the matching plan is selected automatically and granted on assign.</div>
              <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 6 }}>Amount paid</label>
              <div style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface-2)", padding: "0 13px", marginBottom: 14 }}>
                <span style={{ fontFamily: mono, fontSize: 15, fontWeight: 700, color: "var(--text-muted)" }}>₱</span>
                <input value={assignAmount} onChange={(e) => onAssignAmount(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" style={{ flex: 1, border: "none", background: "transparent", color: "var(--text)", fontFamily: mono, fontSize: 15, fontWeight: 700, padding: "12px 0", outline: "none" }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--accent-soft)", border: "1px solid var(--accent)", borderRadius: 13, padding: "13px 15px", marginBottom: 16 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)" }}>Matched plan</span>
                <span style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 700, color: "var(--accent-fg)" }}>{matchPlan(assignAmount)}</span>
              </div>
              <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 6 }}>Assign to seller</label>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface-2)", padding: "12px 13px", marginBottom: 16 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-muted)" }}>Select seller</span><span style={{ color: "var(--text-muted)" }}>▾</span>
              </div>
              <button style={sheetBtn}>Grant {matchPlan(assignAmount)} plan</button>
            </div>
          )}

          {panel === "broadcast" && (
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 8 }}>Audience</label>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 15 }}>
                <span style={chipOn}>All sellers</span><span style={chipOff}>Pro only</span><span style={chipOff}>Expiring</span>
              </div>
              <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 6 }}>Message</label>
              <div style={{ border: "1px solid var(--border-strong)", borderRadius: 12, background: "var(--surface-2)", padding: "12px 13px", minHeight: 84, fontSize: 13, color: "var(--text-muted)", marginBottom: 15 }}>Type your announcement to sellers…</div>
              <button style={sheetBtn}>Send broadcast</button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
