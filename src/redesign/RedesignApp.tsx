// Redesign root (Phase 2). Owns theme/accent/screen state + the live feed, sets
// [data-theme]/[data-accent] on the [data-redesign] root (tokens resolve from
// src/styles/design-tokens.css), and renders the 5 core screens + bottom nav.
// Self-contained preview — does NOT import or touch the existing app.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { INCOMING, SEED_COMMENTS, type Comment, type ThemeMode, type AccentKey } from "./data";
import Dashboard from "./screens/Dashboard";
import Orders from "./screens/Orders";
import Products from "./screens/Products";
import Miners from "./screens/Miners";
import Login from "./screens/Login";

type Screen = "login" | "dashboard" | "miners" | "orders" | "products" | "settings";

const LS = {
  theme: "sfl_rd_theme",
  accent: "sfl_rd_accent",
  lang: "sfl_rd_lang",
} as const;
const readLS = (k: string, fallback: string): string => {
  try { return localStorage.getItem(k) || fallback; } catch { return fallback; }
};

export default function RedesignApp() {
  const [theme, setTheme] = useState<ThemeMode>(() => (readLS(LS.theme, "light") === "dark" ? "dark" : "light"));
  const [accent] = useState<AccentKey>(() => (readLS(LS.accent, "indigo") as AccentKey));
  const [screen, setScreen] = useState<Screen>("login");
  const [lang, setLang] = useState<string>(() => readLS(LS.lang, "en"));
  const [langOpen, setLangOpen] = useState(false);

  // Dashboard account pickers (visual only; selection/open state local — no real
  // account switching, which is Phase 5).
  const [ttOpen, setTtOpen] = useState(false);
  const [fbOpen, setFbOpen] = useState(false);
  const [ttIdx, setTtIdx] = useState(0);
  const [fbIdx, setFbIdx] = useState(0);

  // Auto-detect keyword feature (visual only — no real comment detection /
  // automation, which is Phase 5). Defaults from dc.html v2 state (L1160).
  const [autoDetect, setAutoDetect] = useState(true);
  const [autoSetupOpen, setAutoSetupOpen] = useState(false);
  const [autoAction, setAutoAction] = useState<"slip" | "sticker">("slip");
  const [autoWords, setAutoWords] = useState<string[]>(["mine", "claim", "sold", "get", "take"]);
  const [autoInput, setAutoInput] = useState("");
  const addAutoWord = () => {
    const w = autoInput.trim().toLowerCase();
    if (w && !autoWords.includes(w) && autoWords.length < 20) setAutoWords((ws) => [...ws, w]);
    setAutoInput("");
  };

  const [comments, setComments] = useState<Comment[]>(SEED_COMMENTS);
  const [viewers, setViewers] = useState(1284);
  const [liveClaims, setLiveClaims] = useState(47);
  const cid = useRef(1);
  const pushIdx = useRef(0);

  // Persist appearance choices (redesign-namespaced keys; never touches the
  // existing app's localStorage keys).
  useEffect(() => { try { localStorage.setItem(LS.theme, theme); } catch { /* ignore */ } }, [theme]);
  useEffect(() => { try { localStorage.setItem(LS.lang, lang); } catch { /* ignore */ } }, [lang]);

  // Live comment feed — prepend every 2.7s, cap 11, bump claims on "mine",
  // jitter viewers. (dc.html componentDidMount / pushComment L956–987.)
  useEffect(() => {
    const t = setInterval(() => {
      const inc = INCOMING[pushIdx.current % INCOMING.length];
      pushIdx.current += 1;
      const c: Comment = { ...inc, id: "c" + cid.current++, time: "now" };
      setComments((prev) => [c, ...prev.map((x) => ({ ...x, time: x.time === "now" ? "2s" : x.time }))].slice(0, 11));
      if (inc.mine) setLiveClaims((n) => n + 1);
      setViewers((v) => Math.max(900, v + Math.round((Math.random() - 0.35) * 22)));
    }, 2700);
    return () => clearInterval(t);
  }, []);

  const showNav = screen !== "login";
  const navColor = (on: boolean) => (on ? "var(--accent-fg)" : "var(--text-muted)");
  const navBg = (on: boolean) => (on ? "var(--accent-soft)" : "transparent");
  const navBtn = (on: boolean): CSSProperties => ({ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "7px 0", border: "none", background: navBg(on), borderRadius: 12, cursor: "pointer", color: navColor(on), fontFamily: "var(--font-ui)" });

  return (
    <div data-redesign="" data-theme={theme} data-accent={accent} className="sfl-stage">
      <div className="sfl-phone">
        {/* decorative dark-bg layers (dark theme only) */}
        {theme === "dark" && (
          <>
            <div className="sfl-grid" />
            <div className="sfl-glow-a" />
            <div className="sfl-glow-cyan" />
          </>
        )}

        {/* faux status bar (dc.html L91–98) */}
        <div style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 22px 5px", fontSize: 13, fontWeight: 700, color: "var(--text)", flexShrink: 0 }}>
          <span style={{ fontFamily: "var(--font-mono)", letterSpacing: "-.02em" }}>9:41</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <svg width="17" height="11" viewBox="0 0 18 12" fill="none"><rect x="0" y="7" width="3" height="5" rx="1" fill="currentColor" /><rect x="5" y="4" width="3" height="8" rx="1" fill="currentColor" /><rect x="10" y="1.5" width="3" height="10.5" rx="1" fill="currentColor" opacity=".4" /><rect x="15" y="0" width="3" height="12" rx="1" fill="currentColor" opacity=".4" /></svg>
            <svg width="16" height="11" viewBox="0 0 16 12" fill="none"><path d="M8 10.5 1.5 4a9 9 0 0 1 13 0L8 10.5Z" stroke="currentColor" strokeWidth="1.4" fill="none" opacity=".55" /><circle cx="8" cy="9.5" r="1.3" fill="currentColor" /></svg>
            <svg width="24" height="12" viewBox="0 0 26 13" fill="none"><rect x="1" y="1" width="21" height="11" rx="3" stroke="currentColor" strokeWidth="1.3" opacity=".5" /><rect x="3" y="3" width="15" height="7" rx="1.5" fill="currentColor" /><rect x="23.5" y="4" width="2" height="5" rx="1" fill="currentColor" opacity=".5" /></svg>
          </div>
        </div>

        {/* scrollable screen content */}
        <div className="sfl-scroll">
          {screen === "login" && (
            <Login
              onLogin={() => setScreen("dashboard")}
              lang={lang}
              langOpen={langOpen}
              onToggleLang={() => setLangOpen((o) => !o)}
              onPickLang={(code) => { setLang(code); setLangOpen(false); }}
            />
          )}
          {screen === "dashboard" && (
            <Dashboard
              comments={comments}
              viewers={viewers}
              liveClaims={liveClaims}
              ttOpen={ttOpen}
              fbOpen={fbOpen}
              ttIdx={ttIdx}
              fbIdx={fbIdx}
              onToggleTT={() => { setTtOpen((o) => !o); setFbOpen(false); }}
              onToggleFB={() => { setFbOpen((o) => !o); setTtOpen(false); }}
              onPickTT={(i) => { setTtIdx(i); setTtOpen(false); }}
              onPickFB={(i) => { setFbIdx(i); setFbOpen(false); }}
              onGoOrders={() => setScreen("orders")}
              auto={{
                detect: autoDetect,
                setupOpen: autoSetupOpen,
                action: autoAction,
                words: autoWords,
                input: autoInput,
                toggle: () => setAutoDetect((v) => !v),
                toggleSetup: () => setAutoSetupOpen((o) => !o),
                setAction: setAutoAction,
                removeWord: (i) => setAutoWords((ws) => ws.filter((_, j) => j !== i)),
                setInput: setAutoInput,
                addWord: addAutoWord,
              }}
            />
          )}
          {screen === "orders" && <Orders />}
          {screen === "products" && <Products />}
          {screen === "miners" && <Miners />}
          {screen === "settings" && (
            <div style={{ padding: 24 }}>
              <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px", margin: "-24px -24px 18px", borderRadius: 0 }}>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19, letterSpacing: "-.01em" }}>Settings</div>
                <div style={{ fontSize: 12, opacity: 0.85, marginTop: 1 }}>Shop tools &amp; account</div>
              </div>
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 15, padding: 18, boxShadow: "var(--shadow)", color: "var(--text-dim)", fontSize: 13, lineHeight: 1.6 }}>
                The Settings hub and its sub-screens are built in <strong style={{ color: "var(--text)" }}>Phase 3</strong>. This placeholder keeps the 5-tab bottom nav complete for the Phase 2 core-screen preview.
              </div>
            </div>
          )}
        </div>

        {/* bottom nav (hidden on login) — dc.html L825–848 */}
        {showNav && (
          <div style={{ position: "relative", zIndex: 3, flexShrink: 0, display: "flex", alignItems: "stretch", justifyContent: "space-around", padding: "8px 8px calc(8px + env(safe-area-inset-bottom))", background: "var(--nav-bg)", borderTop: "1px solid var(--border)", backdropFilter: "saturate(1.4) blur(14px)" }}>
            <button onClick={() => setScreen("dashboard")} style={navBtn(screen === "dashboard")}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" fill="currentColor" /><circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="1.7" opacity=".55" /></svg>
              <span style={{ fontSize: 10, fontWeight: 700 }}>Live</span>
            </button>
            <button onClick={() => setScreen("miners")} style={navBtn(screen === "miners")}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 19V11M9 19V5M14 19v-6M19 19V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              <span style={{ fontSize: 10, fontWeight: 700 }}>Miners</span>
            </button>
            <button onClick={() => setScreen("orders")} style={navBtn(screen === "orders")}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M6 7h12l-1 12a2 2 0 0 1-2 1.8H9A2 2 0 0 1 7 19L6 7Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M9 7a3 3 0 0 1 6 0" stroke="currentColor" strokeWidth="1.7" /></svg>
              <span style={{ fontSize: 10, fontWeight: 700 }}>Orders</span>
            </button>
            <button onClick={() => setScreen("products")} style={navBtn(screen === "products")}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="m4 8.5 8 4.5 8-4.5M12 13v7" stroke="currentColor" strokeWidth="1.7" /></svg>
              <span style={{ fontSize: 10, fontWeight: 700 }}>Products</span>
            </button>
            <button onClick={() => setScreen("settings")} style={navBtn(screen === "settings")}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" /><path d="M19.4 13c.04-.3.06-.66.06-1s-.02-.7-.06-1l2.1-1.6-2-3.5-2.5 1a7.5 7.5 0 0 0-1.7-1l-.4-2.6H9.1l-.4 2.6c-.6.25-1.18.58-1.7 1l-2.5-1-2 3.5L4.6 11c-.04.3-.06.66-.06 1s.02.7.06 1l-2.1 1.6 2 3.5 2.5-1c.52.42 1.1.75 1.7 1l.4 2.6h5.8l.4-2.6c.6-.25 1.18-.58 1.7-1l2.5 1 2-3.5-2.1-1.6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
              <span style={{ fontSize: 10, fontWeight: 700 }}>Settings</span>
            </button>
          </div>
        )}
      </div>

      {/* theme toggle (preview affordance — Appearance controls move into the
          General Settings screen in Phase 3) */}
      <button
        onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        title="Toggle theme (preview)"
        style={{ position: "fixed", top: 10, right: 10, zIndex: 50, width: 36, height: 36, borderRadius: 10, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)", cursor: "pointer", boxShadow: "var(--shadow)" }}
      >
        {theme === "dark" ? "☀" : "☾"}
      </button>
    </div>
  );
}
