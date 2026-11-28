// Parts of the Receipt format screen used in two places: the screen itself (screens/ReceiptFormat.tsx) and
// the Invoicing "Facebook receipt format" sheet (components/FbReceiptFormatSheet.tsx). Moved here as they were
// — the screen's DOM is pinned against main in formatPerTab.sameAsMain.test.tsx.
import { useRef } from "react";
import { useT } from "../i18n";
import { downscaleQrFile } from "../adapters/receiptSettings";
import { rcBtn } from "./receiptFormatStyle";

/** The payment QR picture: the whole picture on white (never cropped — a cut QR can't be scanned), tap it to
 *  choose another, plus Choose / Remove. A picked photo is turned upright and made small enough to save. */
export function QrPictureField({ qrImage, onPicked, onRemove, onPickStart, onFailed, idPrefix = "rc", pickLabel, pickTestId, tall = false }: {
  qrImage: string | null;
  onPicked: (dataUrl: string) => void; onRemove: () => void;
  onPickStart?: () => void; onFailed: () => void;
  /** testid prefix: "rc" on the Receipt format screen */
  idPrefix?: string;
  /** the pick button's words (default "Choose picture") */
  pickLabel?: string;
  pickTestId?: string;
  /** buttons at least 44 px tall (the Invoicing sheet); off = the Receipt format screen as it was */
  tall?: boolean;
}) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const b = tall ? { ...rcBtn(false), minHeight: 44 } : rcBtn(false);
  const pickQr = async (f: File | undefined) => {
    if (!f) return;
    onPickStart?.();
    try {
      const url = await downscaleQrFile(f);
      if (url) onPicked(url); else onFailed();
    } catch { onFailed(); }
    if (fileRef.current) fileRef.current.value = "";
  };
  return (
    // 160 × 160 (= the product edit dialog picture). The WHOLE QR is shown (contain, never
    // cover/crop — a cut QR can't be scanned) on white. The buttons sit to the right and
    // wrap below the box on a narrow phone. Tapping the box = "Choose picture".
    <div data-testid={`${idPrefix}-qr-row`} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      {qrImage && (
        <button type="button" data-testid={`${idPrefix}-qr-box`} onClick={() => fileRef.current?.click()}
          style={{ width: 160, height: 160, flexShrink: 0, padding: 0, margin: 0, boxSizing: "border-box", borderRadius: 14, border: "1px solid var(--border)", background: "#fff", overflow: "hidden", cursor: "pointer", display: "block" }}>
          <img src={qrImage} alt={t.rd_rc_qr} data-testid={`${idPrefix}-qr-thumb`} style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }} />
        </button>
      )}
      <div data-testid={`${idPrefix}-qr-actions`} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
        <button type="button" {...(pickTestId ? { "data-testid": pickTestId } : {})} style={b} onClick={() => fileRef.current?.click()}>{pickLabel ?? t.rd_rc_qr_pick}</button>
        {qrImage && <button type="button" data-testid={`${idPrefix}-qr-remove`} style={{ ...b, color: "var(--danger)" }} onClick={onRemove}>{t.rd_rc_qr_remove}</button>}
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden data-testid={`${idPrefix}-qr-file`} onChange={(e) => void pickQr(e.target.files?.[0])} />
    </div>
  );
}

/** The sample receipt picture (or "Preview isn't available on this device."). */
export function SamplePicture({ picture, testid = "rc-sample-img" }: { picture: { url: string | null; failed: boolean }; testid?: string }) {
  const t = useT();
  return picture.url
    ? <img src={picture.url} alt={t.rd_rc_sample} data-testid={testid} className="sfl-no-hover" style={{ display: "block", width: "100%", maxWidth: 360, margin: "0 auto", boxSizing: "border-box", borderRadius: 10, border: "1px solid var(--border)" }} />
    : picture.failed ? <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{t.rd_rc_no_preview}</div> : null;
}
