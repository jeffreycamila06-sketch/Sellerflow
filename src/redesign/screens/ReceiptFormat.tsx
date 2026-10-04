// MESSENGER RECEIPT step 1 — "Receipt format" settings (FB preview accounts only; the
// SettingsHub tile is passed only for them). Opening, note (how to pay) and the seller's OWN
// payment QR picture, saved to seller_receipt_settings (sql/74). Below the form: a sample
// receipt picture from the same renderer the Orders sheet uses. Nothing is sent anywhere.
// A missing table / failed read shows a note on THIS screen only.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useT, tpl } from "../i18n";
import {
  loadReceiptSettings, saveReceiptSettings, downscaleQrFile,
  OPENING_MAX, NOTE_MAX, EMPTY_RECEIPT_SETTINGS, type ReceiptSettings,
} from "../adapters/receiptSettings";
import { useReceiptPicture } from "../adapters/useReceiptPicture";
import type { ReceiptInput } from "../adapters/receiptImage";

const card: CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "14px 15px", marginBottom: 12, boxShadow: "var(--shadow)" };
const label: CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 700, color: "var(--text)", margin: "0 0 6px" };
const area: CSSProperties = { width: "100%", boxSizing: "border-box", minHeight: 76, resize: "vertical", border: "1px solid var(--border-strong)", borderRadius: 10, background: "var(--surface-2)", color: "var(--text)", padding: "9px 11px", fontSize: 14, fontFamily: "var(--font-ui)", lineHeight: 1.4 };
const counter: CSSProperties = { fontSize: 11, color: "var(--text-muted)", textAlign: "right", marginTop: 3 };
const btn = (primary: boolean): CSSProperties => ({ padding: "9px 15px", borderRadius: 10, border: primary ? "none" : "1px solid var(--border-strong)", background: primary ? "var(--accent)" : "var(--surface-2)", color: primary ? "var(--accent-text)" : "var(--text)", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" });

function sampleReceiptInput(s: ReceiptSettings, cur: string, buyerName: string, labels: ReceiptInput["labels"]): ReceiptInput {
  return {
    opening: s.opening, note: s.note, qrImage: s.qrImage, currency: cur, buyerNum: 12, buyerName, labels,
    lines: [{ item: "A1", total: 350 }, { item: "B2", total: 280 }, { item: "C3 ×2", total: 500 }],
  };
}

export default function ReceiptFormat({ cur, onBack }: { cur: string; onBack: () => void }) {
  const t = useT();
  const [s, setS] = useState<ReceiptSettings>(EMPTY_RECEIPT_SETTINGS);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    void loadReceiptSettings().then((r) => {
      if (!alive) return;
      if (r.ok) { setS(r.settings); setStatus("ready"); } else setStatus("error");
    });
    return () => { alive = false; };
  }, []);

  const picture = useReceiptPicture(status === "loading" ? null : sampleReceiptInput(s, cur, t.rd_rc_sample_buyer, { total: t.rd_rc_pic_total, toBeConfirmed: t.rd_rc_pic_tbc }));

  const pickQr = async (f: File | undefined) => {
    if (!f) return;
    setMsg(null);
    try {
      const url = await downscaleQrFile(f);
      if (url) setS((x) => ({ ...x, qrImage: url })); else setMsg({ text: t.rd_rc_qr_failed, ok: false });
    } catch { setMsg({ text: t.rd_rc_qr_failed, ok: false }); }
    if (fileRef.current) fileRef.current.value = "";
  };
  const save = async () => {
    if (saving) return;
    setSaving(true); setMsg(null);
    const ok = await saveReceiptSettings(s);
    setSaving(false);
    setMsg({ text: ok ? t.rd_rc_saved : t.rd_rc_save_failed, ok });
  };

  return (
    <div data-testid="receipt-format">
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,.18)", border: "none", padding: "7px 12px 7px 9px", borderRadius: 9, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_back}</button>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17, letterSpacing: "-.01em" }}>{t.rd_rc_title}</div>
      </div>

      <div style={{ padding: "16px 14px 24px" }}>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5, margin: "0 2px 14px" }}>{t.rd_rc_sub}</div>
        {status === "error" && (
          <div role="alert" data-testid="receipt-format-error" style={{ ...card, color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>{t.rd_rc_load_failed}</div>
        )}
        {status === "ready" && (
          <>
            <div style={card}>
              <label style={label} htmlFor="rc-opening">{t.rd_rc_opening}</label>
              <textarea id="rc-opening" data-testid="rc-opening" style={area} maxLength={OPENING_MAX} value={s.opening} placeholder={t.rd_rc_opening_ph}
                onChange={(e) => setS((x) => ({ ...x, opening: e.target.value.slice(0, OPENING_MAX) }))} />
              <div style={counter}>{tpl("{n}/{max}", { n: s.opening.length, max: OPENING_MAX })}</div>
              <label style={{ ...label, marginTop: 10 }} htmlFor="rc-note">{t.rd_rc_note}</label>
              <textarea id="rc-note" data-testid="rc-note" style={{ ...area, minHeight: 110 }} maxLength={NOTE_MAX} value={s.note} placeholder={t.rd_rc_note_ph}
                onChange={(e) => setS((x) => ({ ...x, note: e.target.value.slice(0, NOTE_MAX) }))} />
              <div style={counter}>{tpl("{n}/{max}", { n: s.note.length, max: NOTE_MAX })}</div>
            </div>
            <div style={card}>
              <span style={label}>{t.rd_rc_qr}</span>
              <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 10 }}>{t.rd_rc_qr_hint}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {s.qrImage && <img src={s.qrImage} alt="" data-testid="rc-qr-thumb" style={{ width: 72, height: 72, objectFit: "contain", borderRadius: 8, border: "1px solid var(--border)", background: "#fff" }} />}
                <button type="button" style={btn(false)} onClick={() => fileRef.current?.click()}>{t.rd_rc_qr_pick}</button>
                {s.qrImage && <button type="button" data-testid="rc-qr-remove" style={{ ...btn(false), color: "var(--danger)" }} onClick={() => setS((x) => ({ ...x, qrImage: null }))}>{t.rd_rc_qr_remove}</button>}
                <input ref={fileRef} type="file" accept="image/*" hidden data-testid="rc-qr-file" onChange={(e) => void pickQr(e.target.files?.[0])} />
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 2px 16px" }}>
              <button type="button" data-testid="rc-save" style={{ ...btn(true), opacity: saving ? 0.6 : 1 }} disabled={saving} onClick={() => void save()}>{saving ? t.rd_rc_saving : t.rd_rc_save}</button>
              {msg && <span role="status" style={{ fontSize: 12.5, fontWeight: 600, color: msg.ok ? "var(--ok)" : "var(--danger)" }}>{msg.text}</span>}
            </div>
          </>
        )}
        {status !== "loading" && (
          <div style={card}>
            <span style={label}>{t.rd_rc_sample}</span>
            {picture.url
              ? <img src={picture.url} alt={t.rd_rc_sample} data-testid="rc-sample-img" style={{ width: "100%", borderRadius: 10, border: "1px solid var(--border)" }} />
              : picture.failed && <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{t.rd_rc_no_preview}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
