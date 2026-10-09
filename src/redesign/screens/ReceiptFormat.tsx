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
import { loadSoldoutSettings, saveSoldoutSettings, SOLDOUT_TEXT_MAX } from "../adapters/fbSoldout";
import { loadAutoReceipt, saveAutoReceipt } from "../adapters/fbAutoReceipt";
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

export default function ReceiptFormat({ cur, onBack, soldout, autoReceipt, polish = false }: {
  cur: string; onBack: () => void;
  // fb_polish_v2 (Build 7): the two toggles save on tap (the same writes as their Save button) and
  // the "Nothing is sent yet" line goes away while either is on. Off → the screen as before.
  polish?: boolean;
  // F2 (fb_soldout_enabled + Messenger access + Facebook world): the "Sold-out message" section.
  // Absent = the screen exactly as before. onChanged → the app's live toggle after a save.
  soldout?: { onChanged: (enabled: boolean) => void };
  // B1 (fb_auto_receipt_enabled + Messenger access + Facebook world + Plus or higher): the
  // "Automatic receipt after live" toggle. Absent = the screen exactly as before.
  autoReceipt?: { lang: string; currency: string };
}) {
  const t = useT();
  const [s, setS] = useState<ReceiptSettings>(EMPTY_RECEIPT_SETTINGS);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [soOn, setSoOn] = useState(false);     // fb_polish_v2: what the toggles below report
  const [autoOn, setAutoOn] = useState(false);

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
        <div data-testid="rc-sub" style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5, margin: "0 2px 14px" }}>{polish && (soOn || autoOn) ? t.rd_rc_sub_live : t.rd_rc_sub}</div>
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
        {soldout && <SoldoutSection onChanged={soldout.onChanged} polish={polish} onState={setSoOn} />}
        {autoReceipt && <AutoReceiptSection lang={autoReceipt.lang} currency={autoReceipt.currency} polish={polish} onState={setAutoOn} />}
        {status !== "loading" && (
          <div style={card}>
            <span style={label}>{t.rd_rc_sample}</span>
            {picture.url
              ? <img src={picture.url} alt={t.rd_rc_sample} data-testid="rc-sample-img" className="sfl-no-hover" style={{ display: "block", width: "100%", maxWidth: 360, margin: "0 auto", boxSizing: "border-box", borderRadius: 10, border: "1px solid var(--border)" }} />
              : picture.failed && <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{t.rd_rc_no_preview}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

// F2 — the seller's sold-out message: own toggle (default OFF) + own text (empty = the built-in
// text, shown as the placeholder). Saved on its own; the receipt fields above are untouched.
// polish: ticking the toggle saves at once (toggle + the current text — what Save writes); a failed
// save puts the tick back. onState reports the saved on/off to the screen header.
function SoldoutSection({ onChanged, polish = false, onState }: { onChanged: (enabled: boolean) => void; polish?: boolean; onState?: (on: boolean) => void }) {
  const t = useT();
  const [st, setSt] = useState<"loading" | "ready" | "error">("loading");
  const [on, setOn] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    void loadSoldoutSettings().then((r) => {
      if (!alive) return;
      if (r.ok) { setOn(r.settings.enabled); setText(r.settings.text); setSt("ready"); onState?.(r.settings.enabled); } else setSt("error");
    });
    return () => { alive = false; };
  }, [onState]);
  const save = async (enabled = on) => {
    if (saving) return;
    setSaving(true); setMsg(null);
    const ok = await saveSoldoutSettings({ enabled, text });
    setSaving(false);
    setMsg({ text: ok ? t.rd_rc_saved : t.rd_rc_save_failed, ok });
    if (ok) { onChanged(enabled); onState?.(enabled); }
    return ok;
  };
  const toggle = async (v: boolean) => {
    setOn(v);
    if (!polish) return;
    if (!(await save(v))) setOn(!v);
  };
  return (
    <div style={card} data-testid="rc-soldout">
      <span style={label}>{t.rd_rc_so_title}</span>
      <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 10 }}>{t.rd_rc_so_hint}</div>
      {st === "error" && <div role="alert" data-testid="rc-soldout-error" style={{ color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>{t.rd_rc_load_failed}</div>}
      {st === "ready" && (
        <>
          <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, fontWeight: 600, color: "var(--text)", marginBottom: 10 }}>
            <input type="checkbox" data-testid="rc-soldout-on" checked={on} disabled={polish && saving} onChange={(e) => void toggle(e.target.checked)} />
            {t.rd_rc_so_toggle}
          </label>
          <textarea data-testid="rc-soldout-text" style={area} maxLength={SOLDOUT_TEXT_MAX} value={text} placeholder={t.rd_rc_so_default}
            onChange={(e) => setText(e.target.value.slice(0, SOLDOUT_TEXT_MAX))} />
          <div style={counter}>{tpl("{n}/{max}", { n: text.length, max: SOLDOUT_TEXT_MAX })}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
            <button type="button" data-testid="rc-soldout-save" style={{ ...btn(true), opacity: saving ? 0.6 : 1 }} disabled={saving} onClick={() => void save()}>{saving ? t.rd_rc_saving : t.rd_rc_save}</button>
            {msg && <span role="status" style={{ fontSize: 12.5, fontWeight: 600, color: msg.ok ? "var(--ok)" : "var(--danger)" }}>{msg.text}</span>}
          </div>
        </>
      )}
    </div>
  );
}

// B1 — the seller's own switch for the automatic receipt (default OFF). Saved on its own with
// the app's language and currency (the server draws the picture with them).
// polish: the toggle saves at once (there is no text here, so no Save button); a failed save puts
// the tick back. onState reports the saved on/off to the screen header.
function AutoReceiptSection({ lang, currency, polish = false, onState }: { lang: string; currency: string; polish?: boolean; onState?: (on: boolean) => void }) {
  const t = useT();
  const [st, setSt] = useState<"loading" | "ready" | "error">("loading");
  const [on, setOn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    void loadAutoReceipt().then((r) => {
      if (!alive) return;
      if (r.ok) { setOn(r.enabled); setSt("ready"); onState?.(r.enabled); } else setSt("error");
    });
    return () => { alive = false; };
  }, [onState]);
  const save = async (enabled = on) => {
    if (saving) return;
    setSaving(true); setMsg(null);
    const ok = await saveAutoReceipt({ enabled, lang, currency });
    setSaving(false);
    setMsg({ text: ok ? t.rd_rc_saved : t.rd_rc_save_failed, ok });
    if (ok) onState?.(enabled);
    return ok;
  };
  const toggle = async (v: boolean) => {
    setOn(v);
    if (!polish) return;
    if (!(await save(v))) setOn(!v);
  };
  return (
    <div style={card} data-testid="rc-auto">
      <span style={label}>{t.rd_rc_auto_title}</span>
      <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 10 }}>{t.rd_rc_auto_hint}</div>
      {st === "error" && <div role="alert" data-testid="rc-auto-error" style={{ color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>{t.rd_rc_load_failed}</div>}
      {st === "ready" && (
        <>
          <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, fontWeight: 600, color: "var(--text)", marginBottom: 10 }}>
            <input type="checkbox" data-testid="rc-auto-on" checked={on} disabled={polish && saving} onChange={(e) => void toggle(e.target.checked)} />
            {t.rd_rc_auto_toggle}
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {!polish && <button type="button" data-testid="rc-auto-save" style={{ ...btn(true), opacity: saving ? 0.6 : 1 }} disabled={saving} onClick={() => void save()}>{saving ? t.rd_rc_saving : t.rd_rc_save}</button>}
            {msg && <span role="status" style={{ fontSize: 12.5, fontWeight: 600, color: msg.ok ? "var(--ok)" : "var(--danger)" }}>{msg.text}</span>}
          </div>
        </>
      )}
    </div>
  );
}
