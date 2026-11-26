// Settings → INVOICING, step 2a (Jeff, 2026-11-26). Tabs TikTok · Facebook · Instagram · Shopee.
// TikTok works: the CURRENT session's buyers, one row each (all days of a multi-day session together —
// the rows come from the Orders buyer card's own code, adapters/invoicing.ts), a "Send next" button that
// copies that buyer's message (the Send to TikTok text) and opens the buyer in TikTok the way Send to
// TikTok does, and the saved status of every invoice. Facebook / Instagram / Shopee say "Soon".
// Opening TikTok is always a real link the seller taps (the only open that works inside the iPhone app).
// Nothing here changes an order, a buyer number, stock or Sales.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { headerBar, headerTitle, mono } from "../ui";
import { HeaderWithBack } from "../components/BackButton";
import { tpl, useT } from "../i18n";
import { fmt } from "../data";
import { track } from "../analytics";
import type { Buyer } from "../../lib/orderTypes";
import { chaseTarget } from "../adapters/parcelTracking";
import { currentSessionDate } from "../adapters/tiktokSend";
import { useCopyFeedback } from "../adapters/buttonFeedback";
import CopyFailNote from "../components/CopyFailNote";
import SoonBadge from "../components/SoonBadge";
import TikTokSendSheet from "../components/TikTokSendSheet";
import InvoiceFormatSheet from "../components/InvoiceFormatSheet";
import {
  EMPTY_INVOICE_FORMAT, INVOICE_PLATFORMS, PLATFORM_NAME, inFilter, invoiceCounts, invoiceMessage, invoiceRows, loadInvoiceFormat, loadPending,
  savePending, sendQueue, sentTime, stateOf, tagOf, useInvoiceStatus,
  type InvoiceFilter, type InvoiceFormat, type InvoicePlatform, type InvoiceRow, type InvoiceTag,
} from "../adapters/invoicing";

/** A second tap on Send next this soon after the first is a double tap: it does nothing (it would mark the
 *  buyer just opened as Sent and open the next one). Coming back from TikTok always takes longer. */
export const SEND_NEXT_GUARD_MS = 900;
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
};

export default function Invoicing({ cur, onBack, buyers, sessionKey, sellerId, sessionStartedAt = null, sessionWindowDays = null, todayId, onReceiptFormat, tapGuardMs = SEND_NEXT_GUARD_MS }: {
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
}) {
  const t = useT();
  const [tab, setTab] = useState<InvoicePlatform>("tiktok");
  const [filter, setFilter] = useState<InvoiceFilter>("all");
  const [fmtState, setFmtState] = useState<"loading" | "ready" | "error">("loading");
  const [format, setFormat] = useState<InvoiceFormat>(EMPTY_INVOICE_FORMAT);
  const [fmtTurn, setFmtTurn] = useState(0);
  const [formatOpen, setFormatOpen] = useState(false);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(() => loadPending(sellerId, sessionKey, "tiktok"));
  const [line, setLine] = useState("");
  const copyFb = useCopyFeedback();
  const status = useInvoiceStatus(sessionKey, "tiktok", true);

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
  const rows = useMemo(() => invoiceRows(buyers, "tiktok", fee), [buyers, fee]);
  // the buyer being sent: only while that row is still there and not already saved as Sent with the same lines
  const pending = useMemo(() => {
    const r = pendingId ? rows.find((x) => x.id === pendingId) : undefined;
    return r && stateOf(r, status.saved.get(r.id)) !== "sent" ? r : null;
  }, [pendingId, rows, status.saved]);
  const setPending = useCallback((id: string | null) => {
    setPendingId(id);
    savePending(sellerId, sessionKey, "tiktok", id);
  }, [sellerId, sessionKey]);

  const queue = useMemo(() => sendQueue(rows, status.saved, pending?.id ?? null), [rows, status.saved, pending]);
  const next = queue[0] ?? null;
  const counts = invoiceCounts(rows, status.saved);
  const sum = rows.reduce((s, r) => s + r.total, 0);
  const labels = { hi: t.rd_tts_msg_hi, order: t.rd_tts_msg_order, total: t.rd_tts_msg_total, shipping: t.rd_tts_msg_shipping };
  const dateOf = (r: InvoiceRow) => currentSessionDate(sessionStartedAt, sessionWindowDays, r.orderNums, todayId);
  const sessionDate = currentSessionDate(sessionStartedAt, sessionWindowDays, rows.flatMap((r) => r.orderNums), todayId);
  const money = (n: number) => `${cur}${fmt(n)}`;
  const ready = status.state === "ready" && fmtState === "ready";

  // "Send next": the buyer sent before this tap becomes Sent; this buyer's message is copied and (the link
  // itself) opens them in TikTok. With nobody left the button reads Done and only marks the last one.
  const lastTap = useRef(0);
  const sendNext = (e: MouseEvent) => {
    const nowMs = Date.now();
    if (nowMs - lastTap.current < tapGuardMs) { e.preventDefault(); return; }   // a double tap: no mark, no copy, no TikTok
    lastTap.current = nowMs;
    if (pending) status.mark(pending, "sent");
    if (!next) { setPending(null); setLine(""); return; }
    const target = chaseTarget(next.receipt.handle);
    const text = invoiceMessage(next, { cur, note: format.note, fee, date: dateOf(next), labels });
    setPending(next.id);
    setLine("");
    void copyFb.copy(text).then((ok) => { if (ok) setLine(target.kind === "open" ? t.rd_tts_copied_open : t.rd_tts_copy_find); });
    track("invoice_send", { platform: "tiktok", via: "next", link: target.kind === "open" });
  };

  const tagText = (tag: InvoiceTag, r: InvoiceRow): string =>
    tag === "next" ? t.rd_ivc_t_next
    : tag === "sending" ? t.rd_ivc_t_sending
    : tag === "sent" ? tpl(t.rd_ivc_t_sent, { time: sentTime(status.saved.get(r.id)?.sentAt) }).trim()
    : tag === "new_item" ? t.rd_ivc_t_new
    : tag === "skipped" ? t.rd_ivc_t_skip
    : t.rd_ivc_f_not;

  const sheetRow = sheetId ? rows.find((r) => r.id === sheetId) ?? null : null;
  const shown = rows.filter((r) => inFilter(stateOf(r, status.saved.get(r.id)), filter));
  const nextTarget = next ? chaseTarget(next.receipt.handle) : null;
  const nextLabel = next ? tpl(t.rd_ivc_send_next, { n: next.num, who: next.receipt.handle, total: money(next.total) }) : "";

  const tiktok = (
    <div data-testid="ivc-tiktok" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {(status.state === "loading" || fmtState === "loading") && status.state !== "error" && fmtState !== "error" && (
        <div data-testid="ivc-loading" style={{ ...card, fontSize: 13, color: "var(--text-muted)" }}>{t.rd_loading}</div>
      )}
      {status.state === "error" && (
        <div role="alert" data-testid="ivc-load-error" style={{ ...card, borderColor: "var(--danger)" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)", lineHeight: 1.4 }}>{t.rd_ivc_load_failed}</div>
          <button type="button" data-testid="ivc-load-retry" onClick={status.reload} style={{ ...chipBtn(true), marginTop: 10 }}>{t.rd_fb_try_again}</button>
        </div>
      )}
      {fmtState === "error" && status.state !== "error" && (
        <div role="alert" data-testid="ivc-format-error" style={{ ...card, borderColor: "var(--danger)" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)", lineHeight: 1.4 }}>{t.rd_ivc_fmt_failed}</div>
          <button type="button" data-testid="ivc-format-retry" onClick={retryFormat} style={{ ...chipBtn(true), marginTop: 10 }}>{t.rd_fb_try_again}</button>
        </div>
      )}
      {ready && rows.length === 0 && (
        <div data-testid="ivc-empty" style={{ ...card, fontSize: 13.5, color: "var(--text-dim)", lineHeight: 1.45 }}>{t.rd_ivc_empty}</div>
      )}
      {ready && rows.length > 0 && (<>
        <div style={card} data-testid="ivc-summary">
          <div data-testid="ivc-summary-line" style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)", lineHeight: 1.4, overflowWrap: "anywhere" }}>
            {tpl(t.rd_ivc_summary, { date: sessionDate, n: rows.length, sum: money(sum) })}
          </div>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={counts.all} aria-valuenow={counts.sent} data-testid="ivc-progress"
            style={{ marginTop: 10, height: 8, borderRadius: 999, background: "var(--chip-bg)", overflow: "hidden" }}>
            <div style={{ width: `${counts.all ? Math.round((counts.sent / counts.all) * 100) : 0}%`, height: "100%", borderRadius: 999, background: "var(--ok)" }} />
          </div>
          <div data-testid="ivc-progress-text" style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>{tpl(t.rd_ivc_progress, { x: counts.sent, n: counts.all })}</div>
        </div>

        <div data-testid="ivc-action">
          {next && nextTarget?.kind === "open" && (
            <a href={nextTarget.url} target="_blank" rel="noreferrer" data-testid="ivc-send-next" data-buyer={next.num} onClick={sendNext} style={bigBtn}>{nextLabel}</a>
          )}
          {next && nextTarget?.kind !== "open" && (<>
            <button type="button" data-testid="ivc-send-next" data-buyer={next.num} data-copy-only="1" onClick={sendNext} style={bigBtn}>{nextLabel}</button>
            <div data-testid="ivc-copy-note" style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: "var(--warn)", lineHeight: 1.4 }}>{t.rd_ivc_copy_note}</div>
          </>)}
          {!next && pending && (
            <button type="button" data-testid="ivc-done" onClick={sendNext} style={bigBtn}>{t.rd_ps_done}</button>
          )}
          {!next && !pending && (
            <div data-testid="ivc-finished" style={{ ...card, fontSize: 13.5, fontWeight: 700, color: counts.sent === counts.all ? "var(--ok)" : "var(--text-dim)" }}>
              {counts.sent === counts.all ? `✓ ${t.rd_ivc_all_done}` : t.rd_ivc_none_left}
            </div>
          )}
          {(next || pending) && <div data-testid="ivc-hint" style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45 }}>{t.rd_ivc_hint}</div>}
          {line && copyFb.phase !== "failed" && <div role="status" data-testid="ivc-line" style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: "var(--ok)", lineHeight: 1.4 }}>{line}</div>}
          <CopyFailNote fb={copyFb} t={t} what="text" testid="ivc-copy-fail" />
        </div>

        {status.unsaved > 0 && (
          <div role="alert" data-testid="ivc-unsaved" style={{ ...card, borderColor: "var(--warn)", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: "var(--warn)", lineHeight: 1.4 }}>{tpl(t.rd_ivc_unsaved, { n: status.unsaved })}</span>
            <button type="button" data-testid="ivc-unsaved-retry" onClick={status.retry} style={{ ...chipBtn(true), flexShrink: 0 }}>{t.rd_fb_try_again}</button>
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
            const tag = tagOf(r, status.saved, pending?.id ?? null, next?.id ?? null);
            return (
              <button key={r.id} type="button" data-testid="ivc-row" data-buyer={r.num} data-tag={tag} onClick={() => setSheetId(r.id)}
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", boxSizing: "border-box", minHeight: 56, padding: "9px 12px", border: "none", borderTop: i ? "1px solid var(--border)" : "none", background: "transparent", textAlign: "left", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 600, color: "var(--text)", minWidth: 38, flexShrink: 0 }}>#{r.num}</span>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                  <span data-testid="ivc-row-handle" style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.receipt.handle}</span>
                  <span data-testid="ivc-row-tag" style={{ alignSelf: "flex-start", maxWidth: "100%", fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 999, lineHeight: 1.35, ...TAG_LOOK[tag] }}>{tagText(tag, r)}</span>
                </span>
                <span data-testid="ivc-row-total" style={{ fontFamily: mono, fontSize: 13.5, fontWeight: 600, color: "var(--text)", flexShrink: 0 }}>{money(r.total)}</span>
              </button>
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
        <div role="tablist" data-testid="ivc-tabs" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 4, padding: 4, borderRadius: 12, background: "var(--chip-bg)", marginBottom: 12 }}>
          {INVOICE_PLATFORMS.map((p) => (
            <button key={p} type="button" role="tab" aria-selected={tab === p} data-testid={`ivc-tab-${p}`} onClick={() => setTab(p)}
              style={{ minHeight: 44, minWidth: 0, padding: "0 2px", borderRadius: 9, border: "none", background: tab === p ? "var(--surface)" : "transparent", color: tab === p ? "var(--text)" : "var(--text-muted)", boxShadow: tab === p ? "var(--shadow)" : "none", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {PLATFORM_NAME[p]}
            </button>
          ))}
        </div>
        {tab === "tiktok" ? tiktok : soon(tab)}
      </div>

      {sheetRow && (
        <TikTokSendSheet key={sheetRow.id} receipt={sheetRow.receipt} cur={cur} sellerId={sellerId} date={dateOf(sheetRow)} onClose={() => setSheetId(null)}
          invoice={{
            note: format.note, shipping: fee,
            sent: ["sent", "new_item"].includes(stateOf(sheetRow, status.saved.get(sheetRow.id))),
            onSent: () => { status.mark(sheetRow, "sent"); if (pendingId === sheetRow.id) setPending(null); track("invoice_send", { platform: "tiktok", via: "sheet" }); },
            onSkip: () => { status.mark(sheetRow, "skipped"); if (pendingId === sheetRow.id) setPending(null); track("invoice_skip", { platform: "tiktok" }); },
          }} />
      )}
      {formatOpen && (
        <InvoiceFormatSheet cur={cur} format={format} sharedWithReceipt={!!onReceiptFormat} onClose={() => setFormatOpen(false)} onSaved={setFormat} />
      )}
    </div>
  );
}
