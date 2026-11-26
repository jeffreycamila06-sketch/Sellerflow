// Invoicing → Format (ONE format for every platform). The payment note is the SAME note the Receipt
// format screen edits (seller_receipt_settings.note); the shipping fee is the invoices' own
// (invoice_shipping_fee, sql/220). Save writes only those two — the Messenger receipt's opening text
// and QR picture are never sent from here. "Message type" is shown, not changeable yet.
import { useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";
import { hasCents } from "../../lib/money";
import SaveButton from "./SaveButton";
import { NOTE_MAX } from "../adapters/receiptSettings";
import { feeInput, saveInvoiceFormat, type InvoiceFormat } from "../adapters/invoicing";

const label: CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 700, color: "var(--text)", margin: "14px 2px 6px" };
const field: CSSProperties = { boxSizing: "border-box", width: "100%", border: "1px solid var(--border-strong)", borderRadius: 10, background: "var(--surface)", color: "var(--text)", padding: "9px 11px", fontSize: 14, fontFamily: "var(--font-ui)" };
const hint: CSSProperties = { fontSize: 11.5, color: "var(--text-muted)", margin: "5px 2px 0", lineHeight: 1.4 };

export default function InvoiceFormatSheet({ cur, format, sharedWithReceipt = false, onSaved, onClose }: {
  cur: string; format: InvoiceFormat;
  /** the seller also has the Messenger receipt → say that the note is shared */
  sharedWithReceipt?: boolean;
  onSaved: (f: InvoiceFormat) => void; onClose: () => void;
}) {
  const t = useT();
  const [note, setNote] = useState(format.note);
  const [fee, setFee] = useState(format.fee);
  const [savedAs, setSavedAs] = useState(format);
  const dirty = note !== savedAs.note || fee.trim() !== savedAs.fee.trim();
  const save = async () => {
    const next = { note: note.slice(0, NOTE_MAX), fee: fee.trim() };
    const ok = await saveInvoiceFormat(next);
    if (ok) { setSavedAs(next); onSaved(next); }
    return ok;
  };
  const node = (
    <div onClick={onClose} data-testid="ivc-format-overlay" style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.5)", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t.rd_ivc_fmt_title} data-testid="ivc-format-sheet"
        style={{ background: "var(--surface-2)", borderTopLeftRadius: 20, borderTopRightRadius: 20, width: "100%", maxWidth: 560, margin: "0 auto", boxSizing: "border-box", maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 -14px 40px rgba(0,0,0,.35)" }}>
        <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "10px 14px 6px" }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: "var(--border-strong)", margin: "0 auto 12px" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>{t.rd_ivc_fmt_title}</span>
            <button type="button" data-testid="ivc-format-close" onClick={onClose}
              style={{ marginLeft: "auto", minHeight: 44, padding: "0 4px 0 12px", border: "none", background: "transparent", color: "var(--accent-fg)", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_close}</button>
          </div>

          <label style={label} htmlFor="ivc-format-note">{t.rd_ivc_fmt_note}</label>
          <textarea id="ivc-format-note" data-testid="ivc-format-note" value={note} maxLength={NOTE_MAX} placeholder={t.rd_ivc_fmt_note_ph}
            onChange={(e) => setNote(e.target.value)} style={{ ...field, minHeight: 92, resize: "vertical", lineHeight: 1.45 }} />
          <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
            {sharedWithReceipt && <div data-testid="ivc-format-shared" style={{ ...hint, flex: 1, minWidth: 0 }}>{t.rd_ivc_fmt_shared}</div>}
            <div style={{ ...hint, marginLeft: "auto", flexShrink: 0 }}>{note.length}/{NOTE_MAX}</div>
          </div>

          <label style={label} htmlFor="ivc-format-fee">{t.rd_ivc_fmt_fee}</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-dim)" }}>{cur}</span>
            <input id="ivc-format-fee" data-testid="ivc-format-fee" inputMode={hasCents(cur) ? "decimal" : "numeric"} value={fee} placeholder={t.rd_tts_shipping_ph}
              onChange={(e) => setFee(feeInput(e.target.value, cur))} style={{ ...field, width: 150, textAlign: "right" }} />
          </div>
          <div style={hint}>{t.rd_ivc_fmt_fee_hint}</div>

          <div data-testid="ivc-format-type" aria-disabled="true"
            style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 8, padding: "12px 12px", borderRadius: 12, border: "1px dashed var(--border-strong)", background: "var(--surface)", opacity: 0.7 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{t.rd_ivc_fmt_type}</span>
            <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, color: "var(--text)", textAlign: "right" }}>
              {t.rd_ivc_fmt_type_text} <span style={{ fontWeight: 600, color: "var(--text-muted)" }}>({t.rd_ivc_fmt_type_soon})</span>
            </span>
          </div>
        </div>
        <div style={{ flex: "0 0 auto", padding: "10px 14px calc(18px + env(safe-area-inset-bottom))" }}>
          <SaveButton label={t.rd_rc_save} onSave={save} dirty={dirty} t={t} testid="ivc-format-save"
            style={{ display: "block", width: "100%", boxSizing: "border-box", minHeight: 46, padding: "12px 0", borderRadius: 12, border: "none", background: "var(--accent)", color: "var(--accent-text)", fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "var(--font-ui)" }} />
        </div>
      </div>
    </div>
  );
  return createPortal(node, (typeof document !== "undefined" && document.querySelector("[data-redesign]")) || document.body);
}
