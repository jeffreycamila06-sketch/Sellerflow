// Screen 1 — Dashboard / Live (hero). dc.html v3 L101–234.
// v3 header: "SellerFlowLive" title + live-session-length pill (Session · Nd),
// TikTok/Facebook account pickers with connect flow. Each comment row carries
// the 1-Click / Enterprise order flow (printed / Enterprise price-entry), all
// visual-only — real account switching / order creation is Phase 5.
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { avColor, initials, type Comment } from "../data";
import { basketCountFor } from "../adapters/basketCounts";
import { sessionSummary, type SessionState } from "../adapters/useLiveSession";
import { useRaffleConfig } from "../adapters/useRaffleConfig";
import { computeRaffleEntries, type RaffleEntry } from "../adapters/raffle";
import RaffleWheel from "../components/RaffleWheel";
import { AnnouncementBanner, BellIcon } from "../components/Announcements";
import type { Announcement } from "../adapters/useAnnouncements";
import type { RebuiltSession } from "../../lib/orderLogic";
import { useT, tpl } from "../i18n";
import { TELEGRAM_URL } from "../../lib/telegram";

const headerBar: CSSProperties = { position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "12px 16px 13px" };
const pickerBtn: CSSProperties = { width: "100%", display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.18)", padding: "6px 9px", border: "none", borderRadius: 9, fontSize: 11.5, fontWeight: 600, color: "var(--on-header)", cursor: "pointer", fontFamily: "var(--font-ui)" };
const dropdown = (side: "left" | "right"): CSSProperties => ({ position: "absolute", top: "calc(100% + 7px)", [side]: 0, width: 220, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 13, boxShadow: "0 16px 38px rgba(0,0,0,.3)", padding: 6, zIndex: 30 });
const ddRow = (active: boolean): CSSProperties => ({ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: 8, border: "none", borderRadius: 9, background: active ? "var(--accent-soft)" : "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)" });
const ddName: CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const ddMeta: CSSProperties = { display: "block", fontSize: 10.5, color: "var(--text-muted)" };
const ddCheck: CSSProperties = { color: "var(--accent-fg)", fontWeight: 800, fontSize: 13, width: 12, flexShrink: 0 };
const bolt = <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4.5 13.5H11l-1 8.5 9-12h-6.5L13 2Z" /></svg>;

// Commenter profile picture (FLive/Chotdon parity) — DISPLAY-ONLY. The colored
// initials circle is ALWAYS rendered as the base layer; when the relay payload
// carries an avatar URL (TikTok CDN 100x100 webp, signed/expiring), the <img>
// overlays it once loaded. ZERO layout shift/flicker by construction: the
// wrapper is a fixed 34px in every state (loading shows initials, error hides
// the img → initials again). URLs are never stored anywhere (expiring, display
// only); referrerPolicy avoids CDN hotlink referer quirks; lazy keeps a fast
// feed cheap. Module-level component — a stable identity so Dashboard renders
// never remount rows (a remount would refetch every visible avatar).
function CommentAvatar({ name, avatar }: { name: string; avatar?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div style={{ position: "relative", width: 34, height: 34, borderRadius: "50%", background: avColor(name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: "#fff", flexShrink: 0 }}>
      {initials(name)}
      {!!avatar && !failed && (
        <img
          src={avatar}
          alt=""
          width={34}
          height={34}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          style={{ position: "absolute", top: 0, left: 0, width: 34, height: 34, borderRadius: "50%", objectFit: "cover" }}
        />
      )}
    </div>
  );
}

// Audit #2b — feed WINDOWING: only the newest N comment rows are mounted in the
// DOM (comments arrive newest-first). The full feed (up to 5,000) stays in
// state/refs for order capture + dedup — this caps DOM size (~15 nodes/row) and
// per-comment reconcile cost, the biggest long-live jank source on low-end
// Android WebViews. An honest note shows the real total when rows are hidden.
// Regression: Dashboard.rendercap.test.
export const FEED_RENDER_CAP = 150;
const bolt12 = <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4.5 13.5H11l-1 8.5 9-12h-6.5L13 2Z" /></svg>;
const printerIcon = <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><rect x="6" y="3" width="12" height="6" stroke="currentColor" strokeWidth="1.9" /><rect x="4" y="9" width="16" height="8" rx="2" stroke="currentColor" strokeWidth="1.9" /><rect x="7" y="14" width="10" height="7" stroke="currentColor" strokeWidth="1.9" /></svg>;

// Connection-flow visuals per platform (dc.html v3 L2009–2028). Visual only.
const conn = (connected: boolean, connecting: boolean) => ({
  chipBg: connected ? "rgba(74,222,128,.22)" : "rgba(255,255,255,.14)",
  chipShadow: connected ? "inset 0 0 0 1.3px rgba(74,222,128,.6)" : "inset 0 0 0 1px rgba(255,255,255,.22)",
  dotBg: connected ? "#4ade80" : connecting ? "#fbbf24" : "rgba(255,255,255,.45)",
  dotGlow: connected ? "0 0 6px rgba(74,222,128,.9)" : "none",
  dotCls: connected || connecting ? "sfl-anim-dot" : "", // class so the kill switch / reduced-motion can disable it (inline animation can't be)
  bg: connected ? "var(--surface-2)" : "var(--accent)",
  fg: connected ? "var(--danger)" : "var(--accent-text)",
  border: connected ? "1px solid var(--border-strong)" : "none",
});
const connFooterWrap: CSSProperties = { display: "flex", gap: 6, padding: "7px 4px 3px", marginTop: 4, borderTop: "1px solid var(--border)" };
const refreshBtn: CSSProperties = { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "8px 0", border: "1px solid var(--border-strong)", borderRadius: 9, background: "var(--surface-2)", color: "var(--text)", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" };
const refreshIcon = <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M20 11a8 8 0 0 0-14-4.5L4 8m0 0V4m0 4h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M4 13a8 8 0 0 0 14 4.5L20 16m0 0v4m0-4h-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;


export default function Dashboard({
  comments, cur,
  ttOpen, fbOpen, ttIdx, fbIdx, onToggleTT, onToggleFB, onPickTT,
  onManageTT,
  ttConnected, fbConnected, ttConnecting, fbConnecting, onConnectTT, onRefreshTT, refreshing = false,
  ttAccounts = [], fbAccounts = [],
  printed, entId, entPrice, onOneClick, onOpenEnt, onEntPrice, onEntKey,
  onEntSubmit,
  viewers = null,
  sessionEndsAt = null, sessionEnded = false,
  historyReady = false,
  onReprint,
  session = { buyers: [], orders: [] }, sessionState = "idle",
  canInject = false, onInjectSynthetic,
  announcement = null, annDismissedId = "", onDismissAnn, annUnread = false, onOpenAnn,
  onPrintWinner,
  basketCounts,
}: {
  comments: Comment[]; cur: string;
  // 🛒 per-buyer order count for the current session window (key: "handle platform").
  // Display-only lookup map built upstream (RedesignApp memo) — O(1) per row.
  basketCounts?: Map<string, number>;
  session?: RebuiltSession; sessionState?: SessionState;
  canInject?: boolean; onInjectSynthetic?: () => void;
  announcement?: Announcement | null; annDismissedId?: string; onDismissAnn?: (id: string) => void;
  annUnread?: boolean; onOpenAnn?: () => void;
  onPrintWinner?: (w: RaffleEntry) => { ok: boolean; via: string };
  ttOpen: boolean; fbOpen: boolean; ttIdx: number; fbIdx: number;
  onToggleTT: () => void; onToggleFB: () => void;
  onPickTT: (i: number) => void;
  // TikTok "Manage / add accounts" row → navigates to the manage screen with a
  // back target of the Live dashboard (Change 1, 2026-07-23). Optional so the
  // screen still renders in isolation/tests.
  onManageTT?: () => void;
  // FB dropdown is an HONEST GATE now (Change 2): no onConnectFB / onRefreshFB /
  // onPickFB — Facebook multi-account is non-functional, so its connect/refresh/
  // pick handlers are intentionally NOT wired into this dropdown.
  ttConnected: boolean; fbConnected: boolean; ttConnecting: boolean; fbConnecting: boolean;
  onConnectTT: () => void;
  onRefreshTT?: () => void; refreshing?: boolean;
  ttAccounts?: string[]; fbAccounts?: string[];
  printed: Record<string, string>; entId: string | null; entPrice: string;
  // Orderable earlier-comments (sql/18) — the E1 gate: history rows may show
  // order buttons ONLY after the session-window load resolved (before that, an
  // already-ordered comment would look orderable — the duplicate window).
  historyReady?: boolean;
  onOneClick: (id: string) => void; onOpenEnt: (id: string) => void;
  onEntPrice: (v: string) => void; onEntKey: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  // iPhone fix (2026-07-13) — the in-app ✓ submit for the Enterprise price:
  // the iOS number pad has NO return key, so Enter can never fire there. Same
  // code path as Enter (RedesignApp submitEnt).
  onEntSubmit?: () => void;
  // Live viewer count (FLive parity) — 👥 N next to the "Live comments" label.
  // null = hidden entirely (no data / not green — RedesignApp gates on the
  // same booleans as ttConnected); a real 0 renders as "👥 0".
  viewers?: number | null;
  // Sub-step 5 — session-end indicator (old pill slot, top-right). sessionEndsAt =
  // server-Taipei end label ("Aug 22, 11:59 PM") or null (no session → nothing);
  // sessionEnded = server says the window passed while still live → "continues …".
  sessionEndsAt?: string | null; sessionEnded?: boolean;
  // REPRINT — print a COPY of this comment's existing order (no new order, no
  // writes; RedesignApp resolves the original order + calls printSlip).
  onReprint?: (id: string, msgId?: string) => void;
}) {
  const t = useT();
  const tt = conn(ttConnected, ttConnecting);
  const fb = conn(fbConnected, fbConnecting);
  const connLabel = (connected: boolean, connecting: boolean) => (connecting ? t.rd_dash_connecting : connected ? t.rd_dash_disconnect : t.rd_dash_connect);
  const ttTitle = ttConnected ? t.rd_dash_conn_title : t.rd_dash_not_conn_title;
  const fbTitle = fbConnected ? t.rd_dash_conn_title : t.rd_dash_not_conn_title;
  const summary = sessionSummary(session); // Phase 5c — today's hydrated session
  // Dropdown dismiss (Jeff bug, 2026-07-12): the header dropdowns (TikTok/FB
  // account pickers + session pill) only closed via their own toggles — a tap
  // anywhere else left the panel hanging (sellers reached for Disconnect just
  // to dismiss it). Standard click-outside-to-close: a document-level
  // pointerdown OUTSIDE the open dropdown's wrapper (chip + panel) closes it
  // with NO action; taps INSIDE (account rows, Refresh, Connect/Disconnect)
  // are untouched. Escape closes too. A listener (not an overlay) because the
  // sticky header's backdrop-filter creates a containing block/stacking
  // context that would trap a fixed overlay. Closing calls the OPEN one's
  // toggle — the toggles are mutually exclusive upstream (RedesignApp), so at
  // most one is open. Listener attaches only while one is open.
  const ttWrapRef = useRef<HTMLDivElement>(null);
  const fbWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ttOpen && !fbOpen) return;
    const close = () => {
      if (ttOpen) onToggleTT();
      else if (fbOpen) onToggleFB();
    };
    const onDown = (e: Event) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (ttWrapRef.current?.contains(target) || fbWrapRef.current?.contains(target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [ttOpen, fbOpen, onToggleTT, onToggleFB]);
  // Phase 5d — feed scroll (tangled-zone #3). Newest is prepended at the top, so
  // we scroll the feed container to top when a new comment arrives. useLayoutEffect
  // (not setTimeout) so it runs after DOM mutation, before paint.
  const feedRef = useRef<HTMLDivElement>(null);
  const newestId = comments[0]?.id;
  useLayoutEffect(() => {
    feedRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [newestId]);
  // REPRINT — per-row double-tap guard: after a tap the button shows
  // "Printing…" and ignores taps for ~2s (a reprint has ZERO writes, so the
  // worst a slip-through could cause is a duplicate piece of paper — the
  // cooldown is purely UX). Timer cleared on unmount.
  const [reprintingId, setReprintingId] = useState<string | null>(null);
  const reprintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (reprintTimerRef.current) clearTimeout(reprintTimerRef.current); }, []);
  const fireReprint = (c: Comment) => {
    if (!onReprint || reprintingId) return;
    setReprintingId(c.id);
    onReprint(c.id, c.msgId);
    reprintTimerRef.current = setTimeout(() => setReprintingId(null), 2000);
  };
  // Green (--ok, theme-aware) outline button — mirrors the Enterprise button
  // geometry; ONE clean button replaces the old "Ordered ✓" / "🖨 Printed"
  // chips (Jeff: FLive style, no chip beside it).
  const reprintBtn = (c: Comment) => {
    const busy = reprintingId === c.id;
    return (
      <button onClick={() => fireReprint(c)} disabled={busy} title={t.rd_dash_reprint_title} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 800, letterSpacing: ".02em", color: "var(--ok)", background: "transparent", border: "1.3px solid var(--ok)", padding: "5px 12px", borderRadius: 7, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1, fontFamily: "var(--font-ui)" }}>
        {printerIcon}{busy ? t.rd_dash_reprinting : t.rd_dash_reprint}
      </button>
    );
  };
  // Raffle Roleta Phase 1 — DB-backed Games on/off + enabled_at anchor (1 read on
  // mount, 1 write per toggle; entries/wheel = Phase 2). Self-contained adapter.
  const raffle = useRaffleConfig();
  const raffleSince = raffle.enabledAt
    ? new Date(raffle.enabledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";
  // Phase 2 — entries are COMPUTED from the already-loaded session orders
  // (orderNum = epoch ms ≥ enabled_at; group by buyer; cap 3). Zero new queries.
  // Winner/excluded live HERE (not in the overlay) so closing/reopening the
  // raffle screen never loses the result.
  const [raffleOpen, setRaffleOpen] = useState(false);
  const [raffleWinner, setRaffleWinner] = useState<RaffleEntry | null>(null);
  const [raffleExcluded, setRaffleExcluded] = useState<string[]>([]);
  const enabledAtMs = raffle.enabledAt ? Date.parse(raffle.enabledAt) : NaN;
  const raffleEntries = raffle.enabled && Number.isFinite(enabledAtMs)
    ? computeRaffleEntries(session.orders, enabledAtMs)
    : [];
  // Batch D (#10): transient notice when a raffle-toggle DB write failed (the
  // hook reverts the pill; this explains WHY it flipped back). Shown in the
  // center header slot for ~3s, same footprint as the collecting indicator.
  const [raffleErrShown, setRaffleErrShown] = useState(false);
  const prevToggleErrs = useRef(0);
  useEffect(() => {
    if (raffle.toggleErrors <= prevToggleErrs.current) return;
    prevToggleErrs.current = raffle.toggleErrors;
    setRaffleErrShown(true);
    const id = setTimeout(() => setRaffleErrShown(false), 3200);
    return () => clearTimeout(id);
  }, [raffle.toggleErrors]);
  return (
    <div style={{ minHeight: "100%", display: "flex", flexDirection: "column" }}>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
            <div className="sfl-anim-live" style={{ display: "flex", alignItems: "center", gap: 6, background: "#e11d48", padding: "4px 9px 4px 7px", borderRadius: 20, flexShrink: 0 }}>
              <span className="sfl-anim-dot" style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff" }} />
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em", color: "#fff" }}>LIVE</span>
            </div>
            <div className="sfl-anim-beat" style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, letterSpacing: "-.01em", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>SellerFlowLive</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {/* 🔔 Announcements bell — same rgba pill styling as the header controls;
              red dot = newest announcement not yet seen (sfl_rd_ann_last_seen). */}
          {onOpenAnn && (
            <button onClick={onOpenAnn} title={t.rd_ann_title} style={{ position: "relative", width: 36, height: 31, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,.18)", border: "none", borderRadius: 9, color: "var(--on-header)", cursor: "pointer", flexShrink: 0 }}>
              <BellIcon />
              {annUnread && <span style={{ position: "absolute", top: 5, right: 7, width: 7, height: 7, borderRadius: "50%", background: "#f87171", boxShadow: "0 0 0 1.5px rgba(0,0,0,.28)" }} />}
            </button>
          )}
          {/* Session-end indicator (sub-step 5) — replaces the removed pill, same
              top-right slot. STATIC "Session ends {date}" (server-Taipei) while
              running; "Session continues …" (animated dots) once past the end while
              still live. Nothing when there is no session. */}
          {sessionEndsAt && (
            sessionEnded ? (
              <span data-testid="session-continues" style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "rgba(255,255,255,.18)", padding: "6px 10px", borderRadius: 9, fontSize: 12, fontWeight: 700, color: "var(--on-header)", whiteSpace: "nowrap", flexShrink: 0 }}>
                {t.rd_ses_continues}
                <span className="sfl-anim-ellip" aria-hidden="true" style={{ display: "inline-flex", gap: 2, marginLeft: 1 }}><i>.</i><i>.</i><i>.</i></span>
              </span>
            ) : (
              <span data-testid="session-ends" style={{ background: "rgba(255,255,255,.18)", padding: "6px 10px", borderRadius: 9, fontSize: 12, fontWeight: 700, color: "var(--on-header)", whiteSpace: "nowrap", flexShrink: 0 }}>
                {tpl(t.rd_ses_ends, { date: sessionEndsAt })}
              </span>
            )
          )}
          </div>
        </div>

        {/* Account pickers (TikTok / Facebook) with connect/connecting/connected states */}
        <div style={{ display: "flex", gap: 8, marginTop: 11, position: "relative", zIndex: 6 }}>
          <div ref={ttWrapRef} style={{ position: "relative", flex: 1 }}>
            <button onClick={onToggleTT} title={ttTitle} style={{ ...pickerBtn, background: tt.chipBg, boxShadow: tt.chipShadow }}>
              <span className="sfl-anim-heart" style={{ width: 16, height: 16, borderRadius: 5, background: "#000", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff", flexShrink: 0 }}>t</span>
              <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ttAccounts.length ? (ttAccounts[ttIdx] || ttAccounts[0]) : t.rd_dash_connect_tiktok}</span>
              <span className={tt.dotCls} style={{ width: 7, height: 7, borderRadius: "50%", background: tt.dotBg, flexShrink: 0, boxShadow: tt.dotGlow }} />
              <span style={{ fontSize: 9, opacity: 0.85 }}>▾</span>
            </button>
            {ttOpen && (
              <div style={dropdown("left")}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".1em", color: "var(--text-muted)", padding: "6px 8px 7px" }}>{t.rd_dash_tiktok_account}</div>
                {ttAccounts.length === 0 && <div style={{ padding: "2px 10px 8px", fontSize: 11.5, color: "var(--text-muted)" }}>{t.rd_dash_no_accounts}</div>}
                {ttAccounts.map((a, i) => (
                  <button key={a} onClick={() => onPickTT(i)} style={ddRow(i === ttIdx)}>
                    <span style={{ width: 30, height: 30, borderRadius: 8, background: "#000", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{initials(a)}</span>
                    <span style={{ flex: 1, minWidth: 0 }}><span style={ddName}>{a}</span><span style={ddMeta}>TikTok · {t.rd_dash_tap_go_live}</span></span>
                    <span style={ddCheck}>{i === ttIdx ? "✓" : ""}</span>
                  </button>
                ))}
                {/* Manage / add accounts — action row (NOT an account), separated by a
                    top hairline. Navigates to the manage screen (back → Live). Always
                    shown; the manage screen self-gates by plan + funnels over-cap to
                    Telegram. onClick navigation unmounts this dropdown cleanly. */}
                <button onClick={onManageTT} style={{ ...ddRow(false), marginTop: 4, borderTop: "1px solid var(--border)", borderRadius: 0 }}>
                  <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--accent-soft)", color: "var(--accent-fg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 700, flexShrink: 0 }}>+</span>
                  <span style={{ flex: 1, minWidth: 0 }}><span style={{ ...ddName, color: "var(--accent-fg)" }}>{t.rd_dash_manage_accounts}</span></span>
                </button>
                <div style={connFooterWrap}>
                  <button onClick={onRefreshTT} disabled={refreshing} title={t.rd_dash_refresh} style={{ ...refreshBtn, opacity: refreshing ? 0.6 : 1, cursor: refreshing ? "default" : "pointer" }}>{refreshIcon}{refreshing ? t.rd_dash_refreshing : t.rd_dash_refresh}</button>
                  <button onClick={onConnectTT} disabled={ttConnecting} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "8px 0", border: tt.border, borderRadius: 9, background: tt.bg, color: tt.fg, fontSize: 11.5, fontWeight: 700, cursor: ttConnecting ? "default" : "pointer", opacity: ttConnecting ? 0.7 : 1, fontFamily: "var(--font-ui)" }}>{connLabel(ttConnected, ttConnecting)}</button>
                </div>
              </div>
            )}
          </div>
          <div ref={fbWrapRef} style={{ position: "relative", flex: 1 }}>
            <button onClick={onToggleFB} title={fbTitle} style={{ ...pickerBtn, background: fb.chipBg, boxShadow: fb.chipShadow }}>
              <span className="sfl-anim-heart" style={{ width: 16, height: 16, borderRadius: 5, background: "#1877f2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: "#fff", flexShrink: 0, fontFamily: "var(--font-display)" }}>f</span>
              <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fbAccounts.length ? (fbAccounts[fbIdx] || fbAccounts[0]) : t.rd_dash_connect_facebook}</span>
              <span className={fb.dotCls} style={{ width: 7, height: 7, borderRadius: "50%", background: fb.dotBg, flexShrink: 0, boxShadow: fb.dotGlow }} />
              <span style={{ fontSize: 9, opacity: 0.85 }}>▾</span>
            </button>
            {fbOpen && (
              <div style={dropdown("right")}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".1em", color: "var(--text-muted)", padding: "6px 8px 7px" }}>{t.rd_dash_fb_page_group}</div>
                {/* HONEST GATE (Change 2, 2026-07-23): Facebook multi-account is
                    non-functional (blocked on Meta Business Verification). NO
                    green-able Connect here — an "activation required" notice + a
                    real Telegram anchor. iOS-safe: a real <a> (never window.open),
                    and onClick closes the dropdown as the tab opens. */}
                <div style={{ padding: "2px 10px 11px", fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.5 }}>{t.rd_dash_fb_activation}</div>
                <a href={TELEGRAM_URL} target="_blank" rel="noreferrer noopener" onClick={onToggleFB} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 0", margin: "0 4px 3px", background: "#0088cc", color: "#fff", borderRadius: 9, fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>{t.rd_dash_fb_contact}<span style={{ fontSize: 14 }}>→</span></a>
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ padding: "14px 14px 18px", flex: 1, display: "flex", flexDirection: "column" }}>
        {/* Admin announcement banner — newest ACTIVE, hidden once dismissed on
            this device (localStorage id match). In-flow above the TODAY bar. */}
        {announcement && announcement.id !== annDismissedId && onDismissAnn && (
          <AnnouncementBanner ann={announcement} onDismiss={onDismissAnn} />
        )}
        {/* Phase 5c — today's cross-device session summary (read-only). Shows
            when a session exists for today; stays hidden when empty. */}
        {sessionState === "loading" && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "0 2px 9px" }}>{t.rd_dash_loading_session}</div>
        )}
        {summary.orders > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 13, padding: "10px 13px", marginBottom: 11, boxShadow: "var(--shadow)" }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".04em", color: "var(--accent-fg)", background: "var(--accent-soft)", padding: "4px 9px", borderRadius: 7 }}>{t.rd_dash_today_badge}</span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)" }}>{summary.buyers} {t.rd_dash_buyers} · {summary.orders} {t.rd_cus_orders_suffix}</span>
            <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{cur}{summary.total.toLocaleString("en-US")}</span>
          </div>
        )}
        {/* COMPACT one-line header: [Live comments ●] … [● Collecting · n] … [🎮][pill]
            — the full-width collecting chip is gone (no extra row). The 🎮 boxed
            button OPENS the roleta (even when OFF → empty state); the pill alone
            toggles. When OFF the 🎮 button carries the "Games" label; when ON the
            label hides so the center indicator gets the space. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9, padding: "0 2px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14.5, color: "var(--text)", whiteSpace: "nowrap" }}>{t.rd_dash_live_comments}</span>
            <span className="sfl-anim-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "#e11d48", flexShrink: 0 }} />
            {viewers != null && (
              <span title={t.rd_dash_viewers_aria} aria-label={t.rd_dash_viewers_aria}
                style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                👥 {viewers.toLocaleString()}
              </span>
            )}
          </div>
          {/* center: tiny collecting indicator (ON only) — shrinks/ellipsizes; the
              text hides <360px via .sfl-raffle-collect-txt (dot stays). */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "center" }}>
            {raffleErrShown && (
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, fontWeight: 700, color: "var(--danger)" }}>⚠ {t.rd_raffle_save_failed}</span>
            )}
            {!raffleErrShown && raffle.enabled && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0, fontSize: 10, fontWeight: 700, color: "var(--text-muted)" }}>
                <span className="sfl-anim-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--ok)", flexShrink: 0 }} />
                <span className="sfl-raffle-collect-txt" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.rd_raffle_collecting} · {raffleEntries.reduce((s, e) => s + e.entries, 0)}
                </span>
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            {/* Preview-only synthetic comment injector (F2) — hidden on the real
                production domain (isPreviewEnv). */}
            {canInject && (
              <button onClick={(e) => { e.stopPropagation(); onInjectSynthetic?.(); }} title={t.rd_dash_inject_title} style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".02em", color: "var(--accent-fg)", background: "var(--accent-soft)", border: "1px dashed var(--accent)", padding: "4px 9px", borderRadius: 7, cursor: "pointer", fontFamily: "var(--font-ui)", flexShrink: 0 }}>{t.rd_dash_test_comment}</button>
            )}
            {/* 🎮 = OPEN the roleta (boxed button; works even when the toggle is OFF).
                Carries the "Games" label only while OFF. */}
            <button onClick={(e) => { e.stopPropagation(); setRaffleOpen(true); }} title={t.rd_raffle_title} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 9px", minHeight: 28, background: "var(--accent-softer)", border: "1px solid var(--accent-soft)", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)", flexShrink: 0 }}>
              <span style={{ fontSize: 15, lineHeight: 1 }}>🎮</span>
              {!raffle.enabled && <span style={{ fontSize: 11, fontWeight: 800, color: "var(--accent-fg)" }}>{t.rd_raffle_games}</span>}
            </button>
            {/* toggle pill — ON/OFF ONLY, clearly separated from the 🎮 open button */}
            <button onClick={(e) => { e.stopPropagation(); void raffle.toggle(!raffle.enabled); }} role="switch" aria-checked={raffle.enabled} title={t.rd_raffle_games} disabled={raffle.loading} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, opacity: raffle.loading ? 0.6 : 1, flexShrink: 0, display: "block" }}>
              <span style={{ width: 40, height: 23, borderRadius: 12, background: raffle.enabled ? "var(--accent)" : "var(--border-strong)", position: "relative", display: "block", transition: "background .15s" }}>
                <span style={{ position: "absolute", top: 3, left: raffle.enabled ? 20 : 3, width: 17, height: 17, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.3)", transition: "left .15s" }} />
              </span>
            </button>
          </div>
        </div>

        {/* Full-screen roleta overlay — opens regardless of the toggle (OFF → empty state) */}
        {raffleOpen && (
          <RaffleWheel
            entries={raffleEntries}
            sinceLabel={raffleSince ? tpl(t.rd_raffle_since, { time: raffleSince }) : ""}
            winner={raffleWinner}
            excluded={raffleExcluded}
            onWinner={setRaffleWinner}
            onExclude={(key) => { setRaffleExcluded((x) => [...x, key]); setRaffleWinner(null); }}
            onReset={() => { setRaffleWinner(null); setRaffleExcluded([]); }}
            onClose={() => setRaffleOpen(false)}
            onPrintWinner={onPrintWinner}
          />
        )}

        <div ref={feedRef} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 7, boxShadow: "var(--shadow)", flex: 1, minHeight: 0, overflowY: "auto" }}>
          {comments.length === 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, height: "100%", minHeight: 160, color: "var(--text-muted)", textAlign: "center", padding: "0 24px" }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{t.rd_dash_waiting}</span>
              <span style={{ fontSize: 11.5 }}>{t.rd_dash_connect_start}{canInject ? t.rd_dash_preview_hint : ""}</span>
            </div>
          )}
          {comments.slice(0, FEED_RENDER_CAP).map((c, i, visible) => {
            // Auto-detect is Soon-badged (not wired) — capture is ALWAYS manual, so
            // every LIVE comment keeps its 1-Click / Enterprise buttons until it is
            // ordered. "printed" is only ever set by a real manual order → no comment
            // is ever silently marked done / left uncapturable.
            // RESTORED rows (initial-comments feature) = history from TikTok's
            // pre-connect buffer — ORDERABLE since sql/18 (Jeff's use case: a
            // "mine" that landed while he was away must be orderable on return).
            // Duplicate protection moved to the DB-backed ordered-check:
            //   • orderedPrior (an order for this exact msgId exists in the
            //     loaded window) → "Ordered ✓" chip, NO buttons;
            //   • historyReady=false (window load not yet resolved — E1 gate)
            //     → display-only (muted, no buttons) until the check is possible;
            //   • otherwise → live action row (1-Click / Enterprise).
            // Auto Mode still NEVER runs on history (structural — the initial
            // branch precedes the seam in useLiveFeed). Test-pinned:
            // Dashboard.restored.test.
            const isRestored = !!c.restored;
            const firstRestored = isRestored && (i === 0 || !visible[i - 1].restored);
            const orderedPrior = isRestored && !!c.ordered;
            const rowActionable = !isRestored || (historyReady && !orderedPrior);
            const manP = printed[c.id];
            const isPrinted = rowActionable && !!manP;
            const entOpen = rowActionable && entId === c.id;
            const showActions = rowActionable && !isPrinted && !entOpen;
            // 🛒 basket count — this buyer's CREATED ORDERS in the current session
            // window (O(1) map lookup). 0 → no badge (keeps a busy feed clean).
            const basketN = basketCounts ? basketCountFor(basketCounts, c.handle, c.platform) : 0;
            return (
              <Fragment key={c.id}>
              {firstRestored && (
                <div style={{ textAlign: "center", padding: "8px 6px 2px", fontSize: 10.5, fontWeight: 700, letterSpacing: ".04em", color: "var(--text-muted)" }}>
                  {t.rd_dash_restored_note}
                </div>
              )}
              <div className="sfl-comm-row" style={{ display: "flex", gap: 10, padding: "9px 8px", borderRadius: 11, ...(isRestored && !rowActionable && !orderedPrior ? { opacity: 0.62 } : null) }}>
                <CommentAvatar name={c.name} avatar={c.avatar} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{c.name}</span>
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--handle)" }}>{c.handle}</span>
                    <span style={{ fontSize: 10.5, color: "var(--text-muted)", marginLeft: "auto", flexShrink: 0 }}>{c.time}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 2 }}>
                    <span style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.3 }}>{c.text}</span>
                    {c.mine && (
                      <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".05em", color: "var(--accent-text)", background: "var(--accent)", padding: "2px 6px", borderRadius: 5, flexShrink: 0 }}>MINE</span>
                    )}
                  </div>
                  {/* Order flow (dc.html v3 L210–227): printed badge · Enterprise
                      price-entry · 1-Click / Enterprise actions. History rows show
                      the full action row when actionable, the "Ordered ✓" chip when
                      an order already exists, or just the basket badge while the
                      ordered-check is not yet possible (E1 gate). */}
                  {(rowActionable || orderedPrior || basketN > 0) && (
                  <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6, marginTop: 8, minHeight: rowActionable ? 27 : 0 }}>
                    {/* 🛒 badge — beside the Enterprise button (Jeff's requested spot);
                        shown in every row state (printed / price-entry / actions).
                        SIZE lives in .sfl-basket-badge (redesign.css), PLATFORM-scoped:
                        default = slightly larger (Android APK + web/desktop); the iOS
                        shell keeps the compact pill via html.sfl-ios-shell (same proven
                        scoping as the iOS 16px input fix). */}
                    {basketN > 0 && (
                      <span className="sfl-basket-badge" title={t.rd_dash_basket_tip} style={{ display: "inline-flex", alignItems: "center", fontWeight: 800, color: "var(--accent-fg)", background: "var(--accent-soft)", borderRadius: 999, flexShrink: 0 }}>🛒{basketN}</span>
                    )}
                    {/* REPRINT — the ONE button for every already-ordered row
                        (FLive style, Jeff 2026-07-12): replaces both the
                        "Ordered ✓" chip (restored rows whose msgId matched a
                        loaded order) and the "🖨 Printed" chip (rows ordered
                        this session). Tap = printSlip copy of the ORIGINAL
                        order — no new order, no writes. */}
                    {(orderedPrior || isPrinted) && reprintBtn(c)}
                    {entOpen && (
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)" }}>{t.rd_dash_type_price}</span>
                        <span style={{ display: "flex", alignItems: "center", gap: 3, border: "1.3px solid var(--accent)", borderRadius: 7, background: "var(--surface-2)", padding: "0 0 0 9px" }}>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>{cur}</span>
                          {/* NO onBlur — deliberate and test-pinned: blur (keyboard
                              dismiss / row unmount in a fast feed) must never print
                              NOR clear the typed price (ghost-print protection). */}
                          <input value={entPrice} onChange={(e) => onEntPrice(e.target.value)} onKeyDown={onEntKey} inputMode="numeric" autoFocus style={{ width: 48, border: "none", background: "transparent", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, padding: "5px 0", outline: "none" }} />
                          {/* iPhone fix — in-app ✓ submit, ALWAYS visible while the
                              price flow is open (the iOS number pad has no return
                              key). onPointerDown + preventDefault: fires BEFORE any
                              blur, so the tap can never lose a race to focus loss;
                              no onClick (single fire per tap). ≥38px thumb hitbox. */}
                          <button
                            onPointerDown={(e) => { e.preventDefault(); onEntSubmit?.(); }}
                            title={t.rd_dash_ent_go}
                            aria-label={t.rd_dash_ent_go}
                            style={{ minWidth: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", border: "none", borderRadius: "0 6px 6px 0", background: "var(--accent)", color: "var(--accent-text)", fontSize: 16, fontWeight: 900, cursor: "pointer", fontFamily: "var(--font-ui)", flexShrink: 0 }}
                          >✓</button>
                        </span>
                      </span>
                    )}
                    {showActions && (
                      <>
                        <button onClick={() => onOpenEnt(c.id)} title={t.rd_dash_ent_title} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 800, letterSpacing: ".02em", color: "var(--accent-fg)", background: "transparent", border: "1.3px solid var(--accent)", padding: "5px 11px", borderRadius: 7, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{bolt}{t.rd_dash_enterprise}</button>
                        <button onClick={() => onOneClick(c.id)} title={t.rd_dash_1click_title} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 800, letterSpacing: ".02em", color: "var(--accent-text)", background: "var(--accent)", border: "none", padding: "5px 12px", borderRadius: 7, cursor: "pointer", fontFamily: "var(--font-ui)", boxShadow: "0 2px 8px var(--accent-soft)" }}>{bolt12}{t.rd_dash_1click}</button>
                      </>
                    )}
                  </div>
                  )}
                </div>
              </div>
              </Fragment>
            );
          })}
          {comments.length > FEED_RENDER_CAP && (
            <div style={{ textAlign: "center", padding: "10px 8px", fontSize: 11, color: "var(--text-muted)" }}>
              {tpl(t.rd_dash_feed_hidden, { shown: FEED_RENDER_CAP, total: comments.length })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
