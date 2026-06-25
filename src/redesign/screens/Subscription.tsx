// Screen 8 — Subscription (plan card + renew via Telegram). dc.html v2 L692–730.
// Phase 5b: reads the REAL plan + expiry from the signed-in profile; prices are
// the real Taiwan tiers via PLAN_PRICE (Basic 500 · Pro 1,200 · Master 1,700).
// Renew stays a manual Wise + Telegram flow (no billing API).
import { headerBar, headerTitle, mono } from "../ui";
import { PLAN_PRICE, fmt } from "../data";
import { planLabel } from "../adapters/useAuthSession";
import type { AccountUser } from "../../accountDb";

const tgPlane = <svg width="19" height="19" viewBox="0 0 24 24" fill="#fff"><path d="M21.5 4.3 3.2 11.4c-1 .4-1 1.8.1 2.1l4.6 1.4 1.8 5.6c.2.7 1.1.9 1.6.3l2.5-2.6 4.7 3.4c.6.4 1.4.1 1.6-.6l3-15c.2-1-.7-1.8-1.6-1.3Z" /></svg>;
const check = <span style={{ color: "var(--ok)", fontWeight: 800 }}>✓</span>;

const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
const daysLeft = (iso: string): number => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 0;
  return Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86400000));
};

export default function Subscription({ cur, account = null }: { cur: string; account?: AccountUser | null }) {
  // Real profile → plan/price/status/expiry; demo fallback when signed out.
  const plan = account ? planLabel(account.plan) : "Pro";
  const price = account ? (PLAN_PRICE[plan] ?? 0) : PLAN_PRICE["Pro"];
  const status = account ? account.planStatus : "active";
  const expiry = account ? account.planExpiry : "2026-07-28T00:00:00.000Z";
  const statusLabel = status === "active" ? "ACTIVE" : status === "expired" ? "EXPIRED" : "PENDING";
  const priceLine = price > 0 ? `${cur}${fmt(price)} / month` : "Free tier";
  return (
    <div>
      <div style={headerBar}><div style={headerTitle}>Subscription</div></div>
      <div style={{ padding: "16px 14px 22px" }}>
        <div style={{ background: "linear-gradient(150deg,var(--accent),var(--accent))", borderRadius: 18, padding: 20, color: "#fff", position: "relative", overflow: "hidden", boxShadow: "0 10px 28px var(--accent-soft)" }}>
          <div style={{ position: "absolute", width: 140, height: 140, borderRadius: "50%", background: "rgba(255,255,255,.14)", top: -50, right: -30 }} />
          <div style={{ position: "relative" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".06em", opacity: 0.9 }}>CURRENT PLAN</span>
              <span style={{ fontSize: 11, fontWeight: 800, background: "rgba(255,255,255,.22)", padding: "4px 9px", borderRadius: 7 }}>{statusLabel}</span>
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 30, marginTop: 8, letterSpacing: "-.02em" }}>{plan}</div>
            <div style={{ fontFamily: mono, fontSize: 14, fontWeight: 600, opacity: 0.92, marginTop: 2 }}>{priceLine}</div>
            <div style={{ display: "flex", gap: 18, marginTop: 18 }}>
              <div><div style={{ fontSize: 11, opacity: 0.85 }}>Renews on</div><div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{fmtDate(expiry)}</div></div>
              <div><div style={{ fontSize: 11, opacity: 0.85 }}>Days left</div><div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{daysLeft(expiry)} days</div></div>
            </div>
          </div>
        </div>

        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 15, boxShadow: "var(--shadow)", marginTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 11 }}>Included in {plan}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {["Unlimited live sessions", "Auto \"mine\" detection & order slips", "TikTok + Facebook channels", "Printer & shipping tools"].map((f) => (
              <div key={f} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: "var(--text-dim)" }}>{check} {f}</div>
            ))}
          </div>
        </div>

        <button style={{ width: "100%", marginTop: 16, padding: "14px 0", border: "none", borderRadius: 13, background: "#0088cc", color: "#fff", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 9, boxShadow: "0 6px 16px rgba(0,136,204,.35)" }}>
          {tgPlane} Renew via Telegram
        </button>
        <div style={{ textAlign: "center", fontSize: 11.5, color: "var(--text-muted)", marginTop: 10 }}>Message <span style={{ fontWeight: 700, color: "var(--accent-fg)" }}>@SellerFlowSupport</span> to renew or upgrade</div>
      </div>
    </div>
  );
}
