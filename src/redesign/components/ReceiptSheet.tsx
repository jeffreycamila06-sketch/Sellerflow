// MESSENGER RECEIPT step 1 — the Orders receipt sheet (Facebook buyers, FB preview accounts
// only). Editable lines + opening + note for THIS receipt, and the rendered picture. Edits
// live only in this component's state: nothing writes orders, buyers, stickers or the saved
// settings. Close only — no Send in this step.
import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";
import { loadReceiptSettings } from "../adapters/receiptSettings";
import { useReceiptPicture } from "../adapters/useReceiptPicture";
import type { BuyerReceipt } from "../adapters/useReadData";

const input: CSSProperties = { boxSizing: "border-box", border: "1px solid var(--border-strong)", borderRadius: 9, background: "var(--surface)", color: "var(--text)", padding: "7px 9px", fontSize: 14, fontFamily: "var(--font-ui)" };
const label: CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, color: "var(--text-muted)", margin: "10px 2px 5px" };

export default function ReceiptSheet({ receipt, cur, onClose }: { receipt: BuyerReceipt; cur: string; onClose: () => void }) {
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

  const picture = useReceiptPicture({
    opening, note, qrImage, currency: cur, buyerNum: receipt.num, buyerName: receipt.name,
    lines: lines.map((l) => ({ item: l.item, total: Number(l.price) > 0 ? Number(l.price) : 0 })),
    labels: { total: t.rd_rc_pic_total, toBeConfirmed: t.rd_rc_pic_tbc },
  });

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
      </div>
    </div>
  );
  return createPortal(node, (typeof document !== "undefined" && document.querySelector("[data-redesign]")) || document.body);
}
