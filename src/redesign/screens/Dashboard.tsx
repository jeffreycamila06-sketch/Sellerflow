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

const headerBar: CSSProperties = { position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "12px 16px 13px" };
const pickerBtn: CSSProperties = { width: "100%", display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.18)", padding: "6px 9px", border: "none", borderRadius: 9, fontSize: 11.5, fontWeight: 600, color: "var(--on-header)", cursor: "pointer", fontFamily: "var(--font-ui)" };
const dropdown = (side: "left" | "right"): CSSProperties => ({ position: "absolute", top: "calc(100% + 7px)", [side]: 0, width: 220, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 13, boxShadow: "0 16px 38px rgba(0,0,0,.3)", padding: 6, zIndex: 30 });
const ddRow = (active: boolean): CSSProperties => ({ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: 8, border: "none", borderRadius: 9, background: active ? "var(--accent-soft)" : "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)" });
const ddName: CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const ddMeta: CSSProperties = { display: "block", fontSize: 10.5, color: "var(--text-muted)" };
const ddCheck: CSSProperties = { color: "var(--accent-fg)", fontWeight: 800, fontSize: 13, width: 12, flexShrink: 0 };
const bolt = <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4.5 13.5H11l-1 8.5 9-12h-6.5L13 2Z" /></svg>;

// Audit #2b — feed WINDOWING: only the newest N comment rows are mounted in the
// DOM (comments arrive newest-first). The full feed (up to 5,000) stays in
// state/refs for order capture + dedup — this caps DOM size (~15 nodes/row) and
// per-comment reconcile cost, the biggest long-live jank source on low-end
// Android WebViews. An honest note shows the real total when rows are hidden.
// Regression: Dashboard.rendercap.test.
export const FEED_RENDER_CAP = 150;
const bolt12 = <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4.5 13.5H11l-1 8.5 9-12h-6.5L13 2Z" /></svg>;
const printerIcon = <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><rect x="6" y="3" width="12" height="6" stroke="currentColor" strokeWidth="1.9" /><rect x="4" y="9" width="16" height="8" rx="2" stroke="currentColor" strokeWidth="1.9" /><rect x="7" y="14" width="10" height="7" stroke="currentColor" strokeWidth="1.9" /></svg>;
const calIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5" width="17" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.7" /><path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;

// Connection-flow visuals per platform (dc.html v3 L2009–2028). Visual only.
const conn = (connected: boolean, connecting: boolean) => ({
  chipBg: connected ? "rgba(74,222,128,.22)" : "rgba(255,255,255,.14)",
  chipShadow: connected ? "inset 0 0 0 1.3px rgba(74,222,128,.6)" : "inset 0 0 0 1px rgba(255,255,255,.22)",
  dotBg: connected ? "#4ade80" : connecting ? "#fbbf24" : "rgba(255,255,255,.45)",
  dotGlow: connected ? "0 0 6px rgba(74,222,128,.9)" : "none",
  dotAnim: connected ? "sflDot 1.1s ease-in-out infinite" : connecting ? "sflDot .7s ease-in-out infinite" : "none",
  bg: connected ? "var(--surface-2)" : "var(--accent)",
  fg: connected ? "var(--danger)" : "var(--accent-text)",
  border: connected ? "1px solid var(--border-strong)" : "none",
});
const connFooterWrap: CSSProperties = { display: "flex", gap: 6, padding: "7px 4px 3px", marginTop: 4, borderTop: "1px solid var(--border)" };
const refreshBtn: CSSProperties = { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "8px 0", border: "1px solid var(--border-strong)", borderRadius: 9, background: "var(--surface-2)", color: "var(--text)", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" };
const refreshIcon = <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M20 11a8 8 0 0 0-14-4.5L4 8m0 0V4m0 4h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M4 13a8 8 0 0 0 14 4.5L20 16m0 0v4m0-4h-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;

const SESSION_OPTS = [1, 2, 3];

export default function Dashboard({
  comments, cur,
  ttOpen, fbOpen, ttIdx, fbIdx, onToggleTT, onToggleFB, onPickTT, onPickFB,
  ttConnected, fbConnected, ttConnecting, fbConnecting, onConnectTT, onConnectFB, onRefreshTT, onRefreshFB, refreshing = false,
  ttAccounts = [], fbAccounts = [],
  sessionDays, sessionOpen, onToggleSession, onPickSession,
  printed, entId, entPrice, onOneClick, onOpenEnt, onEntPrice, onEntKey,
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
  onPickTT: (i: number) => void; onPickFB: (i: number) => void;
  ttConnected: boolean; fbConnected: boolean; ttConnecting: boolean; fbConnecting: boolean;
  onConnectTT: () => void; onConnectFB: () => void;
  onRefreshTT?: () => void; onRefreshFB?: () => void; refreshing?: boolean;
  ttAccounts?: string[]; fbAccounts?: string[];
  sessionDays: number; sessionOpen: boolean; onToggleSession: () => void; onPickSession: (n: number) => void;
  printed: Record<string, string>; entId: string | null; entPrice: string;
  onOneClick: (id: string) => void; onOpenEnt: (id: string) => void;
  onEntPrice: (v: string) => void; onEntKey: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const t = useT();
  const tt = conn(ttConnected, ttConnecting);
  const fb = conn(fbConnected, fbConnecting);
  const connLabel = (connected: boolean, connecting: boolean) => (connecting ? t.rd_dash_connecting : connected ? t.rd_dash_disconnect : t.rd_dash_connect);
  const ttTitle = ttConnected ? t.rd_dash_conn_title : t.rd_dash_not_conn_title;
  const fbTitle = fbConnected ? t.rd_dash_conn_title : t.rd_dash_not_conn_title;
  const dayUnit = (n: number) => `${n} ${n > 1 ? t.rd_dash_days : t.rd_dash_day}`;
  const sessionLabel = dayUnit(sessionDays);
  const summary = sessionSummary(session); // Phase 5c — today's hydrated session
  // Phase 5d — feed scroll (tangled-zone #3). Newest is prepended at the top, so
  // we scroll the feed container to top when a new comment arrives. useLayoutEffect
  // (not setTimeout) so it runs after DOM mutation, before paint.
  const feedRef = useRef<HTMLDivElement>(null);
  const newestId = comments[0]?.id;
  useLayoutEffect(() => {
    feedRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [newestId]);
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
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#e11d48", padding: "4px 9px 4px 7px", borderRadius: 20, animation: "sflLive 1.8s ease-out infinite", flexShrink: 0 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff", animation: "sflDot 1s ease-in-out infinite" }} />
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em", color: "#fff" }}>LIVE</span>
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, letterSpacing: "-.01em", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>SellerFlowLive</div>
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
          {/* Live-session-length pill (dc.html v3 L112) */}
          <div style={{ position: "relative", zIndex: 7 }}>
            <button onClick={onToggleSession} title={t.rd_dash_session_title} style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.18)", border: "none", padding: "6px 10px", borderRadius: 9, fontSize: 12, fontWeight: 700, color: "var(--on-header)", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
              {calIcon}
              {t.rd_dash_session} · {sessionLabel}
              <span style={{ fontSize: 9, opacity: 0.85 }}>▾</span>
            </button>
            {sessionOpen && (
              <div style={{ position: "absolute", top: "calc(100% + 7px)", right: 0, width: 212, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 13, boxShadow: "0 16px 38px rgba(0,0,0,.3)", padding: 6, zIndex: 30 }}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".1em", color: "var(--text-muted)", padding: "7px 9px 6px" }}>{t.rd_dash_session_length}</div>
                {SESSION_OPTS.map((n) => {
                  const active = n === sessionDays;
                  return (
                    <button key={n} onClick={() => onPickSession(n)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 9px", border: "none", borderRadius: 9, background: active ? "var(--accent-soft)" : "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)" }}>
                      <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color: "var(--accent-fg)", flexShrink: 0 }}>{n}</span>
                      <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{dayUnit(n)}</span><span style={{ display: "block", fontSize: 10.5, color: "var(--text-muted)" }}>{n === 1 ? t.rd_dash_ship_same_day : tpl(t.rd_dash_nday_live, { n })}</span></span>
                      <span style={{ color: "var(--accent-fg)", fontWeight: 800, fontSize: 13, width: 12, flexShrink: 0 }}>{active ? "✓" : ""}</span>
                    </button>
                  );
                })}
                <div style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: 1.4, padding: "7px 9px 4px" }}>{t.rd_dash_session_foot}</div>
              </div>
            )}
          </div>
          </div>
        </div>

        {/* Account pickers (TikTok / Facebook) with connect/connecting/connected states */}
        <div style={{ display: "flex", gap: 8, marginTop: 11, position: "relative", zIndex: 6 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <button onClick={onToggleTT} title={ttTitle} style={{ ...pickerBtn, background: tt.chipBg, boxShadow: tt.chipShadow }}>
              <span style={{ width: 16, height: 16, borderRadius: 5, background: "#000", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff", flexShrink: 0 }}>t</span>
              <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ttAccounts.length ? (ttAccounts[ttIdx] || ttAccounts[0]) : t.rd_dash_connect_tiktok}</span>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: tt.dotBg, flexShrink: 0, animation: tt.dotAnim, boxShadow: tt.dotGlow }} />
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
                <div style={connFooterWrap}>
                  <button onClick={onRefreshTT} disabled={refreshing} title={t.rd_dash_refresh} style={{ ...refreshBtn, opacity: refreshing ? 0.6 : 1, cursor: refreshing ? "default" : "pointer" }}>{refreshIcon}{refreshing ? t.rd_dash_refreshing : t.rd_dash_refresh}</button>
                  <button onClick={onConnectTT} disabled={ttConnecting} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "8px 0", border: tt.border, borderRadius: 9, background: tt.bg, color: tt.fg, fontSize: 11.5, fontWeight: 700, cursor: ttConnecting ? "default" : "pointer", opacity: ttConnecting ? 0.7 : 1, fontFamily: "var(--font-ui)" }}>{connLabel(ttConnected, ttConnecting)}</button>
                </div>
              </div>
            )}
          </div>
          <div style={{ position: "relative", flex: 1 }}>
            <button onClick={onToggleFB} title={fbTitle} style={{ ...pickerBtn, background: fb.chipBg, boxShadow: fb.chipShadow }}>
              <span style={{ width: 16, height: 16, borderRadius: 5, background: "#1877f2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: "#fff", flexShrink: 0, fontFamily: "var(--font-display)" }}>f</span>
              <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fbAccounts.length ? (fbAccounts[fbIdx] || fbAccounts[0]) : t.rd_dash_connect_facebook}</span>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: fb.dotBg, flexShrink: 0, animation: fb.dotAnim, boxShadow: fb.dotGlow }} />
              <span style={{ fontSize: 9, opacity: 0.85 }}>▾</span>
            </button>
            {fbOpen && (
              <div style={dropdown("right")}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".1em", color: "var(--text-muted)", padding: "6px 8px 7px" }}>{t.rd_dash_fb_page_group}</div>
                {fbAccounts.length === 0 && <div style={{ padding: "2px 10px 8px", fontSize: 11.5, color: "var(--text-muted)" }}>{t.rd_dash_no_pages}</div>}
                {fbAccounts.map((a, i) => (
                  <button key={a} onClick={() => onPickFB(i)} style={ddRow(i === fbIdx)}>
                    <span style={{ width: 30, height: 30, borderRadius: 8, background: "#1877f2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "#fff", flexShrink: 0, fontFamily: "var(--font-display)" }}>f</span>
                    <span style={{ flex: 1, minWidth: 0 }}><span style={ddName}>{a}</span><span style={ddMeta}>Facebook · {t.rd_dash_tap_go_live}</span></span>
                    <span style={ddCheck}>{i === fbIdx ? "✓" : ""}</span>
                  </button>
                ))}
                <div style={connFooterWrap}>
                  <button onClick={onRefreshFB} disabled={refreshing} title={t.rd_dash_refresh} style={{ ...refreshBtn, opacity: refreshing ? 0.6 : 1, cursor: refreshing ? "default" : "pointer" }}>{refreshIcon}{refreshing ? t.rd_dash_refreshing : t.rd_dash_refresh}</button>
                  <button onClick={onConnectFB} disabled={fbConnecting} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "8px 0", border: fb.border, borderRadius: 9, background: fb.bg, color: fb.fg, fontSize: 11.5, fontWeight: 700, cursor: fbConnecting ? "default" : "pointer", opacity: fbConnecting ? 0.7 : 1, fontFamily: "var(--font-ui)" }}>{connLabel(fbConnected, fbConnecting)}</button>
                </div>
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
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#e11d48", animation: "sflDot 1s infinite", flexShrink: 0 }} />
          </div>
          {/* center: tiny collecting indicator (ON only) — shrinks/ellipsizes; the
              text hides <360px via .sfl-raffle-collect-txt (dot stays). */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "center" }}>
            {raffleErrShown && (
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, fontWeight: 700, color: "var(--danger)" }}>⚠ {t.rd_raffle_save_failed}</span>
            )}
            {!raffleErrShown && raffle.enabled && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0, fontSize: 10, fontWeight: 700, color: "var(--text-muted)" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--ok)", animation: "sflDot 1.4s infinite", flexShrink: 0 }} />
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
            // RESTORED rows (comment persistence) are DISPLAY-ONLY history: muted,
            // NO action row of any kind — duplicate-order layer 3 (layers 1+2 =
            // restored never enters useLiveFeed → onComment unreachable +
            // getComment(restoredId) === undefined). Test-pinned: a restored row
            // renders ZERO <button> elements (Dashboard.restored.test).
            const isRestored = !!c.restored;
            const firstRestored = isRestored && (i === 0 || !visible[i - 1].restored);
            const manP = printed[c.id];
            const isPrinted = !isRestored && !!manP;
            const printedLabel = manP && manP !== "order" ? manP : "";
            const entOpen = !isRestored && entId === c.id;
            const showActions = !isRestored && !isPrinted && !entOpen;
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
              <div className="sfl-comm-row" style={{ display: "flex", gap: 10, padding: "9px 8px", borderRadius: 11, ...(isRestored ? { opacity: 0.62 } : null) }}>
                <div style={{ width: 34, height: 34, borderRadius: "50%", background: avColor(c.name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{initials(c.name)}</div>
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
                      price-entry · 1-Click / Enterprise actions. Restored rows keep
                      ONLY the basket badge (derived from the DB-backed session, which
                      survives refresh) — no buttons, no printed/price UI. */}
                  {(!isRestored || basketN > 0) && (
                  <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6, marginTop: 8, minHeight: isRestored ? 0 : 27 }}>
                    {/* 🛒 badge — beside the Enterprise button (Jeff's requested spot);
                        shown in every row state (printed / price-entry / actions).
                        SIZE lives in .sfl-basket-badge (redesign.css), PLATFORM-scoped:
                        default = slightly larger (Android APK + web/desktop); the iOS
                        shell keeps the compact pill via html.sfl-ios-shell (same proven
                        scoping as the iOS 16px input fix). */}
                    {basketN > 0 && (
                      <span className="sfl-basket-badge" title={t.rd_dash_basket_tip} style={{ display: "inline-flex", alignItems: "center", fontWeight: 800, color: "var(--accent-fg)", background: "var(--accent-soft)", borderRadius: 999, flexShrink: 0 }}>🛒{basketN}</span>
                    )}
                    {isPrinted && (
                      <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 800, letterSpacing: ".02em", color: "var(--text-dim)", background: "var(--surface-3)", padding: "5px 10px", borderRadius: 7 }}>{printerIcon}{t.rd_dash_printed} {printedLabel}</span>
                    )}
                    {entOpen && (
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)" }}>{t.rd_dash_type_price}</span>
                        <span style={{ display: "flex", alignItems: "center", gap: 3, border: "1.3px solid var(--accent)", borderRadius: 7, background: "var(--surface-2)", padding: "0 9px" }}>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>{cur}</span>
                          <input value={entPrice} onChange={(e) => onEntPrice(e.target.value)} onKeyDown={onEntKey} inputMode="numeric" autoFocus style={{ width: 48, border: "none", background: "transparent", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, padding: "5px 0", outline: "none" }} />
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
