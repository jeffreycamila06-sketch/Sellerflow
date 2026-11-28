// Invoicing → Facebook → Format, for a seller with the Receipt add-on: the Messenger receipt's format in the same
// sheet as the TikTok invoice format — Opening, Payment note (how to pay), Shipping fee, Payment QR picture and the
// sample. The note and the shipping fee are the SAME saved values the TikTok invoice uses (one row,
// seller_receipt_settings: note + invoice_shipping_fee); the opening text and the QR picture are the Receipt format
// screen's. The QR field and the sample are the Receipt format screen's own parts (ReceiptFormatParts).
import { useEffect, useState } from "react";
import { useT, tpl } from "../i18n";
import { hasCents } from "../../lib/money";
import SaveButton from "./SaveButton";
import FormatSheetFrame from "./FormatSheetFrame";
import { QrPictureField, SamplePicture } from "./ReceiptFormatParts";
import { fsField as field, fsHint as hint, fsLabel as label, fsSaveStyle } from "./formatSheetStyle";
import { loadReceiptSettings, NOTE_MAX, OPENING_MAX } from "../adapters/receiptSettings";
import { useReceiptPicture } from "../adapters/useReceiptPicture";
import { sampleReceiptInput } from "../adapters/receiptSample";
import { rcBtn } from "./receiptFormatStyle";
import { priceOf } from "../adapters/tiktokSend";
import { feeInput, saveFbReceiptFormat, type FbReceiptFormat, type InvoiceFormat } from "../adapters/invoicing";

export default function FbReceiptFormatSheet({ cur, format, onSaved, onClose }: {
  cur: string;
  /** the note + fee Invoicing already read (the same values as the TikTok sheet) */
  format: InvoiceFormat;
  onSaved: (f: InvoiceFormat) => void; onClose: () => void;
}) {
  const t = useT();
  // the opening text + QR picture are read when the sheet opens (fresh, like the Receipt format screen)
  const [st, setSt] = useState<"loading" | "ready" | "error">("loading");
  const [turn, setTurn] = useState(0);
  const [f, setF] = useState<FbReceiptFormat>({ opening: "", note: format.note, qrImage: null, fee: format.fee });
  const [savedAs, setSavedAs] = useState<FbReceiptFormat>(f);
  const [qrFailed, setQrFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void loadReceiptSettings().then((r) => {
      if (!alive) return;
      if (!r.ok) { setSt("error"); return; }
      const next = { opening: r.settings.opening, note: format.note, qrImage: r.settings.qrImage, fee: format.fee };
      setF(next); setSavedAs(next); setSt("ready");
    });
    return () => { alive = false; };
    // the note + fee come from the screen; only the opening + QR are read here, once per open / Try again
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn]);
  const dirty = st === "ready" && (f.opening !== savedAs.opening || f.note !== savedAs.note || f.qrImage !== savedAs.qrImage || f.fee.trim() !== savedAs.fee.trim());
  const save = async () => {
    if (st !== "ready") return false;
    const next = { ...f, opening: f.opening.slice(0, OPENING_MAX), note: f.note.slice(0, NOTE_MAX), fee: f.fee.trim() };
    const ok = await saveFbReceiptFormat(next);
    if (ok) { setSavedAs(next); onSaved({ note: next.note, fee: next.fee }); }
    return ok;
  };
  const labels = { total: t.rd_rc_pic_total, toBeConfirmed: t.rd_rc_pic_tbc, more: t.rd_rc_pic_more, shipping: t.rd_rc_pic_shipping, howToPay: t.rd_rc_pic_howto, scanToPay: t.rd_rc_pic_scan };
  const picture = useReceiptPicture(st === "ready" ? sampleReceiptInput(f, cur, t.rd_rc_sample_buyer, labels, f.fee.trim() === "" ? 0 : priceOf(f.fee)) : null);

  return (
    <FormatSheetFrame title={t.rd_ivc_fbf_title} testid="ivc-fbformat" onClose={onClose}
      footer={<SaveButton label={t.rd_rc_save} onSave={save} dirty={dirty} t={t} testid="ivc-fbformat-save" style={fsSaveStyle} />}>
      {st === "loading" && <div data-testid="ivc-fbformat-loading" style={{ ...hint, margin: "14px 2px" }}>{t.rd_loading}</div>}
      {st === "error" && (
        <div role="alert" data-testid="ivc-fbformat-error" style={{ margin: "14px 2px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)", lineHeight: 1.4 }}>{t.rd_rc_load_failed}</div>
          <button type="button" data-testid="ivc-fbformat-retry" onClick={() => { setSt("loading"); setTurn((n) => n + 1); }} style={{ ...rcBtn(false), marginTop: 10, minHeight: 44 }}>{t.rd_fb_try_again}</button>
        </div>
      )}
      {st === "ready" && (
        <>
          <label style={label} htmlFor="ivc-fbformat-opening">{t.rd_rc_opening}</label>
          <textarea id="ivc-fbformat-opening" data-testid="ivc-fbformat-opening" value={f.opening} maxLength={OPENING_MAX} placeholder={t.rd_rc_opening_ph}
            onChange={(e) => setF((x) => ({ ...x, opening: e.target.value.slice(0, OPENING_MAX) }))} style={{ ...field, minHeight: 64, resize: "vertical", lineHeight: 1.45 }} />
          <div style={{ ...hint, textAlign: "right" }}>{tpl("{n}/{max}", { n: f.opening.length, max: OPENING_MAX })}</div>

          <label style={label} htmlFor="ivc-fbformat-note">{t.rd_ivc_fmt_note}</label>
          <textarea id="ivc-fbformat-note" data-testid="ivc-fbformat-note" value={f.note} maxLength={NOTE_MAX} placeholder={t.rd_ivc_fmt_note_ph}
            onChange={(e) => setF((x) => ({ ...x, note: e.target.value.slice(0, NOTE_MAX) }))} style={{ ...field, minHeight: 92, resize: "vertical", lineHeight: 1.45 }} />
          <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
            <div data-testid="ivc-fbformat-shared" style={{ ...hint, flex: 1, minWidth: 0 }}>{t.rd_ivc_fbf_shared_tt}</div>
            <div style={{ ...hint, marginLeft: "auto", flexShrink: 0 }}>{f.note.length}/{NOTE_MAX}</div>
          </div>

          <label style={label} htmlFor="ivc-fbformat-fee">{t.rd_ivc_fmt_fee}</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-dim)" }}>{cur}</span>
            <input id="ivc-fbformat-fee" data-testid="ivc-fbformat-fee" inputMode={hasCents(cur) ? "decimal" : "numeric"} value={f.fee} placeholder={t.rd_tts_shipping_ph}
              onChange={(e) => { const v = feeInput(e.target.value, cur); setF((x) => ({ ...x, fee: v })); }} style={{ ...field, width: 150, textAlign: "right" }} />
          </div>
          <div style={hint}>{t.rd_ivc_fbf_fee_hint}</div>

          <span style={label}>{t.rd_rc_qr}</span>
          <div style={{ ...hint, margin: "0 2px 10px" }}>{t.rd_rc_qr_hint}</div>
          <QrPictureField qrImage={f.qrImage} idPrefix="ivc-fbformat" pickTestId="ivc-fbformat-qr-pick" pickLabel={f.qrImage ? t.rd_ivc_fbf_qr_change : t.rd_rc_qr_pick}
            onPicked={(url) => { setQrFailed(false); setF((x) => ({ ...x, qrImage: url })); }} onRemove={() => setF((x) => ({ ...x, qrImage: null }))}
            onPickStart={() => setQrFailed(false)} onFailed={() => setQrFailed(true)} />
          {qrFailed && <div role="alert" data-testid="ivc-fbformat-qr-failed" style={{ ...hint, color: "var(--danger)", fontWeight: 600 }}>{t.rd_rc_qr_failed}</div>}

          <span style={label}>{t.rd_rc_sample}</span>
          <div style={{ marginBottom: 6 }}><SamplePicture picture={picture} testid="ivc-fbformat-sample" /></div>
        </>
      )}
    </FormatSheetFrame>
  );
}
