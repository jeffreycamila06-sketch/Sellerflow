// The Messenger receipt EDITOR fields — shared by Orders → Messenger receipt (ReceiptSheet.tsx) and Settings →
// Invoicing → Facebook ✎ View (FbSendAllTab.tsx): Opening, Items (+ Add line, × to remove), Shipping fee,
// Note — how to pay, the payment QR (read-only, set in Receipt format) and the live picture. Same fields, same
// look, same words in both places. The state lives in the screen that uses it; this only draws it.
import type { CSSProperties } from "react";
import { useT } from "../i18n";
import { priceInput, hasCents } from "../../lib/money";

export const rsInput: CSSProperties = { boxSizing: "border-box", border: "1px solid var(--border-strong)", borderRadius: 9, background: "var(--surface)", color: "var(--text)", padding: "7px 9px", fontSize: 14, fontFamily: "var(--font-ui)" };
export const rsLabel: CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, color: "var(--text-muted)", margin: "10px 2px 5px" };

export interface EditorFieldsLine { id: number; item: string; price: string }
export default function ReceiptEditorFields({
  cur, opening, onOpening, lines, shownIndex, focusLineId, onLine, onRemoveLine, onAddLine,
  shipping, onShipping, note, onNote, qrImage, formatLoaded, picture,
}: {
  cur: string;
  opening: string; onOpening: (v: string) => void;
  lines: EditorFieldsLine[];
  /** each line's number on the picture (no entry = left out → "–") */
  shownIndex: Map<number, number>;
  /** the line "Add line" just made — its item field takes the focus once */
  focusLineId: { current: number | null };
  onLine: (id: number, patch: Partial<{ item: string; price: string }>) => void;
  onRemoveLine: (id: number) => void; onAddLine: () => void;
  shipping: string; onShipping: (v: string) => void;
  note: string; onNote: (v: string) => void;
  qrImage: string | null; formatLoaded: boolean;
  picture: { url: string | null; failed: boolean };
}) {
  const t = useT();
  const input = rsInput, label = rsLabel;
  return (<>
        <span style={label}>{t.rd_rc_opening}</span>
        <textarea data-testid="rs-opening" value={opening} maxLength={300} onChange={(e) => onOpening(e.target.value)} style={{ ...input, width: "100%", minHeight: 56, resize: "vertical" }} />

        <span style={label}>{t.rd_rc_lines}</span>
        {lines.map((l) => (
          <div key={l.id} data-testid="rs-line" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, minHeight: 40 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)", width: 24, textAlign: "right", flexShrink: 0 }}>{shownIndex.has(l.id) ? `${shownIndex.get(l.id)}.` : "–"}</span>
            <input data-testid="rs-item" aria-label={t.rd_rc_item_ph} placeholder={t.rd_rc_item_ph} value={l.item}
              ref={(el) => { if (el && focusLineId.current === l.id) { focusLineId.current = null; el.focus(); } }}
              onChange={(e) => onLine(l.id, { item: e.target.value })} style={{ ...input, flex: 1, minWidth: 0 }} />
            <input data-testid="rs-price" aria-label={t.rd_rc_price_ph} placeholder={t.rd_rc_price_ph} inputMode={hasCents(cur) ? "decimal" : "numeric"} value={l.price} onChange={(e) => onLine(l.id, { price: priceInput(e.target.value, cur) })} style={{ ...input, width: 96, textAlign: "right" }} />
            <button type="button" data-testid="rs-remove-line" aria-label={t.rd_rs_remove_line} title={t.rd_rs_remove_line} onClick={() => onRemoveLine(l.id)}
              style={{ width: 40, height: 40, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--border-strong)", borderRadius: 10, background: "var(--surface)", color: "var(--text-muted)", fontSize: 18, lineHeight: 1, cursor: "pointer", fontFamily: "var(--font-ui)" }}>×</button>
          </div>
        ))}
        <button type="button" data-testid="rs-add-line" onClick={onAddLine}
          style={{ marginTop: 2, minHeight: 40, padding: "0 14px", border: "1px dashed var(--border-strong)", borderRadius: 10, background: "transparent", color: "var(--accent-fg)", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" }}>
          + {t.rd_rs_add_line}
        </button>

        <span style={label}>{t.rd_rs_shipping}</span>
        <input data-testid="rs-shipping" aria-label={t.rd_rs_shipping} placeholder={t.rd_rs_optional} inputMode={hasCents(cur) ? "decimal" : "numeric"}
          value={shipping} onChange={(e) => onShipping(priceInput(e.target.value, cur))} style={{ ...input, width: 140, textAlign: "right" }} />

        <span style={label}>{t.rd_rc_note}</span>
        <textarea data-testid="rs-note" value={note} maxLength={1000} onChange={(e) => onNote(e.target.value)} style={{ ...input, width: "100%", minHeight: 80, resize: "vertical" }} />

        {/* Payment QR — read-only here (set it in Receipt format). The WHOLE QR, never cropped. */}
        <span style={label}>{t.rd_rc_qr}</span>
        {qrImage
          ? <div data-testid="rs-qr-box" style={{ width: 160, height: 160, boxSizing: "border-box", borderRadius: 14, border: "1px solid var(--border)", background: "#fff", overflow: "hidden" }}>
              <img src={qrImage} alt={t.rd_rc_qr} data-testid="rs-qr-img" className="sfl-no-hover" style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }} />
            </div>
          : formatLoaded && <div data-testid="rs-qr-none" style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.45 }}>{t.rd_rs_qr_none}</div>}

        <div style={{ marginTop: 12 }}>
          {picture.url
            ? <img src={picture.url} alt={t.rd_rc_button} data-testid="rs-picture" className="sfl-no-hover" style={{ display: "block", width: "100%", maxWidth: 360, margin: "0 auto", boxSizing: "border-box", borderRadius: 10, border: "1px solid var(--border)", background: "#fff" }} />
            : picture.failed && <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{t.rd_rc_no_preview}</div>}
        </div>
  </>);
}
