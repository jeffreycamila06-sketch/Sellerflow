// Screen 8 — Subscription (plan card + renew via Telegram). dc.html v2 L692–730.
// Phase 5b: reads the REAL plan + expiry from the signed-in profile; prices are
// the real Taiwan tiers via PLAN_PRICE (Basic 500 · Pro 1,200 · Master 1,700).
// Renew stays a manual Wise + Telegram flow (no billing API).
import { headerBar, headerTitle, mono } from "../ui";
import { planLabel } from "../adapters/useAuthSession";
import { useT, tpl } from "../i18n";
import type { AccountUser } from "../../accountDb";
import type { FreeStatus } from "../adapters/useFreeCap";
import { planDaysLeft, daysDisplay } from "../../lib/planWindow";
import { TELEGRAM_HANDLE, TELEGRAM_URL } from "../../lib/telegram";

const tgPlane = <svg width="19" height="19" viewBox="0 0 24 24" fill="#fff"><path d="M21.5 4.3 3.2 11.4c-1 .4-1 1.8.1 2.1l4.6 1.4 1.8 5.6c.2.7 1.1.9 1.6.3l2.5-2.6 4.7 3.4c.6.4 1.4.1 1.6-.6l3-15c.2-1-.7-1.8-1.6-1.3Z" /></svg>;
const check = <span style={{ color: "var(--ok)", fontWeight: 800 }}>✓</span>;

// Date FORMATTING only (presentation, not expiry math — that lives in
// lib/planWindow, the single source of truth per the 2026-07-04 rule).
const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
// Shared planDaysLeft replaces the private 4th expiry copy that rendered a
// NULL/invalid expiry as "0 days left": missing/invalid → Infinity (no expiry)
// → daysDisplay(∞) = "—". Finite negatives clamp to 0 for display (an expired
// plan shows "0", same as before — the status chip already says Expired).
const daysLeftDisplay = (iso: string): string =>
  daysDisplay(Math.max(0, planDaysLeft(iso, Date.now())));

export default function Subscription({ account = null, isFreeUser = false, freeStatus = null }: { cur: string; account?: AccountUser | null; isFreeUser?: boolean; freeStatus?: FreeStatus | null }) {
  const t = useT();
  // Real profile → plan/status/expiry; demo fallback when signed out. (The price
  // line was removed from the card per owner request — plan/price DATA is unchanged;
  // only its display on this card is hidden, on web + Android. iOS never mounts this
  // screen at all — RedesignApp gates it behind `!ios` — so iOS is unaffected.)
  const plan = account ? planLabel(account.plan) : "Pro";
  const status = account ? account.planStatus : "active";
  const expiry = account ? account.planExpiry : "2026-07-28T00:00:00.000Z";
  const statusLabel = status === "active" ? t.rd_sub_active : status === "expired" ? t.rd_sub_expired : t.rd_sub_pending;
  return (
    <div>
      <div style={headerBar}><div style={headerTitle}>{t.rd_sub_title}</div></div>
      <div style={{ padding: "16px 14px 22px" }}>
        <div style={{ background: "linear-gradient(150deg,var(--accent),var(--accent))", borderRadius: 18, padding: 20, color: "#fff", position: "relative", overflow: "hidden", boxShadow: "0 10px 28px var(--accent-soft)" }}>
          <div style={{ position: "absolute", width: 140, height: 140, borderRadius: "50%", background: "rgba(255,255,255,.14)", top: -50, right: -30 }} />
          <div style={{ position: "relative" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".06em", opacity: 0.9 }}>{t.rd_sub_current}</span>
              <span style={{ fontSize: 11, fontWeight: 800, background: "rgba(255,255,255,.22)", padding: "4px 9px", borderRadius: 7 }}>{statusLabel}</span>
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 30, marginTop: 8, letterSpacing: "-.02em" }}>{plan}</div>
            <div style={{ display: "flex", gap: 18, marginTop: 18 }}>
              <div><div style={{ fontSize: 11, opacity: 0.85 }}>{t.rd_sub_renews}</div><div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{fmtDate(expiry)}</div></div>
              <div><div style={{ fontSize: 11, opacity: 0.85 }}>{t.rd_sub_days_left}</div><div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{daysLeftDisplay(expiry) === "—" ? "—" : `${daysLeftDisplay(expiry)} ${t.rd_sub_days_unit}`}</div></div>
            </div>
          </div>
        </div>

        {isFreeUser && freeStatus && (() => {
          const cnt = freeStatus.count ?? 0, fcap = freeStatus.cap ?? 100, rd = freeStatus.cycle_resets_in_days ?? 30;
          const pct = Math.min(100, Math.round((cnt / Math.max(1, fcap)) * 100));
          const barColor = freeStatus.capped ? "var(--danger)" : freeStatus.near_cap ? "var(--warn)" : "var(--ok)";
          return (
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 15, boxShadow: "var(--shadow)", marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{t.rd_sub_free_orders}</span>
                <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: barColor }}>{cnt} / {fcap}</span>
              </div>
              <div style={{ height: 8, borderRadius: 6, background: "var(--surface-2)", overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: barColor, transition: "width .2s" }} />
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 8 }}>{tpl(rd === 1 ? t.rd_sub_resets_one : t.rd_sub_resets_many, { n: rd })}</div>
            </div>
          );
        })()}

        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 15, boxShadow: "var(--shadow)", marginTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 11 }}>{tpl(t.rd_sub_included, { plan })}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {[t.rd_sub_f1, t.rd_sub_f2, t.rd_sub_f3, t.rd_sub_f4].map((f) => (
              <div key={f} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: "var(--text-dim)" }}>{check} {f}</div>
            ))}
          </div>
        </div>

        <a href={TELEGRAM_URL} target="_blank" rel="noreferrer" style={{ width: "100%", marginTop: 16, padding: "14px 0", border: "none", borderRadius: 13, background: "#0088cc", color: "#fff", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 9, textDecoration: "none", boxShadow: "0 6px 16px rgba(0,136,204,.35)" }}>
          {tgPlane} {t.rd_sub_renew_tg}
        </a>
        <div style={{ textAlign: "center", fontSize: 11.5, color: "var(--text-muted)", marginTop: 10 }}>{t.rd_sub_msg_pre}<span style={{ fontWeight: 700, color: "var(--accent-fg)" }}>{TELEGRAM_HANDLE}</span>{t.rd_sub_msg_post}</div>
      </div>
    </div>
  );
}
