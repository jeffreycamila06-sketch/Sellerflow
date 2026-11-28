// Settings → Invoicing → FACEBOOK tab for a seller with the Receipt add-on (FB-2, Jeff 2026-11-26).
// "Send all in Messenger": the server sends every Facebook buyer of the session their receipt picture
// in Messenger, one by one (server/fbSendAll.js) — the app can be closed. The list = the session's
// Facebook buyers (the same rows the TikTok tab builds, adapters/invoicing.ts invoiceRows), each with
// its tag; ✎ View opens the same receipt editor as Orders (the edit is saved for that receipt only — sql/233 —
// and Send all / Send draw it; an edited row is tagged "Edited"), with "Send to #N in Messenger",
// "I sent it by hand" and "Buyer cancelled" (the SAME invoice_sends / invoice_line_cancels as TikTok,
// platform "facebook"). The phone never sees a PSID, a comment id, a page token or Facebook's text —
// only a tag per buyer number.
// Shown by Invoicing only when fb_send_all_enabled is on or the seller is an admin; the server checks
// the same rule (+ the add-on with the plan not ended) and says "not allowed" otherwise → `fallback`
// (the Facebook tab as before).
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { mono } from "../ui";
import { tpl, useT } from "../i18n";
import { track } from "../analytics";
import type { Buyer } from "../../lib/orderTypes";
import {
  invoiceRows, pieceCount, sentTime, useInvoiceLineCancels, useInvoiceOrderIds, useInvoiceStatus, type InvoiceRow,
} from "../adapters/invoicing";
import {
  fbCounts, fbInFilter, fbJobActive, fbSendAllStart, fbSendable, fbSessionOk, fbTagOf, useFbSendAll,
  type FbFilter, type FbTag,
} from "../adapters/fbSendAll";
import { FB_EDIT_SAVE_MS, clearReceiptEditFailed, persistReceiptEdit, rereadReceiptEdits, useReceiptEdits, type SavedReceiptEdit } from "../adapters/fbReceiptEdit";
import { editToState, fbPictureInput, originalState, sameEdit, shownLineIds, stateToEdit, type EditorState, type PictureLabels } from "../adapters/fbReceiptEditState";
import { loadReceiptSettings } from "../adapters/receiptSettings";
import { useReceiptPicture } from "../adapters/useReceiptPicture";
import ReceiptEditorFields from "./ReceiptEditorFields";

const card: CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "13px 14px", boxShadow: "var(--shadow)" };
const bigBtn: CSSProperties = { display: "block", boxSizing: "border-box", width: "100%", minHeight: 52, padding: "14px 12px", borderRadius: 14, border: "none", background: "var(--accent)", color: "var(--accent-text)", fontSize: 15, fontWeight: 800, textAlign: "center", lineHeight: 1.3, cursor: "pointer", fontFamily: "var(--font-ui)", overflowWrap: "anywhere" };
const chipBtn = (on: boolean): CSSProperties => ({ minHeight: 44, padding: "0 13px", borderRadius: 999, border: on ? "1.5px solid var(--accent)" : "1px solid var(--border-strong)", background: on ? "var(--accent-soft)" : "var(--surface)", color: on ? "var(--accent-fg)" : "var(--text-dim)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)", whiteSpace: "nowrap" });
const sheetBtn: CSSProperties = { display: "block", boxSizing: "border-box", width: "100%", marginTop: 10, minHeight: 48, padding: "12px 10px", borderRadius: 12, fontSize: 14, fontWeight: 800, textAlign: "center", cursor: "pointer", fontFamily: "var(--font-ui)", lineHeight: 1.3 };
const WARN_BG = "rgba(217,119,6,.16)";
const TAG_LOOK: Record<FbTag, CSSProperties> = {
  not_sent: { background: "var(--chip-bg)", color: "var(--text-dim)", boxShadow: "inset 0 0 0 1px var(--border)" },
  sending: { background: "var(--accent-soft)", color: "var(--accent-fg)" },
  sent: { background: "rgba(5,150,105,.14)", color: "var(--ok)" },
  by_hand: { background: "rgba(5,150,105,.14)", color: "var(--ok)" },
  other_app: { background: WARN_BG, color: "var(--warn)" },
  cant_message: { background: WARN_BG, color: "var(--warn)" },
  unknown: { background: WARN_BG, color: "var(--warn)" },
  cancelled: { background: "var(--chip-bg)", color: "var(--text-muted)", boxShadow: "inset 0 0 0 1px var(--border)" },
};
const portalRoot = () => (typeof document !== "undefined" && document.querySelector("[data-redesign]")) || document.body;

export default function FbSendAllTab({ picker, pastBanner, isPast, sessionKey, sessionId, buyers, fee, money, lang, cur, buyersState, fallback }: {
  /** the session picker (Invoicing's — the same list as the TikTok tab) */
  picker: ReactNode;
  /** a past session: its amber line; null = the running session */
  pastBanner: ReactNode; isPast: boolean;
  /** the saved-status key of this session (= its session id) and the session id the server reads */
  sessionKey: string; sessionId: string | null;
  buyers: Buyer[]; fee: string; money: (n: number) => string;
  /** the picture's language and currency (the app's) — the preview and the job use the same */
  lang: string; cur: string;
  buyersState: "idle" | "loading" | "ready" | "error";
  /** the Facebook tab as before (the server says Send all is not open for this seller) */
  fallback: ReactNode;
}) {
  const t = useT();
  const okSession = fbSessionOk(sessionId);
  const st = useFbSendAll(okSession ? sessionId : null, true);
  const status = useInvoiceStatus(sessionKey, "facebook", true);
  const cancels = useInvoiceLineCancels(sessionKey, "facebook", true);
  const orderIds = useInvoiceOrderIds(buyers, "facebook", sessionId, true);
  const edits = useReceiptEdits(okSession ? sessionId : null);   // the saved receipt edits (sql/233)
  const rows = useMemo(() => invoiceRows(buyers, "facebook", fee, { ids: orderIds.ids, cancelled: cancels.cancelled }), [buyers, fee, orderIds.ids, cancels.cancelled]);
  const [filter, setFilter] = useState<FbFilter>("all");
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [howOpen, setHowOpen] = useState(false);
  const [starting, setStarting] = useState<null | "all" | number>(null);
  const [startErr, setStartErr] = useState(false);

  const data = st.data;
  const job = data?.job ?? null;
  const active = fbJobActive(job);
  const tagOf = (r: InvoiceRow): FbTag => fbTagOf(data?.buyers.get(r.num), status.saved.get(r.id));
  const tags = rows.map(tagOf);
  const counts = fbCounts(tags);
  const sum = rows.reduce((s, r, i) => s + (tags[i] === "cancelled" ? 0 : r.total), 0);

  // a receipt edit still on its way / not saved: Send all and that buyer's Send wait (never the old receipt)
  // (only buyers Send all would still send count: a buyer already sent / sent by hand / cancelled never holds it)
  const sendableNums = new Set(rows.filter((_r, i) => fbSendable(tags[i])).map((r) => r.num));
  const editsSaving = edits.saving.filter((n) => sendableNums.has(n));
  const editsFailed = edits.failed.filter((n) => sendableNums.has(n));
  const editsBusy = editsSaving.length > 0;
  const editHold = (n?: number) => (n === undefined ? editsBusy || editsFailed.length > 0 : editsSaving.includes(n) || editsFailed.includes(n));
  // a receipt edit still on its way (its sheet may be closed): the browser asks before the page reloads
  const anySaving = edits.saving.length > 0;
  useEffect(() => {
    if (!anySaving) return;
    const stay = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", stay);
    return () => window.removeEventListener("beforeunload", stay);
  }, [anySaving]);
  // fromSheet: the buyer's own sheet saved (or checked) the receipt just before — it is the one on screen
  const start = (buyerNumber?: number, fromSheet = false) => {
    if (!okSession || starting !== null || active || (!fromSheet && editHold(buyerNumber))) return;
    setStarting(buyerNumber ?? "all");
    setStartErr(false);
    void fbSendAllStart(sessionId!, { buyerNumber, lang, currency: cur }).then((r) => {
      setStarting(null);
      if (!r.ok) { setStartErr(true); return; }
      track("invoice_send", { platform: "facebook", via: buyerNumber ? "one" : "all" });
      st.reload();
    });
  };

  const tagText = (tag: FbTag, r: InvoiceRow): string =>
    tag === "sending" ? t.rd_ivc_t_sending
    : tag === "sent" ? tpl(t.rd_ivc_t_sent, { time: sentTime(data?.buyers.get(r.num)?.at) }).trim()
    : tag === "by_hand" ? t.rd_ivc_fb_t_hand
    : tag === "other_app" ? t.rd_ivc_fb_t_other
    : tag === "cant_message" || tag === "unknown" ? t.rd_ivc_t_skip
    : tag === "cancelled" ? t.rd_ivc_t_cancelled
    : t.rd_ivc_f_not;
  const piecesText = (n: number) => (n === 1 ? t.rd_ivc_pcs_1 : tpl(t.rd_ivc_pcs, { n }));

  if (okSession && st.state === "ready" && data && (!data.access || !data.allowed)) return <>{fallback}</>;

  const loading = buyersState === "loading" || buyersState === "idle" || (okSession && st.state === "loading") || status.state === "loading" || cancels.state === "loading" || (okSession && edits.state === "loading");
  const loadErr = buyersState === "error" || (okSession && st.state === "error") || status.state === "error" || cancels.state === "error" || (okSession && edits.state === "error");
  const retry = () => { st.reload(); status.reload(); cancels.reload(); edits.reload(); };
  const sheetRow = sheetId ? rows.find((r) => r.id === sheetId) ?? null : null;
  const shown = rows.filter((_r, i) => fbInFilter(tags[i], filter));
  const stopText = job && !active && (job.stop === "needs_messaging" || data?.needsMessaging) ? t.rd_rs_needs_messaging
    : job && !active && (job.stop === "not_allowed" || job.stop === "no_access") ? t.rd_ivc_fb_stopped : "";

  return (
    <div data-testid="ivc-fb" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {picker}
      {/* no session id: a real old session (it has Facebook buyers) can't be sent from here; a session with
          no Facebook buyer yet just says so */}
      {!okSession && rows.length > 0 && (
        <div data-testid="ivc-fb-old" style={{ ...card, fontSize: 13.5, color: "var(--text-dim)", lineHeight: 1.45 }}>{t.rd_ivc_fb_old}</div>
      )}
      {!okSession && rows.length === 0 && (
        <div data-testid="ivc-fb-empty" style={{ ...card, fontSize: 13.5, color: "var(--text-dim)", lineHeight: 1.45 }}>{isPast ? t.rd_ivc_fb_empty_past : t.rd_ivc_fb_empty}</div>
      )}
      {okSession && loading && !loadErr && (
        <div data-testid="ivc-fb-loading" style={{ ...card, fontSize: 13, color: "var(--text-muted)" }}>{t.rd_loading}</div>
      )}
      {okSession && loadErr && (
        <div role="alert" data-testid="ivc-fb-error" style={{ ...card, borderColor: "var(--danger)" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)", lineHeight: 1.4 }}>{t.rd_ivc_load_failed}</div>
          <button type="button" data-testid="ivc-fb-retry" onClick={retry} style={{ ...chipBtn(true), marginTop: 10 }}>{t.rd_fb_try_again}</button>
        </div>
      )}
      {okSession && !loading && !loadErr && rows.length === 0 && (
        <div data-testid="ivc-fb-empty" style={{ ...card, fontSize: 13.5, color: "var(--text-dim)", lineHeight: 1.45 }}>{isPast ? t.rd_ivc_fb_empty_past : t.rd_ivc_fb_empty}</div>
      )}
      {okSession && !loading && !loadErr && rows.length > 0 && (<>
        <div style={card} data-testid="ivc-fb-summary">
          {pastBanner}
          <div data-testid="ivc-fb-summary-line" style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)", lineHeight: 1.4, overflowWrap: "anywhere" }}>
            {tpl(t.rd_ivc_fb_summary, { n: counts.active, sum: money(sum) })}
          </div>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={counts.active} aria-valuenow={counts.sent} data-testid="ivc-fb-progress"
            style={{ marginTop: 10, height: 8, borderRadius: 999, background: "var(--chip-bg)", overflow: "hidden" }}>
            <div style={{ width: `${counts.active ? Math.round((counts.sent / counts.active) * 100) : 0}%`, height: "100%", borderRadius: 999, background: "var(--ok)" }} />
          </div>
          <div data-testid="ivc-fb-progress-text" style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>{tpl(t.rd_ivc_progress, { x: counts.sent, n: counts.active })}</div>
        </div>

        {(stopText || data?.needsMessaging) && (
          <div role="alert" data-testid="ivc-fb-stop" style={{ ...card, borderColor: "var(--warn)", fontSize: 13, fontWeight: 700, color: "var(--warn)", lineHeight: 1.45 }}>{stopText || t.rd_rs_needs_messaging}</div>
        )}

        <div data-testid="ivc-fb-action">
          {active ? (
            <button type="button" data-testid="ivc-fb-sending" disabled style={{ ...bigBtn, background: "var(--accent-soft)", color: "var(--accent-fg)", cursor: "default" }}>
              {tpl(t.rd_ivc_fb_sending_all, { x: (job?.sent ?? 0) + (job?.skipped ?? 0) + (job?.failed ?? 0), n: job?.total || counts.left })}
            </button>
          ) : counts.left > 0 ? (
            <button type="button" data-testid="ivc-fb-send-all" disabled={starting !== null || !!data?.needsMessaging || editHold()} onClick={() => start()}
              style={{ ...bigBtn, opacity: starting !== null || data?.needsMessaging || editHold() ? 0.65 : 1 }}>
              {tpl(t.rd_ivc_fb_send_all, { k: counts.left })}
            </button>
          ) : (
            <div data-testid="ivc-fb-finished" style={{ ...card, fontSize: 13.5, fontWeight: 700, color: counts.sent === counts.active ? "var(--ok)" : "var(--text-dim)" }}>
              {counts.sent === counts.active ? `✓ ${t.rd_ivc_all_done}` : t.rd_ivc_none_left}
            </div>
          )}
          <div data-testid="ivc-fb-hint" style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45 }}>{t.rd_ivc_fb_all_hint}</div>
          {editsBusy && <div role="status" data-testid="ivc-fb-edits-saving" style={{ marginTop: 8, fontSize: 12.5, fontWeight: 700, color: "var(--text-muted)", lineHeight: 1.4 }}>{t.rd_ivc_fb_wait_save}</div>}
          {!editsBusy && editsFailed.length > 0 && <div role="alert" data-testid="ivc-fb-edits-failed" style={{ marginTop: 8, fontSize: 12.5, fontWeight: 700, color: "var(--danger)", lineHeight: 1.45, overflowWrap: "anywhere" }}>{tpl(t.rd_ivc_fb_unsaved_n, { n: editsFailed.map((n) => `#${n}`).join(", ") })}</div>}
          {startErr && <div role="alert" data-testid="ivc-fb-start-error" style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: "var(--danger)", lineHeight: 1.4 }}>{t.rd_ivc_fb_start_failed}</div>}
        </div>

        {counts.otherApp > 0 && (
          <div data-testid="ivc-fb-other-note" style={{ ...card, borderColor: "#f59e0b", background: "#fef3c7", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: "#92400e", lineHeight: 1.45 }}>{t.rd_ivc_fb_other_note}</span>
            <button type="button" data-testid="ivc-fb-how" onClick={() => setHowOpen(true)}
              style={{ flexShrink: 0, minHeight: 44, padding: "0 14px", borderRadius: 999, border: "1.5px solid #b45309", background: "#fff", color: "#92400e", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_ivc_fb_how}</button>
          </div>
        )}

        {status.unsaved + cancels.unsaved > 0 && (
          <div role="alert" data-testid="ivc-fb-unsaved" style={{ ...card, borderColor: "var(--warn)", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: "var(--warn)", lineHeight: 1.4 }}>{tpl(t.rd_ivc_unsaved, { n: status.unsaved + cancels.unsaved })}</span>
            <button type="button" data-testid="ivc-fb-unsaved-retry" onClick={() => { status.retry(); cancels.retry(); }} style={{ ...chipBtn(true), flexShrink: 0 }}>{t.rd_fb_try_again}</button>
          </div>
        )}

        <div data-testid="ivc-fb-filters" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {([["all", t.rd_min_all, counts.all], ["not_sent", t.rd_ivc_f_not, counts.notSent], ["sent", t.rd_ivc_f_sent, counts.sent]] as const).map(([id, text, n]) => (
            <button key={id} type="button" data-testid={`ivc-fb-filter-${id}`} aria-pressed={filter === id} onClick={() => setFilter(id)} style={chipBtn(filter === id)}>{text} · {n}</button>
          ))}
        </div>

        <div data-testid="ivc-fb-list" style={{ ...card, padding: 0, overflow: "hidden" }}>
          {shown.length === 0 && <div data-testid="ivc-fb-empty-filter" style={{ padding: "14px", fontSize: 13, color: "var(--text-muted)" }}>{t.rd_ivc_empty_filter}</div>}
          {shown.map((r, i) => {
            const tag = tagOf(r);
            const off = tag === "cancelled";
            const canSend = fbSendable(tag) && !active && !data?.needsMessaging && !editHold(r.num);
            return (
              <div key={r.id} data-testid="ivc-fb-row" data-buyer={r.num} data-tag={tag} onClick={() => setSheetId(r.id)}
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", boxSizing: "border-box", minHeight: 56, padding: "9px 12px", borderTop: i ? "1px solid var(--border)" : "none", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 600, color: "var(--text)", minWidth: 38, flexShrink: 0, opacity: off ? 0.5 : 1 }}>#{r.num}</span>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4, opacity: off ? 0.6 : 1 }}>
                  <span data-testid="ivc-fb-row-name" style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.receipt.name || r.receipt.handle}</span>
                  <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 6, rowGap: 2, minWidth: 0 }}>
                    <span data-testid="ivc-fb-row-tag" style={{ maxWidth: "100%", fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 999, lineHeight: 1.35, ...TAG_LOOK[tag] }}>{tagText(tag, r)}</span>
                    {!off && <span data-testid="ivc-fb-row-pcs" style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)", whiteSpace: "nowrap", lineHeight: 1.35 }}>· {piecesText(pieceCount(r))}</span>}
                    {(() => {
                      const e = edits.edits.get(r.num);
                      if (!e) return null;
                      const stale = !!e.basedOn && e.basedOn !== r.hash;
                      return <span data-testid="ivc-fb-row-edited" data-stale={stale ? "1" : "0"} style={{ fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 999, lineHeight: 1.35, whiteSpace: "nowrap", ...(stale ? { background: WARN_BG, color: "var(--warn)" } : { background: "var(--accent-soft)", color: "var(--accent-fg)" }) }}>✎ {stale ? t.rd_ivc_fb_edited_new : t.rd_ivc_fb_edited}</span>;
                    })()}
                  </span>
                </span>
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, flexShrink: 0 }}>
                  <span data-testid="ivc-fb-row-total" style={{ fontFamily: mono, fontSize: 13.5, fontWeight: 600, color: off ? "var(--text-muted)" : "var(--text)", whiteSpace: "nowrap", textDecoration: off ? "line-through" : "none" }}>{money(r.total)}</span>
                  <span style={{ display: "flex", gap: 6 }}>
                    <button type="button" data-testid="ivc-fb-row-view" className="sfl-tap44" aria-label={`${t.rd_ivc_view} #${r.num}`} onClick={(e) => { e.stopPropagation(); setSheetId(r.id); }}
                      style={{ display: "inline-flex", alignItems: "center", gap: 4, minHeight: 30, padding: "0 10px", borderRadius: 999, border: "1.5px solid var(--accent)", background: "transparent", color: "var(--accent-fg)", fontSize: 12, fontWeight: 800, whiteSpace: "nowrap", cursor: "pointer", fontFamily: "var(--font-ui)", lineHeight: 1 }}>
                      <span aria-hidden="true">✎</span>{t.rd_ivc_view}
                    </button>
                    {canSend && (
                      <button type="button" data-testid="ivc-fb-row-send" className="sfl-tap44" aria-label={tpl(t.rd_ivc_fb_view_send, { n: r.num })} disabled={starting !== null}
                        onClick={(e) => { e.stopPropagation(); start(r.num); }}
                        style={{ display: "inline-flex", alignItems: "center", minHeight: 30, padding: "0 10px", borderRadius: 999, border: "none", background: "var(--accent)", color: "var(--accent-text)", fontSize: 12, fontWeight: 800, whiteSpace: "nowrap", cursor: "pointer", fontFamily: "var(--font-ui)", lineHeight: 1, opacity: starting !== null ? 0.6 : 1 }}>
                        {t.rd_ivc_fb_send}
                      </button>
                    )}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </>)}

      {sheetRow && okSession && (
        <FbViewSheet key={sheetRow.id} row={sheetRow} tag={tagOf(sheetRow)} sessionId={sessionId!} cur={cur} fee={fee}
          saved={edits.edits.get(sheetRow.num) ?? null} lastFailed={edits.failed.includes(sheetRow.num)} pending={edits.saving.includes(sheetRow.num)}
          canSend={fbSendable(tagOf(sheetRow)) && !active && !data?.needsMessaging} sending={starting === sheetRow.num || tagOf(sheetRow) === "sending"}
          onClose={() => setSheetId(null)}
          onSend={() => start(sheetRow.num, true)}
          onByHand={() => { status.mark(sheetRow, "sent"); track("invoice_send", { platform: "facebook", via: "hand" }); setSheetId(null); }}
          onCancelBuyer={() => { const prev = status.saved.get(sheetRow.id); status.mark(sheetRow, "cancelled", prev?.hash ?? sheetRow.hash); track("invoice_cancel", { platform: "facebook" }); setSheetId(null); }}
          onUndoCancel={() => { const prev = status.saved.get(sheetRow.id); if (prev?.status === "cancelled" && prev.sentAt) status.mark(sheetRow, "sent", prev.hash); else status.clear(sheetRow); }} />
      )}
      {howOpen && <FbHowSheet onClose={() => setHowOpen(false)} />}
    </div>
  );
}

// ✎ View: the SAME receipt editor as Orders (components/ReceiptEditorFields.tsx) — opening, items, shipping fee,
// note, the payment QR and the live picture. The picture's input is built with the same shared functions the
// server's Send all draws with (adapters/fbReceiptEditState.ts → src/lib/receiptEdit.js), so this is the picture
// the buyer gets. A change is saved for THIS receipt only (sql/233 fb_receipt_edits): a moment after the last
// change, or at once with Save; "✓ Saved" and "Edited" only after the server said yes. Closing with a change not
// saved asks Save / Discard (in the sheet). A save keeps going if the sheet closes some other way
// (adapters/fbReceiptEdit.ts persistReceiptEdit) and the list waits for it before sending. Back exactly to the
// orders = the saved edit goes. "Reset to original" removes it. Orders, Sales, stickers and the saved receipt
// format are never touched.
type SaveState = "idle" | "saving" | "saved" | "failed";
const FAILED_TAGS: readonly FbTag[] = ["other_app", "cant_message", "unknown"];
function FbViewSheet({ row, tag, sessionId, cur, fee, saved, lastFailed, pending, canSend, sending, onClose, onSend, onByHand, onCancelBuyer, onUndoCancel }: {
  row: InvoiceRow; tag: FbTag; sessionId: string; cur: string; fee: string;
  /** this buyer's saved edit (null = none) */
  saved: SavedReceiptEdit | null;
  /** an earlier save of this receipt (from a sheet already closed) failed */
  lastFailed: boolean;
  /** an earlier save of this receipt is still on its way: the editor waits for it before it starts */
  pending: boolean;
  canSend: boolean; sending: boolean;
  onClose: () => void; onSend: () => void; onByHand: () => void; onCancelBuyer: () => void; onUndoCancel: () => void;
}) {
  const t = useT();
  // the saved receipt format (opening / note / QR) — the editor starts from it when there is no saved edit
  const [fmt, setFmt] = useState<{ state: "loading" | "ready" | "error"; opening: string; note: string; qrImage: string | null }>({ state: "loading", opening: "", note: "", qrImage: null });
  const [fmtTurn, setFmtTurn] = useState(0);
  useEffect(() => {
    let alive = true;
    void loadReceiptSettings().then((r) => {
      if (!alive) return;
      setFmt(r.ok ? { state: "ready", opening: r.settings.opening, note: r.settings.note, qrImage: r.settings.qrImage } : { state: "error", opening: "", note: "", qrImage: null });
    }).catch(() => { if (alive) setFmt({ state: "error", opening: "", note: "", qrImage: null }); });
    return () => { alive = false; };
  }, [fmtTurn]);
  const original = useMemo(() => (fmt.state === "ready" ? originalState(row.receipt, row.cancelled, fmt, fee) : null), [fmt, row.receipt, row.cancelled, fee]);
  const [es, setEs] = useState<EditorState | null>(null);
  // what the server has for this receipt now (the saved edit, else the orders) — "not saved" = es differs from it
  const [savedAs, setSavedAs] = useState<EditorState | null>(null);
  // starts only once no earlier save of this receipt is on its way (else it would start from the old receipt and
  // the next change would put the old receipt back over the saved edit)
  if (!es && original && !pending) { const first = saved ? editToState(saved.edit) : original; setEs(first); setSavedAs(first); }
  const savedAsRef = useRef<EditorState | null>(null);
  useEffect(() => { savedAsRef.current = savedAs; }, [savedAs]);
  const nextLineId = useRef(1000);
  const focusLineId = useRef<number | null>(null);

  // ── saving ──
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const latest = useRef<EditorState | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flight = useRef<Promise<boolean> | null>(null);
  const saveNow = useCallback(async (): Promise<boolean> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (flight.current) await flight.current;
    if (!dirty.current || !latest.current || !original) return true;
    const state = latest.current;
    dirty.current = false;
    setSaveState("saving");
    const same = sameEdit(state, original);
    const p = persistReceiptEdit(sessionId, row.num, same ? null : stateToEdit(state), row.hash).then((ok) => {
      if (ok) setSavedAs(state); else dirty.current = true;
      setSaveState(ok ? "saved" : "failed");
      return ok;
    });
    flight.current = p;
    try { return await p; } finally { flight.current = null; }
  }, [original, sessionId, row.num, row.hash]);
  const change = (next: EditorState) => {
    setEs(next);
    latest.current = next;
    dirty.current = true;
    setSaveState("idle");
    setAskClose(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void saveNow(); }, FB_EDIT_SAVE_MS);
  };
  const unsaved = !!es && !!savedAs && !sameEdit(es, savedAs);
  const busy = saveState === "saving";
  // the sheet going away some other way (the list drawn again, another tab) saves what is left
  const saveRef = useRef(saveNow);
  useEffect(() => { saveRef.current = saveNow; }, [saveNow]);
  useEffect(() => () => { if (dirty.current) void saveRef.current(); }, []);
  // the page reloading / closing with a change not saved yet: the browser asks first
  useEffect(() => {
    if (!unsaved && !busy) return;
    const stay = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", stay);
    return () => window.removeEventListener("beforeunload", stay);
  }, [unsaved, busy]);

  // ── closing: a change not saved → Save / Discard ──
  const [askClose, setAskClose] = useState(false);
  const [closing, setClosing] = useState(false);
  const leave = () => { clearReceiptEditFailed(sessionId, row.num); onClose(); };
  const requestClose = async () => {
    if (closing) return;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (flight.current) {             // a save on its way: wait for its answer first
      setClosing(true);
      await flight.current;
      setClosing(false);
    }
    // ask only when what is on screen really differs from what the server has (typed back = nothing to save)
    const now = latest.current;
    const differs = !!now && !!savedAsRef.current && !sameEdit(now, savedAsRef.current);
    if (dirty.current && differs) { setAskClose(true); return; }
    if (dirty.current && !differs) dirty.current = false;
    leave();
  };
  const closeSave = async () => { if (await saveNow()) leave(); };
  const closeDiscard = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    dirty.current = false; latest.current = null;
    if (saveState === "failed") rereadReceiptEdits(sessionId, row.num);   // a failed save may still have landed: show the truth
    leave();
  };

  // ── reset ──
  const [askReset, setAskReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetFailed, setResetFailed] = useState(false);
  const doReset = async () => {
    if (!original || resetting) return;
    setResetting(true); setResetFailed(false);
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (flight.current) await flight.current;
    const ok = await persistReceiptEdit(sessionId, row.num, null, row.hash);
    setResetting(false);
    if (!ok) { setResetFailed(true); return; }                          // the question stays: tap Reset again
    dirty.current = false; latest.current = null;
    setEs(original); setSavedAs(original); setAskReset(false); setSaveState("idle");
  };

  const send = async () => { if (await saveNow()) { clearReceiptEditFailed(sessionId, row.num); onSend(); } };
  // by hand / cancelled: that receipt is not sent from here any more → no need to wait for the save (it keeps going)
  const thenDo = (f: () => void) => () => { void saveNow(); f(); };

  const labels: PictureLabels = { total: t.rd_rc_pic_total, toBeConfirmed: t.rd_rc_pic_tbc, more: t.rd_rc_pic_more, shipping: t.rd_rc_pic_shipping, howToPay: t.rd_rc_pic_howto, scanToPay: t.rd_rc_pic_scan };
  const input = es ? fbPictureInput(es, { receipt: row.receipt, qrImage: fmt.qrImage, cur, labels }) : null;
  const picture = useReceiptPicture(input);
  const shown = es ? shownLineIds(es) : new Set<number>();
  const shownIndex = new Map(es ? es.lines.filter((l) => shown.has(l.id)).map((l, i) => [l.id, i + 1] as [number, number]) : []);
  const noLines = !!es && shown.size === 0;
  const edited = !!saved;
  const stale = !!saved && !!saved.basedOn && saved.basedOn !== row.hash;

  const cancelled = tag === "cancelled";
  const done = tag === "sent" || tag === "by_hand";
  const sendFailed = FAILED_TAGS.includes(tag);
  // the Save button: Save (a change not saved) · Saving… · ✓ Saved (the server said yes) · Save (nothing to save, off)
  const saveLabel = busy || closing ? t.rd_fb_saving : saveState === "saved" && !unsaved ? `✓ ${t.rd_fb_saved}` : t.rd_rc_save;
  const canSave = !!es && !busy && !closing && (unsaved || saveState === "failed");
  return createPortal(
    <div onClick={() => void requestClose()} data-testid="ivc-fb-sheet-overlay" style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.5)", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`#${row.num}`} data-testid="ivc-fb-sheet"
        style={{ background: "var(--surface-2)", borderTopLeftRadius: 20, borderTopRightRadius: 20, width: "100%", maxWidth: 560, margin: "0 auto", boxSizing: "border-box", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 -14px 40px rgba(0,0,0,.35)" }}>
        <div data-testid="ivc-fb-sheet-scroll" style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "10px 14px 6px" }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: "var(--border-strong)", margin: "0 auto 12px" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span data-testid="ivc-fb-sheet-title" style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 800, color: "var(--text)", overflowWrap: "anywhere" }}><b style={{ fontFamily: "var(--font-mono)" }}>#{row.num}</b> {row.receipt.name || row.receipt.handle}</span>
            <button type="button" data-testid="ivc-fb-sheet-close" onClick={() => void requestClose()} style={{ flexShrink: 0, minHeight: 44, padding: "0 8px", border: "none", background: "transparent", color: "var(--accent-fg)", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_rc_close}</button>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "2px 0 4px", lineHeight: 1.4 }}>{t.rd_ivc_fb_view_note}</div>
          <div data-testid="ivc-fb-edit-hint" style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>{t.rd_ivc_fb_edit_hint}</div>
          {edited && (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 8 }}>
              <span data-testid="ivc-fb-sheet-edited" style={{ fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 999, background: "var(--accent-soft)", color: "var(--accent-fg)" }}>{t.rd_ivc_fb_edited}</span>
            </div>
          )}
          {lastFailed && saveState !== "saved" && <div role="alert" data-testid="ivc-fb-last-unsaved" style={{ marginTop: 8, padding: "9px 11px", borderRadius: 10, background: WARN_BG, color: "var(--warn)", fontSize: 12.5, fontWeight: 700, lineHeight: 1.45 }}>{t.rd_ivc_fb_last_unsaved}</div>}
          {stale && <div data-testid="ivc-fb-edit-stale" style={{ marginTop: 8, padding: "9px 11px", borderRadius: 10, background: WARN_BG, color: "var(--warn)", fontSize: 12.5, fontWeight: 700, lineHeight: 1.45 }}>{t.rd_ivc_fb_edit_new_note}</div>}

          {pending && !es && fmt.state !== "error" && <div role="status" data-testid="ivc-fb-edit-waiting" style={{ marginTop: 12, fontSize: 13, color: "var(--text-muted)" }}>{t.rd_fb_saving}</div>}
          {fmt.state === "loading" && !es && !pending && <div data-testid="ivc-fb-edit-loading" style={{ marginTop: 12, fontSize: 13, color: "var(--text-muted)" }}>{t.rd_loading}</div>}
          {fmt.state === "error" && !es && (
            <div role="alert" data-testid="ivc-fb-edit-error" style={{ marginTop: 12, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)" }}>{t.rd_ivc_load_failed}</span>
              <button type="button" data-testid="ivc-fb-edit-retry" onClick={() => { setFmt({ state: "loading", opening: "", note: "", qrImage: null }); setFmtTurn((n) => n + 1); }} style={chipBtn(true)}>{t.rd_fb_try_again}</button>
            </div>
          )}
          {es && (
            <div data-testid="ivc-fb-editor" style={{ opacity: cancelled ? 0.6 : 1 }}>
              <ReceiptEditorFields cur={cur} opening={es.opening} onOpening={(v) => change({ ...es, opening: v })}
                lines={es.lines} shownIndex={shownIndex} focusLineId={focusLineId}
                onLine={(id, patch) => change({ ...es, lines: es.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) })}
                onRemoveLine={(id) => change({ ...es, lines: es.lines.filter((l) => l.id !== id) })}
                onAddLine={() => { const id = nextLineId.current++; focusLineId.current = id; change({ ...es, lines: [...es.lines, { id, item: "", price: "" }] }); }}
                shipping={es.shipping} onShipping={(v) => change({ ...es, shipping: v })}
                note={es.note} onNote={(v) => change({ ...es, note: v })}
                qrImage={fmt.qrImage} formatLoaded={fmt.state !== "loading"} picture={picture} />
              {(edited || !!(original && !sameEdit(es, original))) && (askReset ? (
                <div data-testid="ivc-fb-reset-ask" style={{ marginTop: 12, padding: "10px 12px", border: "1px solid var(--border-strong)", borderRadius: 12, background: "var(--surface)" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", lineHeight: 1.45, marginBottom: 8 }}>{t.rd_ivc_fb_reset_q}</div>
                  {resetFailed && <div role="alert" data-testid="ivc-fb-reset-failed" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--danger)", lineHeight: 1.45, marginBottom: 8 }}>{t.rd_fb_save_failed}</div>}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" data-testid="ivc-fb-reset-no" onClick={() => { setAskReset(false); setResetFailed(false); }} style={{ flex: 1, minHeight: 44, borderRadius: 10, border: "1px solid var(--border-strong)", background: "var(--surface-2)", color: "var(--text)", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_ivc_fb_reset_no}</button>
                    <button type="button" data-testid="ivc-fb-reset-yes" disabled={resetting} onClick={() => void doReset()} style={{ flex: 1, minHeight: 44, borderRadius: 10, border: "none", background: "var(--accent)", color: "var(--accent-text)", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "var(--font-ui)", opacity: resetting ? 0.6 : 1 }}>{t.rd_ivc_fb_reset_yes}</button>
                  </div>
                </div>
              ) : (
                <button type="button" data-testid="ivc-fb-reset" onClick={() => setAskReset(true)}
                  style={{ display: "block", marginTop: 12, minHeight: 44, padding: "0 14px", border: "1px solid var(--border-strong)", borderRadius: 10, background: "var(--surface)", color: "var(--text-dim)", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" }}>↺ {t.rd_ivc_fb_reset}</button>
              ))}
            </div>
          )}
        </div>
        <div style={{ flex: "0 0 auto", padding: "0 14px calc(18px + env(safe-area-inset-bottom))" }}>
          {askClose ? (
            <div data-testid="ivc-fb-close-ask" style={{ marginTop: 10, padding: "12px", border: "1px solid var(--border-strong)", borderRadius: 12, background: "var(--surface)" }}>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: "var(--text)", lineHeight: 1.45 }}>{t.rd_ivc_fb_save_q}</div>
              {saveState === "failed" && <div role="alert" data-testid="ivc-fb-save-failed" style={{ marginTop: 6, fontSize: 12.5, fontWeight: 700, color: "var(--danger)", lineHeight: 1.45 }}>{t.rd_ivc_fb_save_err}</div>}
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button type="button" data-testid="ivc-fb-close-discard" disabled={busy} onClick={closeDiscard} style={{ flex: 1, minHeight: 46, borderRadius: 10, border: "1px solid var(--border-strong)", background: "var(--surface-2)", color: "var(--text)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_ivc_fb_discard}</button>
                <button type="button" data-testid="ivc-fb-close-save" disabled={busy} onClick={() => void closeSave()} style={{ flex: 1, minHeight: 46, borderRadius: 10, border: "none", background: "var(--accent)", color: "var(--accent-text)", fontSize: 13.5, fontWeight: 800, cursor: "pointer", fontFamily: "var(--font-ui)", opacity: busy ? 0.6 : 1 }}>{busy ? t.rd_fb_saving : t.rd_rc_save}</button>
              </div>
            </div>
          ) : (<>
            {es && (
              <button type="button" data-testid="ivc-fb-save" disabled={!canSave} onClick={() => void saveNow()} aria-live="polite"
                style={{ ...sheetBtn, border: canSave ? "1.5px solid var(--accent)" : "1px solid var(--border)", background: "var(--surface)", color: saveState === "saved" && !unsaved ? "var(--ok)" : canSave ? "var(--accent-fg)" : "var(--text-muted)", cursor: canSave ? "pointer" : "default" }}>{saveLabel}</button>
            )}
            {saveState === "failed" && <div role="alert" data-testid="ivc-fb-save-failed" style={{ marginTop: 8, fontSize: 12.5, fontWeight: 700, color: "var(--danger)", lineHeight: 1.45 }}>{t.rd_ivc_fb_save_err}</div>}
            {cancelled ? (<>
              <div data-testid="ivc-fb-cancelled-note" style={{ marginTop: 10, padding: "10px 12px", borderRadius: 12, background: "var(--chip-bg)", color: "var(--text-dim)", fontSize: 13, fontWeight: 700, lineHeight: 1.45 }}>{t.rd_ivc_cancelled_note}</div>
              <button type="button" data-testid="ivc-fb-undo-cancel" onClick={onUndoCancel} style={{ ...sheetBtn, border: "1.5px solid var(--accent)", background: "var(--surface)", color: "var(--accent-fg)" }}>{t.rd_ivc_undo_cancel}</button>
            </>) : (<>
              {sending && !done && <div role="status" data-testid="ivc-fb-sheet-sending" style={{ ...sheetBtn, background: "var(--accent-soft)", color: "var(--accent-fg)", cursor: "default" }}>{t.rd_ivc_t_sending}</div>}
              {!sending && canSend && noLines && <div data-testid="ivc-fb-no-lines" style={{ marginTop: 10, fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.45 }}>{t.rd_rs_no_lines}</div>}
              {!sending && canSend && !noLines && (
                <button type="button" data-testid="ivc-fb-sheet-send" disabled={!es || busy || closing} onClick={() => void send()} style={{ ...sheetBtn, border: "none", background: "var(--accent)", color: "var(--accent-text)", opacity: !es || busy || closing ? 0.6 : 1 }}>{tpl(t.rd_ivc_fb_view_send, { n: row.num })}</button>
              )}
              {!done && sendFailed && (<>
                <div data-testid="ivc-fb-hand-note" style={{ marginTop: 10, fontSize: 12.5, fontWeight: 700, color: "var(--warn)", lineHeight: 1.45 }}>{t.rd_ivc_fb_hand_note}</div>
                <button type="button" data-testid="ivc-fb-sheet-hand" disabled={busy || closing} onClick={thenDo(onByHand)} style={{ ...sheetBtn, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)" }}>{t.rd_ivc_by_hand}</button>
              </>)}
              <button type="button" data-testid="ivc-fb-sheet-cancel" disabled={busy || closing} onClick={thenDo(onCancelBuyer)} style={{ ...sheetBtn, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text-dim)" }}>{t.rd_ivc_cancel_buyer}</button>
            </>)}
          </>)}
        </div>
      </div>
    </div>,
    portalRoot(),
  );
}

// "How": the help guide's own steps for an "Other chat app" refusal (the guide's invoicing section says the same).
function FbHowSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  return createPortal(
    <div onClick={onClose} data-testid="ivc-fb-how-overlay" style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.5)", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center" }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t.rd_ivc_fb_how_title} data-testid="ivc-fb-how-sheet"
        style={{ width: "100%", maxWidth: 520, boxSizing: "border-box", maxHeight: "88vh", overflowY: "auto", background: "var(--surface-2)", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: "16px 16px calc(18px + env(safe-area-inset-bottom))", boxShadow: "0 -14px 40px rgba(0,0,0,.35)" }}>
        <div data-testid="ivc-fb-how-title" style={{ fontSize: 15.5, fontWeight: 800, color: "var(--text)", lineHeight: 1.4 }}>{t.rd_ivc_fb_how_title}</div>
        <div data-testid="ivc-fb-how-steps" style={{ marginTop: 10, fontSize: 13.5, color: "var(--text)", lineHeight: 1.55, whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{t.rd_ivc_fb_how_steps}</div>
        <button type="button" data-testid="ivc-fb-how-close" onClick={onClose} style={{ ...sheetBtn, marginTop: 14, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)" }}>{t.rd_rc_close}</button>
      </div>
    </div>,
    portalRoot(),
  );
}
