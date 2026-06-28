// Public marketing landing (web only — NEVER shown in the APK; gated by isAppShell
// in RedesignApp). Recreated from design-landing/ handoff (README authoritative) in
// React with the redesign FONT tokens; colors use the handoff's fixed light-indigo
// palette so the marketing page looks consistent regardless of a visitor's saved
// theme/accent. support.js is NOT used. STEP La = nav + hero + footer; the marketing
// sections (features / how / pricing / faq / cta) land in Step Lb.
import { useState, type CSSProperties } from "react";
import { LANGS } from "../data";
import { useT, tpl } from "../i18n";

// Handoff palette (README → "all hex values are authoritative"; indigo only).
const C = {
  bg: "#FAFAFE", card: "#FFFFFF", border: "#ECECF5", border2: "#E0DDF0",
  ink: "#171530", body: "#4A4860", muted: "#6A6880", faint: "#8A88A0",
  indigo: "#4F46E5", indigo2: "#6366F1", indigo3: "#818CF8",
  pill: "#EFEEFE", pillBorder: "#E0DDFA",
  green: "#10B981", rose: "#F43F5E", tg: "#27A7E7",
  grad: "linear-gradient(135deg, #4F46E5, #6366F1)",
  heroGrad: "linear-gradient(120deg, #4F46E5, #6366F1 60%, #818CF8)",
};
const FD = "var(--font-display)"; const FU = "var(--font-ui)"; const FM = "var(--font-mono)";

const footHead: CSSProperties = { fontSize: 12, fontWeight: 800, letterSpacing: ".06em", color: "#fff", marginBottom: 12 };
const footLink: CSSProperties = { display: "block", background: "none", border: "none", cursor: "pointer", padding: "5px 0", fontFamily: FU, fontSize: 13.5, color: "#9d9bc0", textAlign: "left" };
const footLinkA: CSSProperties = { display: "block", padding: "5px 0", fontFamily: FU, fontSize: 13.5, color: "#9d9bc0", textDecoration: "none" };

const primaryBtn: CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "0 22px", height: 54, borderRadius: 14, border: "none", background: C.grad, color: "#fff", fontFamily: FU, fontSize: 15.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 16px 30px -10px rgba(79,70,229,.5)", textDecoration: "none" };
const ghostBtn: CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "0 20px", height: 54, borderRadius: 14, background: "#fff", color: C.ink, border: `1px solid ${C.border2}`, fontFamily: FU, fontSize: 15.5, fontWeight: 700, cursor: "pointer", textDecoration: "none" };

export default function Landing({
  onLogin, onSignup, lang, langOpen, onToggleLang, onPickLang,
}: {
  onLogin: () => void;
  onSignup: () => void;
  lang: string;
  langOpen: boolean;
  onToggleLang: () => void;
  onPickLang: (code: string) => void;
}) {
  const t = useT();
  const cur = LANGS.find((l) => l.code === lang) || LANGS[0];
  const [faqOpen, setFaqOpen] = useState(-1); // single-open accordion (-1 = none)
  // Smooth-scroll to an in-page section. Robust inside the .sfl-scroll container
  // (anchor hrefs are unreliable there), so nav links + "See how it works" use this.
  const scrollToId = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const navLink: CSSProperties = { background: "none", border: "none", cursor: "pointer", fontFamily: FU, fontSize: 14.5, fontWeight: 600, color: C.body, padding: "0 4px" };

  const ic = (p: string) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.indigo} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={p} /></svg>;
  // Feature cards — titles reuse lp_feat_*_t (already 7-lang); descriptions are new
  // rd_lp_feat_*_d (handoff copy). Icon tints are the handoff's authoritative hex.
  const FEATURES = [
    { title: t.lp_feat_print_t, desc: t.rd_lp_feat_print_d, tint: "#EEF2FF", icon: ic("M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z") },
    { title: t.lp_feat_capture_t, desc: t.rd_lp_feat_capture_d, tint: "#FEF2F4", icon: ic("M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z") },
    { title: t.lp_feat_orders_t, desc: t.rd_lp_feat_orders_d, tint: "#ECFDF5", icon: ic("M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11") },
    { title: t.lp_feat_db_t, desc: t.rd_lp_feat_db_d, tint: "#EFF6FF", icon: ic("M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8") },
    { title: t.lp_feat_bt_t, desc: t.rd_lp_feat_bt_d, tint: "#F5F3FF", icon: ic("M6.5 6.5 17.5 17.5 12 23V1l5.5 5.5L6.5 17.5") },
    { title: t.lp_feat_analytics_t, desc: t.rd_lp_feat_analytics_d, tint: "#FFFBEB", icon: ic("M3 3v18h18M7 16l4-5 3 3 5-7") },
  ];
  const STEPS = [
    { n: "01", title: t.rd_lp_how_s1_t, desc: t.rd_lp_how_s1_d },
    { n: "02", title: t.rd_lp_how_s2_t, desc: t.rd_lp_how_s2_d },
    { n: "03", title: t.rd_lp_how_s3_t, desc: t.rd_lp_how_s3_d },
  ];
  const METRICS = [
    { v: "12k+", l: t.rd_lp_m1_l }, { v: "1.4M", l: t.rd_lp_m2_l },
    { v: "<2s", l: t.rd_lp_m3_l }, { v: "4.9★", l: t.rd_lp_m4_l },
  ];
  // Pricing — real NT$ tiers (names reuse plan_*). All CTAs → signup. Pro highlighted,
  // Master = dark card. Prices/period are mono literals; perks are rd_lp_p*_* keys.
  const PLANS = [
    { name: t.plan_free, price: "NT$0", per: t.rd_lp_price_forever, tag: t.rd_lp_price_free_tag, cta: t.rd_lp_start_free, kind: "free" as const,
      perks: [t.rd_lp_pf_1, t.rd_lp_pf_2, t.rd_lp_pf_3, t.rd_lp_pf_4] },
    { name: t.plan_basic, price: "NT$500", per: t.rd_lp_per_mo, tag: t.rd_lp_price_basic_tag, cta: tpl(t.rd_lp_choose, { plan: t.plan_basic }), kind: "basic" as const,
      perks: [t.rd_lp_pb_1, t.rd_lp_pb_2, t.rd_lp_pb_3, t.rd_lp_pb_4, t.rd_lp_pb_5] },
    { name: t.plan_pro, price: "NT$1,200", per: t.rd_lp_per_mo, tag: t.rd_lp_price_pro_tag, cta: tpl(t.rd_lp_choose, { plan: t.plan_pro }), kind: "pro" as const,
      perks: [t.rd_lp_pp_1, t.rd_lp_pp_2, t.rd_lp_pp_3, t.rd_lp_pp_4, t.rd_lp_pp_5, t.rd_lp_pp_6] },
    { name: t.plan_master, price: "NT$1,700", per: t.rd_lp_per_mo, tag: t.rd_lp_price_master_tag, cta: tpl(t.rd_lp_choose, { plan: t.plan_master }), kind: "master" as const,
      perks: [t.rd_lp_pm_1, t.rd_lp_pm_2, t.rd_lp_pm_3, t.rd_lp_pm_4, t.rd_lp_pm_5] },
  ];
  const FAQS = [
    { q: t.rd_lp_faq_q1, a: t.rd_lp_faq_a1 }, { q: t.rd_lp_faq_q2, a: t.rd_lp_faq_a2 },
    { q: t.rd_lp_faq_q3, a: t.rd_lp_faq_a3 }, { q: t.rd_lp_faq_q4, a: t.rd_lp_faq_a4 },
    { q: t.rd_lp_faq_q5, a: t.rd_lp_faq_a5 },
  ];

  return (
    <div style={{ minHeight: "100%", background: C.bg, color: C.body, fontFamily: FU }}>
      {/* ── Sticky nav ── */}
      <nav style={{ position: "sticky", top: 0, zIndex: 30, height: 72, background: "rgba(250,250,254,.82)", backdropFilter: "blur(14px)", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center" }}>
        <div style={{ width: "100%", maxWidth: 1200, margin: "0 auto", padding: "0 32px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src="/landing-logo.png" alt="" style={{ width: 38, height: 38, objectFit: "contain" }} />
            <span style={{ fontFamily: FD, fontWeight: 700, fontSize: 19, color: C.ink, letterSpacing: "-.01em" }}>SellerFlow<span style={{ color: C.indigo }}>Live</span></span>
          </div>
          {/* center nav anchors (Pricing/FAQ added in Lc/Ld) */}
          <div className="sfl-lp-navlinks" style={{ display: "flex", alignItems: "center", gap: 22 }}>
            <button onClick={() => scrollToId("features")} style={navLink}>{t.rd_lp_nav_features}</button>
            <button onClick={() => scrollToId("how")} style={navLink}>{t.rd_lp_nav_how}</button>
            <button onClick={() => scrollToId("pricing")} style={navLink}>{t.rd_lp_nav_pricing}</button>
            <button onClick={() => scrollToId("faq")} style={navLink}>{t.rd_lp_nav_faq}</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* language switcher */}
            <div style={{ position: "relative" }}>
              <button onClick={onToggleLang} style={{ display: "flex", alignItems: "center", gap: 6, height: 40, padding: "0 12px", borderRadius: 11, border: `1px solid ${C.border2}`, background: "#fff", cursor: "pointer", fontFamily: FU, fontSize: 13.5, fontWeight: 600, color: C.body }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke={C.muted} strokeWidth="1.6" /><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" stroke={C.muted} strokeWidth="1.3" /></svg>
                <span>{cur.flag} {String(cur.code).toUpperCase()}</span>
                <span style={{ fontSize: 10, color: C.faint }}>▾</span>
              </button>
              {langOpen && (
                <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 200, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 13, boxShadow: "0 14px 34px rgba(23,21,48,.16)", padding: 6, zIndex: 40 }}>
                  {LANGS.map((l) => (
                    <button key={l.code} onClick={() => onPickLang(l.code)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", border: "none", borderRadius: 9, background: l.code === lang ? C.pill : "transparent", cursor: "pointer", textAlign: "left", fontFamily: FU }}>
                      <span style={{ fontSize: 16 }}>{l.flag}</span>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.ink }}>{l.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={onLogin} style={{ height: 40, padding: "0 14px", borderRadius: 11, border: "none", background: "transparent", color: C.body, fontFamily: FU, fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}>{t.lp_login}</button>
            <button onClick={onSignup} style={{ height: 42, padding: "0 18px", borderRadius: 12, border: "none", background: C.grad, color: "#fff", fontFamily: FU, fontSize: 14.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 10px 22px -8px rgba(79,70,229,.5)" }}>{t.rd_lp_start_free}</button>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section style={{ maxWidth: 1200, margin: "0 auto", padding: "72px 32px 80px", display: "grid", gridTemplateColumns: "1.05fr 0.95fr", gap: 56, alignItems: "center" }} className="sfl-lp-hero">
        <div>
          <span style={{ display: "inline-block", padding: "7px 13px", borderRadius: 99, background: C.pill, border: `1px solid ${C.pillBorder}`, color: C.indigo, fontSize: 12.5, fontWeight: 700 }}>{t.rd_lp_hero_kicker}</span>
          <h1 style={{ fontFamily: FD, fontWeight: 700, fontSize: 64, lineHeight: 1.04, letterSpacing: "-2px", color: C.ink, margin: "20px 0 0" }}>
            {t.rd_lp_hero_l1}<br />
            <span style={{ background: C.heroGrad, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{t.rd_lp_hero_l2}</span>
          </h1>
          <p style={{ fontSize: 18, lineHeight: 1.6, color: C.body, maxWidth: 480, margin: "20px 0 0" }}>{t.rd_lp_hero_sub}</p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 28 }}>
            <button onClick={onSignup} style={primaryBtn}>{t.rd_lp_start_free}</button>
            <button onClick={() => scrollToId("how")} style={ghostBtn}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              {t.lp_hero_how}
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 28 }}>
            <div style={{ display: "flex" }}>
              {["#a5b4fc", "#818cf8", "#6366f1", "#4f46e5"].map((bg, i) => (
                <span key={i} style={{ width: 32, height: 32, borderRadius: "50%", background: bg, border: "2px solid #fff", marginLeft: i ? -10 : 0 }} />
              ))}
            </div>
            <span style={{ fontSize: 13.5, color: C.muted, fontWeight: 600 }}>{t.rd_lp_social}</span>
          </div>
        </div>

        {/* Product visual card — the "money shot" (demo data = literals). */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 24, padding: 18, boxShadow: "0 40px 80px -30px rgba(79,70,229,.4)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 11px", borderRadius: 99, background: "rgba(244,63,94,.1)", color: C.rose, fontSize: 12, fontWeight: 800 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: C.rose }} />{t.rd_lp_pc_live}</span>
            <span style={{ fontFamily: FM, fontSize: 14, fontWeight: 700, color: C.ink }}>32:14</span>
          </div>
          <div style={{ background: "#F6F6FC", borderRadius: 16, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
              <span style={{ width: 28, height: 28, borderRadius: "50%", background: "#c7d2fe", flexShrink: 0 }} />
              <div><div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>Jamie R.</div><div style={{ fontSize: 12.5, color: C.body }}>How much for the floral set? 😍</div></div>
            </div>
            <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
              <span style={{ width: 28, height: 28, borderRadius: "50%", background: "#a7f3d0", flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>Crystal L.</div>
                <div style={{ fontSize: 12.5, color: C.body }}>mine 04 ✋</div>
                <div style={{ display: "flex", gap: 7, marginTop: 5 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 800, color: C.indigo, background: C.pill, padding: "3px 7px", borderRadius: 6 }}>MINE 04</span>
                  <span style={{ fontSize: 10.5, fontWeight: 800, color: C.green, display: "inline-flex", alignItems: "center", gap: 4 }}>✓ {t.rd_lp_pc_captured}</span>
                </div>
              </div>
            </div>
          </div>
          <div style={{ marginTop: 12, background: C.grad, borderRadius: 16, padding: "12px 14px", color: "#fff" }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, opacity: .9, letterSpacing: ".04em" }}>{t.rd_lp_pc_auto}</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>Crystal Lim · Item 04</span>
              <span style={{ fontFamily: FM, fontSize: 15, fontWeight: 700 }}>₱980</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 9, marginTop: 12 }}>
            <span style={{ flex: 1, textAlign: "center", padding: "11px 0", borderRadius: 12, background: C.ink, color: "#fff", fontSize: 13, fontWeight: 700 }}>{t.rd_lp_pc_print}</span>
            <span style={{ flex: 1, textAlign: "center", padding: "11px 0", borderRadius: 12, background: "#fff", color: C.ink, border: `1px solid ${C.border2}`, fontSize: 13, fontWeight: 700 }}>{t.rd_lp_pc_paylink}</span>
          </div>
        </div>
      </section>

      {/* ── Metrics strip ── */}
      <section style={{ maxWidth: 1200, margin: "0 auto", padding: "0 32px" }}>
        <div className="sfl-lp-metrics" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18 }}>
          {METRICS.map((m) => (
            <div key={m.l} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, padding: "20px 18px", textAlign: "center" }}>
              <div style={{ fontFamily: FM, fontWeight: 700, fontSize: 30, color: C.indigo }}>{m.v}</div>
              <div style={{ fontSize: 13, color: C.muted, fontWeight: 600, marginTop: 4 }}>{m.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" style={{ maxWidth: 1200, margin: "0 auto", padding: "96px 32px 0", scrollMarginTop: 80 }}>
        <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 40px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: ".12em", color: C.indigo }}>{t.rd_lp_feat_eyebrow}</div>
          <h2 style={{ fontFamily: FD, fontWeight: 700, fontSize: 44, lineHeight: 1.1, color: C.ink, margin: "12px 0 0", letterSpacing: "-1px" }}>{t.rd_lp_feat_h2}</h2>
          <p style={{ fontSize: 16.5, color: C.body, marginTop: 14, lineHeight: 1.6 }}>{t.rd_lp_feat_sub}</p>
        </div>
        <div className="sfl-lp-features" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
          {FEATURES.map((f) => (
            <div key={f.title} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 20, padding: 24 }}>
              <div style={{ width: 50, height: 50, borderRadius: 14, background: f.tint, display: "flex", alignItems: "center", justifyContent: "center" }}>{f.icon}</div>
              <div style={{ fontFamily: FD, fontWeight: 600, fontSize: 19, color: C.ink, marginTop: 16 }}>{f.title}</div>
              <p style={{ fontSize: 14.5, lineHeight: 1.6, color: C.muted, marginTop: 8 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works (dark band) ── */}
      <section id="how" style={{ maxWidth: 1200, margin: "96px auto 0", padding: "0 32px", scrollMarginTop: 80 }}>
        <div style={{ background: C.ink, borderRadius: 28, padding: "56px 48px" }}>
          <div style={{ textAlign: "center", maxWidth: 620, margin: "0 auto 40px" }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: ".12em", color: "#A5B4FC" }}>{t.rd_lp_how_eyebrow}</div>
            <h2 style={{ fontFamily: FD, fontWeight: 700, fontSize: 40, lineHeight: 1.12, color: "#fff", margin: "12px 0 0", letterSpacing: "-1px" }}>{t.rd_lp_how_h2}</h2>
          </div>
          <div className="sfl-lp-steps" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 32 }}>
            {STEPS.map((s) => (
              <div key={s.n}>
                <div style={{ fontFamily: FM, fontWeight: 700, fontSize: 30, color: "#818CF8" }}>{s.n}</div>
                <div style={{ height: 1, background: "rgba(255,255,255,.12)", margin: "14px 0" }} />
                <div style={{ fontFamily: FD, fontWeight: 600, fontSize: 21, color: "#fff" }}>{s.title}</div>
                <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "#b9b7d8", marginTop: 8 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" style={{ maxWidth: 1200, margin: "96px auto 0", padding: "0 32px", scrollMarginTop: 80 }}>
        <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 40px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: ".12em", color: C.indigo }}>{t.rd_lp_price_eyebrow}</div>
          <h2 style={{ fontFamily: FD, fontWeight: 700, fontSize: 44, lineHeight: 1.1, color: C.ink, margin: "12px 0 0", letterSpacing: "-1px" }}>{t.rd_lp_price_h2}</h2>
          <p style={{ fontSize: 16.5, color: C.body, marginTop: 14, lineHeight: 1.6 }}>{t.rd_lp_price_sub}</p>
        </div>
        <div className="sfl-lp-pricing" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18, alignItems: "stretch" }}>
          {PLANS.map((p) => {
            const dark = p.kind === "master";
            const pro = p.kind === "pro";
            const ink = dark ? "#fff" : C.ink;
            const check = dark ? "#818CF8" : p.kind === "pro" ? C.indigo : C.green;
            const cardBg = dark ? C.ink : C.card;
            const btnStyle: CSSProperties = pro
              ? { background: C.grad, color: "#fff", border: "none" }
              : dark
                ? { background: "#fff", color: C.ink, border: "none" }
                : p.kind === "basic"
                  ? { background: C.ink, color: "#fff", border: "none" }
                  : { background: "#fff", color: C.ink, border: `1px solid ${C.border2}` };
            return (
              <div key={p.name} style={{ position: "relative", background: cardBg, border: pro ? `2px solid ${C.indigo}` : `1px solid ${C.border}`, borderRadius: 22, padding: "26px 22px", display: "flex", flexDirection: "column", transform: pro ? "translateY(-8px)" : "none", boxShadow: pro ? "0 30px 60px -24px rgba(79,70,229,.45)" : dark ? "0 30px 60px -24px rgba(23,21,48,.5)" : "none" }}>
                {pro && <span style={{ position: "absolute", top: -11, left: "50%", transform: "translateX(-50%)", background: C.grad, color: "#fff", fontSize: 10.5, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", padding: "5px 12px", borderRadius: 99 }}>{t.lp_price_popular}</span>}
                <div style={{ fontFamily: FD, fontWeight: 700, fontSize: 18, color: ink }}>{p.name}</div>
                <div style={{ fontSize: 12.5, color: dark ? "#b9b7d8" : C.muted, marginTop: 3 }}>{p.tag}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 16 }}>
                  <span style={{ fontFamily: FM, fontWeight: 700, fontSize: 34, color: ink }}>{p.price}</span>
                  <span style={{ fontSize: 12.5, color: dark ? "#9d9bc0" : C.faint }}>{p.per}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 9, margin: "18px 0 22px", flex: 1 }}>
                  {p.perks.map((perk) => (
                    <div key={perk} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13.5, color: dark ? "#cfcde6" : C.body, lineHeight: 1.45 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={check} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}><path d="M20 6 9 17l-5-5" /></svg>
                      {perk}
                    </div>
                  ))}
                </div>
                <button onClick={onSignup} style={{ ...btnStyle, width: "100%", height: 46, borderRadius: 13, fontFamily: FU, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>{p.cta}</button>
              </div>
            );
          })}
        </div>
        <p style={{ textAlign: "center", fontSize: 12.5, color: C.faint, marginTop: 18 }}>{t.rd_lp_price_fine}</p>
      </section>

      {/* ── FAQ (single-open accordion) ── */}
      <section id="faq" style={{ maxWidth: 760, margin: "96px auto 0", padding: "0 32px", scrollMarginTop: 80 }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: ".12em", color: C.indigo }}>{t.rd_lp_faq_eyebrow}</div>
          <h2 style={{ fontFamily: FD, fontWeight: 700, fontSize: 40, lineHeight: 1.12, color: C.ink, margin: "12px 0 0", letterSpacing: "-1px" }}>{t.rd_lp_faq_h2}</h2>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {FAQS.map((f, i) => {
            const open = faqOpen === i;
            return (
              <div key={f.q} style={{ background: C.card, border: `1px solid ${open ? C.indigo2 : C.border}`, borderRadius: 16, overflow: "hidden" }}>
                <button onClick={() => setFaqOpen(open ? -1 : i)} aria-expanded={open} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "18px 20px", background: "none", border: "none", cursor: "pointer", textAlign: "left", fontFamily: FU }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: C.ink }}>{f.q}</span>
                  <span style={{ flexShrink: 0, fontSize: 22, lineHeight: 1, color: C.indigo2, transition: "transform .2s", transform: open ? "rotate(45deg)" : "rotate(0deg)" }}>+</span>
                </button>
                {open && <div style={{ padding: "0 20px 18px", fontSize: 14.5, lineHeight: 1.65, color: C.body }}>{f.a}</div>}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── CTA band ── */}
      <section style={{ maxWidth: 1200, margin: "96px auto 0", padding: "0 32px" }}>
        <div style={{ background: "linear-gradient(135deg, #4F46E5, #6366F1 55%, #818CF8)", borderRadius: 28, padding: "56px 40px", textAlign: "center", color: "#fff" }}>
          <h2 style={{ fontFamily: FD, fontWeight: 700, fontSize: 40, lineHeight: 1.1, letterSpacing: "-1px", margin: 0 }}>{t.rd_lp_cta_h2}</h2>
          <p style={{ fontSize: 16.5, opacity: 0.92, marginTop: 12, lineHeight: 1.6 }}>{t.rd_lp_cta_sub}</p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginTop: 26 }}>
            <button onClick={onSignup} style={{ ...primaryBtn, background: "#fff", color: C.indigo, boxShadow: "0 16px 30px -12px rgba(0,0,0,.3)" }}>{t.rd_lp_start_free}</button>
            <a href="https://t.me/SellerFlowLive1995" target="_blank" rel="noreferrer" style={{ ...ghostBtn, background: "transparent", color: "#fff", border: "1px solid rgba(255,255,255,.5)" }}>{t.rd_lp_cta_telegram}</a>
          </div>
        </div>
      </section>

      {/* ── Footer (4 columns) ── */}
      <footer style={{ background: C.ink, color: "#cfcde6", marginTop: 64 }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "48px 32px 28px" }}>
          <div className="sfl-lp-footcols" style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr 1fr 1fr", gap: 32 }}>
            {/* brand */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <img src="/landing-logo.png" alt="" style={{ width: 34, height: 34, objectFit: "contain" }} />
                <span style={{ fontFamily: FD, fontWeight: 700, fontSize: 18, color: "#fff" }}>SellerFlowLive</span>
              </div>
              <p style={{ fontSize: 13.5, color: "#9d9bc0", marginTop: 12, maxWidth: 320, lineHeight: 1.6 }}>{t.lp_footer_tagline}</p>
              <a href="https://t.me/SellerFlowLive1995" target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 14, padding: "8px 13px", borderRadius: 10, background: "rgba(39,167,231,.16)", color: "#7fd3ff", fontSize: 13, fontWeight: 700, textDecoration: "none" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M21.5 4.3 3.2 11.4c-1 .4-1 1.8.1 2.1l4.6 1.4 1.8 5.6c.2.7 1.1.9 1.6.3l2.5-2.6 4.7 3.4c.6.4 1.4.1 1.6-.6l3-15c.2-1-.7-1.8-1.6-1.3Z" /></svg>
                @SellerFlowLive1995
              </a>
            </div>
            {/* Product */}
            <div>
              <div style={footHead}>{t.rd_lp_foot_product}</div>
              <button onClick={() => scrollToId("features")} style={footLink}>{t.rd_lp_nav_features}</button>
              <button onClick={() => scrollToId("pricing")} style={footLink}>{t.rd_lp_nav_pricing}</button>
              <button onClick={() => scrollToId("faq")} style={footLink}>{t.rd_lp_nav_faq}</button>
            </div>
            {/* Support */}
            <div>
              <div style={footHead}>{t.rd_lp_foot_support}</div>
              <a href="https://t.me/SellerFlowLive1995" target="_blank" rel="noreferrer" style={footLinkA}>{t.rd_lp_foot_tgchat}</a>
              <a href="https://t.me/SellerFlowLive1995" target="_blank" rel="noreferrer" style={footLinkA}>{t.rd_lp_foot_help}</a>
            </div>
            {/* Language */}
            <div>
              <div style={footHead}>{t.rd_lp_foot_language}</div>
              <div style={{ fontSize: 13.5, color: "#9d9bc0" }}>{cur.flag} {cur.label}</div>
            </div>
          </div>
          <div style={{ borderTop: "1px solid rgba(255,255,255,.1)", marginTop: 28, paddingTop: 18, display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "space-between", fontSize: 12, color: "#807ea0" }}>
            <span>{t.rd_lp_foot_bottom}</span>
            <span>{t.rd_lp_foot_langs}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
