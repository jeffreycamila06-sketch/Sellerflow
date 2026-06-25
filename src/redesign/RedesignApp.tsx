// Redesign root. Owns theme/accent/screen state + the live feed, sets
// [data-theme]/[data-accent] on the [data-redesign] root (tokens resolve from
// src/styles/design-tokens.css), and renders all built screens + bottom nav.
// Self-contained preview — does NOT import or touch the existing app.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { INCOMING, SEED_COMMENTS, LANGS, type Comment, type ThemeMode, type AccentKey, type AutoControls } from "./data";
import Dashboard from "./screens/Dashboard";
import Orders from "./screens/Orders";
import Products from "./screens/Products";
import Miners from "./screens/Miners";
import Login from "./screens/Login";
import SettingsHub from "./screens/SettingsHub";
import GeneralSettings from "./screens/GeneralSettings";
import Customers from "./screens/Customers";
import Subscription from "./screens/Subscription";
import Support from "./screens/Support";
import Admin, { AdminPanel, type AdminPanelKind } from "./screens/Admin";
import Print from "./screens/Print";
import SalesReport from "./screens/SalesReport";
import Shipping from "./screens/Shipping";
import CustomerData from "./screens/CustomerData";
import Legal from "./screens/Legal";
import DeleteAccount from "./screens/DeleteAccount";

type Screen =
  | "login" | "dashboard" | "miners" | "orders" | "products"
  | "menu" | "settings" | "customers" | "subscription" | "support"
  | "admin" | "print" | "sales" | "shipping" | "customerdata" | "legal" | "delete";

// Screens grouped under the Settings bottom-nav tab (tab is "active" for all).
const SETTINGS_GROUP: Screen[] = ["menu", "settings", "customers", "subscription", "support", "admin", "sales", "shipping", "customerdata", "legal", "delete"];

const LS = { theme: "sfl_rd_theme", accent: "sfl_rd_accent", lang: "sfl_rd_lang" } as const;
const readLS = (k: string, fallback: string): string => {
  try { return localStorage.getItem(k) || fallback; } catch { return fallback; }
};
const ACCENT_KEYS: AccentKey[] = ["indigo", "violet", "emerald", "rose", "sky", "amber"];
const safeAccent = (v: string): AccentKey => (ACCENT_KEYS.includes(v as AccentKey) ? (v as AccentKey) : "indigo");

export default function RedesignApp() {
  const [theme, setTheme] = useState<ThemeMode>(() => (readLS(LS.theme, "light") === "dark" ? "dark" : "light"));
  const [accent, setAccent] = useState<AccentKey>(() => safeAccent(readLS(LS.accent, "indigo")));
  const [screen, setScreen] = useState<Screen>("login");
  const [adminPanel, setAdminPanel] = useState<AdminPanelKind | null>(null);
  const [assignAmount, setAssignAmount] = useState("499");
  const [lang, setLang] = useState<string>(() => readLS(LS.lang, "en"));
  const [langOpen, setLangOpen] = useState(false);
  const [langPickerOpen, setLangPickerOpen] = useState(false);

  // Dashboard account pickers (visual only — Phase 5 wires real switching).
  const [ttOpen, setTtOpen] = useState(false);
  const [fbOpen, setFbOpen] = useState(false);
  const [ttIdx, setTtIdx] = useState(0);
  const [fbIdx, setFbIdx] = useState(0);

  // General Settings local UI state (visual only).
  const [profileOpen, setProfileOpen] = useState(false);
  const [printerOpen, setPrinterOpen] = useState(false);
  const [printerIdx, setPrinterIdx] = useState(0);

  // Auto-detect keyword feature (visual only). Defaults from dc.html v2 (L1160).
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
  const autoControls: AutoControls = {
    detect: autoDetect, setupOpen: autoSetupOpen, action: autoAction, words: autoWords, input: autoInput,
    toggle: () => setAutoDetect((v) => !v),
    toggleSetup: () => setAutoSetupOpen((o) => !o),
    setAction: setAutoAction,
    removeWord: (i) => setAutoWords((ws) => ws.filter((_, j) => j !== i)),
    setInput: setAutoInput,
    addWord: addAutoWord,
  };

  const [comments, setComments] = useState<Comment[]>(SEED_COMMENTS);
  const [viewers, setViewers] = useState(1284);
  const [liveClaims, setLiveClaims] = useState(47);
  const cid = useRef(1);
  const pushIdx = useRef(0);

  // Persist appearance (redesign-namespaced keys; never touches existing keys).
  useEffect(() => { try { localStorage.setItem(LS.theme, theme); } catch { /* ignore */ } }, [theme]);
  useEffect(() => { try { localStorage.setItem(LS.accent, accent); } catch { /* ignore */ } }, [accent]);
  useEffect(() => { try { localStorage.setItem(LS.lang, lang); } catch { /* ignore */ } }, [lang]);

  // Live comment feed — prepend every 2.7s, cap 11, bump claims on "mine".
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
  const ordersActive = screen === "orders" || screen === "print";
  const navColor = (on: boolean) => (on ? "var(--accent-fg)" : "var(--text-muted)");
  const navBg = (on: boolean) => (on ? "var(--accent-soft)" : "transparent");
  const navBtn = (on: boolean): CSSProperties => ({ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "7px 0", border: "none", background: navBg(on), borderRadius: 12, cursor: "pointer", color: navColor(on), fontFamily: "var(--font-ui)" });
  const settingsActive = SETTINGS_GROUP.includes(screen);

  return (
    <div data-redesign="" data-theme={theme} data-accent={accent} className="sfl-stage">
      <div className="sfl-phone">
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
              comments={comments} viewers={viewers} liveClaims={liveClaims}
              ttOpen={ttOpen} fbOpen={fbOpen} ttIdx={ttIdx} fbIdx={fbIdx}
              onToggleTT={() => { setTtOpen((o) => !o); setFbOpen(false); }}
              onToggleFB={() => { setFbOpen((o) => !o); setTtOpen(false); }}
              onPickTT={(i) => { setTtIdx(i); setTtOpen(false); }}
              onPickFB={(i) => { setFbIdx(i); setFbOpen(false); }}
              onGoOrders={() => setScreen("orders")}
            />
          )}
          {screen === "orders" && <Orders onGoPrint={() => setScreen("print")} />}
          {screen === "products" && <Products />}
          {screen === "miners" && <Miners />}
          {screen === "menu" && (
            <SettingsHub
              onGeneral={() => setScreen("settings")}
              onLanguage={() => setLangPickerOpen(true)}
              onCustomers={() => setScreen("customers")}
              onAdmin={() => setScreen("admin")}
              onSales={() => setScreen("sales")}
              onShipping={() => setScreen("shipping")}
              onCustomerData={() => setScreen("customerdata")}
              onLegal={() => setScreen("legal")}
              onDelete={() => setScreen("delete")}
              onLogout={() => setScreen("login")}
            />
          )}
          {screen === "settings" && (
            <GeneralSettings
              theme={theme} accent={accent} onSetTheme={setTheme} onSetAccent={setAccent}
              auto={autoControls}
              profileOpen={profileOpen} onToggleProfile={() => setProfileOpen((o) => !o)}
              printerIdx={printerIdx} printerOpen={printerOpen}
              onTogglePrinter={() => setPrinterOpen((o) => !o)} onPickPrinter={(i) => { setPrinterIdx(i); setPrinterOpen(false); }}
              onLanguage={() => setLangPickerOpen(true)}
              onSubscription={() => setScreen("subscription")}
              onSupport={() => setScreen("support")}
              onDelete={() => setScreen("delete")}
            />
          )}
          {screen === "customers" && <Customers />}
          {screen === "subscription" && <Subscription />}
          {screen === "support" && <Support onLegal={() => setScreen("legal")} />}
          {screen === "admin" && <Admin onOpenPanel={setAdminPanel} />}
          {screen === "print" && <Print onBack={() => setScreen("orders")} />}
          {screen === "sales" && <SalesReport />}
          {screen === "shipping" && <Shipping />}
          {screen === "customerdata" && <CustomerData onLegal={() => setScreen("legal")} />}
          {screen === "legal" && <Legal />}
          {screen === "delete" && <DeleteAccount onBack={() => setScreen("settings")} />}
        </div>

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
            <button onClick={() => setScreen("orders")} style={navBtn(ordersActive)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M6 7h12l-1 12a2 2 0 0 1-2 1.8H9A2 2 0 0 1 7 19L6 7Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M9 7a3 3 0 0 1 6 0" stroke="currentColor" strokeWidth="1.7" /></svg>
              <span style={{ fontSize: 10, fontWeight: 700 }}>Orders</span>
            </button>
            <button onClick={() => setScreen("products")} style={navBtn(screen === "products")}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="m4 8.5 8 4.5 8-4.5M12 13v7" stroke="currentColor" strokeWidth="1.7" /></svg>
              <span style={{ fontSize: 10, fontWeight: 700 }}>Products</span>
            </button>
            <button onClick={() => setScreen("menu")} style={navBtn(settingsActive)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" /><path d="M19.4 13c.04-.3.06-.66.06-1s-.02-.7-.06-1l2.1-1.6-2-3.5-2.5 1a7.5 7.5 0 0 0-1.7-1l-.4-2.6H9.1l-.4 2.6c-.6.25-1.18.58-1.7 1l-2.5-1-2 3.5L4.6 11c-.04.3-.06.66-.06 1s.02.7.06 1l-2.1 1.6 2 3.5 2.5-1c.52.42 1.1.75 1.7 1l.4 2.6h5.8l.4-2.6c.6-.25 1.18-.58 1.7-1l2.5 1 2-3.5-2.1-1.6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
              <span style={{ fontSize: 10, fontWeight: 700 }}>Settings</span>
            </button>
          </div>
        )}

        {/* Admin control bottom-sheet (absolute within the phone, like the v2 prototype) */}
        {adminPanel && (
          <AdminPanel panel={adminPanel} onClose={() => setAdminPanel(null)} assignAmount={assignAmount} onAssignAmount={setAssignAmount} />
        )}
      </div>

      {/* Language picker (hub Language tile / General Settings language row) */}
      {langPickerOpen && (
        <div onClick={() => setLangPickerOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 320, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, boxShadow: "0 18px 44px rgba(0,0,0,.4)", padding: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".1em", color: "var(--text-muted)", padding: "8px 10px 9px" }}>APP LANGUAGE</div>
            {LANGS.map((l) => (
              <button key={l.code} onClick={() => { setLang(l.code); setLangPickerOpen(false); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px", border: "none", borderRadius: 10, background: l.code === lang ? "var(--accent-soft)" : "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)" }}>
                <span style={{ fontSize: 18, lineHeight: 1 }}>{l.flag}</span>
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>{l.label}</span>
                <span style={{ color: "var(--accent-fg)", fontWeight: 800, fontSize: 14, width: 14 }}>{l.code === lang ? "✓" : ""}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
