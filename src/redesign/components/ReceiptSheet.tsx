// MESSENGER RECEIPT step 1 — the Orders receipt sheet (Facebook buyers, FB preview accounts
// only). Editable lines + opening + note for THIS receipt, and the rendered picture. Edits
// live only in this component's state: nothing writes orders, buyers, stickers or the saved
// settings.
// Step 2 — Send (fb_receipt_access accounts; the server decides via /fb/receipt/info): a FRESH
// PNG is rendered from the sheet's current state on tap and posted; single-flight. The
// server picks the comment and the page; this sheet never sends ids.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useT, tpl } from "../i18n";
import { loadReceiptSettings } from "../adapters/receiptSettings";
import { useReceiptPicture } from "../adapters/useReceiptPicture";
import { renderReceiptPng, type ReceiptInput } from "../adapters/receiptImage";
import { fbReceiptInfo, fbReceiptSend, blobToBase64, RECEIPT_CLIENT_MAX_BYTES, type FbReceiptInfo } from "../adapters/fbReceipt";
import type { BuyerReceipt } from "../adapters/useReadData";

type SendNote = "needs_messaging" | "unknown" | "failed" | "too_big" | "info_failed";
const timeOf = (iso: string | null) => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
};

const input: CSSProperties = { boxSizing: "border-box", border: "1px solid var(--border-strong)", borderRadius: 9, background: "var(--surface)", color: "var(--text)", padding: "7px 9px", fontSize: 14, fontFamily: "var(--font-ui)" };
const label: CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, color: "var(--text-muted)", margin: "10px 2px 5px" };

export default function ReceiptSheet({ receipt, cur, onClose, sessionId = null, onSent }: {
  receipt: BuyerReceipt; cur: string; onClose: () => void;
  sessionId?: string | null;              // the current session (sql/20); no id → no Send (step-1 behaviour)
  onSent?: (sentCount: number) => void;   // lets the Orders box show "Receipt sent ✓"
}) {
  const t = useT();
  const [lines, setLines] = useState(() => receipt.lines.map((l) => ({ item: l.item, price: String(l.total) })));
  const [opening, setOpening] = useState("");
  const [note, setNote] = useState("");
  const [qrImage, setQrImage] = useState<string | null>(null);

  // Prefill opening / note / QR from the saved settings (read-only here).
  useEffect(() => {
    let alive = true;
    void loadReceiptSettings().then((r) => {
      if (!alive || !r.ok) return;
      setOpening(r.settings.opening); setNote(r.settings.note); setQrImage(r.settings.qrImage);
    });
    return () => { alive = false; };
  }, []);

  const pictureInput: ReceiptInput = {
    opening, note, qrImage, currency: cur, buyerNum: receipt.num, buyerName: receipt.name,
    lines: lines.map((l) => ({ item: l.item, total: Number(l.price) > 0 ? Number(l.price) : 0 })),
    labels: { total: t.rd_rc_pic_total, toBeConfirmed: t.rd_rc_pic_tbc },
  };
  const picture = useReceiptPicture(pictureInput);

  // ── Send (step 2) ──
  const [info, setInfo] = useState<FbReceiptInfo | null>(null);
  const [sending, setSending] = useState(false);
  const [sendNote, setSendNote] = useState<SendNote | null>(null);
  const sendingRef = useRef(false);
  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    void fbReceiptInfo(sessionId, receipt.num).then((r) => {
      if (!alive) return;
      if (r.ok) { setInfo(r); if (r.reason === "needs_messaging") setSendNote("needs_messaging"); }
      else setSendNote("info_failed");
    });
    return () => { alive = false; };
  }, [sessionId, receipt.num]);

  const send = async () => {
    if (!sessionId || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setSendNote(null);
    try {
      const blob = await renderReceiptPng(pictureInput);           // fresh render, not the preview URL
      if (blob.size > RECEIPT_CLIENT_MAX_BYTES) { setSendNote("too_big"); return; }
      const r = await fbReceiptSend(sessionId, receipt.num, await blobToBase64(blob));
      if (r.ok) {
        setInfo((i) => ({ ...(i || { ok: true, canSend: true, sentCount: 0, lastSentAt: null, remaining: 0 }), canSend: r.remaining > 0, sentCount: r.sentCount, remaining: r.remaining, lastSentAt: r.lastSentAt || new Date().toISOString(), reason: r.remaining > 0 ? undefined : "none_left" }));
        onSent?.(r.sentCount);
        return;
      }
      const err = "error" in r ? r.error : "";
      if (err === "needs_messaging" || err === "needs_reauth") {
        setInfo((i) => (i ? { ...i, canSend: false, reason: "needs_messaging" } : i));
        setSendNote("needs_messaging");
      } else if (err === "none_left") {
        setInfo((i) => (i ? { ...i, canSend: false, remaining: 0, reason: "none_left" } : i));
      } else if (err === "unknown_result") {
        setSendNote("unknown");
        const again = await fbReceiptInfo(sessionId, receipt.num);   // that comment is now used up
        if (again.ok) setInfo(again);
      } else {
        setSendNote("failed");
      }
    } catch {
      setSendNote("failed");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };
  const showSend = !!info && info.canSend && info.remaining > 0;
  const noneLeft = !!info && (info.reason === "none_left" || (info.sentCount > 0 && info.remaining === 0));
  const noteText: Record<SendNote, string> = {
    needs_messaging: t.rd_rs_needs_messaging, unknown: t.rd_rs_unknown, failed: t.rd_rs_failed,
    too_big: t.rd_rs_too_big, info_failed: t.rd_rs_info_failed,
  };

  const setLine = (i: number, patch: Partial<{ item: string; price: string }>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const node = (
    <div onClick={onClose} data-testid="receipt-sheet-overlay" style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.5)", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t.rd_rc_button} data-testid="receipt-sheet"
        style={{ background: "var(--surface-2)", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: "10px 14px calc(18px + env(safe-area-inset-bottom))", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 -14px 40px rgba(0,0,0,.35)" }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: "var(--border-strong)", margin: "0 auto 12px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>{t.rd_rc_button}</span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>#{receipt.num} {receipt.name}</span>
          <button type="button" data-testid="receipt-sheet-close" onClick={onClose} style={{ marginLeft: "auto", border: "none", background: "transparent", color: "var(--accent-fg)", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_rc_close}</button>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", margin: "4px 2px 0" }}>{t.rd_rc_sheet_hint}</div>

        <span style={label}>{t.rd_rc_opening}</span>
        <textarea data-testid="rs-opening" value={opening} maxLength={300} onChange={(e) => setOpening(e.target.value)} style={{ ...input, width: "100%", minHeight: 56, resize: "vertical" }} />

        <span style={label}>{t.rd_rc_lines}</span>
        {lines.map((l, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)", width: 24, textAlign: "right", flexShrink: 0 }}>{i + 1}.</span>
            <input data-testid="rs-item" aria-label={t.rd_rc_item_ph} placeholder={t.rd_rc_item_ph} value={l.item} onChange={(e) => setLine(i, { item: e.target.value })} style={{ ...input, flex: 1, minWidth: 0 }} />
            <input data-testid="rs-price" aria-label={t.rd_rc_price_ph} placeholder={t.rd_rc_price_ph} inputMode="decimal" value={l.price} onChange={(e) => setLine(i, { price: e.target.value.replace(/[^0-9.]/g, "") })} style={{ ...input, width: 96, textAlign: "right" }} />
          </div>
        ))}

        <span style={label}>{t.rd_rc_note}</span>
        <textarea data-testid="rs-note" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} style={{ ...input, width: "100%", minHeight: 80, resize: "vertical" }} />

        <div style={{ marginTop: 12 }}>
          {picture.url
            ? <img src={picture.url} alt={t.rd_rc_button} data-testid="rs-picture" style={{ width: "100%", borderRadius: 10, border: "1px solid var(--border)", background: "#fff" }} />
            : picture.failed && <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{t.rd_rc_no_preview}</div>}
        </div>

        {info && info.lastSentAt && info.sentCount > 0 && (
          <div data-testid="rs-sent" style={{ marginTop: 10, fontSize: 13, fontWeight: 700, color: "var(--ok)" }}>{tpl(t.rd_rs_sent_at, { time: timeOf(info.lastSentAt) })}</div>
        )}
        {showSend && (
          <button type="button" data-testid="rs-send" disabled={sending} onClick={() => void send()}
            style={{ marginTop: 10, width: "100%", padding: "12px 0", borderRadius: 12, border: "none", background: "var(--accent)", color: "var(--accent-text)", fontSize: 14, fontWeight: 800, cursor: sending ? "default" : "pointer", opacity: sending ? 0.6 : 1, fontFamily: "var(--font-ui)" }}>
            {sending ? t.rd_rs_sending : info!.sentCount > 0 ? tpl(t.rd_rs_send_again, { n: info!.remaining }) : t.rd_rs_send}
          </button>
        )}
        {noneLeft && <div data-testid="rs-none-left" style={{ marginTop: 10, fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.45 }}>{t.rd_rs_none_left}</div>}
        {sendNote && <div role="alert" data-testid="rs-send-note" style={{ marginTop: 10, fontSize: 12.5, fontWeight: 600, color: sendNote === "needs_messaging" ? "var(--warn)" : "var(--danger)", lineHeight: 1.45 }}>{noteText[sendNote]}</div>}
      </div>
    </div>
  );
  return createPortal(node, (typeof document !== "undefined" && document.querySelector("[data-redesign]")) || document.body);
}
