// Screen 10 — Admin panel + control bottom-sheets. dc.html v3 L899–951 (screen)
// and L1262–1513 (adminPanel sheet). Expanded v3 admin: revenue / sign-ups /
// subscription buckets (active·expiring·free·expired) / notifications, plus a
// full users-management panel (per-user plan + days, visual only). Sample data
// only — no real seller management (Phase 5).
import { useState, type CSSProperties, type ReactNode } from "react";
import { USERS, SUBS, PLAN_PRICE, initials, fmt, type Sub, type User } from "../data";
import { headerBar, card, mono } from "../ui";
import { planDaysLeft, daysDisplay, deriveSubBuckets, deriveUserBase, freeUsersSummary, auditActionColor, filterAuditLogs, type ReadState, type SubBuckets, type FreeUserRow } from "../adapters/useReadData";
import type { AdminActions, Plan } from "../adapters/useAdmin";
import { maxAcc } from "../adapters/connect";
import type { AccountAuditLog, AccountUser } from "../../accountDb";
import { csvDL, dayStamp } from "../adapters/csv";
import SoonBadge from "../components/SoonBadge";
import ContactChip from "../components/ContactChip";
import { useT, tpl, type RedesignT } from "../i18n";
import { isIOS } from "../adapters/platform";
import { isAppShell } from "../adapters/appShell";
import { relativeTime } from "../adapters/useReadData";
import { maxHourlyOrders, hourLabel, type PulseData, type PulseState } from "../adapters/useBusinessPulse";
import { pickLatestActive, type Announcement } from "../adapters/useAnnouncements";
import { translateBroadcast } from "../adapters/broadcastTranslate";
import { LANGS } from "../data";
import { matchPlan } from "../../lib/planPricing";
import { isAdminRole } from "../../lib/roles";

const deadBtn: CSSProperties = { opacity: 0.45, cursor: "not-allowed" };
// Sample/not-wired marker for the Admin panels that have no real backend yet
// (everything except the Sellers list + its per-user actions).
const SampleNote = () => { const t = useT(); return <div style={{ marginBottom: 12 }}><SoonBadge label={t.rd_adm_sample_note} /></div>; };

export type AdminPanelKind =
  | "sellers" | "reports" | "system" | "broadcast"
  | "subActive" | "subExpiring" | "subFree" | "subExpired" | "notifs" | "revenue" | "audit" | "userbase" | "pulse";

const ctrlTile: CSSProperties = { display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "14px 6px", border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", boxShadow: "var(--shadow)", cursor: "pointer" };
const ctrlChip: CSSProperties = { width: 34, height: 34, borderRadius: 10, background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-fg)" };
const ctrlLbl: CSSProperties = { fontSize: 11, fontWeight: 700, color: "var(--text)", textAlign: "center", lineHeight: 1.2 };
const subCell: CSSProperties = { textAlign: "center", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, padding: "11px 0", cursor: "pointer", fontFamily: "var(--font-ui)" };
const subNum: CSSProperties = { fontFamily: mono, fontWeight: 700, fontSize: 17 };
const subLbl: CSSProperties = { fontSize: 10.5, color: "var(--text-muted)", fontWeight: 600, marginTop: 2 };
const topStat: CSSProperties = { textAlign: "left", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 15, padding: "13px 14px", boxShadow: "var(--shadow)", cursor: "pointer", fontFamily: "var(--font-ui)" };

const cic = {
  sellers: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.7" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17 14.3a5.5 5.5 0 0 1 3.5 4.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>,
  broadcast: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 10v4a1 1 0 0 0 1 1h3l5 4V5L8 9H5a1 1 0 0 0-1 1Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M17 8a5 5 0 0 1 0 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>,
  reports: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 19V11M10 19V5M15 19v-6M20 19V9" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>,
  system: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 6h14M5 12h14M5 18h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><circle cx="9" cy="6" r="2" fill="var(--surface)" stroke="currentColor" strokeWidth="1.8" /><circle cx="15" cy="12" r="2" fill="var(--surface)" stroke="currentColor" strokeWidth="1.8" /><circle cx="9" cy="18" r="2" fill="var(--surface)" stroke="currentColor" strokeWidth="1.8" /></svg>,
  audit: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 3h8l4 4v14H6z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M9 13h6M9 16.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>,
  userbase: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 3a9 9 0 1 0 9 9h-9V3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="1.7" opacity=".5" /></svg>,
  pulse: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 12h4l2.5-6 4 13 2.5-7H21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>,
};

function Ctrl({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return <div onClick={onClick} style={ctrlTile}><span style={ctrlChip}>{icon}</span><span style={ctrlLbl}>{label}</span></div>;
}

export default function Admin({ onOpenPanel, cur, counts, live = false, userBase, mrr = null, owner = null }: { onOpenPanel: (k: AdminPanelKind) => void; cur: string; counts?: { active: number; expiring: number; expired: number; free: number }; live?: boolean; userBase?: { paid: number; free: number; total: number }; mrr?: number | null; owner?: { name: string; email: string } | null }) {
  const t = useT();
  const subCount = (k: "active" | "expiring" | "expired" | "free", sample: string) => (live && counts ? String(counts[k]) : sample);
  // Batch B #2 — the owner card shows the REAL signed-in admin (was the
  // hardcoded "Juan Dela Cruz / JC" demo persona). The bell badge "5" and the
  // "Systems OK" chip had no data source at all and were removed outright.
  const ownerName = owner?.name || owner?.email || "—";
  return (
    <div>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div><div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19, letterSpacing: "-.01em" }}>{t.rd_adm_title}</div><div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>{t.rd_adm_subtitle}</div></div>
          <button onClick={() => onOpenPanel("notifs")} title={t.rd_adm_notifications} style={{ position: "relative", width: 32, height: 32, borderRadius: 9, border: "none", background: "rgba(255,255,255,.16)", color: "var(--on-header)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.7" /></svg>
          </button>
        </div>
      </div>
      <div style={{ padding: "14px 14px 22px" }}>
        <div style={{ ...card, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <div style={{ width: 50, height: 50, borderRadius: 15, background: "linear-gradient(150deg,#7c3aed,#4f46e5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 800, color: "#fff", fontFamily: "var(--font-display)" }}>{initials(ownerName)}</div>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 15.5, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ownerName}</div><div style={{ fontSize: 12, fontWeight: 600, color: "var(--handle)" }}>{t.rd_adm_platform_owner}</div></div>
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 800, letterSpacing: ".03em", color: "var(--accent-text)", background: "var(--accent)", padding: "5px 9px", borderRadius: 7 }}><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 4 5v6c0 4.4 3.1 7.6 8 9 4.9-1.4 8-4.6 8-9V5l-8-3Z" /></svg>{t.rd_adm_super_admin}</span>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          {/* Batch B #2 — REAL monthly recurring revenue (deriveMrr: active paid
              plans × real NT$ tier price, from the already-loaded users list) —
              was hardcoded "4.2M / ▲12% MoM" with only a small sample badge. */}
          {!isIOS() && <button onClick={() => onOpenPanel("revenue")} style={topStat}><div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>{t.rd_adm_monthly_revenue}</div><div style={{ fontFamily: mono, fontWeight: 700, fontSize: 22, color: "var(--text)", marginTop: 3, letterSpacing: "-.02em" }}>{mrr != null ? `${cur}${fmt(mrr)}` : "—"}</div><div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent-fg)", marginTop: 3 }}>{t.rd_adm_mrr_note}</div></button>}
          <button onClick={() => onOpenPanel("userbase")} style={topStat}><div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>{t.rd_adm_user_base}</div><div style={{ fontFamily: mono, fontWeight: 700, fontSize: 22, color: "var(--accent-fg)", marginTop: 3, letterSpacing: "-.02em" }}>{userBase ? userBase.paid : "—"}</div><div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent-fg)", marginTop: 3 }}>{userBase ? tpl(t.rd_adm_paying_free, { free: userBase.free }) : t.rd_adm_paid_free_split}</div></button>
        </div>

        <div style={{ ...card, padding: "13px 14px", borderRadius: 15, marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 11 }}>{t.rd_adm_subscriptions}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button onClick={() => onOpenPanel("subActive")} style={subCell}><div style={{ ...subNum, color: "var(--ok)" }}>{subCount("active", "9,842")}</div><div style={subLbl}>{t.rd_adm_active_paid}</div></button>
            <button onClick={() => onOpenPanel("subExpiring")} style={subCell}><div style={{ ...subNum, color: "var(--warn)" }}>{subCount("expiring", "418")}</div><div style={subLbl}>{t.rd_adm_expiring}</div></button>
            <button onClick={() => onOpenPanel("subFree")} style={subCell}><div style={{ ...subNum, color: "var(--accent-fg)" }}>{subCount("free", "1,204")}</div><div style={subLbl}>{t.rd_adm_free_tier}</div></button>
            <button onClick={() => onOpenPanel("subExpired")} style={subCell}><div style={{ ...subNum, color: "var(--danger)" }}>{subCount("expired", "2,220")}</div><div style={subLbl}>{t.rd_adm_expired}</div></button>
          </div>
        </div>

        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14.5, color: "var(--text)", margin: "2px 2px 10px" }}>{t.rd_adm_controls}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 9, marginBottom: 16 }}>
          {/* Live Pulse — WEB-ONLY (hidden in the APK / phone shell, incl. iOS which
              carries Capacitor → isAppShell()). Activity counts only, no revenue. */}
          {!isAppShell() && <Ctrl icon={cic.pulse} label={t.rd_pulse_ctrl} onClick={() => onOpenPanel("pulse")} />}
          <Ctrl icon={cic.userbase} label={t.rd_adm_ctrl_userbase} onClick={() => onOpenPanel("userbase")} />
          <Ctrl icon={cic.sellers} label={t.rd_adm_ctrl_sellers} onClick={() => onOpenPanel("sellers")} />
          {/* C2 (audit) — the Plans/Payments panels were removed: they only ever
              rendered fabricated sample data (no payments backend by design —
              subscriptions are Wise+Telegram outside the app). */}
          <Ctrl icon={cic.broadcast} label={t.rd_adm_ctrl_broadcast} onClick={() => onOpenPanel("broadcast")} />
          <Ctrl icon={cic.reports} label={t.rd_adm_ctrl_reports} onClick={() => onOpenPanel("reports")} />
          <Ctrl icon={cic.system} label={t.rd_adm_ctrl_system} onClick={() => onOpenPanel("system")} />
          <Ctrl icon={cic.audit} label={t.rd_adm_ctrl_audit} onClick={() => onOpenPanel("audit")} />
        </div>
      </div>
    </div>
  );
}

// ── Admin control bottom-sheet (overlay; rendered at the phone root) ─────────
const panelTitle = (t: RedesignT, k: AdminPanelKind): string => ({
  sellers: t.rd_adm_pt_sellers, reports: t.rd_adm_pt_reports,
  system: t.rd_adm_pt_system, broadcast: t.rd_adm_ctrl_broadcast, subActive: t.rd_adm_pt_subActive,
  subExpiring: t.rd_adm_pt_subExpiring, subFree: t.rd_adm_pt_subFree, subExpired: t.rd_adm_pt_subExpired,
  revenue: t.rd_adm_pt_revenue, notifs: t.rd_adm_notifications, audit: t.rd_adm_pt_audit, userbase: t.rd_adm_user_base,
  pulse: t.rd_pulse_title,
} as Record<AdminPanelKind, string>)[k];
const chipOn: CSSProperties = { fontSize: 11.5, fontWeight: 700, color: "var(--accent-text)", background: "var(--accent)", padding: "6px 11px", borderRadius: 8 };
const miniStat: CSSProperties = { background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 13, padding: "12px 13px" };
const miniLbl: CSSProperties = { fontSize: 11, color: "var(--text-muted)", fontWeight: 600 };
const miniNum: CSSProperties = { fontFamily: mono, fontWeight: 700, fontSize: 19, color: "var(--text)", marginTop: 3 };
const sheetBtn: CSSProperties = { width: "100%", padding: "13px 0", border: "none", borderRadius: 12, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 14px var(--accent-soft)" };
const planBtn: CSSProperties = { fontSize: 10.5, fontWeight: 700, color: "var(--accent-fg)", background: "var(--accent-soft)", border: "none", padding: "5px 9px", borderRadius: 7, cursor: "pointer", fontFamily: "var(--font-ui)" };
const actBtn: CSSProperties = { fontSize: 10.5, fontWeight: 700, color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border-strong)", padding: "5px 9px", borderRadius: 7, cursor: "pointer", fontFamily: "var(--font-ui)" };
const editTa: CSSProperties = { width: "100%", padding: "10px 12px", border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600, outline: "none", resize: "vertical", boxSizing: "border-box" };

// Real Taiwan prices: Master NT$1,700 · Pro NT$1,200 · Basic NT$500.
// Batch E (#14): matchPlan now imported from lib/planPricing — thresholds ARE
// the PLAN_PRICE tier values, one source with deriveMrr (was a re-typed copy here).
const planFg = (plan: string) => ({ Master: "#7c3aed", Pro: "#0284c7", Basic: "#059669", Free: "#9795ad" } as Record<string, string>)[plan] || "var(--text-dim)";

const NOTIFS = [
  { kind: "New sign-up", title: "Carla Mendoza signed up", sub: "Carla Finds · 12m ago", tint: "var(--accent-soft)", ink: "var(--accent-fg)" },
  { kind: "New sign-up", title: "Ben Uy signed up", sub: "Uy Gadgets · 40m ago", tint: "var(--accent-soft)", ink: "var(--accent-fg)" },
  { kind: "New sign-up", title: "Tina Flores signed up", sub: "Tina Beauty · 1h ago", tint: "var(--accent-soft)", ink: "var(--accent-fg)" },
  { kind: "Expiring", title: "TanwearPH expires in 5 days", sub: "Kim Tan · Starter · Jun 30", tint: "rgba(217,119,6,.16)", ink: "var(--warn)" },
  { kind: "Expiring", title: "NeneFinds expires in 4 days", sub: "Nene Bautista · Pro · Jun 29", tint: "rgba(217,119,6,.16)", ink: "var(--warn)" },
];

// REAL seller bucket list (derived from the live users list). Mirrors the
// SubList shape but rows are real seller_profiles.
function SellerSubList({ list, statusLabel, statusColor, note }: { list: User[]; statusLabel: string; statusColor: string; note: string }) {
  const t = useT();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 2 }}>{note}</div>
      {list.length === 0 && <div style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "8px 2px" }}>{t.rd_adm_none}</div>}
      {list.map((u) => (
        <div key={u.email} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 12px", border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface-2)" }}>
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.note || u.email}</div><div style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email} · {u.plan}</div></div>
          <div style={{ textAlign: "right", flexShrink: 0 }}><div style={{ fontSize: 10.5, fontWeight: 800, color: statusColor }}>{statusLabel}</div><div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 2 }}>{tpl(u.days === 1 ? t.rd_adm_days_left_one : t.rd_adm_days_left_many, { n: daysDisplay(u.days) })}</div></div>
        </div>
      ))}
    </div>
  );
}

// REAL free-tier monitor (list_free_users_status RPC).
function FreeUserList({ list }: { list: FreeUserRow[] }) {
  const t = useT();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 2 }}>{tpl(list.length === 1 ? t.rd_adm_free_shops_one : t.rd_adm_free_shops_many, { n: list.length })}</div>
      {list.length === 0 && <div style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "8px 2px" }}>{t.rd_adm_no_free}</div>}
      {list.map((u) => {
        const color = u.capped ? "var(--danger)" : u.near_cap ? "var(--warn)" : "var(--ok)";
        return (
          <div key={u.email} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 12px", border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface-2)" }}>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.store_name || u.full_name || u.email}</div><div style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email}</div></div>
            <div style={{ textAlign: "right", flexShrink: 0 }}><div style={{ fontFamily: mono, fontSize: 12.5, fontWeight: 700, color }}>{u.count} / {u.cap}</div><div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 2 }}>{tpl(t.rd_adm_resets_nd, { n: u.cycle_resets_in_days })}</div></div>
          </div>
        );
      })}
    </div>
  );
}

function SubList({ list, statusLabel, statusColor, note, showPlan = true }: { list: Sub[]; statusLabel: string; statusColor: string; note: string; showPlan?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      <SampleNote />
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

// Business Pulse — WEB-ONLY admin activity view. Counts + timestamps only (NO
// prices/revenue → coexists with the iOS payment-hiding gate). Data from the
// admin_business_pulse RPC; read-on-open + manual Refresh (zero polling).
function PulsePanel({ pulse, state, onRefresh }: { pulse: PulseData | null; state: PulseState; onRefresh?: () => void }) {
  const t = useT();
  const s = pulse?.summary;
  const maxHr = maxHourlyOrders(pulse?.hourly || []);
  const asOf = pulse?.generatedAt ? new Date(pulse.generatedAt).toLocaleTimeString() : "";
  const statCard: CSSProperties = { flex: 1, minWidth: 0, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 13, padding: "12px 13px" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45 }}>
          {t.rd_pulse_sub}{asOf ? <> · <span style={{ fontFamily: mono }}>{tpl(t.rd_pulse_as_of, { time: asOf })}</span></> : null}
        </div>
        <button onClick={onRefresh} disabled={state === "loading"} style={{ ...planBtn, flexShrink: 0, opacity: state === "loading" ? 0.6 : 1 }}>{state === "loading" ? t.rd_pulse_loading : t.rd_pulse_refresh}</button>
      </div>

      {state === "loading" && !pulse && <div style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "8px 2px" }}>{t.rd_pulse_loading}</div>}
      {state === "error" && <div style={{ fontSize: 12.5, color: "var(--danger)", padding: "8px 2px" }}>{t.rd_pulse_error}</div>}
      {state === "empty" && <div style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "8px 2px" }}>{t.rd_pulse_empty}</div>}

      {pulse && (state === "live" || state === "empty") && (
        <>
          {/* Headline — active sellers right now (proxy: order activity in last 15/60 min) */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{ background: "var(--accent)", borderRadius: 14, padding: "14px 15px", color: "#fff", boxShadow: "0 8px 22px var(--accent-soft)" }}>
              <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 30, letterSpacing: "-.02em" }}>{s?.active_15m ?? 0}</div>
              <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.95 }}>{t.rd_pulse_active_now}</div>
              <div style={{ fontSize: 10.5, opacity: 0.85, marginTop: 2 }}>{t.rd_pulse_active_now_sub}</div>
            </div>
            <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 14, padding: "14px 15px" }}>
              <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 30, color: "var(--accent-fg)", letterSpacing: "-.02em" }}>{s?.active_60m ?? 0}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{t.rd_pulse_active_60m}</div>
              <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 2 }}>{tpl(t.rd_pulse_orders_60m, { n: s?.orders_60m ?? 0 })}</div>
            </div>
          </div>

          {/* Today totals */}
          <div style={{ display: "flex", gap: 10 }}>
            <div style={statCard}><div style={miniLbl}>{t.rd_pulse_orders_today}</div><div style={miniNum}>{(s?.orders_today ?? 0).toLocaleString("en-US")}</div></div>
            <div style={statCard}><div style={miniLbl}>{t.rd_pulse_sellers_today}</div><div style={{ ...miniNum, color: "var(--accent-fg)" }}>{s?.active_today ?? 0}</div></div>
          </div>

          {/* Orders per hour today (Taipei) */}
          <div style={{ ...card, padding: "14px 15px" }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)", marginBottom: 11 }}>{t.rd_pulse_by_hour}</div>
            {(pulse.hourly.length === 0) && <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{t.rd_pulse_no_hours}</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {pulse.hourly.map((h) => (
                <div key={h.hr} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={{ fontFamily: mono, fontSize: 11, color: "var(--text-muted)", width: 42, flexShrink: 0 }}>{hourLabel(h.hr)}</span>
                  <div style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--surface-2)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.round((h.orders / maxHr) * 100)}%`, background: "var(--accent)", borderRadius: 4 }} />
                  </div>
                  <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, color: "var(--text)", width: 38, textAlign: "right", flexShrink: 0 }}>{h.orders}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Per-seller breakdown today */}
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)", margin: "2px 2px 9px" }}>{tpl(pulse.sellers.length === 1 ? t.rd_pulse_sellers_h_one : t.rd_pulse_sellers_h_many, { n: pulse.sellers.length })}</div>
            {pulse.sellers.length === 0 && <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "6px 2px" }}>{t.rd_pulse_no_sellers}</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {pulse.sellers.map((u, i) => {
                const live = u.orders_60m > 0;
                return (
                  <div key={(u.email || "") + i} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 12px", border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface-2)" }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: live ? "#4ade80" : "var(--border-strong)", flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.store_name || u.email || t.rd_pulse_unknown}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email || ""}{u.last_order_at ? <> · {tpl(t.rd_pulse_last, { ago: relativeTime(u.last_order_at, Date.now()) })}</> : null}</div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontFamily: mono, fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{u.orders_today}</div>
                      <div style={{ fontSize: 10, color: live ? "var(--ok)" : "var(--text-muted)", fontWeight: 700, marginTop: 1 }}>{live ? tpl(t.rd_pulse_in_hour, { n: u.orders_60m }) : t.rd_pulse_today_lbl}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function AdminPanel({ panel, onClose, assignAmount, onAssignAmount, cur, users = USERS, usersState = "sample", rawByEmail = {}, actions, onChanged, freeUsers = [], freeUsersState = "sample", auditLogs = [], auditState = "sample", onOpenPanel, pulse = null, pulseState = "idle", onRefreshPulse, ann, onToast }: { panel: AdminPanelKind; onClose: () => void; assignAmount: string; onAssignAmount: (v: string) => void; cur: string; users?: User[]; usersState?: ReadState; rawByEmail?: Record<string, AccountUser>; actions?: AdminActions; onChanged?: () => void; freeUsers?: FreeUserRow[]; freeUsersState?: ReadState; auditLogs?: AccountAuditLog[]; auditState?: ReadState; onOpenPanel?: (k: AdminPanelKind) => void; pulse?: PulseData | null; pulseState?: PulseState; onRefreshPulse?: () => void; ann?: { list: Announcement[]; loading?: boolean; publish: (m: string, i18n?: Record<string, string> | null) => Promise<{ ok: boolean; error?: string }>; unpublish: (id: string) => Promise<{ ok: boolean; error?: string }>; remove: (id: string) => Promise<{ ok: boolean; error?: string }> }; onToast?: (msg: string, kind: "ok" | "err") => void }) {
  const t = useT();
  // Real subscription buckets (derived) when the users list is live; else sample.
  const realSubs = usersState === "live" || usersState === "empty";
  const realFree = freeUsersState === "live" || freeUsersState === "empty";
  const subB: SubBuckets = deriveSubBuckets(users);
  // Audit log — real entries when admin/configured (audit panel never shows sample).
  const [auditQ, setAuditQ] = useState("");
  const auditFiltered = filterAuditLogs(auditLogs, auditQ);
  const exportAudit = () => csvDL(`sellerflow-audit-log-${dayStamp()}.csv`, ["Time", "Admin", "Action", "Target", "Details"], auditFiltered.map((l) => [l.timestamp, l.actorEmail, l.action, l.targetEmail, l.details]));
  const auditTint = (c: "danger" | "ok" | "accent") => (c === "danger" ? "var(--danger)" : c === "ok" ? "var(--ok)" : "var(--accent-fg)");
  // User-base overview — derived from the loaded seller list + the free RPC.
  const userBase = deriveUserBase(users);
  const freeSummary = freeUsersSummary(freeUsers);
  const maxTier = Math.max(1, userBase.basic, userBase.pro, userBase.master);
  // Per-user optimistic display state. Real writes go through `actions` (5h).
  const [userPlans, setUserPlans] = useState<Record<string, string>>({});
  const [userDays, setUserDays] = useState<Record<string, number>>({});
  const [addIdx, setAddIdx] = useState<number | null>(null);
  const [addVal, setAddVal] = useState("");
  const [pwIdx, setPwIdx] = useState<number | null>(null);
  const [pwVal, setPwVal] = useState("");
  const [busy, setBusy] = useState(false);
  // Client-side seller search — email + connected @handles + contact note. Filters
  // the already-loaded users array (rawByEmail carries the real handles); no new query.
  const [sellerQ, setSellerQ] = useState("");
  const sellerQuery = sellerQ.trim().toLowerCase();
  const matchesSeller = (u: User) => {
    if (!sellerQuery) return true;
    const handles = (rawByEmail[u.email]?.connectedAccounts || []).join(" ");
    return `${u.email} ${handles} ${u.contactNote || ""}`.toLowerCase().includes(sellerQuery);
  };
  const noSellerMatches = sellerQuery.length > 0 && !users.some(matchesSeller);
  // Announcements composer (broadcast panel). Writes go through the ann hook —
  // RLS is_admin-gated. No confirm dialog: Unpublish IS the undo.
  const [annMsg, setAnnMsg] = useState("");
  const [annBusy, setAnnBusy] = useState(false);
  const annActive = ann ? pickLatestActive(ann.list) : null;
  const annDate = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? "" : d.toLocaleDateString([], { month: "short", day: "numeric" }); };
  // U4 — surface results through the app's non-blocking toast when wired (the
  // WebView "prevent additional dialogs" checkbox can swallow window.alert,
  // hiding the only failure signal). Standalone/test renders fall back to alert.
  const notify = (msg: string, kind: "ok" | "err") => { if (onToast) onToast(msg, kind); else window.alert(msg); };
  const doAnn = async (label: string, fn: () => Promise<{ ok: boolean; error?: string }>, onOk?: () => void) => {
    if (!ann || annBusy) return;
    setAnnBusy(true);
    try {
      const r = await fn();
      if (r.ok) onOk?.();
      else notify(tpl(t.rd_adm_failed, { label, err: r.error || t.rd_adm_err }), "err");
    } finally { setAnnBusy(false); }
  };
  // Hard delete (trash) — confirm first, then remove the row entirely. RLS
  // is_admin() gates the DB write; sellers stop seeing it on their next open.
  const delAnn = (id: string) => {
    if (!ann || annBusy) return;
    if (!window.confirm(t.rd_ann_del_confirm)) return;
    void doAnn(t.rd_ann_delete, () => ann!.remove(id));
  };
  // Auto-translate composer flow: type ONE message → Translate (1 server call)
  // → preview all 7 langs → Confirm send (writes EN + message_i18n) / Edit
  // (back, text intact) / Send English only (skip translations, legacy render).
  const [annStage, setAnnStage] = useState<"compose" | "translating" | "preview">("compose");
  const [annPreview, setAnnPreview] = useState<Record<string, string> | null>(null);
  const [annErr, setAnnErr] = useState("");
  const resetAnn = () => { setAnnMsg(""); setAnnPreview(null); setAnnStage("compose"); setAnnErr(""); };
  const startTranslate = async () => {
    if (!ann || annBusy || !annMsg.trim()) return;
    setAnnErr(""); setAnnStage("translating"); setAnnBusy(true);
    try {
      const r = await translateBroadcast(annMsg);
      if (r.ok && r.i18n) { setAnnPreview(r.i18n); setAnnStage("preview"); }
      else { setAnnStage("compose"); setAnnErr(r.error || t.rd_adm_err); }
    } finally { setAnnBusy(false); }
  };
  const confirmSend = () => {
    if (!ann || !annPreview) return;
    void doAnn(t.rd_ann_confirm_send, () => ann!.publish(annPreview!.en || annMsg, annPreview), resetAnn);
  };
  const sendEnglishOnly = () => {
    if (!ann || !annMsg.trim()) return;
    void doAnn(t.rd_ann_english_only, () => ann!.publish(annMsg, null), resetAnn);
  };
  const editBack = () => { setAnnStage("compose"); setAnnPreview(null); };
  // Preview rows in the canonical i18n order, labelled via the LANGS picker
  // (LANGS codes are lowercase "zh-tw" → matched case-insensitively).
  const annLangRows = (i18n: Record<string, string>) =>
    (["en", "fil", "zh", "zh-TW", "vi", "th", "id"] as const).map((code) => {
      const meta = LANGS.find((l) => l.code.toLowerCase() === code.toLowerCase());
      return { code, label: meta?.label || code, flag: meta?.flag || "", text: i18n[code] || "" };
    });
  const setPlan = (email: string, plan: string) => setUserPlans((p) => ({ ...p, [email]: plan }));
  const revAdded = users.reduce((sum, u) => sum + ((PLAN_PRICE[userPlans[u.email] || u.plan] || 0) - (PLAN_PRICE[u.plan] || 0)), 0);
  const userCount = usersState === "live" || usersState === "empty" ? `${users.length}` : "12,480";

  // 5h — every admin write is human-confirmed (R2 safeguard: target the dummy only).
  const run = async (label: string, email: string, fn: () => Promise<{ ok: boolean; error?: string }>, onOk?: () => void) => {
    if (!actions || busy) return;
    if (!window.confirm(tpl(t.rd_adm_confirm, { label, email }))) return;
    setBusy(true);
    try {
      const r = await fn();
      if (r.ok) { onOk?.(); onChanged?.(); notify(tpl(t.rd_adm_ok, { label, email }), "ok"); } // refresh real list
      else notify(tpl(t.rd_adm_failed, { label, err: r.error || t.rd_adm_err }), "err");
    } catch (e) {
      notify(tpl(t.rd_adm_failed, { label, err: e instanceof Error ? e.message : t.rd_adm_err }), "err");
    } finally {
      setBusy(false); // never leave the panel stuck (was the bug blocking later actions)
    }
  };
  // Pass the seller's CURRENT plan/status/expiry so a tier switch preserves
  // plan_expiry (only activation from free/expired opens a fresh window).
  const doPlan = (u: User, plan: Plan, label: string) =>
    void run(tpl(t.rd_adm_act_setplan, { plan: label }), u.email, async () => {
      const r = await actions!.changePlan(u.email, plan, { plan: u.plan, status: u.planStatus || "active", expiry: u.planExpiry || "" });
      if (r.ok) setPlan(u.email, label);
      return r;
    });
  const doPassword = (email: string) =>
    void run(t.rd_adm_act_setpw, email, () => actions!.setPassword(email, pwVal), () => { setPwIdx(null); setPwVal(""); });
  // Real add-days: extends the seller's planExpiry (cumulative) via actions.addDays
  // (→ adminUpdatePlan) so it persists + survives reload. Falls back to local-only
  // when there are no real actions (sample preview).
  const doAddDays = (u: User, add: number) => {
    if (add > 0) {
      if (actions) {
        void run(tpl(add === 1 ? t.rd_adm_act_adddays_one : t.rd_adm_act_adddays_many, { n: add }), u.email, async () => {
          const r = await actions.addDays(u.email, u.planExpiry || new Date().toISOString(), u.planStatus || "active", add);
          if (r.ok && r.planExpiry) setUserDays((d) => ({ ...d, [u.email]: planDaysLeft(r.planExpiry, Date.now()) }));
          return r;
        });
      } else {
        const base = userDays[u.email] != null ? userDays[u.email] : u.days;
        setUserDays((d) => ({ ...d, [u.email]: base + add }));
      }
    }
    setAddIdx(null); setAddVal("");
  };

  // Edit accounts modal (Option B — centered overlay above the sheet). Prefilled
  // from the RAW profile (the display User only carries the account count). Save
  // writes ONLY tiktok/facebook via actions.editAccounts (upsertUser, no plan/role).
  const [editEmail, setEditEmail] = useState<string | null>(null);
  const [editTt, setEditTt] = useState("");
  const [editFb, setEditFb] = useState("");
  const editRaw = editEmail ? rawByEmail[editEmail] : undefined;
  const editLimit = maxAcc(editRaw?.plan || "free");
  const openEdit = (email: string) => {
    const raw = rawByEmail[email];
    setEditTt(raw?.profile.tiktok || "");
    setEditFb(raw?.profile.facebook || "");
    setEditEmail(email);
  };
  const closeEdit = () => setEditEmail(null);
  const doEditAccounts = () => {
    if (!editRaw) { closeEdit(); return; }
    void run(t.rd_adm_act_edit_accounts, editRaw.email, () => actions!.editAccounts(editRaw, editTt, editFb), () => closeEdit());
  };

  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 9, background: "rgba(8,6,24,.5)", backdropFilter: "blur(2px)", display: "flex", alignItems: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxHeight: "86%", background: "var(--surface)", borderRadius: "22px 22px 0 0", display: "flex", flexDirection: "column", boxShadow: "0 -16px 40px rgba(0,0,0,.3)", animation: "sflSheet .26s cubic-bezier(.22,1,.36,1)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px 13px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17, color: "var(--text)" }}>{panelTitle(t, panel)}</span>
          <button onClick={onClose} aria-label={t.rd_close} title={t.rd_close} style={{ width: 30, height: 30, borderRadius: 9, border: "none", background: "var(--surface-2)", color: "var(--text-dim)", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>
        <div className="sfl-scroll" style={{ padding: "16px 16px calc(22px + env(safe-area-inset-bottom))" }}>

          {panel === "sellers" && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 11, padding: "10px 12px", marginBottom: 11 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="var(--text-muted)" strokeWidth="1.8" /><path d="m20 20-3.5-3.5" stroke="var(--text-muted)" strokeWidth="1.8" strokeLinecap="round" /></svg>
                <input value={sellerQ} onChange={(e) => setSellerQ(e.target.value)} placeholder={t.rd_adm_search_email} style={{ flex: 1, border: "none", background: "transparent", color: "var(--text)", fontSize: 12.5, outline: "none", fontFamily: "var(--font-ui)" }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 11 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{t.rd_adm_users} · {userCount}</span>
                <button disabled title={t.rd_adm_coming_soon} style={{ fontSize: 11.5, fontWeight: 700, color: "var(--accent-text)", background: "var(--accent)", border: "none", padding: "7px 12px", borderRadius: 9, fontFamily: "var(--font-ui)", ...deadBtn }}>{t.rd_adm_add_user}</button>
              </div>
              {usersState === "loading" && <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 2px" }}>{t.rd_adm_loading_sellers}</div>}
              {usersState === "empty" && <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 2px" }}>{t.rd_adm_no_sellers}</div>}
              {noSellerMatches && <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 2px" }}>{t.rd_adm_no_sellers}</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {users.map((u, i) => {
                  if (!matchesSeller(u)) return null;
                  const plan = userPlans[u.email] || u.plan;
                  const days = userDays[u.email] != null ? userDays[u.email] : u.days;
                  const isAdmin = isAdminRole(u.role); // Batch E #16 — shared predicate (display-cased "Admin")
                  return (
                    <div key={u.email} style={{ border: "1px solid var(--border)", borderRadius: 13, background: "var(--surface-2)", padding: 12 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email}</div>
                          {/* Admin contact note — inline parse + click-to-edit (parity with old App.tsx
                              ContactDisplay/ContactEditor). Editable only when real admin actions exist. */}
                          <div style={{ marginTop: 3 }} onClick={(e) => e.stopPropagation()}>
                            <ContactChip note={u.contactNote || ""} onSave={actions ? (v) => { void actions.setContactNote(u.email, v).then((r) => { if (r.ok) onChanged?.(); }); } : undefined} />
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                          <span style={{ fontSize: 10, fontWeight: 800, color: isAdmin ? "var(--accent-fg)" : "var(--text-dim)", background: isAdmin ? "var(--accent-soft)" : "var(--surface-3)", padding: "3px 7px", borderRadius: 6 }}>{u.role}</span>
                          <span style={{ fontSize: 10, fontWeight: 800, color: planFg(plan), background: "var(--surface)", border: "1px solid var(--border)", padding: "3px 7px", borderRadius: 6 }}>{plan}</span>
                          {u.status && u.status !== "active" && <span style={{ fontSize: 10, fontWeight: 800, color: u.status === "expired" ? "var(--danger)" : "var(--warn)", background: "var(--surface)", border: "1px solid var(--border)", padding: "3px 7px", borderRadius: 6 }}>{u.status}</span>}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 9, fontSize: 11, color: "var(--text-dim)" }}>
                        <span><span style={{ color: "var(--text-muted)" }}>{t.rd_adm_days}</span> <span style={{ fontFamily: mono, fontWeight: 700, color: "var(--text)" }}>{daysDisplay(days)}</span></span>
                        <span><span style={{ color: "var(--text-muted)" }}>{t.rd_adm_accounts}</span> <span style={{ fontFamily: mono, fontWeight: 700, color: "var(--text)" }}>{u.accounts}</span></span>
                        {addIdx === i ? (
                          <span style={{ display: "flex", alignItems: "center", gap: 5, marginLeft: "auto" }}>
                            <input value={addVal} onChange={(e) => setAddVal(e.target.value.replace(/[^0-9]/g, ""))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); doAddDays(u, parseInt(addVal || "0", 10) || 0); } }} inputMode="numeric" autoFocus placeholder={t.rd_adm_days_ph} style={{ width: 54, padding: "4px 7px", border: "1.3px solid var(--accent)", borderRadius: 7, background: "var(--surface)", color: "var(--text)", fontFamily: mono, fontSize: 11, fontWeight: 700, outline: "none" }} />
                            {/* iPhone fix (same class as the Enterprise ✓ — the iOS
                                number pad has no return key, Enter can never fire).
                                onPointerDown+preventDefault: no blur race. */}
                            <button onPointerDown={(e) => { e.preventDefault(); doAddDays(u, parseInt(addVal || "0", 10) || 0); }} title={t.rd_adm_add_days} aria-label={t.rd_adm_add_days} style={{ minWidth: 34, height: 30, display: "flex", alignItems: "center", justifyContent: "center", border: "none", borderRadius: 7, background: "var(--accent)", color: "var(--accent-text)", fontSize: 13, fontWeight: 900, cursor: "pointer", fontFamily: "var(--font-ui)", flexShrink: 0 }}>✓</button>
                          </span>
                        ) : (
                          <button onClick={() => { setAddIdx(i); setAddVal(""); }} style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 3, fontSize: 10.5, fontWeight: 800, color: "var(--accent-text)", background: "var(--accent)", border: "none", padding: "4px 10px", borderRadius: 7, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_adm_add_days}</button>
                        )}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 10 }}>
                        <button onClick={() => actions ? doPlan(u, "free", "Free") : setPlan(u.email, "Free")} style={planBtn}>Free</button>
                        <button onClick={() => actions ? doPlan(u, "basic", "Basic") : setPlan(u.email, "Basic")} style={planBtn}>Basic</button>
                        <button onClick={() => actions ? doPlan(u, "pro", "Pro") : setPlan(u.email, "Pro")} style={planBtn}>Pro</button>
                        <button onClick={() => actions ? doPlan(u, "master", "Master") : setPlan(u.email, "Master")} style={planBtn}>Master</button>
                      </div>
                      {pwIdx === i && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
                          <input value={pwVal} onChange={(e) => setPwVal(e.target.value)} type="text" autoFocus placeholder={t.rd_adm_pw_ph} style={{ flex: 1, padding: "6px 9px", border: "1.3px solid var(--accent)", borderRadius: 7, background: "var(--surface)", color: "var(--text)", fontSize: 11.5, fontWeight: 600, fontFamily: "var(--font-ui)", outline: "none" }} />
                          <button onClick={() => doPassword(u.email)} disabled={busy} style={{ ...actBtn, color: "var(--accent-fg)", borderColor: "var(--accent)" }}>{t.rd_adm_set}</button>
                          <button onClick={() => { setPwIdx(null); setPwVal(""); }} style={actBtn}>{t.rd_prd_cancel}</button>
                        </div>
                      )}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6, paddingTop: 9, borderTop: "1px solid var(--border)" }}>
                        <button onClick={() => openEdit(u.email)} style={{ ...actBtn, color: "var(--accent-fg)", borderColor: "var(--accent)" }} disabled={!actions}>{t.rd_set_edit}</button>
                        <button onClick={() => { setPwIdx(pwIdx === i ? null : i); setPwVal(""); }} style={actBtn} disabled={!actions}>{t.rd_adm_reset_pw}</button>
                        <button onClick={() => void run(isAdmin ? t.rd_adm_act_remove_admin : t.rd_adm_act_make_admin, u.email, () => actions!.setRole(u.email, isAdmin ? "seller" : "admin"))} style={actBtn} disabled={!actions}>{isAdmin ? t.rd_adm_remove_admin : t.rd_adm_make_admin}</button>
                        <button onClick={() => void run(t.rd_adm_act_expire, u.email, () => actions!.expire(u.email))} style={{ ...actBtn, color: "var(--warn)" }} disabled={!actions}>{t.rd_adm_expire}</button>
                        <button onClick={() => void run(t.rd_adm_act_delete, u.email, () => actions!.removeUser(u.email))} style={{ ...actBtn, color: "var(--danger)" }} disabled={!actions}>{t.rd_prd_delete_btn}</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* C2 (audit) — the "plans" and "payments" panels were removed here:
              permanently-fake sample data with no backend by design. */}

          {panel === "reports" && (
            <div>
              <SampleNote />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                <div style={miniStat}><div style={miniLbl}>{t.rd_adm_mrr}</div><div style={miniNum}>{cur}4.2M</div></div>
                <div style={miniStat}><div style={miniLbl}>{t.rd_adm_growth}</div><div style={{ ...miniNum, color: "var(--ok)" }}>+12%</div></div>
                <div style={miniStat}><div style={miniLbl}>{t.rd_adm_churn}</div><div style={{ ...miniNum, color: "var(--warn)" }}>2.1%</div></div>
                <div style={miniStat}><div style={miniLbl}>{t.rd_adm_arpu}</div><div style={miniNum}>{cur}340</div></div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 9 }}>{t.rd_adm_reports_h}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[t.rd_adm_rep_revplan, t.rd_adm_rep_growth, t.rd_adm_rep_churn].map((r) => (
                  <button key={r} disabled title={t.rd_adm_coming_soon} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 13px", border: "1px solid var(--border)", borderRadius: 11, background: "var(--surface-2)", fontFamily: "var(--font-ui)", ...deadBtn }}><span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{r}</span><span style={{ color: "var(--text-muted)" }}>›</span></button>
                ))}
              </div>
              <button disabled title={t.rd_adm_coming_soon} style={{ ...sheetBtn, marginTop: 13, padding: "12px 0", borderRadius: 11, fontSize: 13, ...deadBtn }}>{t.rd_cd_export_csv}</button>
            </div>
          )}

          {panel === "system" && (
            <div>
              <SampleNote />
              <div style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.5, marginBottom: 15 }}>{t.rd_adm_sys_desc_pre}<strong>{t.rd_adm_pt_sellers}</strong>{t.rd_adm_sys_desc_post}</div>
              <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 6 }}>{t.rd_adm_amount_paid}</label>
              <div style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface-2)", padding: "0 13px", marginBottom: 14 }}>
                <span style={{ fontFamily: mono, fontSize: 15, fontWeight: 700, color: "var(--text-muted)" }}>{cur}</span>
                <input value={assignAmount} onChange={(e) => onAssignAmount(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" style={{ flex: 1, border: "none", background: "transparent", color: "var(--text)", fontFamily: mono, fontSize: 15, fontWeight: 700, padding: "12px 0", outline: "none" }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--accent-soft)", border: "1px solid var(--accent)", borderRadius: 13, padding: "13px 15px", marginBottom: 16 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)" }}>{t.rd_adm_matched_plan}</span>
                <span style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 700, color: "var(--accent-fg)" }}>{matchPlan(assignAmount)}</span>
              </div>
              <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 6 }}>{t.rd_adm_assign_seller}</label>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface-2)", padding: "12px 13px", marginBottom: 16 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-muted)" }}>{t.rd_adm_select_seller}</span><span style={{ color: "var(--text-muted)" }}>▾</span>
              </div>
              <button disabled title={t.rd_adm_coming_soon} style={{ ...sheetBtn, ...deadBtn }}>{tpl(t.rd_adm_grant, { plan: matchPlan(assignAmount) })}</button>
            </div>
          )}

          {panel === "broadcast" && (
            <div>
              {/* Announcements — publishes the banner + 🔔 bell entry every seller
                  sees. Real when the ann hook is wired; sample note otherwise. */}
              {!ann && <SampleNote />}
              <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 8 }}>{t.rd_ann_active_now}</label>
              {annActive ? (
                <div style={{ border: "1px solid var(--accent)", borderRadius: 12, background: "var(--surface-2)", padding: "11px 12px", marginBottom: 15 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)", marginBottom: 5 }}>{annDate(annActive.createdAt)}</div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)", lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginBottom: 9 }}>{annActive.message}</div>
                  <button disabled={annBusy} onClick={() => void doAnn(t.rd_ann_unpublish, () => ann!.unpublish(annActive.id))} style={{ ...actBtn, color: "var(--danger)", opacity: annBusy ? 0.6 : 1 }}>{t.rd_ann_unpublish}</button>
                </div>
              ) : (
                <div style={{ border: "1px dashed var(--border-strong)", borderRadius: 12, padding: "13px 12px", fontSize: 12, color: "var(--text-muted)", marginBottom: 15 }}>{ann?.loading ? t.rd_ann_loading : t.rd_ann_none}</div>
              )}
              <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 8 }}>{t.rd_adm_audience}</label>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 15 }}>
                <span style={chipOn}>{t.rd_adm_all_sellers}</span>
              </div>
              {annStage !== "preview" ? (
                <>
                  <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 6 }}>{t.rd_adm_message}</label>
                  <textarea value={annMsg} onChange={(e) => setAnnMsg(e.target.value)} placeholder={t.rd_adm_announce_ph} rows={4} disabled={annStage === "translating"} style={{ ...editTa, minHeight: 84, marginBottom: 8 }} />
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 13, lineHeight: 1.45 }}>{t.rd_ann_auto_note}</div>
                  {annErr && (
                    <div style={{ border: "1px solid var(--danger)", background: "var(--surface-2)", borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
                      {/* U9 — a 403 "forbidden" means the caller isn't admin: retrying just 403s
                          again, so show a distinct message and hide the (useless) Retry. */}
                      <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--danger)", marginBottom: 8, lineHeight: 1.45 }}>{annErr === "forbidden" ? t.rd_ann_forbidden : tpl(t.rd_ann_translate_fail, { err: annErr })}</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {annErr !== "forbidden" && <button disabled={annBusy || !annMsg.trim()} onClick={() => void startTranslate()} style={{ ...actBtn, opacity: annBusy ? 0.6 : 1 }}>{t.rd_ann_retry}</button>}
                        <button disabled={annBusy || !annMsg.trim()} onClick={sendEnglishOnly} style={{ ...actBtn, opacity: annBusy ? 0.6 : 1 }}>{t.rd_ann_english_only}</button>
                      </div>
                    </div>
                  )}
                  <button disabled={!ann || annBusy || !annMsg.trim()} onClick={() => void startTranslate()} style={{ ...sheetBtn, ...(!ann || annBusy || !annMsg.trim() ? deadBtn : {}) }}>
                    {annStage === "translating" ? t.rd_ann_translating : t.rd_ann_translate_btn}
                  </button>
                </>
              ) : (
                <div>
                  <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 8 }}>{t.rd_ann_preview_title}</label>
                  <div className="sfl-scroll" style={{ maxHeight: 300, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 12, padding: "4px 2px", marginBottom: 13 }}>
                    {annPreview && annLangRows(annPreview).map((r) => (
                      <div key={r.code} style={{ padding: "9px 11px", borderBottom: "1px solid var(--border)" }}>
                        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".04em", color: "var(--text-muted)", marginBottom: 4, textTransform: "uppercase" }}>{r.flag} {r.label}</div>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)", lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{r.text}</div>
                      </div>
                    ))}
                  </div>
                  <button disabled={annBusy} onClick={confirmSend} style={{ ...sheetBtn, ...(annBusy ? deadBtn : {}), marginBottom: 9 }}>{t.rd_ann_confirm_send}</button>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button disabled={annBusy} onClick={editBack} style={{ ...actBtn, flex: 1, textAlign: "center", opacity: annBusy ? 0.6 : 1 }}>{t.rd_ann_edit}</button>
                    <button disabled={annBusy} onClick={sendEnglishOnly} style={{ ...actBtn, flex: 1, textAlign: "center", opacity: annBusy ? 0.6 : 1 }}>{t.rd_ann_english_only}</button>
                  </div>
                </div>
              )}
              {ann && ann.list.length > 0 && (
                <div style={{ marginTop: 17 }}>
                  <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 4 }}>{t.rd_ann_title}</label>
                  {ann.list.slice(0, 5).map((a) => (
                    <div key={a.id} style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "8px 2px", borderBottom: "1px solid var(--border)" }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)", flexShrink: 0 }}>{annDate(a.createdAt)}</span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: a.active ? "var(--text)" : "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.message}</span>
                      {a.messageI18n && <span title={t.rd_ann_langs_badge} style={{ fontSize: 9, fontWeight: 800, color: "var(--text-muted)", background: "var(--surface-2)", border: "1px solid var(--border)", padding: "2px 6px", borderRadius: 6, flexShrink: 0 }}>{t.rd_ann_langs_badge}</span>}
                      {a.active && <span style={{ fontSize: 9.5, fontWeight: 800, color: "var(--accent-fg)", background: "var(--accent-soft)", padding: "2px 7px", borderRadius: 6, flexShrink: 0 }}>{t.rd_ann_active_now}</span>}
                      <button aria-label={t.rd_ann_delete} title={t.rd_ann_delete} disabled={annBusy} onClick={() => delAnn(a.id)} style={{ flexShrink: 0, background: "none", border: "none", padding: "0 2px", cursor: annBusy ? "not-allowed" : "pointer", color: "var(--danger)", fontSize: 13, opacity: annBusy ? 0.5 : 1, lineHeight: 1 }}>🗑</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {panel === "subActive" && (realSubs
            ? <SellerSubList list={subB.active} statusLabel={t.rd_adm_st_active} statusColor="var(--ok)" note={tpl(subB.active.length === 1 ? t.rd_adm_note_active_one : t.rd_adm_note_active_many, { n: subB.active.length })} />
            : <SubList list={SUBS.active} statusLabel={t.rd_adm_st_active} statusColor="var(--ok)" note={t.rd_adm_note_active_sample} />)}
          {panel === "subExpiring" && (realSubs
            ? <SellerSubList list={subB.expiring} statusLabel={t.rd_adm_st_expiring} statusColor="var(--warn)" note={tpl(t.rd_adm_note_expiring, { n: subB.expiring.length })} />
            : <SubList list={SUBS.expiring} statusLabel={t.rd_adm_st_expiring} statusColor="var(--warn)" note={t.rd_adm_note_expiring_sample} />)}
          {panel === "subFree" && (realFree
            ? <FreeUserList list={freeUsers} />
            : <SubList list={SUBS.free} statusLabel={t.rd_adm_st_free} statusColor="var(--accent-fg)" note={t.rd_adm_note_free_sample} showPlan={false} />)}
          {panel === "subExpired" && (realSubs
            ? <SellerSubList list={subB.expired} statusLabel={t.rd_adm_st_expired} statusColor="var(--danger)" note={tpl(t.rd_adm_note_expired, { n: subB.expired.length })} />
            : <SubList list={SUBS.expired} statusLabel={t.rd_adm_st_expired} statusColor="var(--danger)" note={t.rd_adm_note_expired_sample} />)}

          {panel === "notifs" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              <SampleNote />
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 2 }}>{t.rd_adm_notif_sub}</div>
              {NOTIFS.map((n, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: "11px 12px", border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface-2)" }}>
                  <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".02em", color: n.ink, background: n.tint, padding: "4px 7px", borderRadius: 6, flexShrink: 0, marginTop: 1 }}>{n.kind}</span>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{n.title}</div><div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>{n.sub}</div></div>
                </div>
              ))}
            </div>
          )}

          {panel === "revenue" && !isIOS() && (
            <div>
              <SampleNote />
              <div style={{ background: "var(--accent)", borderRadius: 14, padding: 15, color: "#fff", boxShadow: "0 8px 22px var(--accent-soft)" }}>
                <div style={{ fontSize: 11.5, opacity: 0.9, fontWeight: 600 }}>{t.rd_adm_rev_thismonth}</div>
                <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 28, marginTop: 4, letterSpacing: "-.02em" }}>{cur}4.2M</div>
                <div style={{ fontSize: 11.5, opacity: 0.92, marginTop: 2 }}>{t.rd_adm_rev_vslast}</div>
              </div>
              <div style={{ display: "flex", gap: 9, marginTop: 12 }}>
                <div style={{ flex: 1, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12, padding: "11px 12px" }}><div style={{ fontSize: 10.5, color: "var(--text-muted)", fontWeight: 600 }}>{t.rd_adm_platform_fees}</div><div style={{ fontFamily: mono, fontWeight: 700, fontSize: 15, color: "var(--text)", marginTop: 2 }}>{cur}1.05M</div></div>
                <div style={{ flex: 1, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12, padding: "11px 12px" }}><div style={{ fontSize: 10.5, color: "var(--text-muted)", fontWeight: 600 }}>{t.rd_adm_net_profit}</div><div style={{ fontFamily: mono, fontWeight: 700, fontSize: 15, color: "var(--ok)", marginTop: 2 }}>{cur}3.15M</div></div>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 11, background: "var(--accent-soft)", border: "1px solid var(--accent)", borderRadius: 12, padding: "11px 13px" }}>
                <div><div style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 600 }}>{t.rd_adm_detected}</div><div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 1 }}>{t.rd_adm_rev_live}</div></div>
                <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 17, color: "var(--accent-fg)" }}>+{cur}{revAdded.toLocaleString("en-US")}</div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", margin: "14px 2px 9px" }}>{t.rd_adm_rev_by_plan}</div>
              <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 13, overflow: "hidden" }}>
                {[{ plan: "Starter", subs: "4,120", price: cur + "199", total: cur + "820K" }, { plan: "Pro", subs: "5,310", price: cur + "499", total: cur + "2.65M" }, { plan: "Business", subs: "412", price: cur + "1,499", total: cur + "618K" }].map((r) => (
                  <div key={r.plan} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 13px", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{r.plan}</div><div style={{ fontSize: 11, color: "var(--text-muted)" }}>{r.subs} {t.rd_adm_subscribers} · {r.price}/mo</div></div>
                    <div style={{ fontFamily: mono, fontSize: 14, fontWeight: 700, color: "var(--text)", flexShrink: 0 }}>{r.total}</div>
                  </div>
                ))}
              </div>
              <button disabled title={t.rd_adm_coming_soon} style={{ ...sheetBtn, marginTop: 13, padding: "12px 0", borderRadius: 11, fontSize: 13, ...deadBtn }}>{t.rd_adm_export_rev}</button>
            </div>
          )}

          {panel === "userbase" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {!realSubs && <SampleNote />}
              {/* Headline — Paid vs Free */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div style={{ background: "var(--accent)", borderRadius: 14, padding: "14px 15px", color: "#fff", boxShadow: "0 8px 22px var(--accent-soft)" }}>
                  <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 30, letterSpacing: "-.02em" }}>{userBase.paid}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.95 }}>{t.rd_adm_paid_plans}</div>
                  <div style={{ fontSize: 10.5, opacity: 0.85, marginTop: 2 }}>{tpl(userBase.paidSellers === 1 ? t.rd_adm_paying_plus_one : t.rd_adm_paying_plus_many, { n: userBase.paidSellers })}</div>
                </div>
                <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 14, padding: "14px 15px" }}>
                  <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 30, color: "var(--accent-fg)", letterSpacing: "-.02em" }}>{userBase.free}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{t.rd_sub_free_tier}</div>
                  <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 2 }}>{tpl(t.rd_adm_accounts_total, { n: userBase.total })}</div>
                </div>
              </div>

              {/* Paid plans by tier */}
              <div style={{ ...card, padding: "14px 15px" }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)", marginBottom: 11 }}>{t.rd_adm_paid_by_tier}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {([["Basic", userBase.basic, "#059669"], ["Pro", userBase.pro, "#0284c7"], ["Master", userBase.master, "#7c3aed"]] as const).map(([name, n, col]) => (
                    <div key={name}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)" }}>{name}{name === "Master" ? t.rd_adm_incl_you : ""}</span>
                        <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{n}</span>
                      </div>
                      <div style={{ height: 7, borderRadius: 4, background: "var(--surface-2)", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${Math.round((n / maxTier) * 100)}%`, background: col, borderRadius: 4 }} />
                      </div>
                    </div>
                  ))}
                  {userBase.trial > 0 && <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{t.rd_adm_trial} <strong style={{ color: "var(--text)" }}>{userBase.trial}</strong></div>}
                </div>
              </div>

              {/* Paid status health (real expiry-based) */}
              <div style={{ ...card, padding: "13px 15px" }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)", marginBottom: 9 }}>{t.rd_adm_paid_status}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {([[t.rd_adm_st_active, userBase.paidActive, "var(--ok)"], [t.rd_adm_expiring_7d, userBase.paidExpiring, "var(--warn)"], [t.rd_adm_st_expired, userBase.paidExpired, "var(--danger)"]] as const).map(([l, n, c]) => (
                    <div key={l} style={{ flex: 1, textAlign: "center", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 0" }}>
                      <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 17, color: c }}>{n}</div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, marginTop: 2 }}>{l}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Free-tier cap usage (from list_free_users_status) */}
              <div style={{ ...card, padding: "13px 15px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 9 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)" }}>{t.rd_adm_free_cap_usage}</span>
                  {freeSummary.total > 0 && <button onClick={() => onOpenPanel?.("subFree")} style={{ ...planBtn }}>{t.rd_adm_view}</button>}
                </div>
                {realFree ? (
                  <div style={{ display: "flex", gap: 8 }}>
                    {([[t.rd_adm_free_users, freeSummary.total, "var(--accent-fg)"], [t.rd_adm_near_cap, freeSummary.nearCap, "var(--warn)"], [t.rd_adm_capped, freeSummary.capped, "var(--danger)"]] as const).map(([l, n, c]) => (
                      <div key={l} style={{ flex: 1, textAlign: "center", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 0" }}>
                        <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 17, color: c }}>{n}</div>
                        <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, marginTop: 2 }}>{l}</div>
                      </div>
                    ))}
                  </div>
                ) : <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{tpl(t.rd_adm_free_loads, { cap: freeSummary.cap })}</div>}
              </div>
            </div>
          )}

          {panel === "audit" && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 11, padding: "9px 12px" }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="var(--text-muted)" strokeWidth="1.8" /><path d="m20 20-3.5-3.5" stroke="var(--text-muted)" strokeWidth="1.8" strokeLinecap="round" /></svg>
                  <input value={auditQ} onChange={(e) => setAuditQ(e.target.value)} placeholder={t.rd_adm_audit_search} style={{ flex: 1, border: "none", background: "transparent", color: "var(--text)", fontSize: 12.5, outline: "none", fontFamily: "var(--font-ui)" }} />
                </div>
                {auditLogs.length > 0 && <button onClick={exportAudit} title={t.rd_exp_audit_note} style={{ ...actBtn, color: "var(--accent-fg)", borderColor: "var(--accent)" }}>{t.rd_adm_csv}</button>}
              </div>
              {/* #7 export-scope label: the loader reads the last 80 entries only */}
              {auditLogs.length > 0 && <div style={{ fontSize: 10.5, color: "var(--text-muted)", margin: "6px 2px 0" }}>{t.rd_exp_audit_note}</div>}
              {auditState === "loading" && <div style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "10px 2px" }}>{t.rd_adm_loading_audit}</div>}
              {auditState !== "loading" && auditFiltered.length === 0 && <div style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "10px 2px" }}>{auditLogs.length === 0 ? t.rd_adm_no_activity : t.rd_adm_no_records}</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {auditFiltered.map((log) => {
                  const tint = auditTint(auditActionColor(log.action));
                  return (
                    <div key={log.id} style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface-2)", padding: "10px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".02em", color: tint, background: "var(--surface)", border: "1px solid var(--border)", padding: "3px 8px", borderRadius: 6 }}>{log.action}</span>
                        <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--text-muted)", whiteSpace: "nowrap", fontFamily: mono }}>{new Date(log.timestamp).toLocaleString()}</span>
                      </div>
                      <div style={{ fontSize: 12.5, color: "var(--text)" }}><strong>{log.actorEmail}</strong>{log.targetEmail ? <> → {log.targetEmail}</> : null}</div>
                      {log.details && <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{log.details}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* WEB-ONLY (defensive: the tile is hidden in the app shell, but guard the
              body too so the panel never renders on a phone / APK / iOS). */}
          {panel === "pulse" && !isAppShell() && <PulsePanel pulse={pulse} state={pulseState} onRefresh={onRefreshPulse} />}

        </div>
      </div>

      {/* Edit accounts modal (Option B) — centered overlay ABOVE the sheet (z 30 > 9).
          Backdrop / X / Cancel close without saving. Writes only tiktok/facebook. */}
      {editEmail && (
        <div onClick={(e) => { e.stopPropagation(); closeEdit(); }} style={{ position: "absolute", inset: 0, zIndex: 30, background: "rgba(8,6,24,.6)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 360, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, boxShadow: "0 24px 60px rgba(0,0,0,.45)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "15px 16px 12px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "var(--text)" }}>{t.rd_adm_edit_accounts}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{editEmail}</div>
              </div>
              <button onClick={closeEdit} style={{ width: 30, height: 30, borderRadius: 9, border: "none", background: "var(--surface-2)", color: "var(--text-dim)", fontSize: 16, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
            </div>
            <div style={{ padding: "14px 16px" }}>
              <label style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-dim)", display: "block", marginBottom: 6 }}>{t.rd_adm_tiktok_accounts}</label>
              <textarea value={editTt} onChange={(e) => setEditTt(e.target.value)} rows={3} placeholder={t.rd_adm_one_per_line} style={editTa} />
              <label style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-dim)", display: "block", margin: "12px 0 6px" }}>{t.rd_adm_fb_pages}</label>
              <textarea value={editFb} onChange={(e) => setEditFb(e.target.value)} rows={3} placeholder={t.rd_adm_one_per_line} style={editTa} />
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>{tpl(t.rd_adm_edit_helper, { n: editLimit })}</div>
            </div>
            <div style={{ display: "flex", borderTop: "1px solid var(--border)" }}>
              <button onClick={closeEdit} style={{ flex: 1, padding: "13px 0", border: "none", borderRight: "1px solid var(--border)", background: "transparent", color: "var(--text-dim)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>{t.rd_prd_cancel}</button>
              <button onClick={doEditAccounts} disabled={busy || !editRaw} style={{ flex: 1, padding: "13px 0", border: "none", background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy || !editRaw ? 0.6 : 1 }}>{t.rd_adm_save_accounts}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
