// Left brand panel for the web-landing auth pop-up (AuthModal). PURELY VISUAL — no auth,
// no state. Deep-plum gradient + the REAL SellerFlowLive bag logo (/icon-192.png) +
// wordmark + tagline (reuses rd_lp_hero_l1/l2) + 3 gold checkmarks (reuses production
// lp_feat_*_t titles). Hidden on narrow screens via CSS (.sfl-authbrand display:none);
// only shows in the ≥720px split. Renders ONLY inside the web landing modal → APK never
// shows it.
import { useT } from "../i18n";

const gold = "#FBBF24";

function Check({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: "rgba(251,191,36,.16)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={gold} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      <span style={{ fontSize: 14.5, fontWeight: 600, color: "rgba(255,255,255,.92)" }}>{label}</span>
    </div>
  );
}

export default function AuthBrandPanel() {
  const t = useT();
  return (
    <div
      className="sfl-authbrand"
      style={{
        flexDirection: "column",
        justifyContent: "space-between",
        gap: 28,
        padding: "36px 32px",
        background: "linear-gradient(160deg, #2E1065 0%, #4F2DD8 100%)",
        color: "#fff",
      }}
    >
      {/* logo + wordmark */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <img
          src="/icon-192.png"
          alt="SellerFlowLive"
          style={{ width: 44, height: 44, borderRadius: 12, objectFit: "cover", boxShadow: "0 8px 20px rgba(0,0,0,.28)" }}
        />
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 20, letterSpacing: "-.01em" }}>SellerFlowLive</span>
      </div>

      {/* tagline */}
      <div>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 32, lineHeight: 1.12, letterSpacing: "-.02em" }}>
          {t.rd_lp_hero_l1}
          <br />
          <span style={{ color: gold }}>{t.rd_lp_hero_l2}</span>
        </div>
      </div>

      {/* 3 feature checkmarks (reused copy) */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Check label={t.lp_feat_capture_t} />
        <Check label={t.lp_feat_print_t} />
        <Check label={t.lp_feat_orders_t} />
      </div>
    </div>
  );
}
