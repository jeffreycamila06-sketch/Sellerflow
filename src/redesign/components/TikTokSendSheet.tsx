// "Send to TikTok" sheet (admin-only preview). Copy a ready message, open the buyer's TikTok
// profile (the SAME chaseTarget rule as Pickup Status Chase), then Message → Paste → Send in
// TikTok. Every edit here is message-only and is discarded on close — nothing is written to
// orders, live_session_orders, products or Sales. Only the note is remembered (per seller).
// The Message box is EDITABLE (buyers abroad don't read Tagalog — the seller writes their
// own): it auto-rebuilds from items / total / note until the seller types in it; from then on
// it is theirs, with "↺ Reset message" to go back to the auto text (and auto-updates). Every
// buyer opens fresh in auto mode (the sheet is keyed per buyer).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { hasCents, moneyText } from "../../lib/money";
import { createPortal } from "react-dom";
import { useT, tpl } from "../i18n";
import { chaseTarget } from "../adapters/parcelTracking";
import { isIOS } from "../adapters/platform";
import { copyText } from "./inviteShare";
import { selectAll } from "../adapters/buttonFeedback";
import {
  initialSendLines, messageTotal, buildSendMessage, loadSendNote, saveSendNote, qtySuffix, priceInput, type SendLine,
} from "../adapters/tiktokSend";
import type { BuyerReceipt } from "../adapters/useReadData";

const label: CSSProperties = { display: "block", fontSize: 11, fontWeight: 800, letterSpacing: ".06em", color: "var(--text-muted)", margin: "12px 2px 6px" };
const input: CSSProperties = { boxSizing: "border-box", padding: "9px 10px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)", fontSize: 14, fontFamily: "var(--font-ui)" };
const smallBtn: CSSProperties = { width: 40, height: 40, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--border-strong)", borderRadius: 10, background: "var(--surface)", color: "var(--text-muted)", fontSize: 18, lineHeight: 1, cursor: "pointer", fontFamily: "var(--font-ui)" };
const bigBtn: CSSProperties = { display: "block", boxSizing: "border-box", width: "100%", marginTop: 10, padding: "12px 0", borderRadius: 12, fontSize: 14, fontWeight: 800, textAlign: "center", textDecoration: "none", cursor: "pointer", fontFamily: "var(--font-ui)" };

// INVOICING (Settings → Invoicing, 2026-11-26) opens this same sheet for one buyer of its list. Only
// with `invoice` (Orders never passes it — the sheet there is exactly as before):
//   • the note and the shipping fee start from the seller's invoice format (the remembered note of
//     Send to TikTok is neither read nor written);
//   • the main button reads Send / Send again and tells the caller when the message was really copied
//     (onSent = that buyer is "Sent"); a copy that failed selects the message so it can be copied by hand;
//   • one more button: "Can't message" (onSkip).
//   • onCopyFailed tells the caller that the main button's copy was refused (that buyer is NOT sent);
//   • onSentByHand (only while that buyer is Copy failed / Sending…) shows a small "I sent it by hand" link:
//     the caller marks the buyer Sent and closes the sheet;
//   • pastRange shows the "Past session" line WITHOUT the "OLD session … Send anyway?" question — in
//     Invoicing the seller picked that session on purpose. (Orders passes the sheet's own pastRange prop
//     and keeps its question.)
//   • lineIds / cancelledLines / onCancelLine: the × of a line that has its order id SAVES "cancelled"
//     (struck through + Undo; left out of the message and the total). A line without an id yet keeps
//     today's × (this message only). The last remaining line asks "Cancel the whole buyer?".
//   • onCancelBuyer / buyerCancelled / onUndoCancel: "Buyer cancelled", and its Undo.
export interface SendSheetInvoice {
  note: string; shipping: string; sent: boolean; onSent: () => void; onSkip: () => void; onCopyFailed?: () => void; pastRange?: string; onSentByHand?: () => void;
  /** per line of the receipt: the order's database id (null = not paired yet) */
  lineIds?: readonly (number | null)[];
  cancelledLines?: ReadonlySet<number>;
  onCancelLine?: (orderId: number, on: boolean) => void;
  buyerCancelled?: boolean;
  onCancelBuyer?: () => void;
  onUndoCancel?: () => void;
}

// pastRange (e.g. "10/08 → 10/10"): the card is from a PAST session → the header says so and
// the first copy asks one confirm ("This is an OLD session … Send anyway?").
export default function TikTokSendSheet({ receipt, cur, date, sellerId, onClose, pastRange, invoice }: {
  receipt: BuyerReceipt; cur: string; date: string; sellerId: string; onClose: () => void; pastRange?: string; invoice?: SendSheetInvoice;
}) {
  const t = useT();
  const [lines, setLines] = useState<SendLine[]>(() => initialSendLines(receipt.lines));
  const [shipping, setShipping] = useState(invoice?.shipping ?? ""); // EMPTY every open (per customer) — never remembered, unlike the note (Invoicing: the format's fee)
  const [totalOverride, setTotalOverride] = useState<string | null>(null);
  const [note, setNote] = useState(() => (invoice ? invoice.note : loadSendNote(sellerId)));
  const previewRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState<string | null>(null); // null = auto mode (rebuilt from the fields); a string = the seller's own text
  const [status, setStatus] = useState("");
  const [oldOk, setOldOk] = useState(!pastRange); // past session: copy buttons only after one confirm
  const nextId = useRef(0);
  const ios = isIOS();
  const target = chaseTarget(receipt.handle);

  // Invoicing: a line whose order is cancelled stays in the list (struck through, Undo) but is left out
  // of the message and of the total. `lines` keeps every line; keys "c<i>" = the i-th line of the receipt.
  const orderIdOf = (l: SendLine): number | null => (l.added ? null : invoice?.lineIds?.[Number(l.key.slice(1))] ?? null);
  const isCut = (l: SendLine): boolean => { const id = orderIdOf(l); return id !== null && !!invoice?.cancelledLines?.has(id); };
  const kept = lines.filter((l) => !isCut(l));
  const [askWhole, setAskWhole] = useState(false);
  const sum = messageTotal(kept, null, shipping); // items + shipping fee
  const total = messageTotal(kept, totalOverride, shipping);
  const autoMessage = buildSendMessage({
    name: receipt.name, date, lines: kept, total, cur, note, shippingFee: shipping,
    labels: { hi: t.rd_tts_msg_hi, order: t.rd_tts_msg_order, total: t.rd_tts_msg_total, shipping: t.rd_tts_msg_shipping },
  });
  const message = draft ?? autoMessage; // what the box shows = exactly what Copy copies

  const setLine = (key: string, patch: Partial<SendLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  // Any change to the items' money (a price, a removed line, an added line) drops the Total
  // override → the total is the sum again. Typing an added line's TEXT keeps it.
  const setPrice = (key: string, price: string) => { setTotalOverride(null); setLine(key, { price }); };
  const removeLine = (key: string) => { setTotalOverride(null); setLines((ls) => ls.filter((l) => l.key !== key)); };
  // × on a line: an order with its id → saved "cancelled" (Invoicing); the last line left asks first.
  const onX = (l: SendLine) => {
    const id = orderIdOf(l);
    if (id === null || !invoice?.onCancelLine) { removeLine(l.key); return; }
    const left = lines.filter((x) => !x.added && !isCut(x)).length;
    if (left <= 1 && invoice.onCancelBuyer) { setAskWhole(true); return; }
    setTotalOverride(null);
    invoice.onCancelLine(id, true);
  };
  const addLine = () => { setTotalOverride(null); const key = `a${nextId.current++}`; setLines((ls) => [...ls, { key, text: "", price: "", added: true, qty: 1 }]); };
  // Changing the shipping fee drops a Total override too (same as changing a price).
  const setShip = (v: string) => { setTotalOverride(null); setShipping(priceInput(v, cur)); };

  const copy = async (): Promise<boolean> => {
    if (!invoice) saveSendNote(sellerId, note);
    return copyText(message);
  };
  // Invoicing: the main button's copy. Copied → the caller marks the buyer Sent; not copied → the message
  // is selected in its box (the seller copies it by hand) and nothing is marked.
  const onInvoiceSend = (okText: string) => {
    void copy().then((ok) => {
      if (ok) { setStatus(okText); invoice?.onSent(); return; }
      setStatus(t.rd_tts_copy_failed);
      invoice?.onCopyFailed?.();
      const box = previewRef.current;
      if (box) { try { box.scrollIntoView({ block: "center" }); } catch { /* not laid out */ } box.focus(); selectAll(box); }
    });
  };
  // Copy, then the anchor's own navigation opens the profile (a real <a> tap — the only open
  // that works inside the iOS app). On iOS the clipboard keeps the MESSAGE (no @handle copy).
  const onCopyOpen = () => { void copy().then((ok) => setStatus(ok ? t.rd_tts_copied_open : t.rd_tts_copy_failed)); };
  const onCopyOnly = (lang: "only" | "find") => {
    void copy().then((ok) => setStatus(!ok ? t.rd_tts_copy_failed : lang === "find" ? t.rd_tts_copy_find : t.rd_tts_copied));
  };

  const node = (
    <div onClick={onClose} data-testid="tts-overlay" style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.5)", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t.rd_tts_title} data-testid="tts-sheet"
        style={{ background: "var(--surface-2)", borderTopLeftRadius: 20, borderTopRightRadius: 20, width: "100%", maxWidth: 560, margin: "0 auto", boxSizing: "border-box", maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 -14px 40px rgba(0,0,0,.35)" }}>
        <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "10px 14px 6px" }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: "var(--border-strong)", margin: "0 auto 12px" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>{t.rd_tts_title}</span>
            <button type="button" data-testid="tts-close" onClick={onClose} style={{ marginLeft: "auto", border: "none", background: "transparent", color: "var(--accent-fg)", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_rc_close}</button>
          </div>
          {(pastRange || invoice?.pastRange) && (
            <div data-testid="tts-past" style={{ marginTop: 6, fontSize: 12, fontWeight: 800, color: "#92400e", background: "#fef3c7", borderRadius: 8, padding: "4px 9px", display: "inline-block" }}>
              {tpl(t.rd_tts_past, { range: pastRange || invoice?.pastRange || "" })}
            </div>
          )}
          <div data-testid="tts-header" style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 4 }}>
            <b style={{ fontFamily: "var(--font-mono)" }}>#{receipt.num}</b> {receipt.name} <span style={{ color: "var(--handle)" }}>{receipt.handle}</span>
          </div>
          {ios && target.kind !== "none" && (
            <div data-testid="tts-handle-big" style={{ marginTop: 8, fontSize: 22, fontWeight: 800, color: "var(--text)", userSelect: "text", WebkitUserSelect: "text", overflowWrap: "anywhere" }}>@{target.handle}</div>
          )}
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", margin: "4px 2px 0" }}>{t.rd_tts_hint}</div>

          <span style={label}>{t.rd_rc_lines}</span>
          {lines.map((l, i) => isCut(l) ? (
            <div key={l.key} data-testid="tts-line-cancelled" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, minHeight: 44, padding: "0 4px", borderRadius: 10, background: "var(--chip-bg)" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)", width: 24, textAlign: "right", flexShrink: 0 }}>{i + 1}.</span>
              <span data-testid="tts-cut-text" style={{ flex: 1, minWidth: 0, fontSize: 14, color: "var(--text-muted)", textDecoration: "line-through", overflowWrap: "anywhere" }}>{l.orig ?? l.text}{qtySuffix(l.qty)}</span>
              <span data-testid="tts-cut-price" style={{ flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-muted)", textDecoration: "line-through" }}>{l.free ? t.rd_cpp_free : l.price}</span>
              <button type="button" data-testid="tts-line-undo" onClick={() => { const id = orderIdOf(l); if (id !== null) { setTotalOverride(null); invoice?.onCancelLine?.(id, false); } }}
                style={{ flexShrink: 0, minHeight: 44, padding: "0 10px", border: "none", background: "transparent", color: "var(--accent-fg)", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_ivc_undo}</button>
            </div>
          ) : (
            <div key={l.key} data-testid={l.added ? "tts-line-added" : "tts-line"} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, minHeight: 40, padding: l.added ? 4 : 0, borderRadius: 10, background: l.added ? "var(--accent-soft)" : "transparent" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)", width: 24, textAlign: "right", flexShrink: 0 }}>{i + 1}.</span>
              {l.added
                ? <input data-testid="tts-text" aria-label={t.rd_rc_item_ph} placeholder={t.rd_rc_item_ph} value={l.text} onChange={(e) => setLine(l.key, { text: e.target.value })} style={{ ...input, flex: 1, minWidth: 0 }} />
                : <>
                  <GrowText value={l.text} placeholder={l.orig} label={t.rd_rc_item_ph} onChange={(text) => setLine(l.key, { text })} />
                  {l.qty > 1 && <span data-testid="tts-qty" style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)" }}>{qtySuffix(l.qty).trim()}</span>}
                </>}
              <input data-testid="tts-price" aria-label={t.rd_rc_price_ph} inputMode={hasCents(cur) ? "decimal" : "numeric"} value={l.price} onChange={(e) => setPrice(l.key, priceInput(e.target.value, cur))} style={{ ...input, width: 96, textAlign: "right" }} />
              <button type="button" data-testid="tts-remove" aria-label={t.rd_rs_remove_line} title={t.rd_rs_remove_line} onClick={() => onX(l)} style={smallBtn}>×</button>
            </div>
          ))}
          <button type="button" data-testid="tts-add" onClick={addLine}
            style={{ marginTop: 2, minHeight: 40, padding: "0 14px", border: "1px dashed var(--border-strong)", borderRadius: 10, background: "transparent", color: "var(--accent-fg)", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" }}>
            + {t.rd_tts_add}
          </button>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-start" }}>
            <div>
              <span style={label}>{t.rd_tts_shipping}</span>
              <input data-testid="tts-shipping" aria-label={t.rd_tts_shipping} inputMode={hasCents(cur) ? "decimal" : "numeric"}
                value={shipping} placeholder={t.rd_tts_shipping_ph} onChange={(e) => setShip(e.target.value)}
                style={{ ...input, display: "block", width: 140, textAlign: "right" }} />
            </div>
            <div>
              <span style={label}>{t.rd_ord_receipt_total}{totalOverride !== null && totalOverride.trim() !== "" && <span data-testid="tts-edited" style={{ marginLeft: 6, fontWeight: 600, letterSpacing: 0, color: "var(--warn)" }}>{t.rd_tts_edited}</span>}</span>
              <input data-testid="tts-total" inputMode={hasCents(cur) ? "decimal" : "numeric"} value={totalOverride ?? moneyText(sum)}
                onChange={(e) => setTotalOverride(priceInput(e.target.value, cur))} style={{ ...input, display: "block", width: 140, textAlign: "right" }} />
            </div>
          </div>

          <span style={label}>{t.rd_tts_note}</span>
          <textarea data-testid="tts-note" value={note} maxLength={500} placeholder={t.rd_tts_note_ph} onChange={(e) => setNote(e.target.value)} style={{ ...input, width: "100%", minHeight: 64, resize: "vertical" }} />

          <span style={{ ...label, display: "flex", alignItems: "center" }}>
            {t.rd_tts_preview}
            {draft !== null && (
              <button type="button" data-testid="tts-reset" onClick={() => setDraft(null)}
                style={{ marginLeft: "auto", margin: "-10px 0 -10px auto", minHeight: 44, padding: "0 8px", border: "none", background: "transparent", color: "var(--accent-fg)", fontSize: 12, fontWeight: 700, letterSpacing: 0, cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                ↺ {t.rd_tts_reset}
              </button>
            )}
          </span>
          <GrowArea value={message} label={t.rd_tts_preview} onChange={setDraft} boxRef={previewRef} />
        </div>

        <div style={{ flex: "0 0 auto", padding: "0 14px calc(18px + env(safe-area-inset-bottom))" }}>
          {!oldOk ? (
            <div data-testid="tts-old-confirm" style={{ marginTop: 10, padding: "10px 12px", borderRadius: 12, background: "#fef3c7", color: "#92400e", fontSize: 13, fontWeight: 700, lineHeight: 1.45 }}>
              {tpl(t.rd_tts_old_confirm, { range: pastRange || "" })}
              <button type="button" data-testid="tts-old-yes" onClick={() => setOldOk(true)}
                style={{ ...bigBtn, border: "none", background: "#b45309", color: "#fff" }}>{t.rd_tts_old_yes}</button>
            </div>
          ) : invoice && invoice.buyerCancelled ? (<>
          <div data-testid="tts-cancelled-note" style={{ marginTop: 10, padding: "10px 12px", borderRadius: 12, background: "var(--chip-bg)", color: "var(--text-dim)", fontSize: 13, fontWeight: 700, lineHeight: 1.45 }}>{t.rd_ivc_cancelled_note}</div>
          <button type="button" data-testid="tts-undo-cancel" onClick={() => invoice.onUndoCancel?.()}
            style={{ ...bigBtn, border: "1.5px solid var(--accent)", background: "var(--surface)", color: "var(--accent-fg)" }}>{t.rd_ivc_undo_cancel}</button>
          </>) : invoice && askWhole ? (
            <div role="alertdialog" data-testid="tts-ask-whole" style={{ marginTop: 10, padding: "10px 12px", borderRadius: 12, background: "var(--chip-bg)", color: "var(--text)", fontSize: 13.5, fontWeight: 700, lineHeight: 1.45 }}>
              {t.rd_ivc_ask_whole}
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" data-testid="tts-ask-whole-no" onClick={() => setAskWhole(false)} style={{ ...bigBtn, flex: 1, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)" }}>{t.rd_ivc_no}</button>
                <button type="button" data-testid="tts-ask-whole-yes" onClick={() => { setAskWhole(false); invoice.onCancelBuyer?.(); }} style={{ ...bigBtn, flex: 1, border: "none", background: "var(--danger)", color: "#fff" }}>{t.rd_ivc_yes_cancel_buyer}</button>
              </div>
            </div>
          ) : invoice ? (<>
          {target.kind === "open"
            ? <a href={target.url} target="_blank" rel="noreferrer" data-testid="tts-copy-open" onClick={() => onInvoiceSend(t.rd_tts_copied_open)}
                style={{ ...bigBtn, border: "none", background: "var(--accent)", color: "var(--accent-text)" }}>{invoice.sent ? t.rd_ivc_send_again : t.rd_ivc_send}</a>
            : <button type="button" data-testid="tts-copy-find" onClick={() => onInvoiceSend(t.rd_tts_copy_find)}
                style={{ ...bigBtn, border: "none", background: "var(--accent)", color: "var(--accent-text)" }}>{t.rd_tts_copy_find_btn}</button>}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" data-testid="tts-copy-only" onClick={() => onCopyOnly("only")}
              style={{ ...bigBtn, flex: 1, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)" }}>{t.rd_tts_copy_only}</button>
            <button type="button" data-testid="tts-skip" onClick={() => { invoice.onSkip(); onClose(); }}
              style={{ ...bigBtn, flex: 1, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--warn)" }}>{t.rd_ivc_skip}</button>
          </div>
          {invoice.onCancelBuyer && (
            <button type="button" data-testid="tts-cancel-buyer" onClick={() => invoice.onCancelBuyer?.()}
              style={{ ...bigBtn, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text-dim)" }}>{t.rd_ivc_cancel_buyer}</button>
          )}
          {invoice.onSentByHand && (
            <button type="button" data-testid="tts-by-hand" onClick={invoice.onSentByHand}
              style={{ display: "block", margin: "6px auto 0", minHeight: 44, padding: "0 12px", border: "none", background: "transparent", color: "var(--accent-fg)", fontSize: 13, fontWeight: 700, textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer", fontFamily: "var(--font-ui)" }}>
              {t.rd_ivc_by_hand}
            </button>
          )}
          </>) : (<>
          {target.kind === "open"
            ? <a href={target.url} target="_blank" rel="noreferrer" data-testid="tts-copy-open" onClick={onCopyOpen}
                style={{ ...bigBtn, border: "none", background: "var(--accent)", color: "var(--accent-text)" }}>{t.rd_tts_copy_open}</a>
            : <button type="button" data-testid="tts-copy-find" onClick={() => onCopyOnly("find")}
                style={{ ...bigBtn, border: "none", background: "var(--accent)", color: "var(--accent-text)" }}>{t.rd_tts_copy_find_btn}</button>}
          <button type="button" data-testid="tts-copy-only" onClick={() => onCopyOnly("only")}
            style={{ ...bigBtn, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)" }}>{t.rd_tts_copy_only}</button>
          </>)}
          {status && <div role="status" data-testid="tts-status" style={{ marginTop: 10, fontSize: 13, fontWeight: 700, color: "var(--ok)", lineHeight: 1.45 }}>{status}</div>}
        </div>
      </div>
    </div>
  );
  return createPortal(node, (typeof document !== "undefined" && document.querySelector("[data-redesign]")) || document.body);
}

// A textarea that grows down with its text (no scrollbar): height = content on every value
// change, re-measured when the width settles after the sheet lays out (and on rotate).
function useGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string) {
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`; // + the 1px top/bottom border
  }, [ref]); // the ref object is stable — listed because it is a hook parameter
  useLayoutEffect(fit, [fit, value]);
  useEffect(() => {
    if (typeof ResizeObserver === "undefined" || !ref.current) return;
    let w = 0;
    const ro = new ResizeObserver(([e]) => { if (e.contentRect.width !== w) { w = e.contentRect.width; fit(); } });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [fit, ref]);
}

// The whole message: multi-line, grows with the text, same look as the other fields.
function GrowArea({ value, label: aria, onChange, boxRef }: { value: string; label: string; onChange: (v: string) => void; boxRef?: RefObject<HTMLTextAreaElement | null> }) {
  const own = useRef<HTMLTextAreaElement>(null);
  const ref = boxRef ?? own;
  useGrow(ref, value);
  return (
    <textarea ref={ref} data-testid="tts-preview" aria-label={aria} rows={3} value={value} onChange={(e) => onChange(e.target.value)}
      style={{ ...input, width: "100%", resize: "none", overflow: "hidden", fontSize: 13, lineHeight: 1.45, overflowWrap: "anywhere" }} />
  );
}

// Order line text: one line that grows down with the text (no scrollbar). Enter adds no new
// line (the message is one line per item) — except while an IME (zh / th keyboard) is composing,
// where Enter picks the word; pasted line breaks become spaces.
function GrowText({ value, placeholder, label: aria, onChange }: { value: string; placeholder?: string; label: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useGrow(ref, value);
  return (
    <textarea ref={ref} data-testid="tts-text-order" aria-label={aria} rows={1} value={value} placeholder={placeholder}
      onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) e.preventDefault(); }}
      onChange={(e) => onChange(e.target.value.replace(/[\r\n]+/g, " "))}
      style={{ ...input, flex: 1, minWidth: 0, resize: "none", overflow: "hidden", lineHeight: 1.35, overflowWrap: "anywhere" }} />
  );
}
