// Redesign root. Owns theme/accent/screen state + the live feed, sets
// [data-theme]/[data-accent] on the [data-redesign] root (tokens resolve from
// src/styles/design-tokens.css), and renders all built screens + bottom nav.
// Self-contained preview — does NOT import or touch the existing app.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CURRENCIES, curSymbol, type ThemeMode, type AccentKey, type AutoControls, type AutoWord } from "./data";
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
import Signup from "./screens/Signup";
import PrinterSettings from "./screens/PrinterSettings";
import PrintPattern, { DEFAULT_PP, type PrintPatternState, type PpBoolKey, type PpSizeKey } from "./screens/PrintPattern";
import { useAuthSession, DEFAULT_CURRENCY } from "./adapters/useAuthSession";
import { useCustomers, useAdminUsers, liveOrdersToRedesign, type ReadState } from "./adapters/useReadData";
import { useLiveSession } from "./adapters/useLiveSession";
import { useSessionWindow } from "./adapters/useSessionWindow";
import { useLiveFeed } from "./adapters/useLiveFeed";
import { useOrders } from "./adapters/useOrders";
import { useFreeCap } from "./adapters/useFreeCap";
import { useAdmin } from "./adapters/useAdmin";
import { upsertUser } from "../accountDb";
import { csvDL, dayStamp } from "./adapters/csv";
import { printSlip, buildSettingsFromRedesign, type Settings as PrintSettings } from "./adapters/printing";
import type { Buyer } from "../lib/orderTypes";
import CapPopup from "./screens/CapPopup";

type Screen =
  | "login" | "signup" | "dashboard" | "miners" | "orders" | "products"
  | "menu" | "settings" | "customers" | "subscription" | "support"
  | "admin" | "print" | "sales" | "shipping" | "customerdata" | "legal" | "delete"
  | "printersettings" | "printpattern";

// Screens grouped under the Settings bottom-nav tab (tab is "active" for all).
const SETTINGS_GROUP: Screen[] = ["menu", "settings", "customers", "subscription", "support", "admin", "sales", "shipping", "customerdata", "legal", "delete", "printersettings", "printpattern"];

const LS = { theme: "sfl_rd_theme", accent: "sfl_rd_accent", lang: "sfl_rd_lang", currency: "sfl_rd_currency", currencySet: "sfl_rd_currency_set", autowords: "sfl_rd_autowords", pp: "sfl_rd_pp", printer: "sfl_rd_printer" } as const;
const readLS = (k: string, fallback: string): string => {
  try { return localStorage.getItem(k) || fallback; } catch { return fallback; }
};
// 5i — JSON-typed read for persisted settings (auto-detect words, print pattern, printer).
function readJSON<T>(k: string, fallback: T): T {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
const ACCENT_KEYS: AccentKey[] = ["indigo", "violet", "emerald", "rose", "sky", "amber"];
const safeAccent = (v: string): AccentKey => (ACCENT_KEYS.includes(v as AccentKey) ? (v as AccentKey) : "indigo");

export default function RedesignApp() {
  // Phase 5a — REAL auth (adapter composes the supabase singleton + getMyProfile).
  const auth = useAuthSession();

  // Phase 5b — READ-ONLY real data (no writes). Enabled only when authed; admin
  // users list only when the profile is admin (else a seller would see just their
  // own row, so we keep sample).
  const authed = auth.status === "authed";
  const isAdmin = auth.profile?.role === "admin";
  const customersData = useCustomers(authed);
  const adminUsers = useAdminUsers(authed && isAdmin);
  // Phase 5h — real admin write actions (owner-only; targets human-confirmed).
  const admin = useAdmin(auth.profile?.email);
  // Phase 5i — self-profile save (upsertUser → own seller_profiles row; user-editable
  // fields only — plan/role are server-controlled and ignored by the trigger).
  const saveProfile = async (fields: { fullName: string; storeName: string; phone: string; tiktok: string }) => {
    if (!auth.profile) return { ok: false, error: "Not signed in" };
    const updated = { ...auth.profile, profile: { ...auth.profile.profile, ...fields } };
    try {
      await upsertUser(updated); // no includePlan → only name/store/phone/handles
      await auth.reloadProfile();
      return { ok: true };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Save failed" }; }
  };
  // Phase 5c — cross-device live-session load for the Dashboard (hydrate-on-empty).
  // Multi-day live session — window config (read-on-load) feeds the session load
  // range. N=1 → single-day (byte-identical 5c). Pill (setWindowDays) + order-open
  // wiring come in later steps.
  const sessionWindow = useSessionWindow(authed);
  const liveSession = useLiveSession(authed, { ready: sessionWindow.loaded, windowDays: sessionWindow.windowDays, windowStart: sessionWindow.windowStart });
  // Phase 5d — real live comment feed (socket + dedup). Replaces the sample
  // SEED_COMMENTS/INCOMING stream. Read-only (order writes are 5e).
  const liveFeed = useLiveFeed(authed, auth.profile?.email);
  const comments = liveFeed.comments;
  // Phase 5f — free-tier cap status + popups (M2 visibility-guarded poll).
  const freeCap = useFreeCap(authed, auth.profile?.plan);
  // Phase 5g — print config snapshot (filled after print-pattern/printer state is
  // declared below), read by the stable onPrint callback at order-create time.
  const printCfgRef = useRef<{ cur: string; storeName: string; settings: PrintSettings } | null>(null);
  const onPrint = (b: Buyer) => {
    const pc = printCfgRef.current;
    if (pc) printSlip(b, pc.cur, pc.storeName, pc.settings); // native in APK; no-op on web
  };
  // Phase 5e — real order creation fan-out (writes). Composes the SAME pure
  // builder + db writes; updates the live session optimistically. 5f: soft-block
  // when capped, resync counter after write, surface hard popup on trigger reject.
  const orders = useOrders({
    getBuyers: liveSession.getBuyers,
    applyOrder: liveSession.applyOrder,
    sessionDate: liveSession.dayId,
    isCapped: () => freeCap.freeCapped,
    onCapBlocked: () => freeCap.setCapPopup("hard"),
    onCapReached: freeCap.noteCapError,
    afterWrite: freeCap.afterOrder,
    onPrint,
    onEnsureWindow: () => { void sessionWindow.ensureWindowOpen(); }, // multi-day; N=1 no-op
  });
  // Orders tab + Dashboard summary now share ONE source (the live session), so a
  // newly created order shows immediately. (5b's useLiveOrders is superseded here.)
  const ordersList = liveOrdersToRedesign(liveSession.session);
  const ordersState: ReadState = liveSession.state === "idle" ? "sample" : liveSession.state;

  // Phase 5j — Miners DERIVED from already-loaded real customers (no new backend),
  // + CSV exports of already-loaded real data (csvDL copied from App.tsx).
  const minersLive = customersData.state === "live";
  const minerList = [...customersData.customers].sort((a, b) => b.spent - a.spent).slice(0, 5)
    .map((c) => ({ name: c.name, handle: c.handle, orders: c.orders, spent: c.spent, platform: c.platform }));
  const minerStats = (() => {
    const cs = customersData.customers;
    const buyers = cs.length;
    const orderCount = cs.reduce((s, c) => s + c.orders, 0);
    const spent = cs.reduce((s, c) => s + c.spent, 0);
    const tt = cs.filter((c) => c.platform === "TikTok").length;
    const tiktokPct = buyers ? Math.round((tt / buyers) * 100) : 0;
    return { buyers, orders: orderCount, spent, avg: orderCount ? Math.round(spent / orderCount) : 0, tiktokPct, fbPct: buyers ? 100 - tiktokPct : 0 };
  })();
  const exportOrders = () => csvDL(`orders-${dayStamp()}.csv`, ["Order", "#", "Customer", "Item", "Qty", "Total", "Platform", "Time", "Status"], liveSession.session.orders.map((o) => [`#SF${o.orderNum}`, o.bNum, `@${o.handle}`, o.item, o.qty, `${cur}${o.total}`, o.platform, o.time, o.status]));
  const exportCustomers = () => csvDL(`customers-${dayStamp()}.csv`, ["Name", "Username", "Platform", "Orders", "Total"], customersData.customers.map((c) => [c.name, c.handle, c.platform, c.orders, `${cur}${c.spent}`]));
  const exportMiners = () => csvDL(`miners-${dayStamp()}.csv`, ["#", "Name", "Username", "Platform", "Orders", "Total"], minerList.map((m, i) => [i + 1, m.name, m.handle, m.platform, m.orders, `${cur}${m.spent}`]));

  const [theme, setTheme] = useState<ThemeMode>(() => (readLS(LS.theme, "light") === "dark" ? "dark" : "light"));
  const [accent, setAccent] = useState<AccentKey>(() => safeAccent(readLS(LS.accent, "indigo")));
  const [screen, setScreen] = useState<Screen>("login");
  const [adminPanel, setAdminPanel] = useState<AdminPanelKind | null>(null);
  const [assignAmount, setAssignAmount] = useState("499");
  const [lang, setLang] = useState<string>(() => readLS(LS.lang, "en"));
  const [langOpen, setLangOpen] = useState(false);

  // Currency switcher (dc.html v3). `cur` is the derived symbol threaded through
  // every money display. Phase 5a: default is NT$/TWD (production default, Taiwan
  // market) instead of USD; on real login we pin TWD unless the user has explicitly
  // picked a currency in the redesign.
  const [currency, setCurrency] = useState<string>(() => (CURRENCIES[readLS(LS.currency, DEFAULT_CURRENCY)] ? readLS(LS.currency, DEFAULT_CURRENCY) : DEFAULT_CURRENCY));
  const cur = curSymbol(currency);
  const setCurrencyExplicit = (c: string) => {
    setCurrency(c);
    try { localStorage.setItem(LS.currencySet, "1"); } catch { /* ignore */ }
  };

  // Live-session-length pill (dc.html v3 Dashboard header). Visual only.
  const [sessionDays, setSessionDays] = useState(1);
  const [sessionOpen, setSessionOpen] = useState(false);

  // Dashboard account pickers (visual only — Phase 5 wires real switching).
  const [ttOpen, setTtOpen] = useState(false);
  const [fbOpen, setFbOpen] = useState(false);
  const [ttIdx, setTtIdx] = useState(0);
  const [fbIdx, setFbIdx] = useState(0);

  // General Settings local UI state (visual only).
  const [profileOpen, setProfileOpen] = useState(false);
  const [printerOpen, setPrinterOpen] = useState(false);
  const [printerIdx, setPrinterIdx] = useState(0);

  // TikTok/FB connection flow (visual only — no real connection). dc.html v3.
  const [ttConnected, setTtConnected] = useState(false);
  const [fbConnected, setFbConnected] = useState(false);
  const [ttConnecting, setTtConnecting] = useState(false);
  const [fbConnecting, setFbConnecting] = useState(false);
  const connectTT = () => {
    if (ttConnected) { setTtConnected(false); return; }
    if (ttConnecting) return;
    setTtConnecting(true);
    setTimeout(() => { setTtConnected(true); setTtConnecting(false); setTtOpen(false); }, 1200);
  };
  const connectFB = () => {
    if (fbConnected) { setFbConnected(false); return; }
    if (fbConnecting) return;
    setFbConnecting(true);
    setTimeout(() => { setFbConnected(true); setFbConnecting(false); setFbOpen(false); }, 1200);
  };

  // Printer settings (visual only). psType wifi|bt, psOut receipt|sticker.
  // Phase 5i — printer config persists across refresh (sfl_rd_printer).
  const printerInit = readJSON(LS.printer, { psType: "wifi" as "wifi" | "bt", psOut: "receipt" as "receipt" | "sticker", psSize: "100x60mm (Standard)" });
  const [psType, setPsType] = useState<"wifi" | "bt">(printerInit.psType);
  const [psOut, setPsOut] = useState<"receipt" | "sticker">(printerInit.psOut);
  const [psSize, setPsSize] = useState(printerInit.psSize);
  const [psSizeOpen, setPsSizeOpen] = useState(false);
  useEffect(() => { try { localStorage.setItem(LS.printer, JSON.stringify({ psType, psOut, psSize })); } catch { /* ignore */ } }, [psType, psOut, psSize]);

  // LIVE print pattern (visual only).
  // Phase 5i — print pattern persists across refresh (sfl_rd_pp).
  const [pp, setPp] = useState<PrintPatternState>(() => readJSON(LS.pp, DEFAULT_PP));
  const togglePp = (k: PpBoolKey) => setPp((p) => ({ ...p, [k]: !p[k] }));
  const stepPp = (k: PpSizeKey, dir: 1 | -1) => setPp((p) => ({ ...p, [k]: Math.min(3, Math.max(0.5, Math.round((p[k] + dir * 0.1) * 10) / 10)) }));
  useEffect(() => { try { localStorage.setItem(LS.pp, JSON.stringify(pp)); } catch { /* ignore */ } }, [pp]);

  // Phase 5g — snapshot the current print config for onPrint (declared above).
  printCfgRef.current = {
    cur,
    storeName: auth.profile?.profile.storeName || "SellerFlowLive",
    settings: buildSettingsFromRedesign({ pp, psType, psOut, psSize }),
  };

  // Auto-detect keyword feature (visual only). v3: each trigger is a
  // {word, price} pair; default OFF (dc.html v3 autoDetect:false L1548).
  const [autoDetect, setAutoDetect] = useState(false);
  const [autoSetupOpen, setAutoSetupOpen] = useState(false);
  const [autoAction, setAutoAction] = useState<"slip" | "sticker">("slip");
  // Phase 5i — auto-detect trigger words persist across refresh (sfl_rd_autowords).
  const [autoWords, setAutoWords] = useState<AutoWord[]>(() => readJSON<AutoWord[]>(LS.autowords, [
    { word: "mine", price: "150" }, { word: "claim", price: "150" }, { word: "sold", price: "150" },
    { word: "get", price: "150" }, { word: "take", price: "150" },
  ]));
  const [autoInput, setAutoInput] = useState("");
  useEffect(() => { try { localStorage.setItem(LS.autowords, JSON.stringify(autoWords)); } catch { /* ignore */ } }, [autoWords]);
  // Parse "word = price" / "word price" / "word" (default price 150). dc.html v3 onAutoKey L2063.
  const addAutoWord = () => {
    const raw = autoInput.trim().toLowerCase();
    const m = raw.match(/^(.*?)[\s=]*(\d+)?$/);
    const word = ((m && m[1]) || raw).trim();
    const price = (m && m[2]) || "150";
    if (word && !autoWords.some((x) => x.word === word) && autoWords.length < 20) setAutoWords((ws) => [...ws, { word, price }]);
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

  // Dashboard order flow (dc.html v3 L1796–1810 / onEntKey L2058). Phase 5e: now
  // creates REAL orders. `printed` is kept PERSISTENT per comment id (commentKey)
  // so the action buttons hide after the first order — the dedup guard that
  // prevents a comment from creating duplicate orders.
  const [printed, setPrinted] = useState<Record<string, string>>({});
  const [entId, setEntId] = useState<string | null>(null);
  const [entPrice, setEntPrice] = useState("");
  // 1-Click: production passes price 0 (captures buyer + comment; total 0).
  const onOneClick = (id: string) => {
    if (printed[id]) return; // already ordered — no duplicate
    const prod = liveFeed.getComment(id);
    if (!prod) return;
    const order = orders.createOrder(prod, 0);
    if (order) setPrinted((p) => ({ ...p, [id]: "order" })); // null = free-cap blocked
  };
  const onOpenEnt = (id: string) => { setEntId(id); setEntPrice(""); };
  // Enterprise: create the order at the typed price.
  const onEntKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const id = entId;
    if (!id) return;
    const prod = liveFeed.getComment(id);
    const price = Number(entPrice || "0") || 0;
    const order = prod && !printed[id] ? orders.createOrder(prod, price) : null;
    if (order) setPrinted((p) => ({ ...p, [id]: price > 0 ? cur + price : "order" })); // null = blocked
    setEntId(null); setEntPrice("");
  };


  // Persist appearance (redesign-namespaced keys; never touches existing keys).
  useEffect(() => { try { localStorage.setItem(LS.theme, theme); } catch { /* ignore */ } }, [theme]);
  useEffect(() => { try { localStorage.setItem(LS.accent, accent); } catch { /* ignore */ } }, [accent]);
  useEffect(() => { try { localStorage.setItem(LS.lang, lang); } catch { /* ignore */ } }, [lang]);
  useEffect(() => { try { localStorage.setItem(LS.currency, currency); } catch { /* ignore */ } }, [currency]);

  // Phase 5a — auth-driven navigation + currency pin. Authed: leave the auth
  // screens. Anon (incl. after logout): force the login screen. On first real
  // login, pin NT$/TWD unless the user explicitly picked a currency here.
  const currencyPinnedRef = useRef(false);
  useEffect(() => {
    if (auth.status === "authed") {
      setScreen((s) => (s === "login" || s === "signup" ? "dashboard" : s));
      if (!currencyPinnedRef.current) {
        currencyPinnedRef.current = true;
        let explicit = false;
        try { explicit = !!localStorage.getItem(LS.currencySet); } catch { explicit = false; }
        if (!explicit) setCurrency(DEFAULT_CURRENCY);
      }
    } else if (auth.status === "anon") {
      setScreen("login");
    }
  }, [auth.status]);

  const showNav = screen !== "login" && auth.status === "authed";
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
          {auth.status === "loading" && (
            <div style={{ minHeight: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, color: "var(--text-muted)" }}>
              <img src="/redesign/icon-180.png" alt="SellerFlowLive" style={{ width: 56, height: 56, borderRadius: 15, objectFit: "cover", opacity: 0.9 }} />
              <div style={{ fontSize: 13, fontWeight: 600, fontFamily: "var(--font-ui)" }}>Loading…</div>
            </div>
          )}
          {screen === "login" && auth.status !== "loading" && (
            <Login
              onLogin={(email, password) => auth.signIn(email, password)}
              configured={auth.configured}
              onSignup={() => setScreen("signup")}
              lang={lang}
              langOpen={langOpen}
              onToggleLang={() => setLangOpen((o) => !o)}
              onPickLang={(code) => { setLang(code); setLangOpen(false); }}
            />
          )}
          {screen === "signup" && (
            <Signup onBack={() => setScreen("login")} onCreate={() => setScreen("dashboard")} onLegal={() => setScreen("legal")} />
          )}
          {screen === "dashboard" && (
            <Dashboard
              comments={comments} cur={cur}
              ttOpen={ttOpen} fbOpen={fbOpen} ttIdx={ttIdx} fbIdx={fbIdx}
              onToggleTT={() => { setTtOpen((o) => !o); setFbOpen(false); setSessionOpen(false); }}
              onToggleFB={() => { setFbOpen((o) => !o); setTtOpen(false); setSessionOpen(false); }}
              onPickTT={(i) => { setTtIdx(i); setTtOpen(false); }}
              onPickFB={(i) => { setFbIdx(i); setFbOpen(false); }}
              ttConnected={ttConnected} fbConnected={fbConnected} ttConnecting={ttConnecting} fbConnecting={fbConnecting}
              onConnectTT={connectTT} onConnectFB={connectFB}
              sessionDays={sessionDays} sessionOpen={sessionOpen}
              onToggleSession={() => { setSessionOpen((o) => !o); setTtOpen(false); setFbOpen(false); }}
              onPickSession={(n) => { setSessionDays(n); setSessionOpen(false); }}
              autoDetect={autoDetect} autoWords={autoWords}
              printed={printed} entId={entId} entPrice={entPrice}
              onOneClick={onOneClick} onOpenEnt={onOpenEnt}
              onEntPrice={(v) => setEntPrice(v.replace(/[^0-9]/g, ""))} onEntKey={onEntKey}
              session={liveSession.session} sessionState={liveSession.state}
              canInject={liveFeed.canInject} onInjectSynthetic={liveFeed.injectSynthetic}
            />
          )}
          {screen === "orders" && <Orders onGoPrint={() => setScreen("print")} cur={cur} orders={ordersList} state={ordersState} onExport={exportOrders} />}
          {screen === "products" && <Products cur={cur} />}
          {screen === "miners" && <Miners cur={cur} miners={minersLive ? minerList : undefined} stats={minersLive ? minerStats : undefined} live={minersLive} onExport={exportMiners} />}
          {screen === "menu" && (
            <SettingsHub
              onGeneral={() => setScreen("settings")}
              onCustomers={() => setScreen("customers")}
              onAdmin={() => setScreen("admin")}
              onSales={() => setScreen("sales")}
              onShipping={() => setScreen("shipping")}
              onCustomerData={() => setScreen("customerdata")}
              onLegal={() => setScreen("legal")}
              onDelete={() => setScreen("delete")}
              onLogout={() => { void auth.signOut(); setScreen("login"); }}
              isAdmin={isAdmin}
            />
          )}
          {screen === "settings" && (
            <GeneralSettings
              theme={theme} accent={accent} onSetTheme={setTheme} onSetAccent={setAccent}
              auto={autoControls} cur={cur} account={auth.profile} onSaveProfile={saveProfile}
              lang={lang} onSetLang={setLang} currency={currency} onSetCurrency={setCurrencyExplicit}
              profileOpen={profileOpen} onToggleProfile={() => setProfileOpen((o) => !o)}
              printerIdx={printerIdx} printerOpen={printerOpen}
              onTogglePrinter={() => setPrinterOpen((o) => !o)}
              onPickPrinter={(i) => { setPrinterIdx(i); setPrinterOpen(false); setPsType(i === 0 ? "wifi" : "bt"); setScreen("printersettings"); }}
              onPrintPattern={() => setScreen("printpattern")}
              onSubscription={() => setScreen("subscription")}
              onSupport={() => setScreen("support")}
              onDelete={() => setScreen("delete")}
            />
          )}
          {screen === "customers" && <Customers cur={cur} customers={customersData.customers} state={customersData.state} onExport={exportCustomers} />}
          {screen === "subscription" && <Subscription cur={cur} account={auth.profile} isFreeUser={freeCap.isFreeUser} freeStatus={freeCap.freeStatus} />}
          {screen === "support" && <Support onLegal={() => setScreen("legal")} />}
          {screen === "admin" && isAdmin && <Admin onOpenPanel={setAdminPanel} cur={cur} />}
          {screen === "print" && <Print onBack={() => setScreen("orders")} cur={cur} />}
          {screen === "sales" && <SalesReport cur={cur} />}
          {screen === "shipping" && <Shipping />}
          {screen === "customerdata" && <CustomerData onLegal={() => setScreen("legal")} cur={cur} customers={customersData.customers} onExport={exportCustomers} />}
          {screen === "legal" && <Legal />}
          {screen === "delete" && <DeleteAccount onBack={() => setScreen("settings")} />}
          {screen === "printersettings" && (
            <PrinterSettings
              onBack={() => setScreen("settings")}
              psType={psType}
              psOut={psOut} onSetPsOut={setPsOut}
              psSize={psSize} psSizeOpen={psSizeOpen}
              onTogglePsSize={() => setPsSizeOpen((o) => !o)} onPickPsSize={(s) => { setPsSize(s); setPsSizeOpen(false); }}
            />
          )}
          {screen === "printpattern" && (
            <PrintPattern onBack={() => setScreen("settings")} pp={pp} onToggle={togglePp} onStep={stepPp} />
          )}
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
        {adminPanel && isAdmin && (
          <AdminPanel panel={adminPanel} onClose={() => setAdminPanel(null)} assignAmount={assignAmount} onAssignAmount={setAssignAmount} cur={cur} users={adminUsers.users} usersState={adminUsers.state} actions={admin} onChanged={adminUsers.reload} />
        )}

        {/* Phase 5f — free-tier cap popup (near / hard) */}
        {freeCap.capPopup && (
          <CapPopup
            kind={freeCap.capPopup}
            freeStatus={freeCap.freeStatus}
            onUpgrade={() => { freeCap.setCapPopup(""); setScreen("subscription"); }}
            onViewOrders={() => { freeCap.setCapPopup(""); setScreen("orders"); }}
            onClose={() => freeCap.setCapPopup("")}
          />
        )}
      </div>
    </div>
  );
}
