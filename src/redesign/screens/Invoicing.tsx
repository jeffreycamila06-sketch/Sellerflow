// Settings → INVOICING, step 2a (Jeff, 2026-11-26). Tabs TikTok · Facebook · Instagram · Shopee.
// TikTok works: a session's buyers, one row each (all days of a multi-day session together — the rows
// come from the Orders buyer card's own code, adapters/invoicing.ts), a "Send next" button that copies
// that buyer's message (the Send to TikTok text) and opens the buyer in TikTok the way Send to TikTok
// does, and the saved status of every invoice. Instagram / Shopee say "Soon". Facebook: a seller WITH the
// Receipt add-on (onReceiptFormat) gets today's "Soon" card + Receipt format; without it, a locked card
// with "Ask Admin to turn it on" (Telegram, a ready message) — every plan, every build, no price.
// SESSION PICKER: "This session" or a past one — the SAME list and the SAME loader the Orders tab uses
// (adapters/pastSessions.ts usePastSessions; its own state here, so picking changes nothing in Orders or
// in the live session). The saved status is per session. A past session is shown in amber and its row
// sheet asks no "old session" question (the seller picked that session on purpose).
// COPY FAILED = NOT SENT: a buyer whose message could not be copied is never marked Sent; the big button
// stays on that buyer ("Copy again") until a copy works.
// BUYER CANCELLED: the buyer is left out of Send next and of "X of N sent" (listed under All, dimmed,
// total struck through); right after, "Add <buyer> to Blacklist?" when the seller has Blacklist (the
// Blacklist screen's own add, reason "Not checked out"). Undo cancel → Sent again if they were Sent before
// the cancel (with that send time), else Not sent.
// CANCEL ONE ITEM: the × of a line in the row sheet saves that ORDER (by its database id) as cancelled for
// the invoice; the order itself is never changed.
// Opening TikTok is always a real link the seller taps (the only open that works inside the iPhone app).
// Nothing here changes an order, a buyer number, stock or Sales.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { headerBar, headerTitle, mono } from "../ui";
import { HeaderWithBack } from "../components/BackButton";
import { tpl, useT } from "../i18n";
import { fmt } from "../data";
import { track } from "../analytics";
import type { Buyer } from "../../lib/orderTypes";
import { chaseTarget } from "../adapters/parcelTracking";
import { currentSessionDate } from "../adapters/tiktokSend";
import { mayBeIncomplete, sessionRange, usePastSessions } from "../adapters/pastSessions";
import { useCopyFeedback } from "../adapters/buttonFeedback";
import CopyFailNote from "../components/CopyFailNote";
import SoonBadge from "../components/SoonBadge";
import { telegramDraftUrl, TELEGRAM_HANDLE } from "../../lib/telegram";
import PlatformEmblem from "../components/PlatformEmblem";
import { LIVE_PICKER_MOTION, emblemMotionVars, emblemOutline, EMBLEM_SLUG, type PickerPlatform } from "../adapters/livePicker";
import TikTokSendSheet from "../components/TikTokSendSheet";
import InvoiceFormatSheet from "../components/InvoiceFormatSheet";
import FbSendAllTab from "../components/FbSendAllTab";
import type { BlAddResult } from "../adapters/blacklist";
import {
  EMPTY_INVOICE_FORMAT, INVOICE_PLATFORMS, PLATFORM_NAME, inFilter, invoiceCounts, invoiceMessage, invoiceRows, loadInvoiceFormat, loadPending,
  byHandAllowed, pieceCount, savePending, sendTarget, sentTime, stateOf, tagOf, useInvoiceLineCancels, useInvoiceOrderIds, useInvoiceStatus,
  type InvoiceFilter, type InvoiceFormat, type InvoicePlatform, type InvoiceRow, type InvoiceTag,
} from "../adapters/invoicing";

/** A second tap on Send next this soon after the first is a double tap: it does nothing (it would mark the
 *  buyer just opened as Sent and open the next one). Coming back from TikTok always takes longer. */
export const SEND_NEXT_GUARD_MS = 900;
/** The time of a tap (read in the tap handler only, never while drawing). */
const tapTime = () => Date.now();
const card: CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "13px 14px", boxShadow: "var(--shadow)" };
const bigBtn: CSSProperties = { display: "block", boxSizing: "border-box", width: "100%", minHeight: 52, padding: "14px 12px", borderRadius: 14, border: "none", background: "var(--accent)", color: "var(--accent-text)", fontSize: 15, fontWeight: 800, textAlign: "center", textDecoration: "none", lineHeight: 1.3, cursor: "pointer", fontFamily: "var(--font-ui)", overflowWrap: "anywhere" };
const chipBtn = (on: boolean): CSSProperties => ({ minHeight: 44, padding: "0 13px", borderRadius: 999, border: on ? "1.5px solid var(--accent)" : "1px solid var(--border-strong)", background: on ? "var(--accent-soft)" : "var(--surface)", color: on ? "var(--accent-fg)" : "var(--text-dim)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)", whiteSpace: "nowrap" });
const TAG_LOOK: Record<InvoiceTag, CSSProperties> = {
  next: { background: "var(--accent)", color: "var(--accent-text)" },
  sending: { background: "var(--accent-soft)", color: "var(--accent-fg)" },
  not_sent: { background: "var(--chip-bg)", color: "var(--text-dim)", boxShadow: "inset 0 0 0 1px var(--border)" },   // the outline keeps it readable on a hovered row (laptop)
  sent: { background: "rgba(5,150,105,.14)", color: "var(--ok)" },
  new_item: { background: "rgba(217,119,6,.16)", color: "var(--warn)" },
  skipped: { background: "rgba(217,119,6,.16)", color: "var(--warn)" },
  copy_failed: { background: "rgba(217,119,6,.16)", color: "var(--warn)" },
  cancelled: { background: "var(--chip-bg)", color: "var(--text-muted)", boxShadow: "inset 0 0 0 1px var(--border)" },
};
// a past session: the same amber the Orders tab uses for one (fixed colours — readable in both themes)
const AMBER = { border: "1px solid #f59e0b", background: "#fef3c7", color: "#92400e" } as const;
const pickBtn: CSSProperties = { display: "flex", alignItems: "center", gap: 8, width: "100%", boxSizing: "border-box", minHeight: 44, padding: "8px 12px", borderRadius: 12, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)", fontSize: 13.5, fontWeight: 800, textAlign: "left", cursor: "pointer", fontFamily: "var(--font-ui)", lineHeight: 1.3 };
const pickItem = (on: boolean): CSSProperties => ({ display: "block", width: "100%", boxSizing: "border-box", minHeight: 44, padding: "10px 14px", border: "none", borderTop: "1px solid var(--border)", background: on ? "var(--accent-soft)" : "transparent", color: on ? "var(--accent-fg)" : "var(--text)", fontSize: 13.5, fontWeight: on ? 800 : 600, textAlign: "left", cursor: "pointer", fontFamily: "var(--font-ui)", lineHeight: 1.35, overflowWrap: "anywhere" });
const pickNote: CSSProperties = { padding: "10px 14px", borderTop: "1px solid var(--border)", fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.4 };

export default function Invoicing({ cur, onBack, buyers, sessionKey, sellerId, sessionStartedAt = null, sessionWindowDays = null, todayId, onReceiptFormat, tapGuardMs = SEND_NEXT_GUARD_MS, sessionId = null, pastSessions = false, onBlacklistAdd, fbSendAll }: {
  cur: string; onBack: () => void;
  /** the current session's buyers — the same list the Orders tab gets */
  buyers: Buyer[];
  /** the session the saved status belongs to (adapters/invoicing.ts invoiceSessionKey) */
  sessionKey: string;
  sellerId: string;
  sessionStartedAt?: string | null; sessionWindowDays?: number | null; todayId: string;
  /** a seller with the Messenger receipt: opens the existing Receipt format screen (Facebook tab) */
  onReceiptFormat?: () => void;
  /** the double-tap guard of Send next (tests pass 0) */
  tapGuardMs?: number;
  /** the running session's id (null = none) and whether this seller has past sessions — the SAME rule
   *  and the same list as the Orders tab's Sessions picker */
  sessionId?: string | null; pastSessions?: boolean;
  /** the Blacklist screen's own add (RedesignApp: blacklist.add, reason "Not checked out"); absent = the
   *  seller has no Blacklist → no question after "Buyer cancelled" */
  onBlacklistAdd?: (handle: string) => Promise<BlAddResult>;
  /** FB-2 "Send all in Messenger" (fb_send_all_enabled on, or an admin) for a seller with the add-on
   *  (onReceiptFormat): the picture's language. Absent = the Facebook tab exactly as before. */
  fbSendAll?: { lang: string };
}) {
  const t = useT();
  const [tab, setTab] = useState<InvoicePlatform>("tiktok");
  const [filter, setFilter] = useState<InvoiceFilter>("all");
  const [fmtState, setFmtState] = useState<"loading" | "ready" | "error">("loading");
  const [format, setFormat] = useState<InvoiceFormat>(EMPTY_INVOICE_FORMAT);
  const [fmtTurn, setFmtTurn] = useState(0);
  const [formatOpen, setFormatOpen] = useState(false);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [line, setLine] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const copyFb = useCopyFeedback();
  // the session on screen: the running one, or the past one picked here
  const past = usePastSessions(pastSessions, sessionId);
  const pastSel = past.selected;
  const activeKey = pastSel ? pastSel.id : sessionKey;
  const status = useInvoiceStatus(activeKey, "tiktok", true);
  const cancels = useInvoiceLineCancels(activeKey, "tiktok", true);
  const [blAsk, setBlAsk] = useState<{ handle: string; phase: "ask" | "busy" | "added" | "already" | "error" } | null>(null);
  // this phone only, per session: the buyer being sent (kept on the phone) and the buyer whose copy
  // failed (kept nowhere). Another session picked → that session's own.
  const [local, setLocal] = useState<{ key: string; pendingId: string | null; copyFailedId: string | null }>(
    () => ({ key: activeKey, pendingId: loadPending(sellerId, activeKey, "tiktok"), copyFailedId: null }));
  if (local.key !== activeKey) setLocal({ key: activeKey, pendingId: loadPending(sellerId, activeKey, "tiktok"), copyFailedId: null });
  const pendingId = local.key === activeKey ? local.pendingId : null;
  const copyFailedId = local.key === activeKey ? local.copyFailedId : null;
  const keyRef = useRef(activeKey);
  useEffect(() => { keyRef.current = activeKey; }, [activeKey]);

  useEffect(() => {
    let alive = true;
    void loadInvoiceFormat().then((r) => {
      if (!alive) return;
      if (r.ok) { setFormat(r.format); setFmtState("ready"); } else setFmtState("error");
    });
    return () => { alive = false; };
  }, [fmtTurn]);
  const retryFormat = () => { setFmtState("loading"); setFmtTurn((n) => n + 1); };

  const fee = format.fee;
  const shownBuyers = pastSel ? past.buyers : buyers;
  const orderIds = useInvoiceOrderIds(shownBuyers, "tiktok", pastSel ? pastSel.id : sessionId, true);
  const idMap = orderIds.ids, cutSet = cancels.cancelled;
  const rows = useMemo(() => invoiceRows(shownBuyers, "tiktok", fee, { ids: idMap, cancelled: cutSet }), [shownBuyers, fee, idMap, cutSet]);
  // the buyer being sent: only while that row is still there and not already saved as Sent with the same lines
  const pending = useMemo(() => {
    const r = pendingId ? rows.find((x) => x.id === pendingId) : undefined;
    const st = r ? stateOf(r, status.saved.get(r.id)) : null;
    return r && st !== "sent" && st !== "cancelled" ? r : null;
  }, [pendingId, rows, status.saved]);
  // `key` = the session the tap was made in: an answer that lands after another session was picked
  // changes nothing on screen
  const setPending = useCallback((key: string, id: string | null) => {
    savePending(sellerId, key, "tiktok", id);
    setLocal((l) => (l.key === key ? { ...l, pendingId: id } : l));
  }, [sellerId]);
  const setCopyFailed = useCallback((key: string, id: string | null) => {
    setLocal((l) => (l.key === key ? { ...l, copyFailedId: id } : l));
  }, []);

  // the buyer the big button is on: the one whose copy failed (until a copy works), else the next in line
  const target = useMemo(() => sendTarget(rows, status.saved, pending?.id ?? null, copyFailedId), [rows, status.saved, pending, copyFailedId]);
  const next = target.row;
  const again = target.again;
  const counts = invoiceCounts(rows, status.saved);
  const sum = rows.reduce((s, r) => s + (stateOf(r, status.saved.get(r.id)) === "cancelled" ? 0 : r.total), 0);
  const labels = { hi: t.rd_tts_msg_hi, order: t.rd_tts_msg_order, total: t.rd_tts_msg_total, shipping: t.rd_tts_msg_shipping };
  // the date in a message: a past session's own range (as in the Orders tab), else the running session's
  const pastRange = pastSel ? sessionRange(pastSel) : "";
  const dateOf = (r: InvoiceRow) => (pastSel ? pastRange : currentSessionDate(sessionStartedAt, sessionWindowDays, r.orderNums, todayId));
  const thisDate = currentSessionDate(sessionStartedAt, sessionWindowDays, buyers.flatMap((b) => b.orders.map((o) => o.orderNum)), todayId);
  const money = (n: number) => `${cur}${fmt(n)}`;
  const pastState = pastSel ? past.buyersState : "ready";
  const ready = status.state === "ready" && fmtState === "ready" && pastState === "ready" && cancels.state === "ready";

  // "Send next": the buyer sent before this tap becomes Sent; this buyer's message is copied and (the link
  // itself) opens them in TikTok. With nobody left the button reads Done and only marks the last one.
  const lastTap = useRef(0);
  const sendNext = (e: MouseEvent) => {
    const nowMs = tapTime();
    if (nowMs - lastTap.current < tapGuardMs) { e.preventDefault(); return; }   // a double tap: no mark, no copy, no TikTok
    lastTap.current = nowMs;
    const key = activeKey;
    if (pending) status.mark(pending, "sent");
    setPending(key, null);
    if (!next) { setLine(""); return; }
    const row = next;
    const link = chaseTarget(row.receipt.handle);
    const text = invoiceMessage(row, { cur, note: format.note, fee, date: dateOf(row), labels });
    setLine("");
    // COPY FAILED = NOT SENT: this buyer is "being sent" only once the message really is on the clipboard.
    // Refused → the buyer is marked "Copy failed" and the button stays on them.
    void copyFb.copy(text).then((ok) => {
      if (ok) { setCopyFailed(key, null); setPending(key, row.id); }
      else setCopyFailed(key, row.id);
      if (ok && keyRef.current === key) setLine(link.kind === "open" ? t.rd_tts_copied_open : t.rd_tts_copy_find);
    });
    track("invoice_send", { platform: "tiktok", via: again ? "again" : "next", link: link.kind === "open" });
  };

  const pickSession = (s: (typeof past.list)[number] | null) => {
    setPickerOpen(false);
    setSheetId(null);
    setLine("");
    copyFb.clear();
    void past.pick(s);
  };

  // "Buyer cancelled": saved as 'cancelled' (the lines it was sent with are kept), the sheet closes, and
  // the seller with Blacklist is asked once.
  const cancelBuyer = (r: InvoiceRow) => {
    const prev = status.saved.get(r.id);
    status.mark(r, "cancelled", prev?.hash ?? r.hash);
    if (pendingId === r.id) setPending(activeKey, null);
    if (copyFailedId === r.id) setCopyFailed(activeKey, null);
    setSheetId(null);
    track("invoice_cancel", { platform: "tiktok" });
    if (onBlacklistAdd) setBlAsk({ handle: r.receipt.handle, phase: "ask" });
  };
  // "Undo cancel": Sent again (with its first send time) when the buyer was Sent before the cancel; else Not sent.
  const undoCancel = (r: InvoiceRow) => {
    const prev = status.saved.get(r.id);
    if (prev?.status === "cancelled" && prev.sentAt) status.mark(r, "sent", prev.hash);
    else status.clear(r);
  };
  const askYes = () => {
    if (!blAsk || !onBlacklistAdd) return;
    const handle = blAsk.handle;
    setBlAsk({ handle, phase: "busy" });
    void onBlacklistAdd(handle).then((res) => setBlAsk((b) => (b && b.handle === handle ? { handle, phase: res.kind === "added" ? "added" : res.kind === "already" ? "already" : "error" } : b)));
  };

  const tagText = (tag: InvoiceTag, r: InvoiceRow): string =>
    tag === "next" ? t.rd_ivc_t_next
    : tag === "sending" ? t.rd_ivc_t_sending
    : tag === "sent" ? tpl(t.rd_ivc_t_sent, { time: sentTime(status.saved.get(r.id)?.sentAt) }).trim()
    : tag === "new_item" ? t.rd_ivc_t_new
    : tag === "skipped" ? t.rd_ivc_t_skip
    : tag === "copy_failed" ? t.rd_ivc_t_copy_failed
    : tag === "cancelled" ? t.rd_ivc_t_cancelled
    : t.rd_ivc_f_not;
  const piecesText = (n: number) => (n === 1 ? t.rd_ivc_pcs_1 : tpl(t.rd_ivc_pcs, { n }));

  const sheetRow = sheetId ? rows.find((r) => r.id === sheetId) ?? null : null;
  const shown = rows.filter((r) => inFilter(stateOf(r, status.saved.get(r.id)), filter));
  const nextTarget = next ? chaseTarget(next.receipt.handle) : null;
  const nextLabel = !next ? ""
    : again ? tpl(t.rd_ivc_copy_again, { n: next.num, who: next.receipt.handle })
    : tpl(t.rd_ivc_send_next, { n: next.num, who: next.receipt.handle, total: money(next.total) });
  const pastList = past.list.filter((x) => !x.current);
  const sessionLabel = (x: (typeof past.list)[number]) => tpl(t.rd_psn_row, { range: sessionRange(x), days: x.days === 1 ? t.rd_psn_day1 : tpl(t.rd_psn_days, { n: x.days }) });

  const picker = pastSessions && (
    <div data-testid="ivc-session">
      <button type="button" data-testid="ivc-session-btn" data-past={pastSel ? "1" : "0"} aria-haspopup="menu" aria-expanded={pickerOpen}
        onClick={() => { const opening = !pickerOpen; setPickerOpen(opening); if (opening) void past.ensureList(); }}
        style={pastSel ? { ...pickBtn, ...AMBER } : pickBtn}>
        <span data-testid="ivc-session-label" style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
          {pastSel ? tpl(t.rd_psn_btn, { range: pastRange }) : tpl(t.rd_ivc_ses_this, { range: thisDate })}
        </span>
        <span aria-hidden="true" style={{ flexShrink: 0 }}>▾</span>
      </button>
      {pickerOpen && (
        <div role="menu" data-testid="ivc-session-menu" style={{ marginTop: 6, border: "1px solid var(--border-strong)", borderRadius: 12, background: "var(--surface)", boxShadow: "var(--shadow)", overflow: "hidden", maxHeight: "60vh", overflowY: "auto" }}>
          <button type="button" role="menuitem" data-testid="ivc-session-current" aria-current={!pastSel} onClick={() => pickSession(null)} style={{ ...pickItem(!pastSel), borderTop: "none" }}>
            {tpl(t.rd_ivc_ses_this, { range: thisDate })}
          </button>
          <div style={{ ...pickNote, fontSize: 11, fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase" }}>{t.rd_psn_past}</div>
          {past.listState === "loading" && pastList.length === 0 && <div data-testid="ivc-session-loading" style={pickNote}>{t.rd_psn_loading}</div>}
          {past.listState === "error" && <div role="alert" data-testid="ivc-session-error" style={{ ...pickNote, color: "var(--danger)" }}>{t.rd_psn_failed}</div>}
          {past.listState === "ready" && pastList.length === 0 && <div data-testid="ivc-session-none" style={pickNote}>{t.rd_psn_none}</div>}
          {pastList.map((x) => (
            <button key={x.id} type="button" role="menuitem" data-testid="ivc-session-item" data-session={x.id} aria-current={pastSel?.id === x.id} onClick={() => pickSession(x)} style={pickItem(pastSel?.id === x.id)}>
              {sessionLabel(x)}
              {mayBeIncomplete(x) && <span style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#b45309", marginTop: 2 }}>{t.rd_psn_incomplete}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const tiktok = (
    <div data-testid="ivc-tiktok" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {picker}
      {pastSel && pastState === "error" && (
        <div role="alert" data-testid="ivc-past-error" style={{ ...card, borderColor: "var(--danger)" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)", lineHeight: 1.4 }}>{t.rd_psn_failed}</div>
          <button type="button" data-testid="ivc-past-retry" onClick={() => void past.pick(pastSel)} style={{ ...chipBtn(true), marginTop: 10 }}>{t.rd_fb_try_again}</button>
        </div>
      )}
      {(status.state === "loading" || fmtState === "loading" || pastState === "loading" || cancels.state === "loading") && status.state !== "error" && cancels.state !== "error" && fmtState !== "error" && pastState !== "error" && (
        <div data-testid="ivc-loading" style={{ ...card, fontSize: 13, color: "var(--text-muted)" }}>{pastState === "loading" ? t.rd_psn_buyers_loading : t.rd_loading}</div>
      )}
      {status.state === "error" && pastState !== "error" && (
        <div role="alert" data-testid="ivc-load-error" style={{ ...card, borderColor: "var(--danger)" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)", lineHeight: 1.4 }}>{t.rd_ivc_load_failed}</div>
          <button type="button" data-testid="ivc-load-retry" onClick={status.reload} style={{ ...chipBtn(true), marginTop: 10 }}>{t.rd_fb_try_again}</button>
        </div>
      )}
      {cancels.state === "error" && status.state !== "error" && pastState !== "error" && (
        <div role="alert" data-testid="ivc-cancels-error" style={{ ...card, borderColor: "var(--danger)" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)", lineHeight: 1.4 }}>{t.rd_ivc_load_failed}</div>
          <button type="button" data-testid="ivc-cancels-retry" onClick={cancels.reload} style={{ ...chipBtn(true), marginTop: 10 }}>{t.rd_fb_try_again}</button>
        </div>
      )}
      {fmtState === "error" && status.state !== "error" && pastState !== "error" && (
        <div role="alert" data-testid="ivc-format-error" style={{ ...card, borderColor: "var(--danger)" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)", lineHeight: 1.4 }}>{t.rd_ivc_fmt_failed}</div>
          <button type="button" data-testid="ivc-format-retry" onClick={retryFormat} style={{ ...chipBtn(true), marginTop: 10 }}>{t.rd_fb_try_again}</button>
        </div>
      )}
      {ready && rows.length === 0 && (
        <div data-testid="ivc-empty" style={{ ...card, fontSize: 13.5, color: "var(--text-dim)", lineHeight: 1.45 }}>{pastSel ? t.rd_ivc_empty_past : t.rd_ivc_empty}</div>
      )}
      {ready && rows.length > 0 && (<>
        <div style={card} data-testid="ivc-summary">
          {pastSel && (
            <div data-testid="ivc-past-line" style={{ display: "inline-block", marginBottom: 8, padding: "4px 9px", borderRadius: 8, fontSize: 12.5, fontWeight: 800, lineHeight: 1.35, overflowWrap: "anywhere", ...AMBER }}>
              {tpl(t.rd_psn_banner, { range: pastRange })}
            </div>
          )}
          <div data-testid="ivc-summary-line" style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)", lineHeight: 1.4, overflowWrap: "anywhere" }}>
            {pastSel ? tpl(t.rd_ivc_summary_past, { n: counts.active, sum: money(sum) }) : tpl(t.rd_ivc_summary, { date: thisDate, n: counts.active, sum: money(sum) })}
          </div>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={counts.active} aria-valuenow={counts.sent} data-testid="ivc-progress"
            style={{ marginTop: 10, height: 8, borderRadius: 999, background: "var(--chip-bg)", overflow: "hidden" }}>
            <div style={{ width: `${counts.active ? Math.round((counts.sent / counts.active) * 100) : 0}%`, height: "100%", borderRadius: 999, background: "var(--ok)" }} />
          </div>
          <div data-testid="ivc-progress-text" style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>{tpl(t.rd_ivc_progress, { x: counts.sent, n: counts.active })}</div>
        </div>

        <div data-testid="ivc-action">
          {next && nextTarget?.kind === "open" && (
            <a href={nextTarget.url} target="_blank" rel="noreferrer" data-testid="ivc-send-next" data-buyer={next.num} data-again={again ? "1" : "0"} onClick={sendNext} style={bigBtn}>{nextLabel}</a>
          )}
          {next && nextTarget?.kind !== "open" && (<>
            <button type="button" data-testid="ivc-send-next" data-buyer={next.num} data-again={again ? "1" : "0"} data-copy-only="1" onClick={sendNext} style={bigBtn}>{nextLabel}</button>
            <div data-testid="ivc-copy-note" style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: "var(--warn)", lineHeight: 1.4 }}>{t.rd_ivc_copy_note}</div>
          </>)}
          {!next && pending && (
            <button type="button" data-testid="ivc-done" onClick={sendNext} style={bigBtn}>{t.rd_ps_done}</button>
          )}
          {!next && !pending && (
            <div data-testid="ivc-finished" style={{ ...card, fontSize: 13.5, fontWeight: 700, color: counts.sent === counts.active ? "var(--ok)" : "var(--text-dim)" }}>
              {counts.sent === counts.active ? `✓ ${t.rd_ivc_all_done}` : t.rd_ivc_none_left}
            </div>
          )}
          {(next || pending) && !again && <div data-testid="ivc-hint" style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45 }}>{t.rd_ivc_hint}</div>}
          {line && copyFb.phase !== "failed" && <div role="status" data-testid="ivc-line" style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: "var(--ok)", lineHeight: 1.4 }}>{line}</div>}
          <CopyFailNote fb={copyFb} t={t} what="text" testid="ivc-copy-fail" />
        </div>

        {status.unsaved + cancels.unsaved > 0 && (
          <div role="alert" data-testid="ivc-unsaved" style={{ ...card, borderColor: "var(--warn)", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: "var(--warn)", lineHeight: 1.4 }}>{tpl(t.rd_ivc_unsaved, { n: status.unsaved + cancels.unsaved })}</span>
            <button type="button" data-testid="ivc-unsaved-retry" onClick={() => { status.retry(); cancels.retry(); }} style={{ ...chipBtn(true), flexShrink: 0 }}>{t.rd_fb_try_again}</button>
          </div>
        )}

        <div data-testid="ivc-filters" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {([["all", t.rd_min_all, counts.all], ["not_sent", t.rd_ivc_f_not, counts.notSent], ["sent", t.rd_ivc_f_sent, counts.sent]] as const).map(([id, text, n]) => (
            <button key={id} type="button" data-testid={`ivc-filter-${id}`} aria-pressed={filter === id} onClick={() => setFilter(id)} style={chipBtn(filter === id)}>{text} · {n}</button>
          ))}
        </div>

        <div data-testid="ivc-list" style={{ ...card, padding: 0, overflow: "hidden" }}>
          {shown.length === 0 && <div data-testid="ivc-empty-filter" style={{ padding: "14px", fontSize: 13, color: "var(--text-muted)" }}>{t.rd_ivc_empty_filter}</div>}
          {shown.map((r, i) => {
            const tag = tagOf(r, status.saved, pending?.id ?? null, next?.id ?? null, copyFailedId);
            const off = tag === "cancelled";
            return (
              // The whole row opens the buyer's sheet; "✎ View" (a real button, 44px tap area) does the same — the
              // row is a plain container so the View button is not a button inside a button.
              <div key={r.id} data-testid="ivc-row" data-buyer={r.num} data-tag={tag} data-cancelled={off ? "1" : undefined} onClick={() => setSheetId(r.id)}
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", boxSizing: "border-box", minHeight: 56, padding: "9px 12px", borderTop: i ? "1px solid var(--border)" : "none", background: "transparent", textAlign: "left", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 600, color: "var(--text)", minWidth: 38, flexShrink: 0, opacity: off ? 0.5 : 1 }}>#{r.num}</span>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4, opacity: off ? 0.6 : 1 }}>
                  <span data-testid="ivc-row-handle" style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.receipt.handle}</span>
                  <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 6, rowGap: 2, minWidth: 0 }}>
                    <span data-testid="ivc-row-tag" style={{ maxWidth: "100%", fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 999, lineHeight: 1.35, ...TAG_LOOK[tag] }}>{tagText(tag, r)}</span>
                    {!off && <span data-testid="ivc-row-pcs" style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)", whiteSpace: "nowrap", lineHeight: 1.35 }}>· {piecesText(pieceCount(r))}</span>}
                  </span>
                </span>
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, flexShrink: 0 }}>
                  <span data-testid="ivc-row-total" style={{ fontFamily: mono, fontSize: 13.5, fontWeight: 600, color: off ? "var(--text-muted)" : "var(--text)", whiteSpace: "nowrap", textDecoration: off ? "line-through" : "none" }}>{money(r.total)}</span>
                  <button type="button" data-testid="ivc-row-view" className="sfl-tap44" aria-label={`${t.rd_ivc_view} #${r.num}`}
                    onClick={(e) => { e.stopPropagation(); setSheetId(r.id); }}
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, minHeight: 30, padding: "0 10px", borderRadius: 999, border: "1.5px solid var(--accent)", background: "transparent", color: "var(--accent-fg)", fontSize: 12, fontWeight: 800, whiteSpace: "nowrap", cursor: "pointer", fontFamily: "var(--font-ui)", lineHeight: 1 }}>
                    <span aria-hidden="true">✎</span>{t.rd_ivc_view}
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </>)}
    </div>
  );

  const soon = (p: InvoicePlatform) => (
    <div data-testid={`ivc-soon-${p}`} style={{ ...card, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
      <SoonBadge plain testid={`ivc-soon-badge-${p}`} />
      <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)", lineHeight: 1.45 }}>
        {p === "facebook" ? t.rd_ivc_fb_soon : tpl(t.rd_ivc_soon_body, { platform: PLATFORM_NAME[p] })}
      </div>
      {p === "facebook" && onReceiptFormat && (
        <button type="button" data-testid="ivc-receipt-format" onClick={onReceiptFormat}
          style={{ minHeight: 44, padding: "0 16px", borderRadius: 12, border: "1.5px solid var(--accent)", background: "var(--accent-soft)", color: "var(--accent-fg)", fontSize: 13.5, fontWeight: 800, cursor: "pointer", fontFamily: "var(--font-ui)" }}>
          {t.rd_rc_title} ›
        </button>
      )}
    </div>
  );

  // Facebook tab for a seller WITHOUT the Receipt add-on (fb_receipt_access, through onReceiptFormat):
  // a locked card + a real Telegram link with a ready message (the Website teaser's helper). Every
  // plan and every build (iPhone too) gets the same words — no price, no "upgrade". A seller WITH
  // the add-on keeps the card above, exactly as before.
  const fbLocked = (
    <div data-testid="ivc-fb-locked" style={{ ...card, display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
      <span aria-hidden="true" data-testid="ivc-fb-lock-icon" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, borderRadius: 12, background: "var(--accent-soft)", color: "var(--accent-fg)" }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>
      </span>
      <div data-testid="ivc-fb-lock-title" style={{ fontSize: 15.5, fontWeight: 800, color: "var(--text)", lineHeight: 1.3 }}>{t.rd_ivc_fb_lock_title}</div>
      <div data-testid="ivc-fb-lock-body" style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text-muted)", lineHeight: 1.5 }}>{t.rd_ivc_fb_lock_body}</div>
      <a data-testid="ivc-fb-lock-ask" href={telegramDraftUrl(t.rd_ivc_fb_lock_msg)} target="_blank" rel="noreferrer"
        style={{ display: "flex", alignItems: "center", justifyContent: "center", alignSelf: "stretch", minHeight: 46, padding: "8px 16px", boxSizing: "border-box", borderRadius: 12, background: "var(--accent)", color: "var(--accent-text)", fontSize: 14.5, fontWeight: 800, textAlign: "center", lineHeight: 1.25, textDecoration: "none", fontFamily: "var(--font-ui)" }}>
        {t.rd_ivc_fb_lock_btn}
      </a>
      <div data-testid="ivc-fb-lock-hint" style={{ alignSelf: "stretch", textAlign: "center", fontSize: 12, fontWeight: 600, color: "var(--text-dim)" }}>{tpl(t.rd_ivc_fb_lock_hint, { handle: TELEGRAM_HANDLE })}</div>
    </div>
  );

  return (
    <div data-testid="invoicing-screen">
      <div style={headerBar}>
        <HeaderWithBack onBack={onBack}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ ...headerTitle, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.rd_invoice_title}</div>
            <button type="button" data-testid="ivc-format-btn" disabled={fmtState !== "ready"} onClick={() => setFormatOpen(true)}
              style={{ flexShrink: 0, minHeight: 44, padding: "0 14px", borderRadius: 9, border: "none", background: "rgba(255,255,255,.18)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: fmtState === "ready" ? "pointer" : "default", opacity: fmtState === "ready" ? 1 : 0.6, fontFamily: "var(--font-ui)" }}>
              {t.rd_ivc_format}
            </button>
          </div>
        </HeaderWithBack>
      </div>
      <div style={{ padding: "12px 14px 26px", maxWidth: 720, margin: "0 auto", boxSizing: "border-box" }}>
        {/* Each tab = the Live picker's own emblem (small) above the name. The selected tab's emblem moves at
            the picker's speed, the others slowly (redesign.css .sfl-ivc-tab*); the app's motion switch and
            "reduce motion" stop all of it. */}
        <div role="tablist" data-testid="ivc-tabs" className={`sfl-ivc-tabs sfl-ivc-tabs--m-${LIVE_PICKER_MOTION}`}
          style={{ ...emblemMotionVars(), display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 4, padding: 4, borderRadius: 14, background: "var(--chip-bg)", marginBottom: 12 } as CSSProperties}>
          {INVOICE_PLATFORMS.map((p) => {
            const brand = PLATFORM_NAME[p] as PickerPlatform;
            const on = tab === p;
            return (
              <button key={p} type="button" role="tab" aria-selected={on} data-testid={`ivc-tab-${p}`} onClick={() => setTab(p)}
                className={`sfl-ivc-tab${on ? " is-on" : ""}`}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, minHeight: 56, minWidth: 0, padding: "5px 1px 4px", boxSizing: "border-box", borderRadius: 11, border: `2px solid ${on ? emblemOutline(brand) : "transparent"}`, background: on ? "var(--surface)" : "transparent", color: on ? "var(--text)" : "var(--text-muted)", boxShadow: on ? "var(--shadow)" : "none", cursor: "pointer", fontFamily: "var(--font-ui)", overflow: "hidden" }}>
                <span aria-hidden="true" data-testid={`ivc-tab-emblem-${p}`} className="sfl-ivc-emb">
                  <span className="sfl-ivc-emb-in">
                    <span className={`sfl-lpk-emb sfl-lpk-emb--${EMBLEM_SLUG[brand]}`}><PlatformEmblem platform={brand} /></span>
                  </span>
                </span>
                <span data-testid={`ivc-tab-name-${p}`} style={{ maxWidth: "100%", fontSize: 12, fontWeight: 700, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{PLATFORM_NAME[p]}</span>
              </button>
            );
          })}
        </div>
        {tab === "tiktok" ? tiktok
          : tab === "facebook" && !onReceiptFormat ? fbLocked
          : tab === "facebook" && fbSendAll ? (
            <FbSendAllTab picker={picker} isPast={!!pastSel} sessionKey={activeKey} sessionId={pastSel ? pastSel.id : sessionId}
              pastBanner={pastSel ? (
                <div data-testid="ivc-fb-past-line" style={{ display: "inline-block", marginBottom: 8, padding: "4px 9px", borderRadius: 8, fontSize: 12.5, fontWeight: 800, lineHeight: 1.35, overflowWrap: "anywhere", ...AMBER }}>{tpl(t.rd_psn_banner, { range: pastRange })}</div>
              ) : null}
              buyers={shownBuyers} fee={fee} money={money} lang={fbSendAll.lang} cur={cur} buyersState={pastState} fallback={soon("facebook")} />
          )
          : soon(tab)}
      </div>

      {sheetRow && (
        <TikTokSendSheet key={sheetRow.id} receipt={sheetRow.receipt} cur={cur} sellerId={sellerId} date={dateOf(sheetRow)} onClose={() => setSheetId(null)}
          invoice={{
            note: format.note, shipping: fee,
            sent: ["sent", "new_item"].includes(stateOf(sheetRow, status.saved.get(sheetRow.id))),
            // a past session: the amber line, and NO "old session — send anyway?" question (picked on purpose)
            ...(pastSel ? { pastRange } : {}),
            onSent: () => { status.mark(sheetRow, "sent"); if (pendingId === sheetRow.id) setPending(activeKey, null); if (copyFailedId === sheetRow.id) setCopyFailed(activeKey, null); track("invoice_send", { platform: "tiktok", via: "sheet" }); },
            onSkip: () => { status.mark(sheetRow, "skipped"); if (pendingId === sheetRow.id) setPending(activeKey, null); if (copyFailedId === sheetRow.id) setCopyFailed(activeKey, null); track("invoice_skip", { platform: "tiktok" }); },
            // copy refused in the sheet = NOT sent: the buyer shows "Copy failed" and the big button goes to
            // them. (A buyer already Sent stays Sent — only the "Send again" did not go out.)
            lineIds: sheetRow.orderIds, cancelledLines: cutSet,
            onCancelLine: (orderId: number, on: boolean) => { cancels.set(orderId, on); track(on ? "invoice_line_cancel" : "invoice_line_undo", { platform: "tiktok" }); },
            buyerCancelled: stateOf(sheetRow, status.saved.get(sheetRow.id)) === "cancelled",
            onCancelBuyer: () => cancelBuyer(sheetRow),
            onUndoCancel: () => undoCancel(sheetRow),
            onCopyFailed: () => {
              if (stateOf(sheetRow, status.saved.get(sheetRow.id)) === "sent") return;
              if (pendingId === sheetRow.id) setPending(activeKey, null);
              setCopyFailed(activeKey, sheetRow.id);
            },
            // "I sent it by hand": only while this buyer is Copy failed or Sending… — saved like a normal Sent
            ...(byHandAllowed(tagOf(sheetRow, status.saved, pending?.id ?? null, next?.id ?? null, copyFailedId)) ? {
              onSentByHand: () => {
                status.mark(sheetRow, "sent");
                if (pendingId === sheetRow.id) setPending(activeKey, null);
                if (copyFailedId === sheetRow.id) setCopyFailed(activeKey, null);
                track("invoice_send", { platform: "tiktok", via: "hand" });
                setSheetId(null);
              },
            } : {}),
          }} />
      )}
      {blAsk && createPortal(
        <div data-testid="ivc-bl-overlay" onClick={() => { if (blAsk.phase !== "busy") setBlAsk(null); }}
          style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.5)", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center" }}>
          <div role="dialog" aria-label={tpl(t.rd_ivc_bl_ask, { who: blAsk.handle })} data-testid="ivc-bl-ask" onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 480, boxSizing: "border-box", background: "var(--surface-2)", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: "16px 16px calc(18px + env(safe-area-inset-bottom))", boxShadow: "0 -14px 40px rgba(0,0,0,.35)" }}>
            <div data-testid="ivc-bl-title" style={{ fontSize: 15.5, fontWeight: 800, color: "var(--text)", lineHeight: 1.4, overflowWrap: "anywhere" }}>{tpl(t.rd_ivc_bl_ask, { who: blAsk.handle })}</div>
            <div style={{ marginTop: 4, fontSize: 12.5, color: "var(--text-muted)" }}>{t.rd_bl_not_out_short}</div>
            {(blAsk.phase === "ask" || blAsk.phase === "busy") ? (
              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <button type="button" data-testid="ivc-bl-no" disabled={blAsk.phase === "busy"} onClick={() => setBlAsk(null)}
                  style={{ flex: 1, minHeight: 48, borderRadius: 12, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)", fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_ivc_no}</button>
                <button type="button" data-testid="ivc-bl-yes" disabled={blAsk.phase === "busy"} onClick={askYes}
                  style={{ flex: 1, minHeight: 48, borderRadius: 12, border: "none", background: "var(--accent)", color: "var(--accent-text)", fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "var(--font-ui)", opacity: blAsk.phase === "busy" ? 0.6 : 1 }}>{t.rd_ivc_bl_yes}</button>
              </div>
            ) : (<>
              <div role="status" data-testid="ivc-bl-result" data-result={blAsk.phase} style={{ marginTop: 12, fontSize: 13.5, fontWeight: 700, lineHeight: 1.45, overflowWrap: "anywhere", color: blAsk.phase === "error" ? "var(--danger)" : "var(--ok)" }}>
                {blAsk.phase === "added" ? tpl(t.rd_bl_added, { buyer: blAsk.handle, reason: t.rd_bl_not_out_short })
                  : blAsk.phase === "already" ? tpl(t.rd_bl_already, { buyer: blAsk.handle, reason: t.rd_bl_not_out_short })
                  : t.rd_bl_save_err}
              </div>
              <button type="button" data-testid="ivc-bl-close" onClick={() => setBlAsk(null)}
                style={{ marginTop: 12, width: "100%", minHeight: 48, borderRadius: 12, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)", fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_rc_close}</button>
            </>)}
          </div>
        </div>,
        (typeof document !== "undefined" && document.querySelector("[data-redesign]")) || document.body,
      )}
      {formatOpen && (
        <InvoiceFormatSheet cur={cur} format={format} sharedWithReceipt={!!onReceiptFormat} onClose={() => setFormatOpen(false)} onSaved={setFormat} />
      )}
    </div>
  );
}
