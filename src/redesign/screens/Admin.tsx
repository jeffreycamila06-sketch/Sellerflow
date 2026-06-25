// Screen 10 — Admin panel + control bottom-sheets. dc.html v3 L899–951 (screen)
// and L1262–1513 (adminPanel sheet). Expanded v3 admin: revenue / sign-ups /
// subscription buckets (active·expiring·free·expired) / notifications, plus a
// full users-management panel (per-user plan + days, visual only). Sample data
// only — no real seller management (Phase 5).
import { useState, type CSSProperties, type ReactNode } from "react";
import { PLANS, PAYMENTS, USERS, SIGNUPS, SUBS, PLAN_PRICE, type Sub, type User } from "../data";
import { headerBar, card, mono } from "../ui";
import type { ReadState } from "../adapters/useReadData";

export type AdminPanelKind =
  | "sellers" | "plans" | "payments" | "reports" | "system" | "broadcast"
  | "subActive" | "subExpiring" | "subFree" | "subExpired" | "signups" | "notifs" | "revenue";

const ctrlTile: CSSProperties = { display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "14px 6px", border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", boxShadow: "var(--shadow)", cursor: "pointer" };
const ctrlChip: CSSProperties = { width: 34, height: 34, borderRadius: 10, background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-fg)" };
const ctrlLbl: CSSProperties = { fontSize: 11, fontWeight: 700, color: "var(--text)", textAlign: "center", lineHeight: 1.2 };
const subCell: CSSProperties = { textAlign: "center", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, padding: "11px 0", cursor: "pointer", fontFamily: "var(--font-ui)" };
const subNum: CSSProperties = { fontFamily: mono, fontWeight: 700, fontSize: 17 };
const subLbl: CSSProperties = { fontSize: 10.5, color: "var(--text-muted)", fontWeight: 600, marginTop: 2 };
const topStat: CSSProperties = { textAlign: "left", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 15, padding: "13px 14px", boxShadow: "var(--shadow)", cursor: "pointer", fontFamily: "var(--font-ui)" };

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

export default function Admin({ onOpenPanel, cur }: { onOpenPanel: (k: AdminPanelKind) => void; cur: string }) {
  return (
    <div>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div><div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19, letterSpacing: "-.01em" }}>Admin panel</div><div style={{ fontSize: 12, opacity: 0.85 }}>Owner control center</div></div>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <button onClick={() => onOpenPanel("notifs")} title="Notifications" style={{ position: "relative", width: 32, height: 32, borderRadius: 9, border: "none", background: "rgba(255,255,255,.16)", color: "var(--on-header)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.7" /></svg>
              <span style={{ position: "absolute", top: -4, right: -4, minWidth: 16, height: 16, padding: "0 3px", borderRadius: 8, background: "#fb7185", border: "1.5px solid var(--accent)", color: "#fff", fontSize: 9.5, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: mono }}>5</span>
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
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <button onClick={() => onOpenPanel("revenue")} style={topStat}><div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>Monthly revenue</div><div style={{ fontFamily: mono, fontWeight: 700, fontSize: 22, color: "var(--text)", marginTop: 3, letterSpacing: "-.02em" }}>{cur}4.2M</div><div style={{ fontSize: 11, fontWeight: 700, color: "var(--ok)", marginTop: 3 }}>▲ 12% MoM ›</div></button>
          <button onClick={() => onOpenPanel("signups")} style={topStat}><div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>New today</div><div style={{ fontFamily: mono, fontWeight: 700, fontSize: 22, color: "var(--text)", marginTop: 3, letterSpacing: "-.02em" }}>38</div><div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent-fg)", marginTop: 3 }}>sign-ups to approve ›</div></button>
        </div>

        <div style={{ ...card, padding: "13px 14px", borderRadius: 15, marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 11 }}>Subscriptions</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button onClick={() => onOpenPanel("subActive")} style={subCell}><div style={{ ...subNum, color: "var(--ok)" }}>9,842</div><div style={subLbl}>Active paid ›</div></button>
            <button onClick={() => onOpenPanel("subExpiring")} style={subCell}><div style={{ ...subNum, color: "var(--warn)" }}>418</div><div style={subLbl}>Expiring ‹15d ›</div></button>
            <button onClick={() => onOpenPanel("subFree")} style={subCell}><div style={{ ...subNum, color: "var(--accent-fg)" }}>1,204</div><div style={subLbl}>Free tier ›</div></button>
            <button onClick={() => onOpenPanel("subExpired")} style={subCell}><div style={{ ...subNum, color: "var(--danger)" }}>2,220</div><div style={subLbl}>Expired ›</div></button>
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
      </div>
    </div>
  );
}

// ── Admin control bottom-sheet (overlay; rendered at the phone root) ─────────
const PANEL_TITLE: Record<AdminPanelKind, string> = {
  sellers: "Manage sellers", plans: "Subscription plans", payments: "Payments", reports: "Platform reports",
  system: "Assign plan by payment", broadcast: "Broadcast", subActive: "Active paid subscriptions",
  subExpiring: "Expiring soon", subFree: "Free tier", subExpired: "Expired", signups: "New sign-ups to approve",
  revenue: "App revenue", notifs: "Notifications",
};
const chipOn: CSSProperties = { fontSize: 11.5, fontWeight: 700, color: "var(--accent-text)", background: "var(--accent)", padding: "6px 11px", borderRadius: 8 };
const chipOff: CSSProperties = { fontSize: 11.5, fontWeight: 600, color: "var(--text-dim)", background: "var(--surface-2)", border: "1px solid var(--border)", padding: "6px 11px", borderRadius: 8 };
const miniStat: CSSProperties = { background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 13, padding: "12px 13px" };
const miniLbl: CSSProperties = { fontSize: 11, color: "var(--text-muted)", fontWeight: 600 };
const miniNum: CSSProperties = { fontFamily: mono, fontWeight: 700, fontSize: 19, color: "var(--text)", marginTop: 3 };
const sheetBtn: CSSProperties = { width: "100%", padding: "13px 0", border: "none", borderRadius: 12, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 14px var(--accent-soft)" };
const planBtn: CSSProperties = { fontSize: 10.5, fontWeight: 700, color: "var(--accent-fg)", background: "var(--accent-soft)", border: "none", padding: "5px 9px", borderRadius: 7, cursor: "pointer", fontFamily: "var(--font-ui)" };
const actBtn: CSSProperties = { fontSize: 10.5, fontWeight: 700, color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border-strong)", padding: "5px 9px", borderRadius: 7, cursor: "pointer", fontFamily: "var(--font-ui)" };

// Real Taiwan prices: Master NT$1,700 · Pro NT$1,200 · Basic NT$500.
const matchPlan = (amt: string) => { const a = +amt || 0; return a >= 1700 ? "Master" : a >= 1200 ? "Pro" : a >= 500 ? "Basic" : "—"; };
const planFg = (plan: string) => ({ Master: "#7c3aed", Pro: "#0284c7", Basic: "#059669", Free: "#9795ad" } as Record<string, string>)[plan] || "var(--text-dim)";

const NOTIFS = [
  { kind: "New sign-up", title: "Carla Mendoza signed up", sub: "Carla Finds · 12m ago", tint: "var(--accent-soft)", ink: "var(--accent-fg)" },
  { kind: "New sign-up", title: "Ben Uy signed up", sub: "Uy Gadgets · 40m ago", tint: "var(--accent-soft)", ink: "var(--accent-fg)" },
  { kind: "New sign-up", title: "Tina Flores signed up", sub: "Tina Beauty · 1h ago", tint: "var(--accent-soft)", ink: "var(--accent-fg)" },
  { kind: "Expiring", title: "TanwearPH expires in 5 days", sub: "Kim Tan · Starter · Jun 30", tint: "rgba(217,119,6,.16)", ink: "var(--warn)" },
  { kind: "Expiring", title: "NeneFinds expires in 4 days", sub: "Nene Bautista · Pro · Jun 29", tint: "rgba(217,119,6,.16)", ink: "var(--warn)" },
];

function SubList({ list, statusLabel, statusColor, note, showPlan = true }: { list: Sub[]; statusLabel: string; statusColor: string; note: string; showPlan?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 2 }}>{note}</div>
      {list.map((s) => (
        <div key={s.shop} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 12px", border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface-2)" }}>
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{s.shop}</div><div style={{ fontSize: 11, color: "var(--text-muted)" }}>{showPlan ? `${s.owner} · ${s.plan}` : s.owner}</div></div>
          <div style={{ textAlign: "right", flexShrink: 0 }}><div style={{ fontSize: 10.5, fontWeight: 800, color: statusColor }}>{statusLabel}</div><div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 2 }}>{s.info}</div></div>
        </div>
      ))}
    </div>
  );
}

export function AdminPanel({ panel, onClose, assignAmount, onAssignAmount, cur, users = USERS, usersState = "sample" }: { panel: AdminPanelKind; onClose: () => void; assignAmount: string; onAssignAmount: (v: string) => void; cur: string; users?: User[]; usersState?: ReadState }) {
  // Users-management ephemeral state (dc.html v3 userPlans/userDays/addIdx). Visual
  // only — these never write to the DB (real plan/days/PW changes are 5h).
  const [userPlans, setUserPlans] = useState<Record<string, string>>({});
  const [userDays, setUserDays] = useState<Record<string, number>>({});
  const [addIdx, setAddIdx] = useState<number | null>(null);
  const [addVal, setAddVal] = useState("");
  const setPlan = (email: string, plan: string) => setUserPlans((p) => ({ ...p, [email]: plan }));
  const revAdded = users.reduce((sum, u) => sum + ((PLAN_PRICE[userPlans[u.email] || u.plan] || 0) - (PLAN_PRICE[u.plan] || 0)), 0);
  const userCount = usersState === "live" || usersState === "empty" ? `${users.length}` : "12,480";

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
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 11, padding: "10px 12px", marginBottom: 11 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="var(--text-muted)" strokeWidth="1.8" /><path d="m20 20-3.5-3.5" stroke="var(--text-muted)" strokeWidth="1.8" strokeLinecap="round" /></svg>
                <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Search email or @handle</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 11 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>Users · {userCount}</span>
                <button style={{ fontSize: 11.5, fontWeight: 700, color: "var(--accent-text)", background: "var(--accent)", border: "none", padding: "7px 12px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)" }}>+ Add user</button>
              </div>
              {usersState === "loading" && <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 2px" }}>Loading sellers…</div>}
              {usersState === "empty" && <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 2px" }}>No sellers found.</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {users.map((u, i) => {
                  const plan = userPlans[u.email] || u.plan;
                  const days = userDays[u.email] != null ? userDays[u.email] : u.days;
                  const isAdmin = u.role === "Admin";
                  return (
                    <div key={u.email} style={{ border: "1px solid var(--border)", borderRadius: 13, background: "var(--surface-2)", padding: 12 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email}</div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>{u.note}</div>
                        </div>
                        <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                          <span style={{ fontSize: 10, fontWeight: 800, color: isAdmin ? "var(--accent-fg)" : "var(--text-dim)", background: isAdmin ? "var(--accent-soft)" : "var(--surface-3)", padding: "3px 7px", borderRadius: 6 }}>{u.role}</span>
                          <span style={{ fontSize: 10, fontWeight: 800, color: planFg(plan), background: "var(--surface)", border: "1px solid var(--border)", padding: "3px 7px", borderRadius: 6 }}>{plan}</span>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 9, fontSize: 11, color: "var(--text-dim)" }}>
                        <span><span style={{ color: "var(--text-muted)" }}>Days</span> <span style={{ fontFamily: mono, fontWeight: 700, color: "var(--text)" }}>{days}</span></span>
                        <span><span style={{ color: "var(--text-muted)" }}>Accounts</span> <span style={{ fontFamily: mono, fontWeight: 700, color: "var(--text)" }}>{u.accounts}</span></span>
                        {addIdx === i ? (
                          <span style={{ display: "flex", alignItems: "center", gap: 5, marginLeft: "auto" }}>
                            <input value={addVal} onChange={(e) => setAddVal(e.target.value.replace(/[^0-9]/g, ""))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const base = userDays[u.email] != null ? userDays[u.email] : u.days; const add = parseInt(addVal || "0", 10) || 0; setUserDays((d) => ({ ...d, [u.email]: base + add })); setAddIdx(null); setAddVal(""); } }} inputMode="numeric" autoFocus placeholder="days" style={{ width: 54, padding: "4px 7px", border: "1.3px solid var(--accent)", borderRadius: 7, background: "var(--surface)", color: "var(--text)", fontFamily: mono, fontSize: 11, fontWeight: 700, outline: "none" }} />
                            <span style={{ fontSize: 9.5, color: "var(--text-muted)" }}>Enter ↵</span>
                          </span>
                        ) : (
                          <button onClick={() => { setAddIdx(i); setAddVal(""); }} style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 3, fontSize: 10.5, fontWeight: 800, color: "var(--accent-text)", background: "var(--accent)", border: "none", padding: "4px 10px", borderRadius: 7, cursor: "pointer", fontFamily: "var(--font-ui)" }}>+ Add days</button>
                        )}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 10 }}>
                        <button onClick={() => setPlan(u.email, "Free")} style={planBtn}>Free</button>
                        <button onClick={() => setPlan(u.email, "Basic")} style={planBtn}>Basic</button>
                        <button onClick={() => setPlan(u.email, "Pro")} style={planBtn}>Pro</button>
                        <button onClick={() => setPlan(u.email, "Master")} style={planBtn}>Master</button>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6, paddingTop: 9, borderTop: "1px solid var(--border)" }}>
                        <button style={actBtn}>Edit</button>
                        <button style={actBtn}>Reset PW</button>
                        <button style={actBtn}>{isAdmin ? "Remove Admin" : "Make Admin"}</button>
                        <button style={{ ...actBtn, color: "var(--warn)" }}>Expire</button>
                        <button style={{ ...actBtn, color: "var(--danger)" }}>Delete</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {panel === "plans" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {PLANS.map((p) => (
                <div key={p.name} style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 14, background: "var(--surface-2)" }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                    <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "var(--text)" }}>{p.name}</span>
                    <span><span style={{ fontFamily: mono, fontWeight: 700, fontSize: 18, color: "var(--text)" }}>{cur}{p.price}</span><span style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.per}</span></span>
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
                <div style={{ ...miniStat, flex: 1 }}><div style={miniLbl}>Collected today</div><div style={miniNum}>{cur}48,200</div></div>
                <div style={{ ...miniStat, flex: 1 }}><div style={miniLbl}>Pending</div><div style={{ ...miniNum, color: "var(--warn)" }}>12</div></div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 9 }}>Recent transactions</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {PAYMENTS.map((t, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 11 }}>
                    <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{t.seller}</div><div style={{ fontSize: 11, color: "var(--text-muted)" }}>{t.method} · {t.time} ago</div></div>
                    <div style={{ textAlign: "right" }}><div style={{ fontFamily: mono, fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{cur}{t.amount}</div><div style={{ fontSize: 10.5, fontWeight: 800, color: t.status === "Paid" ? "var(--ok)" : "var(--warn)" }}>{t.status}</div></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {panel === "reports" && (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                <div style={miniStat}><div style={miniLbl}>MRR</div><div style={miniNum}>{cur}4.2M</div></div>
                <div style={miniStat}><div style={miniLbl}>Growth</div><div style={{ ...miniNum, color: "var(--ok)" }}>+12%</div></div>
                <div style={miniStat}><div style={miniLbl}>Churn</div><div style={{ ...miniNum, color: "var(--warn)" }}>2.1%</div></div>
                <div style={miniStat}><div style={miniLbl}>ARPU</div><div style={miniNum}>{cur}340</div></div>
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
                <span style={{ fontFamily: mono, fontSize: 15, fontWeight: 700, color: "var(--text-muted)" }}>{cur}</span>
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

          {panel === "subActive" && <SubList list={SUBS.active} statusLabel="Active" statusColor="var(--ok)" note="9,842 active paid subscriptions · showing recent" />}
          {panel === "subExpiring" && <SubList list={SUBS.expiring} statusLabel="Expiring" statusColor="var(--warn)" note="418 expiring within 15 days — renew or follow up" />}
          {panel === "subFree" && <SubList list={SUBS.free} statusLabel="Free" statusColor="var(--accent-fg)" note="1,204 free-tier shops · plan & free cycle" showPlan={false} />}
          {panel === "subExpired" && <SubList list={SUBS.expired} statusLabel="Expired" statusColor="var(--danger)" note="2,220 expired — not renewed / no payment" />}

          {panel === "signups" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 2 }}>Pending approval — accounts created from sign-up</div>
              {SIGNUPS.map((g) => (
                <div key={g.email} style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface-2)", padding: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{g.name}</div><div style={{ fontSize: 11, color: "var(--text-muted)" }}>{g.email}</div></div>
                    <span style={{ fontSize: 10.5, color: "var(--text-muted)", flexShrink: 0 }}>{g.time}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 5 }}>Shop: <span style={{ fontWeight: 700, color: "var(--text)" }}>{g.shop}</span></div>
                  <div style={{ display: "flex", gap: 7, marginTop: 10 }}>
                    <button style={{ flex: 1, padding: "9px 0", border: "none", borderRadius: 9, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Approve</button>
                    <button style={{ flex: 1, padding: "9px 0", border: "1px solid var(--border-strong)", borderRadius: 9, background: "var(--surface)", color: "var(--danger)", fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Reject</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {panel === "notifs" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 2 }}>New sign-ups &amp; subscriptions expiring within 5 days</div>
              {NOTIFS.map((n, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: "11px 12px", border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface-2)" }}>
                  <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".02em", color: n.ink, background: n.tint, padding: "4px 7px", borderRadius: 6, flexShrink: 0, marginTop: 1 }}>{n.kind}</span>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{n.title}</div><div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>{n.sub}</div></div>
                </div>
              ))}
            </div>
          )}

          {panel === "revenue" && (
            <div>
              <div style={{ background: "var(--accent)", borderRadius: 14, padding: 15, color: "#fff", boxShadow: "0 8px 22px var(--accent-soft)" }}>
                <div style={{ fontSize: 11.5, opacity: 0.9, fontWeight: 600 }}>This month · from paid subscribers</div>
                <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 28, marginTop: 4, letterSpacing: "-.02em" }}>{cur}4.2M</div>
                <div style={{ fontSize: 11.5, opacity: 0.92, marginTop: 2 }}>▲ 12% vs last month</div>
              </div>
              <div style={{ display: "flex", gap: 9, marginTop: 12 }}>
                <div style={{ flex: 1, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12, padding: "11px 12px" }}><div style={{ fontSize: 10.5, color: "var(--text-muted)", fontWeight: 600 }}>Platform fees</div><div style={{ fontFamily: mono, fontWeight: 700, fontSize: 15, color: "var(--text)", marginTop: 2 }}>{cur}1.05M</div></div>
                <div style={{ flex: 1, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12, padding: "11px 12px" }}><div style={{ fontSize: 10.5, color: "var(--text-muted)", fontWeight: 600 }}>Net profit</div><div style={{ fontFamily: mono, fontWeight: 700, fontSize: 15, color: "var(--ok)", marginTop: 2 }}>{cur}3.15M</div></div>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 11, background: "var(--accent-soft)", border: "1px solid var(--accent)", borderRadius: 12, padding: "11px 13px" }}>
                <div><div style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 600 }}>Detected from plan changes</div><div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 1 }}>Live — when you upgrade a paid seller</div></div>
                <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 17, color: "var(--accent-fg)" }}>+{cur}{revAdded.toLocaleString("en-US")}</div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", margin: "14px 2px 9px" }}>Revenue by plan</div>
              <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 13, overflow: "hidden" }}>
                {[{ plan: "Starter", subs: "4,120", price: cur + "199", total: cur + "820K" }, { plan: "Pro", subs: "5,310", price: cur + "499", total: cur + "2.65M" }, { plan: "Business", subs: "412", price: cur + "1,499", total: cur + "618K" }].map((r) => (
                  <div key={r.plan} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 13px", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{r.plan}</div><div style={{ fontSize: 11, color: "var(--text-muted)" }}>{r.subs} subscribers · {r.price}/mo</div></div>
                    <div style={{ fontFamily: mono, fontSize: 14, fontWeight: 700, color: "var(--text)", flexShrink: 0 }}>{r.total}</div>
                  </div>
                ))}
              </div>
              <button style={{ ...sheetBtn, marginTop: 13, padding: "12px 0", borderRadius: 11, fontSize: 13 }}>Export revenue report</button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
