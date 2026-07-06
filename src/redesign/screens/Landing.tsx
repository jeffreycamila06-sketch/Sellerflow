// Public marketing landing v2 (web only — NEVER shown in the APK; gated by
// anonScreen/isAppShell in RedesignApp). 1:1 adaptation of the approved blueprint
// design-landing/sellerflow-landing-preview.html (chat-Claude, Jeff-approved):
// livestream hero scene (ring light, animated comment feed → order chips, floating
// hearts, seller-photo card, thermal printer emitting a slip), social bar,
// 3 steps, dashboard "door-closing" assembly, deep dives, bento features, video
// poster slot, FAQ, Taglish-rooted testimonials (localized ×7), guide cards,
// final CTA, footer, help fab. NO pricing anywhere (Jeff decision); the existing
// stats row stays as-is. All animation is CSS (.sfl-l2-* / reused .sfl-lp-*) +
// two IntersectionObservers; prefers-reduced-motion collapses everything.
//
// Demo literals (feed comments, order chips, slip contents, dash numbers) are
// intentional sample data — same convention as the rest of the redesign.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { LANGS } from "../data";
import { useT, tpl } from "../i18n";

// Store links (verified): Play = com.sellerflow.live · App Store id 6783770354.
export const PLAY_URL = "https://play.google.com/store/apps/details?id=com.sellerflow.live";
export const APPSTORE_URL = "https://apps.apple.com/app/id6783770354";
const TELEGRAM_URL = "https://t.me/SellerFlowLive1995";

// Blueprint palette (authoritative hex values from the preview file).
const C = {
  ink: "#17143a", inkSoft: "#4b4770", paper: "#f7f7fd", card: "#ffffff",
  indigo: "#4f46e5", indigoDeep: "#3730a3", violet: "#8b5cf6",
  live: "#ef3e5c", mint: "#10b981", amber: "#f59e0b", line: "#e6e5f4",
};
const FD = "var(--font-display)"; const FU = "var(--font-ui)"; const FM = "var(--font-mono)";

const btnBase: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 15, borderRadius: 12, padding: "11px 20px", cursor: "pointer", border: "none", fontFamily: FU, textDecoration: "none" };
const btnPrimary: CSSProperties = { ...btnBase, background: C.indigo, color: "#fff", boxShadow: "0 6px 18px rgba(79,70,229,.28)" };
const btnHero: CSSProperties = { fontSize: 17, padding: "15px 26px", borderRadius: 14 };
const btnGhost: CSSProperties = { ...btnBase, background: "transparent", color: C.inkSoft, padding: "11px 10px" };
const eyebrow: CSSProperties = { fontFamily: FM, fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", color: C.indigo, fontWeight: 700 };
const h2Style: CSSProperties = { fontFamily: FD, fontSize: "clamp(1.7rem, 3.4vw, 2.4rem)", letterSpacing: "-.015em", margin: "10px 0 14px", lineHeight: 1.15, color: C.ink, fontWeight: 700 };
const secSub: CSSProperties = { color: C.inkSoft, maxWidth: "36rem", fontSize: 16, margin: "0 auto", lineHeight: 1.6 };
const wrap: CSSProperties = { maxWidth: 1120, margin: "0 auto", padding: "0 24px" };

// Scroll-reveal stagger delay (consumed by .sfl-lp-reveal's transition-delay var).
const rv = (i: number, step = 0.08): CSSProperties => ({ "--rv-delay": `${(i * step).toFixed(2)}s` } as CSSProperties);
const rise = (d: number): CSSProperties => ({ animationDelay: `${d}s` });

// Scroll-triggered reveals + the dashboard-assembly trigger. Adds classes ONCE
// (never re-hides). Falls back to fully-visible when IO is unavailable (jsdom).
function useScrollFx() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(".sfl-lp-reveal"));
    const stage = document.getElementById("sflDashStage");
    if (typeof IntersectionObserver === "undefined") {
      els.forEach((e) => e.classList.add("sfl-lp-in"));
      stage?.classList.add("sfl-l2-on");
      return;
    }
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { en.target.classList.add("sfl-lp-in"); io.unobserve(en.target); }
    }, { threshold: 0.12 });
    els.forEach((e) => io.observe(e));
    let io2: IntersectionObserver | null = null;
    if (stage) {
      io2 = new IntersectionObserver((entries) => {
        for (const en of entries) if (en.isIntersecting) { stage.classList.add("sfl-l2-on"); io2?.disconnect(); }
      }, { threshold: 0.35 });
      io2.observe(stage);
    }
    return () => { io.disconnect(); io2?.disconnect(); };
  }, []);
}

// ── Store badges (conventional untranslated store copy) ──────────────────────
function StoreBadge({ kind }: { kind: "play" | "ios" }) {
  const play = kind === "play";
  return (
    <a href={play ? PLAY_URL : APPSTORE_URL} target="_blank" rel="noreferrer" className="sfl-lp-lift" style={{ display: "flex", alignItems: "center", gap: 10, background: C.ink, color: "#fff", borderRadius: 12, padding: "9px 16px", textDecoration: "none" }}>
      <span style={{ fontSize: 21, lineHeight: 1 }}>{play ? "▶" : ""}</span>
      <span>
        <small style={{ display: "block", fontSize: 10, opacity: 0.75, lineHeight: 1.1 }}>{play ? "GET IT ON" : "Download on the"}</small>
        <b style={{ fontFamily: FD, fontSize: 15.5, lineHeight: 1.15 }}>{play ? "Google Play" : "App Store"}</b>
      </span>
    </a>
  );
}

// ── Hero livestream scene (blueprint: ring light + phone feed + slip + printer) ──
const FEED: { r: number; av: string; ch: string; user: string; text: string; chip?: string }[] = [
  { r: 1, av: "#f472b6", ch: "M", user: "mei.chen88", text: "— mine! 🙋‍♀️", chip: "✓ ORDER · Buyer #12 · NT$390" },
  { r: 2, av: "#60a5fa", ch: "J", user: "jaso_tw", text: "— ganda ng kulay 😍" },
  { r: 3, av: "#fbbf24", ch: "A", user: "abby.shopaholic", text: "— M +1", chip: "✓ ORDER · Buyer #13 · NT$250" },
  { r: 4, av: "#34d399", ch: "L", user: "lin_grace", text: "— may medium pa?" },
  { r: 5, av: "#a78bfa", ch: "K", user: "kuya.dave", text: "— mine 2pcs!", chip: "✓ ORDER · Buyer #14 · NT$780" },
  { r: 6, av: "#f87171", ch: "C", user: "cherry_go", text: "— MINE!!", chip: "✓ ORDER · Buyer #15 · NT$450" },
];

function HeroScene({ t }: { t: Record<string, string> }) {
  const [photoOk, setPhotoOk] = useState(true);
  return (
    <div style={{ position: "relative", padding: "34px 0 26px" }}>
      {/* ring light glow */}
      <div className="sfl-l2-ring" style={{ position: "absolute", top: "46%", left: "50%", width: 430, height: 430, transform: "translate(-50%,-50%)", borderRadius: "50%", border: "14px solid rgba(255,255,255,.95)", background: "radial-gradient(circle, rgba(255,255,255,.75), rgba(247,247,253,0) 68%)", zIndex: 0, maxWidth: "96vw", maxHeight: "96vw" }} />
      {/* viewers pill */}
      <div style={{ position: "absolute", top: 16, left: -14, zIndex: 4, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 999, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, color: C.ink, boxShadow: "0 8px 22px rgba(23,20,58,.1)", display: "flex", gap: 7, alignItems: "center" }}>
        <span className="sfl-lp-livedot" style={{ width: 7, height: 7 }} />{t.rd_l2_viewers}
      </div>
      {/* seller photo polaroid — real asset /landing-seller.jpg; graceful fallback frame */}
      <div className="sfl-l2-sellerbob sfl-l2-sellercard" style={{ position: "absolute", left: -64, bottom: 44, zIndex: 3, width: 190, background: "#fff", padding: "9px 9px 30px", borderRadius: 14, boxShadow: "0 22px 50px rgba(23,20,58,.22)" }}>
        {photoOk ? (
          <img src="/landing-seller.jpg" alt="" className="sfl-l2-sellerimg" onError={() => setPhotoOk(false)} style={{ width: "100%", height: 210, objectFit: "cover", borderRadius: 9, display: "block" }} />
        ) : (
          <div className="sfl-l2-sellerimg" style={{ width: "100%", height: 210, borderRadius: 9, border: "2px dashed #c9c6e8", display: "grid", placeItems: "center", textAlign: "center", fontSize: 12, color: C.inkSoft, padding: 14, background: C.paper }}>
            📸<br />{t.rd_l2_photo_fallback}
          </div>
        )}
        <span style={{ position: "absolute", bottom: 8, left: 0, right: 0, textAlign: "center", fontFamily: FM, fontSize: 9.5, color: C.inkSoft, letterSpacing: ".05em" }}>LIVE NOW · @yourshop</span>
      </div>
      {/* floating hearts */}
      <div style={{ position: "absolute", right: -8, bottom: 120, zIndex: 4, width: 40, height: 220, pointerEvents: "none" }} aria-hidden>
        <span className="sfl-l2-heart">❤️</span>
        <span className="sfl-l2-heart sfl-l2-h2">🧡</span>
        <span className="sfl-l2-heart sfl-l2-h3">💜</span>
        <span className="sfl-l2-heart sfl-l2-h4">❤️</span>
      </div>
      {/* phone */}
      <div style={{ position: "relative", zIndex: 2, width: "min(340px, 86vw)", margin: "0 auto", background: C.ink, borderRadius: 38, padding: 12, boxShadow: "0 30px 70px rgba(23,20,58,.28)" }}>
        <div style={{ background: C.paper, borderRadius: 28, overflow: "hidden", height: 560, display: "flex", flexDirection: "column" }}>
          <div style={{ background: `linear-gradient(120deg, ${C.indigo}, ${C.violet})`, color: "#fff", padding: "14px 16px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: FD, fontWeight: 700, fontSize: 15 }}>
              <span style={{ background: C.live, borderRadius: 999, fontSize: 9.5, letterSpacing: ".06em", padding: "3px 8px", display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "#fff" }} />LIVE</span>
              SellerFlowLive
            </div>
            <div style={{ fontSize: 11, opacity: 0.85, marginTop: 4 }}>{t.rd_l2_scr_sub}</div>
          </div>
          <div style={{ flex: 1, padding: 12, display: "flex", flexDirection: "column", gap: 9, overflow: "hidden", position: "relative" }}>
            {FEED.map((c) => (
              <div key={c.r} className={`sfl-l2-crow sfl-l2-r${c.r}`} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ width: 26, height: 26, borderRadius: "50%", flex: "none", display: "grid", placeItems: "center", fontSize: 10, fontWeight: 800, color: "#fff", background: c.av }}>{c.ch}</span>
                <div>
                  <div style={{ background: "#fff", border: `1px solid ${c.chip ? "rgba(79,70,229,.5)" : C.line}`, borderRadius: 12, padding: "7px 11px", fontSize: 12, color: C.ink, boxShadow: "0 2px 6px rgba(23,20,58,.05)" }}><b>{c.user}</b> {c.text}</div>
                  {c.chip && <span className="sfl-l2-chip" style={{ marginTop: 5, display: "inline-flex", gap: 7, alignItems: "center", background: "rgba(16,185,129,.1)", border: `1px dashed ${C.mint}`, color: "#0b7a58", borderRadius: 9, padding: "4px 9px", fontFamily: FM, fontSize: 10.5, fontWeight: 700 }}>{c.chip}</span>}
                </div>
              </div>
            ))}
          </div>
          <div style={{ borderTop: `1px dashed ${C.line}`, background: "#fff", padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 10.5, color: C.inkSoft }}>{t.rd_l2_foot_lab}</span>
            <span style={{ fontFamily: FM, fontWeight: 700, color: C.indigo, fontSize: 15 }}>{t.rd_l2_foot_num}</span>
          </div>
        </div>
      </div>
      {/* tripod */}
      <div aria-hidden style={{ position: "relative", zIndex: 1, width: 0, margin: "-6px auto 0", height: 58 }}>
        <span style={{ position: "absolute", top: 0, left: -40, width: 7, height: 60, background: "linear-gradient(#2a2650, #17143a)", borderRadius: 4, transform: "rotate(20deg)", display: "block" }} />
        <span style={{ position: "absolute", top: 0, right: -40, width: 7, height: 60, background: "linear-gradient(#2a2650, #17143a)", borderRadius: 4, transform: "rotate(-20deg)", display: "block" }} />
      </div>
      {/* thermal printer emitting a slip */}
      <div className="sfl-l2-printerbob sfl-l2-printer" style={{ position: "absolute", right: -88, top: 120, zIndex: 3, width: 150, filter: "drop-shadow(0 18px 36px rgba(23,20,58,.22))" }}>
        <div style={{ position: "relative", zIndex: 2, background: "linear-gradient(160deg, #26224e, #17143a)", borderRadius: 16, padding: "14px 14px 10px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}>
            <span style={{ fontFamily: FM, fontSize: 8.5, letterSpacing: ".12em", color: "#8a86b8" }}>SELLERFLOW PRINT</span>
            <span className="sfl-lp-printlight" style={{ width: 7, height: 7 }} />
          </div>
          <div style={{ height: 7, borderRadius: 4, background: "#0c0a22", boxShadow: "inset 0 2px 4px rgba(0,0,0,.7)" }} />
        </div>
        <div className="sfl-l2-prpaper" style={{ position: "relative", zIndex: 1, margin: "0 12px", background: "#fff", border: "1px solid #e4e2f2", borderTop: "none", borderRadius: "0 0 9px 9px", padding: "9px 11px 11px", fontFamily: FM, fontSize: 9, lineHeight: 1.75, color: C.ink }}>
          SELLERFLOW SLIP<br />
          <b style={{ color: C.indigo }}>Buyer #14</b> · kuya.dave<br />
          2× Summer dress<br />
          TOTAL <b style={{ color: C.indigo }}>NT$780</b><br />
          <span style={{ color: "#b6b3d6", letterSpacing: ".18em" }}>✂ - - - - - - -</span>
        </div>
      </div>
    </div>
  );
}

// mono receipt-slip motif card (deep dives)
function MonoSlip({ children }: { children: ReactNode }) {
  return <div style={{ fontFamily: FM, fontSize: 12, lineHeight: 2, background: C.paper, border: "1px dashed #c9c6e8", borderRadius: 12, padding: "14px 16px", color: C.ink, overflowX: "auto" }}>{children}</div>;
}

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
  const t = useT() as unknown as Record<string, string>;
  const cur = LANGS.find((l) => l.code === lang) || LANGS[0];
  useScrollFx();
  const scrollToId = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const navLink: CSSProperties = { background: "none", border: "none", cursor: "pointer", fontFamily: FU, fontSize: 14.5, fontWeight: 600, color: C.inkSoft, padding: "0 2px" };

  // nav Features dropdown items → in-page sections
  const DD = [
    { t: t.rd_l2_dd1_t, s: t.rd_l2_dd1_s, id: "features" },
    { t: t.rd_l2_dd2_t, s: t.rd_l2_dd2_s, id: "inside" },
    { t: t.rd_l2_dd3_t, s: t.rd_l2_dd3_s, id: "deep-print" },
    { t: t.rd_l2_dd4_t, s: t.rd_l2_dd4_s, id: "inside" },
  ];
  // existing stats row — values as-is (Jeff decision), labels reuse rd_lp_m*_l
  const METRICS = [
    { v: "12k+", l: t.rd_lp_m1_l }, { v: "1.4M", l: t.rd_lp_m2_l },
    { v: "<2s", l: t.rd_lp_m3_l }, { v: "4.9★", l: t.rd_lp_m4_l },
  ];
  const STEPS = [
    { ic: "📡", tint: "rgba(239,62,92,.1)", ti: t.rd_l2_s1_t, d: t.rd_l2_s1_d },
    { ic: "⚡", tint: "rgba(79,70,229,.1)", ti: t.rd_l2_s2_t, d: t.rd_l2_s2_d },
    { ic: "🖨️", tint: "rgba(16,185,129,.1)", ti: t.rd_l2_s3_t, d: t.rd_l2_s3_d },
  ];
  const BENTO: { span: 3 | 2; hero?: boolean; ic: string; ti: string; d: string }[] = [
    { span: 3, hero: true, ic: "🧲", ti: t.rd_l2_b1_t, d: t.rd_l2_b1_d },
    { span: 3, ic: "#️⃣", ti: t.rd_l2_b2_t, d: t.rd_l2_b2_d },
    { span: 2, ic: "🖨️", ti: t.rd_l2_b3_t, d: t.rd_l2_b3_d },
    { span: 2, ic: "📦", ti: t.rd_l2_b4_t, d: t.rd_l2_b4_d },
    { span: 2, ic: "🎡", ti: t.rd_l2_b5_t, d: t.rd_l2_b5_d },
    { span: 2, ic: "📊", ti: t.rd_l2_b6_t, d: t.rd_l2_b6_d },
    { span: 2, ic: "🌏", ti: t.rd_l2_b7_t, d: t.rd_l2_b7_d },
    { span: 2, ic: "🔄", ti: t.rd_l2_b8_t, d: t.rd_l2_b8_d },
  ];
  const FAQS = [
    { q: t.rd_l2_faq_q1, a: t.rd_l2_faq_a1 }, { q: t.rd_l2_faq_q2, a: t.rd_l2_faq_a2 },
    { q: t.rd_l2_faq_q3, a: t.rd_l2_faq_a3 }, { q: t.rd_l2_faq_q4, a: t.rd_l2_faq_a4 },
    { q: t.rd_l2_faq_q5, a: t.rd_l2_faq_a5 }, { q: t.rd_l2_faq_q6, a: t.rd_l2_faq_a6 },
  ];
  const QUOTES = [
    { av: "#f472b6", ch: "C", q: t.rd_l2_q1, who: t.rd_l2_q1_who },
    { av: "#60a5fa", ch: "N", q: t.rd_l2_q2, who: t.rd_l2_q2_who },
    { av: "#34d399", ch: "M", q: t.rd_l2_q3, who: t.rd_l2_q3_who },
  ];
  // Guide cards route to signup — the User Guide lives inside the app (Support
  // screen, post-login); an anonymous visitor's path to it starts at signup.
  const GUIDES = [
    { ic: "🚀", ti: t.rd_l2_g1_t, d: t.rd_l2_g1_d },
    { ic: "🖨️", ti: t.rd_l2_g2_t, d: t.rd_l2_g2_d },
    { ic: "🔴", ti: t.rd_l2_g3_t, d: t.rd_l2_g3_d },
    { ic: "📦", ti: t.rd_l2_g4_t, d: t.rd_l2_g4_d },
  ];
  const [faqOpen, setFaqOpen] = useState(-1);

  return (
    <div style={{ minHeight: "100%", background: C.paper, color: C.ink, fontFamily: FU, lineHeight: 1.6, overflowX: "hidden" }}>
      {/* ── NAV ── */}
      <nav style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(247,247,253,.85)", backdropFilter: "blur(12px)", borderBottom: `1px solid ${C.line}` }}>
        <div style={{ ...wrap, display: "flex", alignItems: "center", gap: 24, height: 64 }}>
          <span style={{ fontFamily: FD, fontWeight: 700, fontSize: 18, display: "flex", alignItems: "center", gap: 9, color: C.ink }}>
            <img src="/landing-logo.png" alt="" style={{ width: 30, height: 30, objectFit: "contain" }} />
            SellerFlowLive
          </span>
          <div className="sfl-l2-navlinks" style={{ display: "flex", gap: 20, fontSize: 14.5, fontWeight: 600, color: C.inkSoft, alignItems: "center" }}>
            <button onClick={() => scrollToId("how")} style={navLink}>{t.rd_lp_nav_how}</button>
            <span className="sfl-l2-dd">
              <button onClick={() => scrollToId("features")} style={navLink}>{t.rd_lp_nav_features} ▾</button>
              <span className="sfl-l2-ddmenu">
                {DD.map((d) => (
                  <button key={d.t} onClick={() => scrollToId(d.id)} style={{ display: "block", width: "100%", padding: "10px 12px", borderRadius: 9, fontSize: 13.5, color: C.ink, background: "none", border: "none", cursor: "pointer", textAlign: "left", fontFamily: FU }}>
                    <span style={{ fontWeight: 700 }}>{d.t}</span>
                    <small style={{ display: "block", fontWeight: 500, color: C.inkSoft, fontSize: 11.5 }}>{d.s}</small>
                  </button>
                ))}
              </span>
            </span>
            <button onClick={() => scrollToId("guide")} style={navLink}>{t.rd_l2_nav_guide}</button>
            <button onClick={() => scrollToId("faq")} style={navLink}>{t.rd_lp_nav_faq}</button>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
            {/* language switcher (real 7-lang control — kept from v1) */}
            <div style={{ position: "relative" }}>
              <button onClick={onToggleLang} style={{ display: "flex", alignItems: "center", gap: 6, height: 38, padding: "0 11px", borderRadius: 11, border: `1px solid ${C.line}`, background: "#fff", cursor: "pointer", fontFamily: FU, fontSize: 13, fontWeight: 600, color: C.inkSoft }}>
                <span>{cur.flag} {String(cur.code).toUpperCase()}</span>
                <span style={{ fontSize: 9 }}>▾</span>
              </button>
              {langOpen && (
                <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 200, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 13, boxShadow: "0 14px 34px rgba(23,20,58,.16)", padding: 6, zIndex: 60 }}>
                  {LANGS.map((l) => (
                    <button key={l.code} onClick={() => onPickLang(l.code)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", border: "none", borderRadius: 9, background: l.code === lang ? "#efeefe" : "transparent", cursor: "pointer", textAlign: "left", fontFamily: FU }}>
                      <span style={{ fontSize: 16 }}>{l.flag}</span>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.ink }}>{l.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={onLogin} style={{ ...btnGhost, fontSize: 14.5 }}>{t.lp_login}</button>
            <button onClick={onSignup} className="sfl-lp-lift" style={{ ...btnPrimary, padding: "10px 18px", fontSize: 14.5 }}>{t.rd_l2_nav_cta}</button>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <header style={{ position: "relative", padding: "72px 0 84px", overflow: "hidden" }}>
        <div aria-hidden style={{ position: "absolute", inset: "-40% -20% auto", height: "120%", background: "radial-gradient(600px 420px at 18% 20%, rgba(139,92,246,.14), transparent 60%), radial-gradient(700px 480px at 85% 8%, rgba(79,70,229,.16), transparent 65%)", pointerEvents: "none" }} />
        <div className="sfl-l2-hero" style={{ ...wrap, position: "relative" }}>
          <div>
            <span className="sfl-lp-rise" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 999, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, color: C.inkSoft, marginBottom: 22, ...rise(0.05) }}>
              <span className="sfl-lp-livedot" style={{ width: 8, height: 8 }} />{t.rd_l2_eyebrow}
            </span>
            <h1 className="sfl-lp-rise" style={{ fontFamily: FD, fontSize: "clamp(2.3rem, 5vw, 3.6rem)", lineHeight: 1.08, letterSpacing: "-.02em", fontWeight: 700, color: C.ink, margin: 0, ...rise(0.16) }}>
              {t.rd_l2_h1_pre} <span style={{ color: C.indigo }}>{t.rd_l2_h1_hl}</span>
            </h1>
            <p className="sfl-lp-rise" style={{ margin: "20px 0 30px", fontSize: 17.5, color: C.inkSoft, maxWidth: "32rem", ...rise(0.3) }}>{t.rd_l2_hero_sub}</p>
            <div className="sfl-lp-rise" style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", ...rise(0.42) }}>
              <button onClick={onSignup} className="sfl-lp-lift" style={{ ...btnPrimary, ...btnHero }}>{t.rd_l2_cta_try}</button>
              <button onClick={() => scrollToId("how")} style={btnGhost}>{t.rd_l2_cta_how}</button>
            </div>
            <div className="sfl-lp-rise" style={{ display: "flex", gap: 12, marginTop: 26, flexWrap: "wrap", ...rise(0.52) }}>
              <StoreBadge kind="play" />
              <StoreBadge kind="ios" />
            </div>
            <div className="sfl-lp-rise" style={{ display: "flex", gap: 34, marginTop: 34, flexWrap: "wrap", ...rise(0.62) }}>
              {METRICS.map((m) => (
                <div key={m.l}>
                  <b style={{ fontFamily: FM, fontSize: 23, color: C.indigo, fontWeight: 700 }}>{m.v}</b>
                  <span style={{ display: "block", fontSize: 12.5, color: C.inkSoft }}>{m.l}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="sfl-lp-rise" style={rise(0.3)}>
            <HeroScene t={t} />
          </div>
        </div>
      </header>

      {/* ── SOCIAL BAR ── */}
      <div style={{ borderBlock: `1px solid ${C.line}`, background: "#fff", padding: "18px 0" }}>
        <div style={{ ...wrap, display: "flex", alignItems: "center", gap: 26, justifyContent: "center", flexWrap: "wrap", fontWeight: 700, color: C.inkSoft, fontSize: 14 }}>
          <span>{t.rd_l2_sb_works}</span>
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center", fontFamily: FD }}>🎵 TikTok LIVE</span>
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center", fontFamily: FD }}>📘 Facebook Live</span>
          <span style={{ opacity: 0.4 }}>|</span>
          <span>{t.rd_l2_sb_trust}</span>
        </div>
      </div>

      {/* ── HOW IT WORKS ── */}
      <section id="how" style={{ padding: "86px 0", scrollMarginTop: 70 }}>
        <div style={{ ...wrap, textAlign: "center" }}>
          <span className="sfl-lp-reveal" style={eyebrow}>{t.rd_lp_nav_how}</span>
          <h2 className="sfl-lp-reveal" style={h2Style}>{t.rd_l2_how_h2}</h2>
          <p className="sfl-lp-reveal" style={secSub}>{t.rd_l2_how_sub}</p>
          <div className="sfl-l2-steps" style={{ marginTop: 46, textAlign: "left" }}>
            {STEPS.map((s, i) => (
              <div key={s.ti} className="sfl-lp-reveal sfl-lp-lift sfl-lp-hovshadow" style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 20, padding: "28px 24px", position: "relative", ...rv(i, 0.1) }}>
                <span style={{ position: "absolute", top: 22, right: 22, fontFamily: FM, fontSize: 11, color: "#b6b3d6", fontWeight: 700 }}>{tpl(t.rd_l2_step, { n: i + 1 })}</span>
                <div style={{ width: 46, height: 46, borderRadius: 13, display: "grid", placeItems: "center", fontSize: 21, marginBottom: 16, background: s.tint }}>{s.ic}</div>
                <h3 style={{ fontFamily: FD, fontSize: 18, marginBottom: 8, color: C.ink }}>{s.ti}</h3>
                <p style={{ fontSize: 15, color: C.inkSoft, margin: 0 }}>{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── INSIDE THE APP: dashboard assembly + deep dives ── */}
      <section id="inside" style={{ padding: "0 0 86px", scrollMarginTop: 70 }}>
        <div style={{ ...wrap, textAlign: "center" }}>
          <span className="sfl-lp-reveal" style={eyebrow}>{t.rd_l2_in_eyebrow}</span>
          <h2 className="sfl-lp-reveal" style={h2Style}>{t.rd_l2_in_h2}</h2>
          <p className="sfl-lp-reveal" style={secSub}>{t.rd_l2_in_sub}</p>

          {/* door-closing dashboard assembly (IntersectionObserver adds .sfl-l2-on) */}
          <div id="sflDashStage" style={{ marginTop: 50, background: "linear-gradient(160deg, #1d1946, #17143a)", borderRadius: 26, padding: 26, overflow: "hidden", textAlign: "left" }}>
            <div className="sfl-l2-dash">
              <div className="sfl-l2-piece sfl-l2-ptop" style={{ gridColumn: "1 / -1", background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 14, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", color: "#fff" }}>
                <b style={{ fontFamily: FD, fontSize: 14.5 }}>{t.rd_l2_dash_title}</b>
                <span style={{ fontFamily: FM, fontSize: 10, background: "rgba(16,185,129,.18)", color: "#6ee7c3", borderRadius: 999, padding: "4px 10px" }}>{t.rd_l2_dash_pill}</span>
              </div>
              <div className="sfl-l2-piece sfl-l2-pleft" style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.09)", borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                {[`🔴 ${t.rd_nav_live}`, "⛏️ Miners", `🛍️ ${t.rd_nav_orders}`, `📦 ${t.rd_nav_products}`, `📈 ${t.rd_l2_dash_reports}`, `⚙️ ${t.rd_nav_settings}`].map((label, i) => (
                  <span key={label} style={{ fontSize: 12.5, color: i === 2 ? "#fff" : "#b9b5e6", padding: "8px 10px", borderRadius: 8, background: i === 2 ? C.indigo : "transparent", fontWeight: i === 2 ? 700 : 500 }}>{label}</span>
                ))}
              </div>
              <div className="sfl-l2-piece sfl-l2-pright" style={{ display: "grid", gap: 14 }}>
                <div className="sfl-l2-kpis">
                  <div style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 13, padding: "13px 15px", color: "#fff" }}>
                    <small style={{ fontSize: 10, color: "#a5a1d6", letterSpacing: ".05em" }}>{t.rd_l2_kpi_rev}</small>
                    <b style={{ display: "block", fontFamily: FM, fontSize: 18, marginTop: 3 }}>NT$186,420</b>
                    <span style={{ color: "#6ee7c3", fontSize: 10, fontFamily: FM }}>{t.rd_l2_kpi_rev_up}</span>
                  </div>
                  <div style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 13, padding: "13px 15px", color: "#fff" }}>
                    <small style={{ fontSize: 10, color: "#a5a1d6", letterSpacing: ".05em" }}>{t.rd_l2_kpi_orders}</small>
                    <b style={{ display: "block", fontFamily: FM, fontSize: 18, marginTop: 3 }}>1,284</b>
                    <span style={{ color: "#6ee7c3", fontSize: 10, fontFamily: FM }}>▲ 11%</span>
                  </div>
                  <div style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 13, padding: "13px 15px", color: "#fff" }}>
                    <small style={{ fontSize: 10, color: "#a5a1d6", letterSpacing: ".05em" }}>{t.rd_l2_kpi_buyers}</small>
                    <b style={{ display: "block", fontFamily: FM, fontSize: 18, marginTop: 3 }}>447</b>
                    <span style={{ color: "#6ee7c3", fontSize: 10, fontFamily: FM }}>▲ 9%</span>
                  </div>
                </div>
                <div style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 13, padding: 15, color: "#fff" }}>
                  <small style={{ fontSize: 10, color: "#a5a1d6" }}>{t.rd_l2_chart_lab}</small>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 7, height: 90, marginTop: 12 }}>
                    {[38, 56, 44, 78, 62, 92, 70].map((h, i) => (
                      <div key={i} className="sfl-l2-bar" style={{ flex: 1, height: `${h}%`, background: `linear-gradient(180deg, ${C.violet}, ${C.indigo})`, borderRadius: "5px 5px 0 0" }} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <p style={{ textAlign: "center", color: "#8f8bc4", fontSize: 12.5, marginTop: 18, marginBottom: 0 }}>{t.rd_l2_dash_cap}</p>
          </div>

          {/* deep dive: print & ship */}
          <div id="deep-print" className="sfl-l2-deep" style={{ marginTop: 64, textAlign: "left", scrollMarginTop: 70 }}>
            <div>
              <span className="sfl-lp-reveal" style={eyebrow}>{t.rd_l2_d1_eyebrow}</span>
              <h3 className="sfl-lp-reveal" style={{ fontFamily: FD, fontSize: 24, marginBottom: 12, letterSpacing: "-.01em", color: C.ink }}>{t.rd_l2_d1_h3}</h3>
              <p className="sfl-lp-reveal" style={{ color: C.inkSoft, fontSize: 15.5 }}>{t.rd_l2_d1_p}</p>
              <ul className="sfl-lp-reveal" style={{ listStyle: "none", marginTop: 14, display: "grid", gap: 9, fontSize: 14.5, color: C.inkSoft, padding: 0 }}>
                {[t.rd_l2_d1_l1, t.rd_l2_d1_l2, t.rd_l2_d1_l3].map((li) => (
                  <li key={li}><span style={{ color: C.mint, fontWeight: 800, marginRight: 9 }}>✓</span>{li}</li>
                ))}
              </ul>
            </div>
            <div className="sfl-lp-reveal sfl-l2-deepvis" style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 20, padding: 26, boxShadow: "0 18px 44px rgba(23,20,58,.08)" }}>
              <MonoSlip>
                ============================<br />
                &nbsp;&nbsp;SELLERFLOW · ORDER SLIP<br />
                ============================<br />
                <b style={{ color: C.indigo }}>BUYER #14</b> · kuya.dave<br />
                2× Summer dress ······ NT$780<br />
                1× Hair clip set ····· NT$120<br />
                ----------------------------<br />
                TOTAL ············ <b style={{ color: C.indigo }}>NT$900</b><br />
                7-11 pickup · 中山門市<br />
                ✂ - - - - - - - - - - - - -
              </MonoSlip>
            </div>
          </div>

          {/* deep dive: multi-day (flipped) */}
          <div className="sfl-l2-deep sfl-l2-deepflip" style={{ marginTop: 64, textAlign: "left" }}>
            <div>
              <span className="sfl-lp-reveal" style={eyebrow}>{t.rd_l2_d2_eyebrow}</span>
              <h3 className="sfl-lp-reveal" style={{ fontFamily: FD, fontSize: 24, marginBottom: 12, letterSpacing: "-.01em", color: C.ink }}>{t.rd_l2_d2_h3}</h3>
              <p className="sfl-lp-reveal" style={{ color: C.inkSoft, fontSize: 15.5 }}>{t.rd_l2_d2_p}</p>
              <ul className="sfl-lp-reveal" style={{ listStyle: "none", marginTop: 14, display: "grid", gap: 9, fontSize: 14.5, color: C.inkSoft, padding: 0 }}>
                {[t.rd_l2_d2_l1, t.rd_l2_d2_l2, t.rd_l2_d2_l3].map((li) => (
                  <li key={li}><span style={{ color: C.mint, fontWeight: 800, marginRight: 9 }}>✓</span>{li}</li>
                ))}
              </ul>
            </div>
            <div className="sfl-lp-reveal sfl-l2-deepvis" style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 20, padding: 26, boxShadow: "0 18px 44px rgba(23,20,58,.08)" }}>
              <MonoSlip>
                SESSION — Day 2 of 3<br />
                ----------------------------<br />
                <b style={{ color: C.indigo }}>#12</b> mei.chen88 ···· 3 orders<br />
                <b style={{ color: C.indigo }}>#13</b> abby.shop ····· 1 order<br />
                <b style={{ color: C.indigo }}>#14</b> kuya.dave ····· 2 orders<br />
                <b style={{ color: C.indigo }}>#15</b> cherry_go ····· 4 orders<br />
                ----------------------------<br />
                same numbers · both devices ✓
              </MonoSlip>
            </div>
          </div>
        </div>
      </section>

      {/* ── BENTO FEATURES ── */}
      <section id="features" style={{ background: "#fff", borderBlock: `1px solid ${C.line}`, padding: "86px 0", scrollMarginTop: 70 }}>
        <div style={wrap}>
          <span className="sfl-lp-reveal" style={eyebrow}>{t.rd_l2_f_eyebrow}</span>
          <h2 className="sfl-lp-reveal" style={h2Style}>{t.rd_l2_f_h2}</h2>
          <p className="sfl-lp-reveal" style={{ ...secSub, margin: 0 }}>{t.rd_l2_f_sub}</p>
          <div className="sfl-l2-bento" style={{ marginTop: 46 }}>
            {BENTO.map((c, i) => (
              <div key={c.ti} className={`sfl-lp-reveal sfl-lp-lift sfl-lp-hovshadow sfl-l2-span${c.span}`} style={{ background: c.hero ? `linear-gradient(135deg, ${C.indigo}, ${C.violet})` : C.card, border: c.hero ? "none" : `1px solid ${C.line}`, borderRadius: 20, padding: 24, color: c.hero ? "#fff" : undefined, ...rv(i, 0.06) }}>
                <span style={{ fontSize: 24 }}>{c.ic}</span>
                <h3 style={{ fontFamily: FD, fontSize: 17, margin: "12px 0 6px", color: c.hero ? "#fff" : C.ink }}>{c.ti}</h3>
                <p style={{ fontSize: 14, color: c.hero ? "rgba(255,255,255,.82)" : C.inkSoft, margin: 0 }}>{c.d}</p>
                {c.hero && (
                  <div style={{ marginTop: 14, background: "rgba(255,255,255,.14)", border: "1px dashed rgba(255,255,255,.45)", borderRadius: 10, padding: "9px 12px", fontFamily: FM, fontSize: 11, lineHeight: 1.7 }}>
                    mine! → ✓ Buyer #12 · NT$390<br />M +1 → ✓ Buyer #13 · NT$250
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── VIDEO (poster placeholder — demo video to follow) ── */}
      <section style={{ padding: "86px 0" }}>
        <div style={{ ...wrap, textAlign: "center" }}>
          <span className="sfl-lp-reveal" style={eyebrow}>{t.rd_l2_v_eyebrow}</span>
          <h2 className="sfl-lp-reveal" style={h2Style}>{t.rd_l2_v_h2}</h2>
          <div className="sfl-lp-reveal" style={{ marginTop: 44, background: C.ink, borderRadius: 24, aspectRatio: "16/9", display: "grid", placeItems: "center", position: "relative", overflow: "hidden" }}>
            <div aria-hidden style={{ position: "absolute", inset: 0, background: "radial-gradient(500px 300px at 30% 20%, rgba(139,92,246,.35), transparent), radial-gradient(500px 320px at 75% 80%, rgba(79,70,229,.4), transparent)" }} />
            <div style={{ position: "relative", width: 74, height: 74, borderRadius: "50%", background: "#fff", display: "grid", placeItems: "center", fontSize: 24, color: C.indigo, boxShadow: "0 14px 40px rgba(0,0,0,.35)" }}>▶</div>
            <span style={{ position: "absolute", bottom: 20, left: 24, color: "rgba(255,255,255,.85)", fontSize: 13.5, fontWeight: 600 }}>{t.rd_l2_v_cap}</span>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" style={{ background: "#fff", borderBlock: `1px solid ${C.line}`, padding: "86px 0", scrollMarginTop: 70 }}>
        <div style={{ ...wrap, textAlign: "center" }}>
          <span className="sfl-lp-reveal" style={eyebrow}>{t.rd_lp_nav_faq}</span>
          <h2 className="sfl-lp-reveal" style={h2Style}>{t.rd_l2_faq_h2}</h2>
          <div style={{ maxWidth: 720, margin: "44px auto 0", display: "grid", gap: 12, textAlign: "left" }}>
            {FAQS.map((f, i) => {
              const open = faqOpen === i;
              return (
                <div key={f.q} className="sfl-lp-reveal" style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, overflow: "hidden", ...rv(i, 0.05) }}>
                  <button onClick={() => setFaqOpen(open ? -1 : i)} aria-expanded={open} style={{ width: "100%", cursor: "pointer", padding: "18px 22px", fontWeight: 700, fontFamily: FD, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 15.5, background: "none", border: "none", color: C.ink, textAlign: "left", gap: 12 }}>
                    {f.q}
                    <span style={{ fontSize: 21, color: C.indigo, transition: "transform .2s", transform: open ? "rotate(45deg)" : "none", flexShrink: 0 }}>+</span>
                  </button>
                  {open && <div style={{ padding: "0 22px 18px", color: C.inkSoft, fontSize: 14.5 }}>{f.a}</div>}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section style={{ background: "#fff", borderBottom: `1px solid ${C.line}`, padding: "86px 0" }}>
        <div style={{ ...wrap, textAlign: "center" }}>
          <span className="sfl-lp-reveal" style={eyebrow}>{t.rd_l2_q_eyebrow}</span>
          <h2 className="sfl-lp-reveal" style={h2Style}>{t.rd_l2_q_h2}</h2>
          <div className="sfl-l2-quotes" style={{ marginTop: 44, textAlign: "left" }}>
            {QUOTES.map((q, i) => (
              <div key={q.who} className="sfl-lp-reveal sfl-lp-lift sfl-lp-hovshadow" style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 18, padding: 24, fontSize: 14.5, ...rv(i, 0.1) }}>
                <div style={{ color: C.amber, letterSpacing: 2, marginBottom: 10, fontSize: 13.5 }}>★★★★★</div>
                <p style={{ color: C.ink, margin: 0 }}>{q.q}</p>
                <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", fontSize: 12.5, color: C.inkSoft }}>
                  <span style={{ width: 32, height: 32, borderRadius: "50%", display: "grid", placeItems: "center", color: "#fff", fontWeight: 800, fontSize: 11.5, background: q.av }}>{q.ch}</span>
                  {q.who}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── GUIDE CENTER ── */}
      <section id="guide" style={{ padding: "86px 0", scrollMarginTop: 70 }}>
        <div style={{ ...wrap, textAlign: "center" }}>
          <span className="sfl-lp-reveal" style={eyebrow}>{t.rd_l2_g_eyebrow}</span>
          <h2 className="sfl-lp-reveal" style={h2Style}>{t.rd_l2_g_h2}</h2>
          <p className="sfl-lp-reveal" style={secSub}>{t.rd_l2_g_sub}</p>
          <div className="sfl-l2-guides" style={{ marginTop: 44, textAlign: "left" }}>
            {GUIDES.map((g, i) => (
              <button key={g.ti} onClick={onSignup} className="sfl-lp-reveal sfl-lp-lift sfl-lp-hovshadow" style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 18, padding: 22, cursor: "pointer", textAlign: "left", fontFamily: FU, ...rv(i, 0.08) }}>
                <span style={{ fontSize: 22 }}>{g.ic}</span>
                <h3 style={{ fontFamily: FD, fontSize: 15.5, margin: "10px 0 5px", color: C.ink }}>{g.ti}</h3>
                <p style={{ fontSize: 13, color: C.inkSoft, margin: 0 }}>{g.d}</p>
                <span style={{ display: "inline-block", marginTop: 12, fontSize: 13, fontWeight: 700, color: C.indigo }}>{t.rd_l2_g_go}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section style={{ padding: "0 0 86px" }}>
        <div style={wrap}>
          <div className="sfl-lp-reveal" style={{ background: `linear-gradient(130deg, ${C.indigoDeep}, ${C.indigo} 55%, ${C.violet})`, borderRadius: 28, color: "#fff", textAlign: "center", padding: "70px 28px", position: "relative", overflow: "hidden" }}>
            <div aria-hidden style={{ position: "absolute", inset: 0, background: "radial-gradient(420px 260px at 80% 15%, rgba(255,255,255,.14), transparent)" }} />
            <h2 style={{ ...h2Style, color: "#fff", position: "relative" }}>{t.rd_l2_cta_h2}</h2>
            <p style={{ ...secSub, color: "rgba(255,255,255,.85)", margin: "0 auto 30px", position: "relative" }}>{t.rd_l2_cta_sub}</p>
            <div style={{ position: "relative" }}>
              <button onClick={onSignup} className="sfl-lp-lift" style={{ ...btnPrimary, ...btnHero, background: "#fff", color: C.indigo, boxShadow: "0 10px 30px rgba(0,0,0,.25)" }}>{t.rd_l2_cta_try}</button>
              <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 22, flexWrap: "wrap" }}>
                <StoreBadge kind="play" />
                <StoreBadge kind="ios" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ borderTop: `1px solid ${C.line}`, background: "#fff", padding: "52px 0 34px" }}>
        <div style={wrap}>
          <div className="sfl-l2-fgrid">
            <div>
              <span style={{ fontFamily: FD, fontWeight: 700, fontSize: 17, display: "flex", alignItems: "center", gap: 9, color: C.ink }}>
                <img src="/landing-logo.png" alt="" style={{ width: 30, height: 30, objectFit: "contain" }} />
                SellerFlowLive
              </span>
              <p style={{ fontSize: 14, color: C.inkSoft, marginTop: 12, maxWidth: "24rem" }}>{t.rd_l2_f_desc}</p>
              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                <a href={TELEGRAM_URL} target="_blank" rel="noreferrer" title="Telegram" style={{ width: 36, height: 36, borderRadius: 10, background: C.paper, border: `1px solid ${C.line}`, display: "grid", placeItems: "center", fontSize: 16, textDecoration: "none" }}>✈️</a>
              </div>
            </div>
            <div>
              <h4 style={{ fontFamily: FD, fontSize: 14, marginBottom: 14, color: C.ink }}>{t.rd_lp_foot_product}</h4>
              {[[t.rd_lp_nav_how, "how"], [t.rd_lp_nav_features, "features"], [t.rd_lp_nav_faq, "faq"]].map(([label, id]) => (
                <button key={id} onClick={() => scrollToId(id)} style={{ display: "block", fontSize: 14, color: C.inkSoft, marginBottom: 9, background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: FU, textAlign: "left" }}>{label}</button>
              ))}
            </div>
            <div>
              <h4 style={{ fontFamily: FD, fontSize: 14, marginBottom: 14, color: C.ink }}>{t.rd_lp_foot_support}</h4>
              <button onClick={onSignup} style={{ display: "block", fontSize: 14, color: C.inkSoft, marginBottom: 9, background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: FU, textAlign: "left" }}>{t.rd_l2_foot_guide}</button>
              <button onClick={() => scrollToId("faq")} style={{ display: "block", fontSize: 14, color: C.inkSoft, marginBottom: 9, background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: FU, textAlign: "left" }}>{t.rd_lp_nav_faq}</button>
              <a href={TELEGRAM_URL} target="_blank" rel="noreferrer" style={{ display: "block", fontSize: 14, color: C.inkSoft, marginBottom: 9, textDecoration: "none" }}>{t.rd_l2_foot_tg}</a>
            </div>
            <div>
              <h4 style={{ fontFamily: FD, fontSize: 14, marginBottom: 14, color: C.ink }}>{t.rd_l2_foot_getapp}</h4>
              <a href={PLAY_URL} target="_blank" rel="noreferrer" style={{ display: "block", fontSize: 14, color: C.inkSoft, marginBottom: 9, textDecoration: "none" }}>Google Play</a>
              <a href={APPSTORE_URL} target="_blank" rel="noreferrer" style={{ display: "block", fontSize: 14, color: C.inkSoft, marginBottom: 9, textDecoration: "none" }}>App Store</a>
              <button onClick={onSignup} style={{ display: "block", fontSize: 14, color: C.inkSoft, marginBottom: 9, background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: FU, textAlign: "left" }}>{t.rd_l2_foot_web}</button>
            </div>
          </div>
          <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 40, paddingTop: 22, display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap", fontSize: 12.5, color: C.inkSoft }}>
            <span>{t.rd_l2_foot_bottom}</span>
            <a href="/privacy/" style={{ color: C.inkSoft }}>{t.rd_l2_privacy}</a>
          </div>
        </div>
      </footer>

      {/* ── HELP FAB ── */}
      <a className="sfl-lp-lift" href={TELEGRAM_URL} target="_blank" rel="noreferrer" style={{ position: "fixed", right: 22, bottom: 22, zIndex: 60, background: C.indigo, color: "#fff", borderRadius: 999, padding: "13px 20px", fontWeight: 700, fontSize: 14, display: "flex", gap: 9, alignItems: "center", boxShadow: "0 14px 36px rgba(79,70,229,.4)", textDecoration: "none" }}>{t.rd_l2_fab}</a>
    </div>
  );
}
