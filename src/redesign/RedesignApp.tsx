// Redesign root. Owns theme/accent/screen state + the live feed, sets
// [data-theme]/[data-accent] on the [data-redesign] root (tokens resolve from
// src/styles/design-tokens.css), and renders all built screens + bottom nav.
// Self-contained preview — does NOT import or touch the existing app.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
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
import ManageChannels from "./screens/ManageChannels";
import { useAuthSession, DEFAULT_CURRENCY } from "./adapters/useAuthSession";
import { useCustomers, useAdminUsers, useFreeUsers, useAuditLogs, deriveSubBuckets, deriveUserBase, liveOrdersToRedesign, type ReadState } from "./adapters/useReadData";
import { useLiveSession } from "./adapters/useLiveSession";
import { useSessionWindow, type WindowDays } from "./adapters/useSessionWindow";
import { useLiveFeed, commentKey } from "./adapters/useLiveFeed";
import { useOrders } from "./adapters/useOrders";
import { planAutoOrder, type AutoCode } from "./adapters/autoMode";
import { loadCodes } from "./adapters/autoCodesDb";
import { resolveInitialProducts } from "./adapters/productsDb";
import { loadProducts } from "./adapters/products";
import { useFreeCap } from "./adapters/useFreeCap";
import { useAdmin } from "./adapters/useAdmin";
import { upsertUser } from "../accountDb";
import { csvDL, dayStamp } from "./adapters/csv";
import { computeSales } from "./adapters/sales";
import { printSlip, buildSettingsFromRedesign, type Settings as PrintSettings } from "./adapters/printing";
import { btCall, hasBtBridge, buildTestStickerPayload, type StickerPrintResult } from "./adapters/printerBridge";
import { registeredAccountsFor, appendAccount, maxAcc, composeChannelSave, connectToast, type Platform } from "./adapters/connect";
import type { Buyer, Comment as ProdComment } from "../lib/orderTypes";
import CapPopup from "./screens/CapPopup";
import ConnectModal from "./screens/ConnectModal";
import { TProvider, buildT, tpl } from "./i18n";

type Screen =
  | "login" | "signup" | "dashboard" | "miners" | "orders" | "products"
  | "menu" | "settings" | "customers" | "subscription" | "support"
  | "admin" | "print" | "sales" | "shipping" | "customerdata" | "legal" | "delete"
  | "printersettings" | "printpattern" | "ttchannels" | "fbchannels";

// Screens grouped under the Settings bottom-nav tab (tab is "active" for all).
const SETTINGS_GROUP: Screen[] = ["menu", "settings", "customers", "subscription", "support", "admin", "sales", "shipping", "customerdata", "legal", "delete", "printersettings", "printpattern", "ttchannels", "fbchannels"];

const LS = { theme: "sfl_rd_theme", accent: "sfl_rd_accent", lang: "sfl_rd_lang", currency: "sfl_rd_currency", currencySet: "sfl_rd_currency_set", autowords: "sfl_rd_autowords", automode: "sfl_rd_automode", pp: "sfl_rd_pp", printer: "sfl_rd_printer" } as const;
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
  // Admin subscription buckets — real free-tier monitor (RPC) + derived active/
  // expiring/expired from the loaded seller list (App.tsx Plan Monitoring).
  const freeUsersData = useFreeUsers(authed && isAdmin);
  const auditData = useAuditLogs(authed && isAdmin);
  const subBuckets = deriveSubBuckets(adminUsers.users);
  const adminLive = adminUsers.state === "live" || adminUsers.state === "empty";
  const adminCounts = { active: subBuckets.active.length, expiring: subBuckets.expiring.length, expired: subBuckets.expired.length, free: freeUsersData.freeUsers.length };
  const userBase = deriveUserBase(adminUsers.users); // plan-derived paid/free for the home card
  // Phase 5h — real admin write actions (owner-only; targets human-confirmed).
  const admin = useAdmin(auth.profile?.email);
  // Phase 5i — self-profile save (upsertUser → own seller_profiles row; user-editable
  // fields only — plan/role are server-controlled and ignored by the trigger).
  // ⚠️ Profile card writes ONLY name/store/phone — NOT tiktok/facebook. The Channels
  // editor (saveChannels below) is the SOLE writer of the account lists (no double-writer).
  const saveProfile = async (fields: { fullName: string; storeName: string; phone: string }) => {
    if (!auth.profile) return { ok: false, error: "Not signed in" };
    const updated = { ...auth.profile, profile: { ...auth.profile.profile, ...fields } };
    try {
      await upsertUser(updated); // spreads existing profile; tiktok/facebook untouched
      await auth.reloadProfile();
      return { ok: true };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Save failed" }; }
  };
  // Channels editor save — the ONLY writer of seller_profiles.tiktok/.facebook.
  // Mirrors App.tsx handleSaveProfile 4230-4238: keepLockedAccounts (can't overwrite
  // server-known slots) + fitProfileAccounts (combined plan cap), admin bypass — all
  // folded into the pure composeChannelSave. Spreads existing profile; never writes
  // plan/role (trigger-protected). reloadProfile after → locks refresh.
  const saveChannels = async (lists: { tiktok: string; facebook: string }) => {
    if (!auth.profile) return { ok: false, error: "Not signed in" };
    const cur = auth.profile;
    const next = composeChannelSave(cur.profile, lists, maxAcc(cur.plan), cur.role === "admin");
    const updated = { ...cur, profile: { ...cur.profile, tiktok: next.tiktok, facebook: next.facebook } };
    try {
      await upsertUser(updated);
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
  // Auto Mode (Step 4) — code map + ref-backed live stock for socket matching. Refs
  // (not state) so the socket handler reads the latest without re-subscribing and so
  // concurrent same-code comments claim stock SYNCHRONOUSLY (no double-decrement).
  const autoCommentRef = useRef<(c: ProdComment) => void>(() => {});
  const autoCodesRef = useRef<AutoCode[]>([]);
  const autoStockRef = useRef<Map<number, number>>(new Map());   // productLocalId → live remaining
  const autoSoldRef = useRef<Set<number>>(new Set());            // sold-out toast fired once per product
  const autoProcessedRef = useRef<Set<string>>(new Set());       // commentKey → already handled (sync dedup)

  // Phase 5d — real live comment feed (socket + dedup). Replaces the sample
  // SEED_COMMENTS/INCOMING stream. Read-only (order writes are 5e). The 3rd arg is the
  // Auto Mode seam — a stable wrapper calling the latest handler via ref (no re-subscribe).
  const liveFeed = useLiveFeed(authed, auth.profile?.email, (c) => autoCommentRef.current(c));
  const comments = liveFeed.comments;

  // Auto Mode — READ-ON-LOAD only (on auth change): load the code map + seed live
  // stock from the catalog. No poll. Codes/stock edited in Settings apply on next
  // load (same reseed-on-reload model as multi-day; decided with Jeff).
  useEffect(() => {
    if (!authed) { autoCodesRef.current = []; autoStockRef.current = new Map(); autoSoldRef.current = new Set(); autoProcessedRef.current = new Set(); return; }
    let active = true;
    void (async () => {
      const [resolved, codes] = await Promise.all([resolveInitialProducts(loadProducts()), loadCodes()]);
      if (!active) return;
      autoCodesRef.current = codes ?? [];
      const m = new Map<number, number>();
      for (const p of resolved.products) m.set(p.id, p.stock);
      autoStockRef.current = m;
      autoSoldRef.current = new Set();
      autoProcessedRef.current = new Set();
    })();
    return () => { active = false; };
  }, [authed]);

  // 5b — apply a just-saved code map immediately (no reload): push the persisted
  // codes + each product's stock into the live matcher refs the onComment handler
  // reads. Restocked products clear their sold-out latch so they can sell + toast
  // again. Stable (refs only) → no re-render churn. Still no polling.
  const liftAutoCodes = useCallback((codes: AutoCode[], stock: Map<number, number>) => {
    autoCodesRef.current = codes;
    for (const [lid, n] of stock) { autoStockRef.current.set(lid, n); autoSoldRef.current.delete(lid); }
  }, []);
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

  // Sales report — session-derived aggregation (App.tsx Sales). CSV row shape
  // matches App.tsx:1988 exactly: [#SF{orderNum}, name, item, qty, cur+total, platform, time].
  const sales = computeSales(liveSession.session.orders, liveSession.session.buyers);
  const exportSales = () => csvDL(`sales-${dayStamp()}.csv`, ["Order", "Buyer", "Item", "Qty", "Total", "Platform", "Time"], liveSession.session.orders.map((o) => [`#SF${o.orderNum}`, o.name, o.item, o.qty, `${cur}${o.total}`, o.platform, o.time]));

  const [theme, setTheme] = useState<ThemeMode>(() => (readLS(LS.theme, "light") === "dark" ? "dark" : "light"));
  const [accent, setAccent] = useState<AccentKey>(() => safeAccent(readLS(LS.accent, "indigo")));
  const [screen, setScreen] = useState<Screen>("login");
  const [adminPanel, setAdminPanel] = useState<AdminPanelKind | null>(null);
  const [assignAmount, setAssignAmount] = useState("499");
  const [lang, setLang] = useState<string>(() => readLS(LS.lang, "en"));
  const [langOpen, setLangOpen] = useState(false);
  const tApp = buildT(lang); // RedesignApp is the TProvider parent → resolve strings directly here
  // Auto-dismissing toast (no buttons) — chip connect feedback. kind "ok" = success
  // ("Connected!"), "err" = honest failure reason. Errors linger a bit longer to read.
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), toast.kind === "err" ? 3200 : 1800); return () => clearTimeout(id); }, [toast]);
  /* eslint-enable react-hooks/set-state-in-effect */

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
  // Session-length pill — real N from seller_session_config (sessionWindow). Open/close is local UI.
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

  // #6 — REAL TikTok/FB connect. Connected state + active account come from the
  // server via useLiveFeed (platform_status); the modal/pickers POST to the live
  // server. ⚠️ Preview-unverifiable (Render + socket) — only active post-merge/APK.
  const ttConnected = liveFeed.ttConnected;
  const fbConnected = liveFeed.fbConnected;
  const ttAccounts = auth.profile ? registeredAccountsFor(auth.profile, "TikTok") : [];
  const fbAccounts = auth.profile ? registeredAccountsFor(auth.profile, "Facebook") : [];
  const [connectOpen, setConnectOpen] = useState<Platform | null>(null);
  // ConnectModal action: real connect → on success register the account on the
  // profile (same as App.tsx connectPlatform) + reload so it appears in the picker.
  const handleConnect = async (platform: Platform, data: Record<string, string>) => {
    const r = await liveFeed.connect(platform, data);
    if (r.ok && auth.profile) {
      const np = appendAccount(auth.profile, platform, r.account);
      if (np) { try { await upsertUser(np); await auth.reloadProfile(); } catch { /* non-fatal */ } }
    }
    return r;
  };
  // Switch the active account (connect to the picked registered account).
  const switchAccount = (platform: Platform, i: number) => {
    const acct = (platform === "TikTok" ? ttAccounts : fbAccounts)[i];
    if (platform === "TikTok") { setTtIdx(i); setTtOpen(false); } else { setFbIdx(i); setFbOpen(false); }
    if (acct) void liveFeed.connect(platform, { username: acct });
  };
  // Surface B — chip 3-state connect (neutral → connecting → connected → Disconnect).
  // `connected` is server truth (liveFeed.tt/fbConnected). We add a LOCAL connecting
  // flag for the in-flight POST and a LOCAL disconnect gesture (the redesign has no
  // server unbind), cleared whenever the server pushes a fresh platform_status. The
  // real connect path (liveFeed.connect / ConnectModal) is unchanged.
  const [ttConnecting, setTtConnecting] = useState(false);
  const [fbConnecting, setFbConnecting] = useState(false);
  const [ttOff, setTtOff] = useState(false);
  const [fbOff, setFbOff] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => { setTtOff(false); }, [ttConnected]); // server status wins over a local disconnect
  useEffect(() => { setFbOff(false); }, [fbConnected]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const ttEff = ttConnected && !ttOff;
  const fbEff = fbConnected && !fbOff;
  const doConnect = async (platform: Platform) => {
    const eff = platform === "TikTok" ? ttEff : fbEff;
    const setOff = platform === "TikTok" ? setTtOff : setFbOff;
    const setConnecting = platform === "TikTok" ? setTtConnecting : setFbConnecting;
    const accts = platform === "TikTok" ? ttAccounts : fbAccounts;
    const idx = platform === "TikTok" ? ttIdx : fbIdx;
    if (eff) { setOff(true); return; }               // Disconnect (local UI; no server unbind in the redesign)
    const acct = accts[idx] || accts[0];
    if (!acct) { setConnectOpen(platform); return; } // no registered account → add-new modal (real connect)
    setConnecting(true);
    try {
      const r = await liveFeed.connect(platform, { username: acct });
      // Honest feedback: success "Connected!"; failure → the real server/network reason
      // (r.error verbatim) with the generic fallback. Chip still reverts to neutral.
      setToast(connectToast(r, tApp.rd_dash_connected_toast, tApp.rd_cm_conn_failed));
    } finally { setConnecting(false); }
  };
  // Refresh = one-shot full dashboard reload (pull-to-refresh style; NO polling).
  // Reuses the existing load functions: profile/accounts + live session (reset =
  // clear + hydrate-on-empty from DB) + customers (read adapter reload). Orders derive
  // from the live session; Products read from localStorage on mount.
  const [refreshing, setRefreshing] = useState(false);
  const refreshDashboard = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      liveSession.reset();        // reload today's live session from DB
      customersData.reload();     // reload customers/miners read data
      await auth.reloadProfile(); // reload profile + registered accounts
    } finally { setRefreshing(false); }
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

  // Printer Test (PrintPattern) — real BT test sticker, mirroring PrinterSettings
  // testBt: builds the test payload from the live print config + fires the native
  // bridge, with a toast for the result. No-op-safe off-device (no BT bridge).
  const onTestPrint = async () => {
    if (!hasBtBridge()) { setToast({ msg: tApp.rd_ps_open_app_test, kind: "err" }); return; }
    const storeName = auth.profile?.profile.storeName || "SellerFlowLive";
    const settings = buildSettingsFromRedesign({ pp, psType, psOut, psSize });
    const r = await btCall<StickerPrintResult>("printStickerNative", buildTestStickerPayload(cur, storeName, settings));
    setToast({ msg: r?.ok ? (r.message || tApp.rd_ps_test_sent) : (r?.message || tApp.rd_ps_test_failed), kind: r?.ok ? "ok" : "err" });
  };

  // Auto Mode on/off. Default OFF, but PERSISTED (sfl_rd_automode) so the toggle
  // stays where the seller left it across refresh — same pattern as theme/currency.
  const [autoDetect, setAutoDetect] = useState<boolean>(() => readLS(LS.automode, "0") === "1");
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

  // Auto Mode (Step 4) — socket match → ref-locked inventory claim → auto-order via
  // 5e. Reassigned each render so it closes over the latest state; useLiveFeed calls
  // it through autoCommentRef (no re-subscribe). Event-driven off the feed — NO poll.
  const autoSoldOutToast = (code: AutoCode) => {
    if (autoSoldRef.current.has(code.productLocalId)) return; // once per product
    autoSoldRef.current.add(code.productLocalId);
    setToast({ msg: tpl(tApp.rd_auto_soldout_toast, { code: code.code }), kind: "err" });
  };
  autoCommentRef.current = (c: ProdComment) => {
    if (!autoDetect) return;                                    // Auto Mode OFF → ignore
    const key = commentKey(c);
    if (autoProcessedRef.current.has(key) || printed[key]) return; // this comment already handled
    const plan = planAutoOrder(c.comment || "", autoCodesRef.current, (lid) => autoStockRef.current.get(lid) ?? 0);
    if (plan.kind === "none") return;
    if (plan.kind === "soldout") { autoSoldOutToast(plan.code); return; }
    // plan.kind === "order": claim SYNCHRONOUSLY before any await (anti double-decrement)
    autoProcessedRef.current.add(key);
    autoStockRef.current.set(plan.code.productLocalId, plan.nextStock);
    const order = orders.createOrder(c, plan.code.price, { productLocalId: plan.code.productLocalId });
    if (order) {
      setPrinted((p) => ({ ...p, [key]: cur + plan.code.price }));
      if (plan.soldOut) autoSoldOutToast(plan.code);
    } else {
      // free-cap soft block prevented creation → refund the claim so it can retry.
      autoStockRef.current.set(plan.code.productLocalId, plan.nextStock + 1);
      autoProcessedRef.current.delete(key);
    }
  };


  // Persist appearance (redesign-namespaced keys; never touches existing keys).
  useEffect(() => { try { localStorage.setItem(LS.theme, theme); } catch { /* ignore */ } }, [theme]);
  useEffect(() => { try { localStorage.setItem(LS.accent, accent); } catch { /* ignore */ } }, [accent]);
  useEffect(() => { try { localStorage.setItem(LS.lang, lang); } catch { /* ignore */ } }, [lang]);
  useEffect(() => { try { localStorage.setItem(LS.currency, currency); } catch { /* ignore */ } }, [currency]);
  useEffect(() => { try { localStorage.setItem(LS.automode, autoDetect ? "1" : "0"); } catch { /* ignore */ } }, [autoDetect]);

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
    <TProvider lang={lang}>
    <div data-redesign="" data-theme={theme} data-accent={accent} className="sfl-stage">
      <div className="sfl-phone">
        {theme === "dark" && (
          <>
            <div className="sfl-grid" />
            <div className="sfl-glow-a" />
            <div className="sfl-glow-cyan" />
          </>
        )}

        {/* Safe-area top spacer — replaces the old faux "9:41" status bar (a design
            mockup leftover that double-stacked under the real system status bar).
            On a device this reserves exactly the system inset; on desktop/preview
            env(safe-area-inset-top) = 0, so there is no gap. */}
        <div style={{ height: "env(safe-area-inset-top)", flexShrink: 0 }} />

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
            <Signup onBack={() => setScreen("login")} onLegal={() => setScreen("legal")} onRegister={auth.register} />
          )}
          {screen === "dashboard" && (
            <Dashboard
              comments={comments} cur={cur}
              ttOpen={ttOpen} fbOpen={fbOpen} ttIdx={ttIdx} fbIdx={fbIdx}
              onToggleTT={() => { setTtOpen((o) => !o); setFbOpen(false); setSessionOpen(false); }}
              onToggleFB={() => { setFbOpen((o) => !o); setTtOpen(false); setSessionOpen(false); }}
              onPickTT={(i) => switchAccount("TikTok", i)}
              onPickFB={(i) => switchAccount("Facebook", i)}
              ttConnected={ttEff} fbConnected={fbEff} ttConnecting={ttConnecting} fbConnecting={fbConnecting}
              onConnectTT={() => void doConnect("TikTok")} onConnectFB={() => void doConnect("Facebook")}
              onRefreshTT={() => void refreshDashboard()} onRefreshFB={() => void refreshDashboard()} refreshing={refreshing}
              ttAccounts={ttAccounts} fbAccounts={fbAccounts}
              sessionDays={sessionWindow.windowDays} sessionOpen={sessionOpen}
              onToggleSession={() => { setSessionOpen((o) => !o); setTtOpen(false); setFbOpen(false); }}
              onPickSession={(n) => { void sessionWindow.setWindowDays(n as WindowDays); liveSession.reset(); setSessionOpen(false); }}
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
              onManageChannel={(p) => setScreen(p === "tiktok" ? "ttchannels" : "fbchannels")}
              onAutoCodesSaved={liftAutoCodes}
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
          {(screen === "ttchannels" || screen === "fbchannels") && (
            <ManageChannels platform={screen === "ttchannels" ? "tiktok" : "facebook"} account={auth.profile} onBack={() => setScreen("settings")} onSaveChannels={saveChannels} />
          )}
          {screen === "customers" && <Customers cur={cur} customers={customersData.customers} state={customersData.state} onExport={exportCustomers} />}
          {screen === "subscription" && <Subscription cur={cur} account={auth.profile} isFreeUser={freeCap.isFreeUser} freeStatus={freeCap.freeStatus} />}
          {screen === "support" && <Support onLegal={() => setScreen("legal")} />}
          {screen === "admin" && isAdmin && <Admin onOpenPanel={setAdminPanel} cur={cur} counts={adminCounts} live={adminLive} userBase={adminLive ? { paid: userBase.paid, free: userBase.free, total: userBase.total } : undefined} />}
          {screen === "print" && <Print onBack={() => setScreen("orders")} cur={cur} buyers={liveSession.session.buyers} storeName={auth.profile?.profile.storeName || "SellerFlowLive"} settings={buildSettingsFromRedesign({ pp, psType, psOut, psSize })} />}
          {screen === "sales" && <SalesReport cur={cur} sales={sales} onExport={exportSales} />}
          {screen === "shipping" && isAdmin && <Shipping email={auth.profile?.email} cur={cur} />}
          {screen === "customerdata" && <CustomerData onLegal={() => setScreen("legal")} cur={cur} customers={customersData.customers} onExport={exportCustomers} />}
          {screen === "legal" && <Legal />}
          {screen === "delete" && <DeleteAccount onBack={() => setScreen("settings")} email={auth.profile?.email} onConfirm={auth.deleteAccount} />}
          {screen === "printersettings" && (
            <PrinterSettings
              onBack={() => setScreen("settings")}
              psType={psType}
              psOut={psOut} onSetPsOut={setPsOut}
              psSize={psSize} psSizeOpen={psSizeOpen}
              onTogglePsSize={() => setPsSizeOpen((o) => !o)} onPickPsSize={(s) => { setPsSize(s); setPsSizeOpen(false); }}
              cur={cur} storeName={auth.profile?.profile.storeName || "SellerFlowLive"} settings={buildSettingsFromRedesign({ pp, psType, psOut, psSize })}
            />
          )}
          {screen === "printpattern" && (
            <PrintPattern onBack={() => setScreen("settings")} pp={pp} onToggle={togglePp} onStep={stepPp} onTestPrint={() => void onTestPrint()} />
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
          <AdminPanel panel={adminPanel} onClose={() => setAdminPanel(null)} assignAmount={assignAmount} onAssignAmount={setAssignAmount} cur={cur} users={adminUsers.users} usersState={adminUsers.state} actions={admin} onChanged={() => { adminUsers.reload(); freeUsersData.reload(); auditData.reload(); }} freeUsers={freeUsersData.freeUsers} freeUsersState={freeUsersData.state} auditLogs={auditData.logs} auditState={auditData.state} onOpenPanel={setAdminPanel} />
        )}

        {/* #6 — real connect modal (registered-account picker / add account) */}
        {connectOpen && auth.profile && (
          <ConnectModal profile={auth.profile} initialTab={connectOpen} onClose={() => setConnectOpen(null)} onConnect={handleConnect} />
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

        {/* Auto-dismissing toast (no buttons). ok = neutral dark pill; err = danger tint + ⚠ */}
        {toast && (
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 80, display: "flex", justifyContent: "center", padding: "0 24px", zIndex: 1200, pointerEvents: "none" }}>
            <div style={{ maxWidth: "100%", background: toast.kind === "err" ? "var(--danger)" : "var(--text)", color: toast.kind === "err" ? "#fff" : "var(--surface)", fontSize: 13, fontWeight: 700, padding: "10px 18px", borderRadius: 999, boxShadow: "0 8px 24px rgba(0,0,0,.3)", textAlign: "center", lineHeight: 1.35 }}>{toast.kind === "err" ? `⚠ ${toast.msg}` : toast.msg}</div>
          </div>
        )}
      </div>
    </div>
    </TProvider>
  );
}
