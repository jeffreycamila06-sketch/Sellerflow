// Redesign root. Owns theme/accent/screen state + the live feed, sets
// [data-theme]/[data-accent] on the [data-redesign] root (tokens resolve from
// src/styles/design-tokens.css), and renders all built screens + bottom nav.
// Self-contained preview — does NOT import or touch the existing app.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CURRENCIES, curSymbol, type ThemeMode, type AccentKey, type AutoControls, type Order as RDOrder } from "./data";
import Dashboard from "./screens/Dashboard";
import Orders from "./screens/Orders";
import Products from "./screens/Products";
import Miners from "./screens/Miners";
import Login from "./screens/Login";
import Landing from "./screens/Landing";
import AuthModal from "./components/AuthModal";
import AuthBrandPanel from "./components/AuthBrandPanel";
import { anonScreen, isAppShell } from "./adapters/appShell";
import { identifySeller, track, resetAnalytics } from "./analytics";
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
import PrintPattern, { DEFAULT_PP, stepScaleLevel, type PrintPatternState, type PpBoolKey, type PpSizeKey } from "./screens/PrintPattern";
import ManageChannels from "./screens/ManageChannels";
import { useAuthSession, DEFAULT_CURRENCY } from "./adapters/useAuthSession";
import { useCustomers, useMinerStats, ZERO_MINERS_STATS, useAdminUsers, useFreeUsers, useAuditLogs, deriveSubBuckets, deriveUserBase, deriveMrr, liveOrdersToRedesign, type ReadState } from "./adapters/useReadData";
import { useBusinessPulse } from "./adapters/useBusinessPulse";
import { useAnnouncements } from "./adapters/useAnnouncements";
import { useLiveSession } from "./adapters/useLiveSession";
import { useSessionInstance } from "./adapters/useSessionInstance";
import { sessionEndLabel } from "./adapters/sessionEnd";
import SessionPickerModal from "./components/SessionPickerModal";
import { buildBasketCounts } from "./adapters/basketCounts";
import { useSessionWindow } from "./adapters/useSessionWindow";
import { useLiveFeed, commentKey } from "./adapters/useLiveFeed";
import { useOrders } from "./adapters/useOrders";
import { useOutbox } from "./adapters/outbox";
import { saveLiveSessionOrder } from "../db";
import { planAutoOrder, type AutoCode } from "./adapters/autoMode";
import { buildWinnerTicketBuyer, type RaffleEntry } from "./adapters/raffle";
import { loadCodes } from "./adapters/autoCodesDb";
import { resolveInitialProducts } from "./adapters/productsDb";
import { loadProducts } from "./adapters/products";
import { useFreeCap } from "./adapters/useFreeCap";
import { useAdmin } from "./adapters/useAdmin";
import { upsertUser } from "../accountDb";
import { csvDL, dayStamp } from "./adapters/csv";
import { computeSales } from "./adapters/sales";
import { useSalesReport } from "./adapters/salesReport";
import { ordersByHour } from "./adapters/peakHours";
import { sessionKeyFor } from "./adapters/shipping";
import { printSlip, buildSettingsFromRedesign, setNativePrintAlertText, setNativePrintFailureHandler, isPrinterNotSetup, type Settings as PrintSettings, type PrintVia } from "./adapters/printing";
import { snapshotFromCreate, performReprint, type ReprintRow } from "./adapters/reprint";
import { useOrdersHistory, resolveReprintRow } from "./adapters/ordersSearch";
import { btCallOutcome, hasBtBridge, buildTestStickerPayload, buildTestBuyer } from "./adapters/printerBridge";
import { registeredAccountsFor, appendAccount, maxAcc, composeChannelSave, type Platform } from "./adapters/connect";
import { useConnectToastGate } from "./adapters/connectToastGate";
import { useWakeLock, shouldHoldWakeLock } from "./adapters/useWakeLock";
import type { Buyer, Comment as ProdComment } from "../lib/orderTypes";
import CapPopup from "./screens/CapPopup";
import ConnectModal from "./screens/ConnectModal";
import ContactSupportPopup from "./components/ContactSupportPopup";
import { AnnouncementsSheet } from "./components/Announcements";
import { isIOS, STATUS_BAR_BACKDROP_HEIGHT } from "./adapters/platform";
import { isAdminRole } from "../lib/roles";
import UpdateModal from "./components/UpdateModal";
import ExpiryModal from "./components/ExpiryModal";
import PrinterModal from "./components/PrinterModal";
import PrinterGuideModal from "./components/PrinterGuideModal";
import { currentNativePlatform, readBinaryBuild, shouldShowUpdate, wasDismissed, markDismissed, storeUrlFor, bridgeBuildNumber, isUpdatePreview, IOS_BLE_BUILD, type NativePlatform, type NativeVersionConfig } from "./adapters/nativeVersion";
import { computeExpiryTier, wasExpiryDismissed, markExpiryDismissed, previewExpiryTier, type ExpiryTier } from "./adapters/planExpiryModal";
import { planDaysLeft } from "../lib/planWindow";
import { TProvider, buildT, tpl } from "./i18n";

type Screen =
  | "landing" | "login" | "signup" | "dashboard" | "miners" | "orders" | "products"
  | "menu" | "settings" | "customers" | "subscription" | "support"
  | "admin" | "print" | "sales" | "shipping" | "customerdata" | "legal" | "delete"
  | "printersettings" | "printpattern" | "ttchannels" | "fbchannels";

// Screens grouped under the Settings bottom-nav tab (tab is "active" for all).
const SETTINGS_GROUP: Screen[] = ["menu", "settings", "customers", "subscription", "support", "admin", "sales", "shipping", "customerdata", "legal", "delete", "printersettings", "printpattern", "ttchannels", "fbchannels"];


const LS = { theme: "sfl_rd_theme", accent: "sfl_rd_accent", lang: "sfl_rd_lang", currency: "sfl_rd_currency", currencySet: "sfl_rd_currency_set", automode: "sfl_rd_automode", pp: "sfl_rd_pp", printer: "sfl_rd_printer", keepAwake: "sfl_rd_keepawake", motion: "sfl_rd_motion" } as const;
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
  // Analytics — identify the signed-in seller once authed (parity with App.tsx
  // 735/757: email + plan/store_name/role). No-op when PostHog has no key.
  useEffect(() => {
    if (auth.status === "authed" && auth.profile) identifySeller(auth.profile);
  }, [auth.status, auth.profile]);

  // Phase 5b — READ-ONLY real data (no writes). Enabled only when authed; admin
  // users list only when the profile is admin (else a seller would see just their
  // own row, so we keep sample).
  const authed = auth.status === "authed";
  const isAdmin = isAdminRole(auth.profile?.role); // Batch E #16 — shared predicate
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
  const saveChannels = async (lists: { tiktok: string; facebook: string }, opts?: { unlocked?: { tiktok?: number[]; facebook?: number[] } }) => {
    if (!auth.profile) return { ok: false, error: "Not signed in" };
    const cur = auth.profile;
    // `unlocked` (default {}) = slot indices the 4h cooldown has server-verified as
    // editable; composeChannelSave still protects every still-locked slot + the cap.
    const next = composeChannelSave(cur.profile, lists, maxAcc(cur.plan), isAdminRole(cur.role), opts?.unlocked ?? {});
    const updated = { ...cur, profile: { ...cur.profile, tiktok: next.tiktok, facebook: next.facebook } };
    try {
      await upsertUser(updated);
      await auth.reloadProfile();
      return { ok: true };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Save failed" }; }
  };
  // Phase 5c — cross-device live-session load for the Dashboard (hydrate-on-empty).
  // Multi-day live session — window config (read-on-load) still feeds the LEGACY
  // (null-session_id) load path. The session-length pill was removed (sub-step 4);
  // session length is now chosen only in the required picker modal on Connect.
  const sessionWindow = useSessionWindow(authed);
  // Explicit session model — declared BEFORE useLiveSession so its currentSessionId
  // + loaded gate the feed load. Sub-step 3: when a session instance exists, the
  // live feed loads by session_id (stability fix); legacy sellers (null) keep the
  // window/session_date path. `ready` waits for BOTH config reads so the first load
  // picks the correct path once (no legacy-then-session double load).
  const sessionInstance = useSessionInstance(authed);
  const liveSession = useLiveSession(authed, { ready: sessionWindow.loaded && sessionInstance.loaded, windowDays: sessionWindow.windowDays, windowStart: sessionWindow.windowStart, sessionId: sessionInstance.currentSessionId });
  // Pending connect awaiting a session pick (the required picker modal). Non-null =
  // modal open + the platform/account to connect once a length is chosen.
  const [pickerConnect, setPickerConnect] = useState<{ platform: Platform; acct: string } | null>(null);
  // Orders search 7-day history (LAZY — fetches on the first search only,
  // once per open; display-only lane, structurally isolated from liveSession).
  const ordersHistory = useOrdersHistory(authed, liveSession.dayId, sessionWindow.windowStart, sessionWindow.windowDays);
  // Auto Mode (Step 4) — code map + ref-backed live stock for socket matching. Refs
  // (not state) so the socket handler reads the latest without re-subscribing and so
  // concurrent same-code comments claim stock SYNCHRONOUSLY (no double-decrement).
  const autoCommentRef = useRef<(c: ProdComment) => void>(() => {});
  const autoCodesRef = useRef<AutoCode[]>([]);
  const autoStockRef = useRef<Map<number, number>>(new Map());   // productLocalId → live remaining
  const autoSoldRef = useRef<Set<number>>(new Set());            // sold-out toast fired once per product
  const autoProcessedRef = useRef<Set<string>>(new Set());       // commentKey → already handled (sync dedup)

  // Dashboard account-picker selection (declared before useLiveFeed so the feed can
  // scope comments to the chosen account). registeredAccountsFor is pure.
  const [ttIdx, setTtIdx] = useState(0);
  const [fbIdx, setFbIdx] = useState(0);
  const ttAccounts = auth.profile ? registeredAccountsFor(auth.profile, "TikTok") : [];
  const fbAccounts = auth.profile ? registeredAccountsFor(auth.profile, "Facebook") : [];
  // Account-leak fix — the account the user has picked per platform. Passed to
  // useLiveFeed so ONLY this account's comments show, even with up to 5 accounts live.
  const liveSelected = { TikTok: ttAccounts[ttIdx] || "", Facebook: fbAccounts[fbIdx] || "" };

  // Phase 5d — real live comment feed (socket + dedup). Replaces the sample
  // SEED_COMMENTS/INCOMING stream. Read-only (order writes are 5e). The 3rd arg is the
  // Auto Mode seam — a stable wrapper calling the latest handler via ref (no re-subscribe).
  // 4th arg = the user's account selection (comment scoping).
  const liveFeed = useLiveFeed(authed, auth.profile?.email, (c) => autoCommentRef.current(c), liveSelected);
  // Approach A (FLive parity) — TikTok's pre-connect room buffer renders as a
  // history block BELOW the live feed. ORDERABLE since sql/18: each history row
  // is stamped `ordered` when an order for that exact message (msgId) already
  // exists in the loaded window — those render "Ordered ✓" with no buttons; the
  // rest get live 1-Click/Enterprise buttons once the window load resolves
  // (historyReady, the E1 gate — passed to the Dashboard below).
  // (optional-chained: test harnesses that mock useLiveFeed without the
  // additive initialComments field must degrade to live-only, not throw.)
  const orderedMsgIds = liveSession.orderedMsgIds;
  const comments = useMemo(() => {
    const init = liveFeed.initialComments;
    if (!init?.length) return liveFeed.comments;
    const flagged = init.map((c) => (c.msgId && orderedMsgIds.has(c.msgId) ? { ...c, ordered: true } : c));
    return [...liveFeed.comments, ...flagged];
  }, [liveFeed.comments, liveFeed.initialComments, orderedMsgIds]);

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
    if (!pc) return;
    const r = printSlip(b, pc.cur, pc.storeName, pc.settings); // sticker in APK; browser print on web
    track("print", { via: r.via }); // web-vs-native print usage (PostHog)
  };
  // Raffle winner ticket — SYNTHETIC buyer through the SAME printSlip pipeline
  // (routing + fallbacks identical to 1-Click auto-print / the Print screen).
  const onPrintWinner = (w: RaffleEntry): { ok: boolean; via: string } => {
    const pc = printCfgRef.current;
    if (!pc) return { ok: false, via: "none" };
    const r = printSlip(buildWinnerTicketBuyer(w, Date.now()), pc.cur, pc.storeName, pc.settings);
    return { ok: r.ok, via: r.via };
  };
  // REPRINT (FLive-parity) — print a COPY of an existing order's sticker: NO new
  // order, NO buyer#, NO stock change, NO DB write (zero-write contract, tested).
  // Resolution: in-session snapshot by comment id (covers rows without a msgId,
  // e.g. Facebook) → else the ordered-check map by msgId (covers restored rows
  // after a refresh — DB-backed, cross-device). Same printCfgRef snapshot + the
  // proven onPrintWinner pattern (print-without-create through printSlip).
  const reprintByIdRef = useRef<Map<string, ReprintRow>>(new Map());
  const onReprint = (id: string, msgId?: string) => {
    const pc = printCfgRef.current;
    if (!pc) return;
    const snap = reprintByIdRef.current.get(id) || (msgId ? orderedMsgIds.get(msgId) : null);
    if (!snap) return;
    const r = performReprint(snap, pc.cur, pc.storeName, pc.settings);
    track("reprint", { via: r.via }); // reprint usage (PostHog), mirrors track("print")
  };
  // Orders-tab reprint (torn-sticker search, 2026-07-13) — ZERO-WRITE like the
  // Dashboard ↻: resolveReprintRow picks the history fetch's RAW DB row when
  // present, else reconstructs from the window session order (parity-tested);
  // both feed the SAME performReprint (= printSlip only — no order/session/
  // customer/stock writes; pinned by the ordersSearch zero-write contract).
  const onReprintOrder = (o: RDOrder) => {
    const pc = printCfgRef.current;
    if (!pc || o.orderNum == null) return;
    const row = resolveReprintRow(o.orderNum, ordersHistory.rowFor(o.orderNum), liveSession.session.orders);
    if (!row) return;
    const r = performReprint(row, pc.cur, pc.storeName, pc.settings);
    track("reprint", { via: r.via });
  };
  // Batch D (#7): counts non-cap background write failures from the order
  // fan-out. A toast effect below (after tApp exists) converts bumps into the
  // localized "cloud save failed" toast — the local order is kept (see useOrders).
  const [orderWriteErrs, setOrderWriteErrs] = useState(0);
  const [stockErrs, setStockErrs] = useState(0); // M1 — stock-decrement RPC failure (Auto Mode oversell risk)
  // FAMILY A (#1 durability): the retry outbox for the live_session_orders write.
  // Drains on mount / return-to-visible / a connection rise; idempotent via the
  // ux_lso_user_msgid index, so a lost-ACK retry can never duplicate. An exhausted
  // item reuses the existing "cloud save failed" toast.
  const outbox = useOutbox({
    write: saveLiveSessionOrder,
    onExhausted: () => setOrderWriteErrs((c) => c + 1),
    drainSignal: liveFeed.ttConnected || liveFeed.fbConnected,
  });
  // Phase 5e — real order creation fan-out (writes). Composes the SAME pure
  // builder + db writes; updates the live session optimistically. 5f: soft-block
  // when capped, resync counter after write, surface hard popup on trigger reject.
  const orders = useOrders({
    getBuyers: liveSession.getBuyers,
    applyOrder: liveSession.applyOrder,
    sessionDate: liveSession.dayId,
    sessionId: sessionInstance.currentSessionId, // explicit session stamp (sql/20); additive, numbering unchanged

    isCapped: () => freeCap.freeCapped,
    onCapBlocked: () => freeCap.setCapPopup("hard"),
    onCapReached: freeCap.noteCapError,
    onWriteError: () => setOrderWriteErrs((c) => c + 1), // Batch D #7 — toast below
    onStockError: () => setStockErrs((c) => c + 1),      // M1 — stock RPC failure toast below
    afterWrite: freeCap.afterOrder,
    onPrint,
    onEnsureWindow: () => { void sessionWindow.ensureWindowOpen(); }, // multi-day; N=1 no-op
    enqueueLiveSession: outbox.enqueue,                  // FAMILY A #1 — durable retry (msgId writes)
    isMsgIdOrdered: (m) => liveSession.orderedMsgIds.has(m), // FAMILY A #7 — restored/loaded dedup
  });
  // Orders tab + Dashboard summary now share ONE source (the live session), so a
  // newly created order shows immediately. (5b's useLiveOrders is superseded here.)
  const ordersList = liveOrdersToRedesign(liveSession.session);
  // 🛒 basket counts — per-buyer order count for the feed rows, derived from the
  // SAME window-scoped session state (Buyer.totalOrders). ONE map per session
  // change; each feed row is an O(1) lookup. New window/reset → empty → all 0.
  const basketCounts = useMemo(() => buildBasketCounts(liveSession.session.buyers), [liveSession.session]);
  const ordersState: ReadState = liveSession.state === "idle" ? "sample" : liveSession.state;

  // Miners — aggregate RPC (sql/14 miners_stats: own totals + top-5 in one tiny
  // response). Replaces the old client-side derivation over the full customers
  // download, which was PostgREST-capped at 1,000 rows AND admin-RLS-scoped to
  // ALL sellers (the 2026-07-05 "1,000 buyers" bug). Still ALWAYS real-mode —
  // never the sample MINERS demo: any non-live/empty state (unauthed / RPC
  // error) is forced to clean 0s + the guidance empty-state.
  const minersData = useMinerStats(authed);
  const minersReal = minersData.state === "live" || minersData.state === "empty";
  const minerList = minersReal ? minersData.top : [];
  const minerStats = minersReal ? minersData.stats : ZERO_MINERS_STATS;
  const exportOrders = () => csvDL(`orders-${dayStamp()}.csv`, ["Order", "#", "Customer", "Item", "Qty", "Total", "Platform", "Time", "Status"], liveSession.session.orders.map((o) => [`#SF${o.orderNum}`, o.bNum, `@${o.handle}`, o.item, o.qty, `${cur}${o.total}`, o.platform, o.time, o.status]));
  const exportCustomers = () => csvDL(`customers-${dayStamp()}.csv`, ["Name", "Username", "Platform", "Orders", "Total"], customersData.customers.map((c) => [c.name, c.handle, c.platform, c.orders, `${cur}${c.spent}`]));
  const exportMiners = () => csvDL(`miners-${dayStamp()}.csv`, ["#", "Name", "Username", "Platform", "Orders", "Total"], minerList.map((m, i) => [i + 1, m.name, m.handle, m.platform, m.orders, `${cur}${m.spent}`]));

  // Sales report — session-derived aggregation (App.tsx Sales). CSV row shape
  // matches App.tsx:1988 exactly: [#SF{orderNum}, name, item, qty, cur+total, platform, time].
  const sales = computeSales(liveSession.session.orders, liveSession.session.buyers);
  // Sales Report v2 — historical periods from the orders ledger (sql/15 RPC,
  // Taipei-bucketed server-side). One RPC per period switch, cached; zero poll.
  const salesHist = useSalesReport(authed);
  // Today "Orders by hour" — bucket the current session's orders by device-local
  // hour (pure; orderNum is epoch ms). Derived from data the tab already loads.
  const salesByHour = ordersByHour(liveSession.session.orders);
  const exportSales = () => csvDL(`sales-${dayStamp()}.csv`, ["Order", "Buyer", "Item", "Qty", "Total", "Platform", "Time"], liveSession.session.orders.map((o) => [`#SF${o.orderNum}`, o.name, o.item, o.qty, `${cur}${o.total}`, o.platform, o.time]));

  const [theme, setTheme] = useState<ThemeMode>(() => (readLS(LS.theme, "light") === "dark" ? "dark" : "light"));
  const [accent, setAccent] = useState<AccentKey>(() => safeAccent(readLS(LS.accent, "indigo")));
  const [screen, setScreen] = useState<Screen>(anonScreen());
  // iOS App Store compliance: hide/neutralize all payment & subscription UI on iOS only
  // (Android/web unchanged). `ios` is evaluated once per render; `?ios=1` overrides for
  // browser testing. iosExpired = the neutral "plan inactive" popup (connect-403 on iOS).
  const ios = isIOS();
  const [iosExpired, setIosExpired] = useState(false);
  // Web-landing auth pop-up: "" = none, else Login/Signup renders in a modal OVER the
  // still-mounted landing (web only; the APK starts at screen "login" and never sets this).
  const [authModal, setAuthModal] = useState<"" | "login" | "signup">("");
  const [adminPanel, setAdminPanel] = useState<AdminPanelKind | null>(null);
  // Business Pulse — WEB-ONLY admin activity view (admin_business_pulse RPC).
  // Enabled ONLY while the pulse panel is open (read-on-open) and never in the app
  // shell (isAppShell → phone/APK/iOS) → zero polling, zero phone egress.
  const pulse = useBusinessPulse(authed && isAdmin && !isAppShell() && adminPanel === "pulse");
  // Announcements — ONE read of the latest 10 rows on app open (zero poll);
  // banner + 🔔 bell state. Admin publish/unpublish flow through the same hook.
  const ann = useAnnouncements(authed);
  const [annOpen, setAnnOpen] = useState(false);
  const [assignAmount, setAssignAmount] = useState("499");
  const [lang, setLang] = useState<string>(() => readLS(LS.lang, "en"));
  const [langOpen, setLangOpen] = useState(false);
  // RedesignApp is the TProvider parent → resolve strings directly here.
  // Memoized (audit #2): buildT merges ~1,100 keys — rebuilding that object on
  // EVERY app render (which happens per incoming live comment) was pure waste.
  const tApp = useMemo(() => buildT(lang), [lang]);
  // F-batch i18n: localize the native-printer failure alert (printing.ts module
  // fallback — the one string that module generates itself).
  useEffect(() => { setNativePrintAlertText(tApp.rd_print_native_failed); }, [tApp]);
  // Auto-dismissing toast (no buttons) — chip connect feedback. kind "ok" = success
  // ("Connected!"), "err" = honest failure reason. Errors linger a bit longer to read.
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), toast.kind === "err" ? 3200 : 1800); return () => clearTimeout(id); }, [toast]);

  // "No printer connected" modal — an order printed but the native bridge said no
  // printer is set up yet (BT_NOT_SET / PRINTER_NOT_SET). The order is ALREADY
  // saved (Option A); this only nudges the seller to finish setup. Registered
  // ONCE; reads screen via a ref so it can suppress itself while the seller is
  // already on the printer setup screens. No-stack: a burst of failed auto-prints
  // keeps the single open instance (functional set-state) — 3 orders, 1 modal.
  const [printerModal, setPrinterModal] = useState<{ via: PrintVia } | null>(null);
  const screenRef = useRef(screen);
  useEffect(() => { screenRef.current = screen; }, [screen]); // ref write in an effect (react-hooks/refs)
  useEffect(() => {
    setNativePrintFailureHandler(({ code, message, via }) => {
      if (!isPrinterNotSetup(code, message)) return false; // other codes keep their legacy path
      // Consume (suppress the legacy alert) but don't nag while they're setting up.
      if (screenRef.current === "printersettings" || screenRef.current === "printpattern") return true;
      setPrinterModal((cur) => cur || { via });
      return true;
    });
    return () => setNativePrintFailureHandler(null);
  }, []);

  // ── Cold-open modal coordinator: plan-EXPIRY nudge (priority) then native
  // UPDATE nudge. Runs ONCE after auth resolves — at that point nothing is live
  // (the socket connect is a deliberate post-open tap), so neither modal ever
  // interrupts an active live session. At most ONE shows per open (expiry wins,
  // it's time-critical); the other waits for the next open. Zero poll — expiry is
  // computed from the already-loaded profile via the shared lib/planWindow math
  // (no new query); update is ONE same-origin static fetch. Dev/preview toggles
  // (?preview_expiry=7|3|1|0, ?preview_update=1) force-show demos in a browser.
  const [expiry, setExpiry] = useState<{ tier: ExpiryTier; daysLeft: number } | null>(null);
  const [update, setUpdate] = useState<{ platform: NativePlatform; messageKey: string; force: boolean; latest: number } | null>(null);
  const coldDone = useRef(false);
  useEffect(() => {
    if (auth.status === "loading" || coldDone.current) return;
    coldDone.current = true;
    // preview overrides (dev/non-prod only)
    const pExp = previewExpiryTier();
    if (pExp) { setExpiry({ tier: pExp, daysLeft: pExp === "7d" ? 7 : pExp === "3d" ? 3 : pExp === "1d" ? 1 : 0 }); return; }
    if (isUpdatePreview()) { setUpdate({ platform: "ios", messageKey: "rd_upd_msg_ble", force: false, latest: IOS_BLE_BUILD + 1 }); return; }
    // 1) expiry (priority, sync — no query)
    const prof = auth.profile;
    if (prof) {
      const daysLeft = planDaysLeft(prof.planExpiry, Date.now());
      const tier = computeExpiryTier(prof.plan, prof.planStatus, daysLeft);
      if (tier && !wasExpiryDismissed(tier, prof.planExpiry)) { setExpiry({ tier, daysLeft }); return; }
    }
    // 2) native update (async, native platforms only)
    const platform = currentNativePlatform();
    if (!platform) return; // web browser → never
    let cancelled = false;
    fetch("/native-version.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg: NativeVersionConfig | null) => {
        if (cancelled || !cfg) return;
        const pcfg = cfg[platform];
        if (!pcfg) return;
        const build = readBinaryBuild(platform, { bridgeBuild: bridgeBuildNumber(), hasBle: hasBtBridge() });
        if (shouldShowUpdate(pcfg, build, wasDismissed(platform, pcfg.latest))) {
          setUpdate({ platform, messageKey: pcfg.message_key, force: pcfg.force, latest: pcfg.latest });
        }
      })
      .catch(() => { /* JSON missing/unreachable → no modal, silent */ });
    return () => { cancelled = true; };
  }, [auth.status, auth.profile]);
  const dismissUpdate = () => { if (update) markDismissed(update.platform, update.latest); setUpdate(null); };
  // Tap side-effect only — the modal's anchor href does the store open natively.
  const onUpdateTap = () => { if (update) markDismissed(update.platform, update.latest); };
  const dismissExpiry = () => { if (expiry) markExpiryDismissed(expiry.tier, auth.profile?.planExpiry); setExpiry(null); };
  // Tap side-effect only — the modal's anchor href opens Telegram natively.
  const onRenewTap = () => { if (expiry) markExpiryDismissed(expiry.tier, auth.profile?.planExpiry); };
  // Batch D silent-failure surfacing (#7/#8/#9) — converts adapter error signals
  // into the existing toast. Effects (not inline callbacks) because tApp is
  // declared after the hooks that emit the signals; counters/flags only ever
  // ADVANCE, so a prev-ref guard makes each bump toast exactly once.
  const prevOrderWriteErrs = useRef(0);
  useEffect(() => {
    if (orderWriteErrs <= prevOrderWriteErrs.current) return;
    prevOrderWriteErrs.current = orderWriteErrs;
    setToast({ msg: tApp.rd_ord_save_failed, kind: "err" });
  }, [orderWriteErrs, tApp]);
  const prevStockErrs = useRef(0); // M1 — stock-decrement RPC failure (Auto Mode oversell risk)
  useEffect(() => {
    if (stockErrs <= prevStockErrs.current) return;
    prevStockErrs.current = stockErrs;
    setToast({ msg: tApp.rd_auto_stock_failed, kind: "err" });
  }, [stockErrs, tApp]);
  const prevWinPersistErrs = useRef(0);
  useEffect(() => {
    if (sessionWindow.persistErrors <= prevWinPersistErrs.current) return;
    prevWinPersistErrs.current = sessionWindow.persistErrors;
    setToast({ msg: tApp.rd_win_save_failed, kind: "err" });
  }, [sessionWindow.persistErrors, tApp]);
  const prevLoadError = useRef(false);
  useEffect(() => {
    const was = prevLoadError.current;
    prevLoadError.current = liveSession.loadError;
    if (liveSession.loadError && !was) setToast({ msg: tApp.rd_sess_load_failed, kind: "err" });
  }, [liveSession.loadError, tApp]);
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

  // Dashboard account pickers (open/close state; ttIdx/fbIdx declared above
  // useLiveFeed for comment scoping).
  const [ttOpen, setTtOpen] = useState(false);
  const [fbOpen, setFbOpen] = useState(false);
  // Where "Back" returns from the ManageChannels screen — depends on origin
  // (Change 3): Settings → "settings" (unchanged), Live dashboard → "dashboard".
  const [chanBack, setChanBack] = useState<Screen>("settings");

  // General Settings local UI state (visual only).
  const [profileOpen, setProfileOpen] = useState(false);
  const [printerOpen, setPrinterOpen] = useState(false);
  // Printer setup guide (shown before the setup screen when a not-yet-set-up
  // printer type is picked) + a nonce that asks Settings to scroll the printer
  // picker into view when the seller arrives from the no-printer modal.
  const [printerGuide, setPrinterGuide] = useState<"wifi" | "bt" | null>(null);
  const [printerFocus, setPrinterFocus] = useState(0);
  // ONE-SHOT consume: Settings scrolls the picker into view once on arrival, then
  // calls this to clear the focus intent (stable identity so the child effect only
  // fires on printerFocus transitions, never on render churn).
  const consumePrinterFocus = useCallback(() => setPrinterFocus(0), []);
  // Default the Settings "Printer" row to the Bluetooth sticker slot (1) — the
  // real production printer (AIMO D520BT) virtually every seller uses. Slot 0
  // (WiFi/LAN receipt) stays reachable when the user taps it; this only changes
  // which slot is SHOWN by default so a BT seller doesn't see the WiFi slot's
  // "…not set up yet" copy. DISPLAY-ONLY: printerIdx never feeds print routing
  // (buildSettingsFromRedesign uses psType/psOut/psSize, not printerIdx).
  const [printerIdx, setPrinterIdx] = useState(1);

  // #6 — REAL TikTok/FB connect. Connected state + active account come from the
  // server via useLiveFeed (platform_status); the modal/pickers POST to the live
  // server. ⚠️ Preview-unverifiable (Render + socket) — only active post-merge/APK.
  const ttConnected = liveFeed.ttConnected;
  const fbConnected = liveFeed.fbConnected;
  const [connectOpen, setConnectOpen] = useState<Platform | null>(null);
  // CONNECT-TRUTH Item A — "Connected!" fires on the ttConnected RISE (server
  // truth), gated to a recent Connect tap: background rises (health-cycle
  // recovery, join snapshot after a socket blip) never pop a surprise toast
  // mid-live. Armed at the tap (BEFORE the POST — the server emits the status
  // event before the HTTP response), disarmed on a failed attempt.
  const ttToastGate = useConnectToastGate(ttConnected, () => setToast({ msg: tApp.rd_dash_connected_toast, kind: "ok" }));
  const fbToastGate = useConnectToastGate(fbConnected, () => setToast({ msg: tApp.rd_dash_connected_toast, kind: "ok" }));
  const toastGateFor = (platform: Platform) => (platform === "TikTok" ? ttToastGate : fbToastGate);
  // ConnectModal action: real connect → on success register the account on the
  // profile (same as App.tsx connectPlatform) + reload so it appears in the picker.
  const handleConnect = async (platform: Platform, data: Record<string, string>) => {
    toastGateFor(platform).arm(); // the modal's Connect tap = an attempt (2nd door)
    const r = await liveFeed.connect(platform, data);
    if (!r.ok) toastGateFor(platform).disarm(); // a later background rise must not claim this
    if (r.ok && auth.profile) {
      const np = appendAccount(auth.profile, platform, r.account);
      if (np) { try { await upsertUser(np); await auth.reloadProfile(); } catch { /* non-fatal */ } }
    }
    return r;
  };
  // Pick the active account — SELECT ONLY. Tapping a row just moves the checkmark
  // (setTtIdx/setFbIdx) and updates comment scoping (liveSelected derives from the idx);
  // it does NOT close the dropdown and does NOT connect. Connect is the sole action that
  // connects + closes (doConnect). No connect.ts/useLiveFeed change — selection state only.
  const switchAccount = (platform: Platform, i: number) => {
    if (platform === "TikTok") setTtIdx(i); else setFbIdx(i);
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
  // KEEP-AWAKE habang naka-live (FLive/Chotdon parity) — web Screen Wake Lock,
  // held while GREEN or AMBER (kasama ang connecting/recovering — ang 60s grace
  // ay karaniwang bumabalik sa green; ang natutulog na phone mid-heal ay
  // pumapatay sa recovery), released on honest GRAY. Toggle sa GeneralSettings
  // (default ON, sfl_rd_keepawake). iOS <16.4 = graceful no-op (feature-detect
  // sa hook). Client-side ang order capture — sleeping phone = nawawalang mines.
  const [keepAwake, setKeepAwake] = useState<boolean>(() => readLS(LS.keepAwake, "1") !== "0");
  const toggleKeepAwake = () => {
    setKeepAwake((v) => {
      const next = !v;
      try { localStorage.setItem(LS.keepAwake, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };
  // Motion kill switch — default ON. Drives [data-motion] on the root; the CSS
  // gates ONLY looping animations (one-shot entrances stay). Presentational.
  const [motionOn, setMotionOn] = useState<boolean>(() => readLS(LS.motion, "1") !== "0");
  const toggleMotion = () => {
    setMotionOn((v) => {
      const next = !v;
      try { localStorage.setItem(LS.motion, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };
  useWakeLock(shouldHoldWakeLock(keepAwake, {
    ttEff, fbEff,
    ttConnecting, fbConnecting,
    ttRecovering: liveFeed.ttRecovering, fbRecovering: liveFeed.fbRecovering,
  }));
  // The actual socket connect (unchanged) — extracted so BOTH the "session already
  // running" path and the "after the seller picks a session length" path can call
  // it. Nothing in this body changed vs the old inline doConnect.
  const performConnect = async (platform: Platform, acct: string) => {
    const setConnecting = platform === "TikTok" ? setTtConnecting : setFbConnecting;
    const setOpen = platform === "TikTok" ? setTtOpen : setFbOpen;
    setOpen(false);                                  // Connect uses the selected account → close the dropdown
    setConnecting(true);
    track("connect_attempt", { platform });          // analytics parity (App.tsx:4277)
    toastGateFor(platform).arm();                    // Item A — the tap arms the success toast
    try {
      const r = await liveFeed.connect(platform, { username: acct });
      // connect_success / connect_failed — captured for EVERY outcome (App.tsx:4289-4311),
      // before the early returns below. reason: not-live → "not_live"; else the real error.
      if (r.ok) track("connect_success", { platform });
      else { track("connect_failed", { platform, reason: r.notLive ? "not_live" : (r.error || "unknown") }); toastGateFor(platform).disarm(); }
      // iOS: an expired plan (server 403 "plan_expired") shows a NEUTRAL "plan inactive"
      // popup → Contact Support, NOT a payment-tinged toast. Android/web keep the toast.
      if (ios && !r.ok && (r.error || "").includes("plan_expired")) { setIosExpired(true); return; }
      // Phase 1 — account resolved but is NOT live (server 409 notLive): a distinct,
      // localized "start your LIVE first" toast, NOT the generic server-error toast.
      if (r.notLive) { setToast({ msg: tApp.rd_cm_not_live, kind: "err" }); return; }
      // F-batch i18n: a CLIENT-side network failure (fetch threw — no server reason)
      // gets its own localized toast instead of the hardcoded English fallback.
      if (!r.ok && r.unreachable) { setToast({ msg: tApp.rd_cm_cant_reach, kind: "err" }); return; }
      // CONNECT-TRUTH Item A: the old r.ok "Connected!" toast is GONE (the same
      // POST-ok-as-truth lie the branch removes) — success now toasts via the
      // gated ttConnected rise above. Failures keep the honest r-based toast.
      if (!r.ok) setToast({ msg: r.error || tApp.rd_cm_conn_failed, kind: "err" });
    } finally { setConnecting(false); }
  };
  const doConnect = async (platform: Platform) => {
    const eff = platform === "TikTok" ? ttEff : fbEff;
    const setOff = platform === "TikTok" ? setTtOff : setFbOff;
    const accts = platform === "TikTok" ? ttAccounts : fbAccounts;
    const idx = platform === "TikTok" ? ttIdx : fbIdx;
    if (eff) { setOff(true); return; } // Disconnect (local UI; no server unbind — manual-connect-only: no auto-reconnect to forget)
    const acct = accts[idx] || accts[0];
    if (!acct) {
      // No registered account (Addendum 2, 2026-07-23). TikTok → the
      // Manage/add-accounts screen (SAME destination + back-behaviour as the
      // Live dropdown row), retiring the old ConnectModal add-popup for this
      // path. The Facebook fallthrough below is KEPT (not deleted) but is
      // unreachable — nothing in the UI connects Facebook after the prior commits.
      if (platform === "TikTok") { setTtOpen(false); setChanBack("dashboard"); setScreen("ttchannels"); return; }
      setConnectOpen(platform); return;
    }
    // EXPLICIT SESSION MODEL (sub-step 2): a session must be running before the feed
    // starts. Ask the SERVER (authoritative ended-check; never the device clock).
    // running → straight to the feed with the existing session (no reset). NOT
    // running → REQUIRED picker; the feed starts only AFTER a pick creates a
    // session (a dismiss aborts the connect — never a session-less feed).
    // Sub-step 4 (audit LOW #2): WAIT for the mount read first, so a tap while it
    // is still pending can't fall back to a null id → a wrongful new session.
    // ensureLoaded always resolves (the mount read always completes) → no deadlock.
    await sessionInstance.ensureLoaded();
    const status = await sessionInstance.checkStatus();
    if (status.running) { void performConnect(platform, acct); return; }
    setPickerConnect({ platform, acct });
  };
  // Picker "pick a length" → create the session (server-authoritative start), THEN
  // connect. A null id (RPC failed) surfaces a toast and does NOT start a feed.
  const onPickSessionLength = async (days: number) => {
    const pending = pickerConnect;
    setPickerConnect(null);
    if (!pending) return;
    const sid = await sessionInstance.startSession(days);
    if (!sid) { setToast({ msg: tApp.rd_sp_start_failed, kind: "err" }); return; }
    // New session_id → clear + reload the live session so it loads by the NEW id
    // (empty → buyer# restarts at #1). The load effect re-runs on the sessionId
    // change; reset() clears the prior session's rows so the hydrate-on-empty
    // guard lets the fresh (empty) session load.
    liveSession.reset();
    void performConnect(pending.platform, pending.acct);
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
      customersData.reload();     // reload the paged customers list
      minersData.reload();        // re-run the miners_stats aggregate RPC
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
  // HONEST STEPS: one tap = one whole printable level (1→2→3, clamped) — the
  // printer only produces integer TSPL magnifications, so fractional 0.1 steps
  // were 26 fake positions that mostly printed identically. stepScaleLevel
  // starts from printScaleLevel(current), so a legacy stored fraction (e.g.
  // 1.3, which already PRINTS as 1x) snaps onto the honest ladder on first tap.
  // Stored legacy fractions are otherwise left as-is (display + print already
  // quantize them identically; no load-time rewrite → zero migration risk).
  const stepPp = (k: PpSizeKey, dir: 1 | -1) => setPp((p) => ({ ...p, [k]: stepScaleLevel(p[k], dir) }));
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
    const storeName = auth.profile?.profile.storeName || "SellerFlowLive";
    const settings = buildSettingsFromRedesign({ pp, psType, psOut, psSize });
    // No BT bridge (web/desktop) → browser-print the SAME test pattern through
    // printSlip, so desktop sellers can preview their pattern settings too.
    if (!hasBtBridge()) {
      const wr = printSlip(buildTestBuyer(), cur, storeName, settings);
      setToast(wr.ok ? { msg: tpl(tApp.rd_pr_sent, { via: wr.via }), kind: "ok" } : { msg: tApp.rd_ps_test_failed, kind: "err" });
      return;
    }
    const r = await btCallOutcome("printStickerNative", buildTestStickerPayload(cur, storeName, settings));
    if (r.ok) { setToast({ msg: tApp.rd_ps_test_sent, kind: "ok" }); return; }
    setToast({ msg: isPrinterNotSetup(r.code, r.message) ? tApp.rd_prn_title : tApp.rd_ps_test_failed, kind: "err" });
  };

  // Auto Mode on/off. Default OFF, but PERSISTED (sfl_rd_automode) so the toggle
  // stays where the seller left it across refresh — same pattern as theme/currency.
  const [autoDetect, setAutoDetect] = useState<boolean>(() => readLS(LS.automode, "0") === "1");
  const [autoSetupOpen, setAutoSetupOpen] = useState(false);
  // F-batch sweep: the old word-list plumbing (autoWords/sfl_rd_autowords/
  // addAutoWord) is gone — it had no renderer and the REAL Auto Mode matches
  // product CODES (useAutoCodes). The toggle + setup accordion remain real.
  const autoControls: AutoControls = {
    detect: autoDetect, setupOpen: autoSetupOpen,
    toggle: () => setAutoDetect((v) => !v),
    toggleSetup: () => setAutoSetupOpen((o) => !o),
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
    const prod = liveFeed.getComment(id); // resolves live AND history rows (sql/18 unlock)
    if (!prod) return;
    const order = orders.createOrder(prod, 0);
    if (order) {
      setPrinted((p) => ({ ...p, [id]: "order" })); // null = free-cap blocked
      const snap = snapshotFromCreate(prod, order); // reprint — the original order, row-shaped
      reprintByIdRef.current.set(id, snap);
      liveSession.addOrderedMsgId((prod as ProdComment & { msgId?: string }).msgId, snap); // ordered-check stays complete
    }
  };
  const onOpenEnt = (id: string) => { setEntId(id); setEntPrice(""); };
  // Enterprise: create the order at the typed price. ONE code path for BOTH
  // triggers — Enter (desktop/Android/iPad) AND the in-app ✓ button (the
  // iPhone fix: the iOS number pad has NO return key, so Enter can never be
  // delivered there — the keyboard's ✓ is a plain dismiss/blur with no
  // distinguishing event, and blur-as-print would ghost-print on row unmount
  // in a fast feed; see the 2026-07-13 investigation).
  // Sync double-tap guard (money path): `printed` is React state — two taps
  // in the same batch would both read it stale → double order; the ref is
  // marked SYNCHRONOUSLY before the create.
  const entSubmittedRef = useRef<Set<string>>(new Set());
  const submitEnt = () => {
    const id = entId;
    if (!id) return;
    // VALIDATION (2026-07-13, with the ✓ button): a typed price is REQUIRED
    // and must be > 0 — empty/zero/invalid creates NOTHING and keeps the
    // field open so the seller can fix it. (Deliberate change from the old
    // Enter behavior, which turned an empty field into a price-0 order —
    // 1-Click is the price-0 path; an accidental submit on an empty field
    // must not mint a duplicate-looking zero order.)
    const price = Number(entPrice || "0") || 0;
    if (price <= 0) return;
    if (entSubmittedRef.current.has(id) || printed[id]) return; // double-tap / already-ordered guard
    entSubmittedRef.current.add(id);
    const prod = liveFeed.getComment(id); // resolves live AND history rows (sql/18 unlock)
    const order = prod ? orders.createOrder(prod, price) : null;
    if (order) {
      setPrinted((p) => ({ ...p, [id]: cur + price }));
      const snap = snapshotFromCreate(prod as ProdComment, order); // reprint snapshot
      reprintByIdRef.current.set(id, snap);
      liveSession.addOrderedMsgId((prod as ProdComment & { msgId?: string }).msgId, snap);
    } else {
      entSubmittedRef.current.delete(id); // free-cap soft block / unresolved id → allow retry
      if (!prod) return;
    }
    setEntId(null); setEntPrice("");
  };
  const onEntKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    submitEnt();
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
      const snap = snapshotFromCreate(c, order); // reprint snapshot (auto orders reprint too)
      reprintByIdRef.current.set(key, snap);
      liveSession.addOrderedMsgId((c as ProdComment & { msgId?: string }).msgId, snap); // ordered-check stays complete
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
      setAuthModal(""); // close the landing auth pop-up once signed in
      setScreen((s) => (s === "login" || s === "signup" || s === "landing" ? "dashboard" : s));
      if (!currencyPinnedRef.current) {
        currencyPinnedRef.current = true;
        let explicit = false;
        try { explicit = !!localStorage.getItem(LS.currencySet); } catch { explicit = false; }
        if (!explicit) setCurrency(DEFAULT_CURRENCY);
      }
    } else if (auth.status === "anon") {
      setScreen(anonScreen());
    }
  }, [auth.status]);

  const showNav = screen !== "login" && auth.status === "authed";
  const ordersActive = screen === "orders" || screen === "print";
  // Nav item = .sfl-navbtn (+ .is-active). All visual styling lives in redesign.css
  // (mobile baseline byte-equal to the old inline navBtn; desktop sidebar via @media).
  const navCls = (on: boolean) => "sfl-navbtn" + (on ? " is-active" : "");
  const settingsActive = SETTINGS_GROUP.includes(screen);

  return (
    <TProvider lang={lang}>
    <div data-redesign="" data-theme={theme} data-accent={accent} data-motion={motionOn ? "on" : "off"} className="sfl-stage">
      <div className="sfl-phone">
        {theme === "dark" && (
          <>
            <div className="sfl-grid" />
            <div className="sfl-glow-a" />
            <div className="sfl-glow-cyan" />
          </>
        )}

        {/* Status-bar backdrop — the canonical full-bleed pattern. The iOS shell
            draws BEHIND the status bar (ios.contentInset default "never" +
            viewport-fit=cover), so this strip paints var(--header-bg) under the
            system clock/battery: every screen starts with the same header color
            (headerBar / the Login+Signup hero), making the purple run
            edge-to-edge like a native opaque nav bar. White text on top comes
            from the StatusBar plugin (style DARK, set natively + in main.tsx).
            Android WebView draws BELOW its status bar and desktop has none, so
            env(safe-area-inset-top)=0 → zero height → byte-identical there.
            backdrop-filter mirrors headerBar so the dark theme's translucent
            header-bg reads as one continuous surface. */}
        <div style={{ height: STATUS_BAR_BACKDROP_HEIGHT, flexShrink: 0, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)" }} />

        {/* key={screen} remounts the scroll subtree on navigation so the
            one-shot entrance (.sfl-anim-screen) re-fires + scroll resets to top.
            Screens already unmount/remount per {screen===…}; this adds no new
            remounts, only the fresh scroll element + fade. Hooks (useLiveFeed /
            useOrders) live ABOVE this node → comment/order state is untouched. */}
        <div className="sfl-scroll sfl-anim-screen" key={screen}>
          {auth.status === "loading" && (
            <div style={{ minHeight: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, color: "var(--text-muted)" }}>
              <img src="/redesign/icon-180.png" alt="SellerFlowLive" className="sfl-anim-float" style={{ width: 56, height: 56, borderRadius: 15, objectFit: "cover", opacity: 0.9 }} />
              <div style={{ fontSize: 13, fontWeight: 600, fontFamily: "var(--font-ui)" }}>Loading…</div>
            </div>
          )}
          {screen === "landing" && auth.status !== "loading" && (
            <>
              <Landing
                onLogin={() => setAuthModal("login")}
                onSignup={() => setAuthModal("signup")}
                lang={lang}
                langOpen={langOpen}
                onToggleLang={() => setLangOpen((o) => !o)}
                onPickLang={(code) => { setLang(code); setLangOpen(false); }}
              />
              {/* Web-landing auth pop-up: Login/Signup overlay; the landing stays mounted
                  behind. Same components, same auth logic — only the presentation differs.
                  On success, the auth effect clears authModal + navigates to the dashboard. */}
              {authModal && (
                <AuthModal onClose={() => setAuthModal("")} closeLabel={tApp.rd_close} brand={<AuthBrandPanel />}>
                  {authModal === "login" ? (
                    <Login
                      onLogin={(email, password) => auth.signIn(email, password)}
                      configured={auth.configured}
                      onSignup={() => setAuthModal("signup")}
                      lang={lang}
                      langOpen={langOpen}
                      onToggleLang={() => setLangOpen((o) => !o)}
                      onPickLang={(code) => { setLang(code); setLangOpen(false); }}
                    />
                  ) : (
                    <Signup
                      onBack={() => setAuthModal("login")}
                      onLegal={() => { setAuthModal(""); setScreen("legal"); }}
                      onRegister={auth.register}
                    />
                  )}
                </AuthModal>
              )}
            </>
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
              comments={comments} cur={cur} basketCounts={basketCounts}
              ttOpen={ttOpen} fbOpen={fbOpen} ttIdx={ttIdx} fbIdx={fbIdx}
              onToggleTT={() => { setTtOpen((o) => !o); setFbOpen(false); }}
              onToggleFB={() => { setFbOpen((o) => !o); setTtOpen(false); }}
              onPickTT={(i) => switchAccount("TikTok", i)}
              /* TikTok "Manage / add accounts" row → manage screen, back target =
                 Live dashboard (Change 3). FB has no onPickFB — honest gate. */
              onManageTT={() => { setTtOpen(false); setChanBack("dashboard"); setScreen("ttchannels"); }}
              /* F3 — recovering has DISPLAY precedence over connected: while a grace
                 window is armed (health-cycle reconnect / socket blip) the pill shows
                 the existing amber pulsing "Connecting…" instead of a solid green; a
                 real connected:true clears recovering → green. The hook-level state
                 machine (grace timers, honest gray) is untouched — display-only. */
              ttConnected={ttEff && !liveFeed.ttRecovering} fbConnected={fbEff && !liveFeed.fbRecovering}
              ttConnecting={ttConnecting || liveFeed.ttRecovering} fbConnecting={fbConnecting || liveFeed.fbRecovering}
              /* Viewer chip: GREEN-only (exact same booleans as ttConnected above) —
                 amber/gray → null → hidden. Data-side resets live in useLiveFeed. */
              viewers={ttEff && !liveFeed.ttRecovering ? liveFeed.ttViewers : null}
              /* Sub-step 5 — session-end indicator (old pill slot). Server-Taipei end
                 date from session_started_at (device-clock-free); ended flag from
                 session_status. null label → no indicator (defensive: no session). */
              sessionEndsAt={sessionInstance.currentSessionId && sessionInstance.sessionStartedAt && sessionInstance.sessionWindowDays ? sessionEndLabel(sessionInstance.sessionStartedAt, sessionInstance.sessionWindowDays, lang) : null}
              sessionEnded={sessionInstance.ended}
              onConnectTT={() => void doConnect("TikTok")}
              onRefreshTT={() => void refreshDashboard()} refreshing={refreshing}
              ttAccounts={ttAccounts} fbAccounts={fbAccounts}
              printed={printed} entId={entId} entPrice={entPrice}
              historyReady={liveSession.orderedLoaded}
              onReprint={onReprint}
              onOneClick={onOneClick} onOpenEnt={onOpenEnt}
              onEntPrice={(v) => setEntPrice(v.replace(/[^0-9]/g, ""))} onEntKey={onEntKey} onEntSubmit={submitEnt}
              session={liveSession.session} sessionState={liveSession.state}
              canInject={liveFeed.canInject} onInjectSynthetic={liveFeed.injectSynthetic}
              announcement={ann.latest} annDismissedId={ann.dismissedId} onDismissAnn={ann.dismiss}
              annUnread={ann.unread} onOpenAnn={() => { setAnnOpen(true); if (ann.list[0]) ann.markSeen(ann.list[0].id); }}
              onPrintWinner={onPrintWinner}
            />
          )}
          {screen === "orders" && <Orders onGoPrint={() => setScreen("print")} cur={cur} orders={ordersList} state={ordersState} onExport={exportOrders} onGoShipping={() => setScreen("shipping")}
            historyOrders={ordersHistory.orders} historyState={ordersHistory.state} onEnsureHistory={ordersHistory.ensureLoaded} onReprintOrder={onReprintOrder} todayId={liveSession.dayId} />}
          {screen === "products" && <Products cur={cur} />}
          {screen === "miners" && <Miners cur={cur} miners={minerList} stats={minerStats} onExport={exportMiners} />}
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
              onLogout={() => { resetAnalytics(); void auth.signOut(); setScreen("login"); }}
              isAdmin={isAdmin}
            />
          )}
          {screen === "settings" && (
            <GeneralSettings
              theme={theme} accent={accent} onSetTheme={setTheme} onSetAccent={setAccent}
              auto={autoControls} cur={cur} account={auth.profile} onSaveProfile={saveProfile}
              onManageChannel={(p) => { setChanBack("settings"); setScreen(p === "tiktok" ? "ttchannels" : "fbchannels"); }}
              onAutoCodesSaved={liftAutoCodes}
              lang={lang} onSetLang={setLang} currency={currency} onSetCurrency={setCurrencyExplicit}
              profileOpen={profileOpen} onToggleProfile={() => setProfileOpen((o) => !o)}
              printerIdx={printerIdx} printerOpen={printerOpen} printerFocus={printerFocus}
              onPrinterFocused={consumePrinterFocus}
              onTogglePrinter={() => setPrinterOpen((o) => !o)}
              /* Pick a printer type → set psType, then show the setup GUIDE when
                 that type isn't set up yet (alreadySetUp from the picker's live
                 status), else go straight to the technical setup screen. */
              onPickPrinter={(i, alreadySetUp) => {
                setPrinterIdx(i); setPrinterOpen(false);
                const kind = i === 0 ? "wifi" : "bt"; setPsType(kind);
                if (alreadySetUp) setScreen("printersettings"); else setPrinterGuide(kind);
              }}
              onPrintPattern={() => setScreen("printpattern")}
              onSubscription={() => setScreen("subscription")}
              onSupport={() => setScreen("support")}
              onDelete={() => setScreen("delete")}
              keepAwake={keepAwake} onToggleKeepAwake={toggleKeepAwake}
              motionOn={motionOn} onToggleMotion={toggleMotion}
            />
          )}
          {(screen === "ttchannels" || screen === "fbchannels") && (
            <ManageChannels platform={screen === "ttchannels" ? "tiktok" : "facebook"} account={auth.profile} onBack={() => setScreen(chanBack)} onSaveChannels={saveChannels} />
          )}
          {/* onExport gated on live (#7): the sample fallback list must never be
              downloadable as a real-looking CSV. */}
          {screen === "customers" && <Customers cur={cur} customers={customersData.customers} state={customersData.state} onExport={customersData.state === "live" ? exportCustomers : undefined} hasMore={customersData.hasMore} loadingMore={customersData.loadingMore} onLoadMore={customersData.loadMore} />}
          {screen === "subscription" && !ios && <Subscription cur={cur} account={auth.profile} isFreeUser={freeCap.isFreeUser} freeStatus={freeCap.freeStatus} />}
          {screen === "support" && <Support onLegal={() => setScreen("legal")} />}
          {screen === "admin" && isAdmin && <Admin onOpenPanel={setAdminPanel} cur={cur} counts={adminCounts} live={adminLive} userBase={adminLive ? { paying: userBase.paying, free: userBase.free, total: userBase.total } : undefined} mrr={adminLive ? deriveMrr(adminUsers.users) : null} owner={auth.profile ? { name: auth.profile.profile.fullName, email: auth.profile.email } : null} />}
          {screen === "print" && <Print onBack={() => setScreen("orders")} cur={cur} buyers={liveSession.session.buyers} storeName={auth.profile?.profile.storeName || "SellerFlowLive"} settings={buildSettingsFromRedesign({ pp, psType, psOut, psSize })} />}
          {screen === "sales" && <SalesReport cur={cur} sales={sales} onExport={exportSales} hist={salesHist} byHour={salesByHour} enabled={authed} />}
          {screen === "shipping" && <Shipping cur={cur} buyers={liveSession.session.buyers} sessionKey={sessionKeyFor(liveSession.dayId, sessionWindow.windowStart, sessionWindow.windowDays)} windowDays={sessionWindow.windowDays} plan={auth.profile?.plan} onUpgrade={ios ? undefined : () => setScreen("subscription")} />}
          {screen === "customerdata" && <CustomerData onLegal={() => setScreen("legal")} cur={cur} customers={customersData.state === "live" ? customersData.customers : []} onExport={customersData.state === "live" ? exportCustomers : undefined} />}
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
          <div className="sfl-nav">
            {/* Brand header — sidebar only (display:none below 900px). */}
            <div className="sfl-nav-logo">
              <img src="/redesign/icon-180.png" alt="" className="sfl-anim-float" style={{ width: 30, height: 30, borderRadius: 8, objectFit: "cover" }} />
              <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, color: "var(--text)", letterSpacing: "-.01em" }}>SellerFlowLive</span>
            </div>
            <button onClick={() => setScreen("dashboard")} className={navCls(screen === "dashboard")}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" fill="currentColor" /><circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="1.7" opacity=".55" /></svg>
              <span style={{ fontSize: 10, fontWeight: 700 }}>{tApp.rd_nav_live}</span>
            </button>
            <button onClick={() => setScreen("miners")} className={navCls(screen === "miners")}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 19V11M9 19V5M14 19v-6M19 19V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              <span style={{ fontSize: 10, fontWeight: 700 }}>Miners</span>
            </button>
            <button onClick={() => setScreen("orders")} className={navCls(ordersActive)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M6 7h12l-1 12a2 2 0 0 1-2 1.8H9A2 2 0 0 1 7 19L6 7Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M9 7a3 3 0 0 1 6 0" stroke="currentColor" strokeWidth="1.7" /></svg>
              <span style={{ fontSize: 10, fontWeight: 700 }}>{tApp.rd_nav_orders}</span>
            </button>
            <button onClick={() => setScreen("products")} className={navCls(screen === "products")}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="m4 8.5 8 4.5 8-4.5M12 13v7" stroke="currentColor" strokeWidth="1.7" /></svg>
              <span style={{ fontSize: 10, fontWeight: 700 }}>{tApp.rd_nav_products}</span>
            </button>
            <button onClick={() => setScreen("menu")} className={navCls(settingsActive)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" /><path d="M19.4 13c.04-.3.06-.66.06-1s-.02-.7-.06-1l2.1-1.6-2-3.5-2.5 1a7.5 7.5 0 0 0-1.7-1l-.4-2.6H9.1l-.4 2.6c-.6.25-1.18.58-1.7 1l-2.5-1-2 3.5L4.6 11c-.04.3-.06.66-.06 1s.02.7.06 1l-2.1 1.6 2 3.5 2.5-1c.52.42 1.1.75 1.7 1l.4 2.6h5.8l.4-2.6c.6-.25 1.18-.58 1.7-1l2.5 1 2-3.5-2.1-1.6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
              <span style={{ fontSize: 10, fontWeight: 700 }}>{tApp.rd_nav_settings}</span>
            </button>
            {/* Admin — owner only, sidebar only (display:none below 900px). */}
            {isAdmin && (
              <button onClick={() => setScreen("admin")} className={navCls(screen === "admin") + " sfl-nav-admin"}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3 5 6v5c0 4 2.8 6.9 7 8 4.2-1.1 7-4 7-8V6l-7-3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
                <span style={{ fontSize: 10, fontWeight: 700 }}>{tApp.rd_nav_admin}</span>
              </button>
            )}
          </div>
        )}

        {/* Admin control bottom-sheet (absolute within the phone, like the v2 prototype) */}
        {adminPanel && isAdmin && (
          <AdminPanel panel={adminPanel} onClose={() => setAdminPanel(null)} assignAmount={assignAmount} onAssignAmount={setAssignAmount} cur={cur} users={adminUsers.users} usersState={adminUsers.state} rawByEmail={adminUsers.rawByEmail} actions={admin} onChanged={() => { adminUsers.reload(); freeUsersData.reload(); auditData.reload(); }} freeUsers={freeUsersData.freeUsers} freeUsersState={freeUsersData.state} auditLogs={auditData.logs} auditState={auditData.state} onOpenPanel={setAdminPanel} pulse={pulse.data} pulseState={pulse.state} onRefreshPulse={pulse.refresh} ann={{ list: ann.list, loading: ann.loading, publish: ann.publish, unpublish: ann.unpublish, remove: ann.remove }} onToast={(msg, kind) => setToast({ msg, kind })} />
        )}

        {/* 🔔 Announcements list bottom-sheet (same pattern as AdminPanel) */}
        {annOpen && <AnnouncementsSheet list={ann.list} loading={ann.loading} onClose={() => setAnnOpen(false)} />}

        {/* #6 — real connect modal (registered-account picker / add account) */}
        {connectOpen && auth.profile && (
          <ConnectModal profile={auth.profile} initialTab={connectOpen} onClose={() => setConnectOpen(null)} onConnect={handleConnect} />
        )}
        {/* Explicit session model (sub-step 2) — required session-length picker shown
            on Connect when no session is running. Pick → create session → connect;
            cancel → abort (no feed, no session). */}
        {pickerConnect && (
          <SessionPickerModal onPick={(n) => void onPickSessionLength(n)} onCancel={() => setPickerConnect(null)} />
        )}

        {/* Phase 5f — free-tier cap popup (near / hard). iOS: neutral Contact-Support
            popup (no upgrade/subscription wording). Android/web: original CapPopup. */}
        {freeCap.capPopup && ios && (
          <ContactSupportPopup
            title={freeCap.capPopup === "hard" ? tApp.rd_ios_cap_hard_title : tApp.rd_cap_near_title}
            message={freeCap.capPopup === "hard"
              ? tApp.rd_ios_cap_hard_msg
              : tpl(tApp.rd_ios_cap_near_msg, { left: Math.max(0, (freeCap.freeStatus?.cap ?? 100) - (freeCap.freeStatus?.count ?? 0)), cap: freeCap.freeStatus?.cap ?? 100 })}
            onClose={() => freeCap.setCapPopup("")}
          />
        )}
        {freeCap.capPopup && !ios && (
          <CapPopup
            kind={freeCap.capPopup}
            freeStatus={freeCap.freeStatus}
            onUpgrade={() => { freeCap.setCapPopup(""); setScreen("subscription"); }}
            onViewOrders={() => { freeCap.setCapPopup(""); setScreen("orders"); }}
            onClose={() => freeCap.setCapPopup("")}
          />
        )}
        {/* iOS expired-plan neutral popup (triggered by a connect-403). */}
        {ios && iosExpired && (
          <ContactSupportPopup
            title={tApp.rd_ios_expired_title}
            message={tApp.rd_ios_expired_msg}
            onClose={() => setIosExpired(false)}
          />
        )}

        {/* Cold-open nudges — expiry (priority) then native update. Mutually
            exclusive per open (see the coordinator effect above). */}
        {expiry && (
          <ExpiryModal tier={expiry.tier} daysLeft={expiry.daysLeft} ios={ios} onDismiss={dismissExpiry} onAction={onRenewTap} />
        )}
        {!expiry && update && (
          <UpdateModal messageKey={update.messageKey} force={update.force} href={storeUrlFor(update.platform).web} onDismiss={dismissUpdate} onAction={onUpdateTap} />
        )}

        {/* "No printer connected" — order saved, but nothing printed (no printer
            set up yet). Primary button = the verified deep-link straight to the
            printer setup screen (right tab pre-selected by the failing path). */}
        {printerModal && (
          <PrinterModal
            /* Land on the CHOICE (Settings with the printer picker open), NOT on a
               pre-committed tab — the seller picks their printer type first. Do
               this regardless of whether a type is already set up. Focus nonce
               scrolls the picker into view. */
            onGoSettings={() => { setPrinterModal(null); setScreen("settings"); setPrinterOpen(true); setPrinterFocus((n) => n + 1); }}
            onDismiss={() => setPrinterModal(null)}
          />
        )}
        {/* Setup guide for the chosen printer type (before the technical screen).
            OK → the setup screen (psType already set at pick time); ✕ → back to
            the choice without proceeding. */}
        {printerGuide && (
          <PrinterGuideModal
            kind={printerGuide}
            onOk={() => { setPrinterGuide(null); setScreen("printersettings"); }}
            onClose={() => setPrinterGuide(null)}
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
