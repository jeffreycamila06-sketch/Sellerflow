// Invoicing → Format on the TikTok / Instagram / Shopee tabs (the text invoice). The payment note is the SAME
// note the Facebook receipt uses (seller_receipt_settings.note); the shipping fee is the one Invoicing fee
// (invoice_shipping_fee, sql/220) — also on the Facebook receipts sent from Invoicing. Save writes only those two —
// the Messenger receipt's opening text and QR picture are never sent from here.
import { useState } from "react";
import { useT } from "../i18n";
import { hasCents } from "../../lib/money";
import SaveButton from "./SaveButton";
import FormatSheetFrame from "./FormatSheetFrame";
import { fsField as field, fsHint as hint, fsLabel as label, fsSaveStyle } from "./formatSheetStyle";
import { NOTE_MAX } from "../adapters/receiptSettings";
import { feeInput, saveInvoiceFormat, type InvoiceFormat } from "../adapters/invoicing";

export default function InvoiceFormatSheet({ cur, format, sharedWithReceipt = false, title, onSaved, onClose }: {
  cur: string; format: InvoiceFormat;
  /** the seller also has the Facebook receipt → say that the note is on it too */
  sharedWithReceipt?: boolean;
  /** default "Invoice format" */
  title?: string;
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
  return (
    <FormatSheetFrame title={title ?? t.rd_ivc_fmt_title} testid="ivc-format" onClose={onClose}
      footer={<SaveButton label={t.rd_rc_save} onSave={save} dirty={dirty} t={t} testid="ivc-format-save" style={fsSaveStyle} />}>
      <label style={label} htmlFor="ivc-format-note">{t.rd_ivc_fmt_note}</label>
      <textarea id="ivc-format-note" data-testid="ivc-format-note" value={note} maxLength={NOTE_MAX} placeholder={t.rd_ivc_fmt_note_ph}
        onChange={(e) => setNote(e.target.value)} style={{ ...field, minHeight: 92, resize: "vertical", lineHeight: 1.45 }} />
      <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
        {sharedWithReceipt && <div data-testid="ivc-format-shared" style={{ ...hint, flex: 1, minWidth: 0 }}>{t.rd_ivc_fmt_shared_fb}</div>}
        <div style={{ ...hint, marginLeft: "auto", flexShrink: 0 }}>{note.length}/{NOTE_MAX}</div>
      </div>

      <label style={label} htmlFor="ivc-format-fee">{t.rd_ivc_fmt_fee}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-dim)" }}>{cur}</span>
        <input id="ivc-format-fee" data-testid="ivc-format-fee" inputMode={hasCents(cur) ? "decimal" : "numeric"} value={fee} placeholder={t.rd_tts_shipping_ph}
          onChange={(e) => setFee(feeInput(e.target.value, cur))} style={{ ...field, width: 150, textAlign: "right" }} />
      </div>
      <div style={{ ...hint, marginBottom: 6 }}>{t.rd_ivc_fmt_fee_hint}</div>
    </FormatSheetFrame>
  );
}
