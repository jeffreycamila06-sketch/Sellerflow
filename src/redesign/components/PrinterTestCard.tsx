// "Printer test" card — printer testers only (feature key printer_tester), for any printer that is not
// built-in. Pick a language → Test print (the existing generic path, nothing saved) → "Did it print
// clean?" → Yes (needs a photo of the sticker) / No → one report to Admin. With onUse: after a CLEAN
// report, "Use this printer" saves it with the language that printed clean. Without onUse: no Save.
import { useState, type CSSProperties } from "react";
import type { BluetoothPrinterDevice } from "../adapters/printerBridge";
import type { Settings } from "../adapters/printing";
import type { PrinterLang } from "../adapters/printerModels";
import {
  LANG_LABEL, TESTER_LANGS, resizeTestPhoto, submitPrinterTestReport, testPrintInLang,
  type SubmitResult, type TesterSendResult,
} from "../adapters/printerTesters";
import { tpl, useT } from "../i18n";

const card: CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 15, boxShadow: "var(--shadow)", marginTop: 12 };
const btn: CSSProperties = { minHeight: 44, padding: "10px 12px", border: "1px solid var(--border-strong)", borderRadius: 12, background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const primary = (on: boolean): CSSProperties => ({ ...btn, width: "100%", border: "none", background: on ? "var(--accent)" : "var(--surface-2)", color: on ? "var(--accent-text)" : "var(--text-muted)", cursor: on ? "pointer" : "not-allowed" });

export interface PrinterTestDeps {
  testPrint: typeof testPrintInLang;
  resize: typeof resizeTestPhoto;
  submit: typeof submitPrinterTestReport;
}
const DEFAULT_DEPS: PrinterTestDeps = { testPrint: testPrintInLang, resize: resizeTestPhoto, submit: submitPrinterTestReport };

export default function PrinterTestCard({ printer, settings, cur, storeName, stickerSize, onClose, onUse, deps = DEFAULT_DEPS }: {
  printer: BluetoothPrinterDevice; settings?: Settings; cur: string; storeName: string; stickerSize: string;
  onClose: () => void; onUse?: (lang: PrinterLang) => Promise<boolean> | boolean; // false = not saved
  deps?: PrinterTestDeps;
}) {
  const t = useT();
  const [lang, setLang] = useState<PrinterLang | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ lang: PrinterLang; r: TesterSendResult } | null>(null);
  const [answer, setAnswer] = useState<"clean" | null>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoErr, setPhotoErr] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [cleanLang, setCleanLang] = useState<PrinterLang | null>(null); // the language of the clean report just sent
  const [using, setUsing] = useState(false);
  const [useFailed, setUseFailed] = useState(false);

  async function doTest() {
    if (!lang || !settings || sending) return;
    setSending(true); setAnswer(null); setPhoto(null); setResult(null);
    const r = await deps.testPrint(printer, lang, settings, cur, storeName);
    setSending(false); setSent({ lang, r });
  }
  async function send(clean: boolean) {
    if (!sent || submitting) return;
    if (clean && !photo) return;
    setSubmitting(true);
    const r = await deps.submit({ printer, lang: sent.lang, stickerSize, send: sent.r, clean, photo: clean ? photo : null });
    setSubmitting(false); setResult(r);
    setCleanLang(r.ok && clean ? sent.lang : null);
  }
  async function use() {
    if (!onUse || !cleanLang || using) return;
    setUsing(true); setUseFailed(false);
    const ok = await Promise.resolve(onUse(cleanLang)).catch(() => false);
    setUsing(false);
    if (!ok) setUseFailed(true);
  }
  async function onPhoto(f: File | undefined) {
    setPhotoErr(false); setPhoto(null);
    if (!f) return;
    const b = await deps.resize(f);
    if (b) setPhoto(b); else setPhotoErr(true);
  }

  const done = result?.ok === true;
  return (
    <div data-testid="ps-tester-card" style={card}>
      <div style={{ fontSize: 14.5, fontWeight: 800, color: "var(--text)" }}>{t.rd_prt_title}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{printer.name || t.rd_ps_bt_device}</div>
      <div data-testid="ps-tester-no-save" style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45, marginTop: 6 }}>{onUse ? t.rd_prt_try_note : t.rd_prt_no_save}</div>
      {done ? (<>
        <div role="status" data-testid="ps-tester-sent" style={{ marginTop: 12, padding: "11px 13px", borderRadius: 12, background: "var(--ok-soft, rgba(5,150,105,.1))", border: "1px solid var(--ok)", fontSize: 13, fontWeight: 600, color: "var(--text)", lineHeight: 1.45 }}>{onUse ? (cleanLang ? tpl(t.rd_prt_sent_use, { lang: LANG_LABEL[cleanLang] }) : t.rd_prt_sent_try) : t.rd_prt_sent}</div>
        {onUse && cleanLang && (
          <button data-testid="ps-tester-use" disabled={using} onClick={() => void use()} style={{ ...primary(!using), marginTop: 10 }}>{t.rd_prt_use}</button>
        )}
        {useFailed && <div data-testid="ps-tester-use-failed" role="alert" style={{ fontSize: 12, color: "var(--danger)", fontWeight: 700, marginTop: 8 }}>{t.rd_prt_use_failed}</div>}
      </>) : (<>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)", margin: "12px 0 6px" }}>{t.rd_prt_lang}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {TESTER_LANGS.map((l) => (
            <button key={l} data-testid={`ps-tester-lang-${l}`} aria-pressed={lang === l} onClick={() => setLang(l)} style={{ ...btn, border: lang === l ? "2px solid var(--accent)" : btn.border, background: lang === l ? "var(--accent-softer)" : "var(--surface)" }}>{LANG_LABEL[l]}</button>
          ))}
        </div>
        <button data-testid="ps-tester-print" disabled={!lang || !settings || sending} onClick={() => void doTest()} style={{ ...primary(!!lang && !!settings && !sending), marginTop: 10 }}>{sending ? t.rd_ps_sending_test : t.rd_ps_test_print}</button>
        {sent && !sending && (
          <div data-testid="ps-tester-question" style={{ marginTop: 12 }}>
            {!sent.r.ok && <div data-testid="ps-tester-send-failed" style={{ fontSize: 12, color: "var(--warn)", fontWeight: 600, marginBottom: 8 }}>{t.rd_ps_test_failed}</div>}
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>{t.rd_prt_q}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button data-testid="ps-tester-yes" aria-pressed={answer === "clean"} disabled={submitting} onClick={() => setAnswer("clean")} style={{ ...btn, border: answer === "clean" ? "2px solid var(--ok)" : btn.border }}>{t.rd_prt_yes}</button>
              <button data-testid="ps-tester-no" disabled={submitting} onClick={() => { setAnswer(null); void send(false); }} style={btn}>{t.rd_prt_no}</button>
            </div>
            {answer === "clean" && (
              <div data-testid="ps-tester-photo" style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 6, lineHeight: 1.45 }}>{t.rd_prt_photo_need}</div>
                <label style={{ ...btn, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  📷 {photo ? t.rd_prt_photo_change : t.rd_prt_photo_add}
                  <input data-testid="ps-tester-photo-input" type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => void onPhoto(e.target.files?.[0])} />
                </label>
                {photo && <div data-testid="ps-tester-photo-ok" style={{ fontSize: 12, color: "var(--ok)", fontWeight: 700, marginTop: 6 }}>✓ {t.rd_prt_photo_ok}</div>}
                {photoErr && <div data-testid="ps-tester-photo-err" style={{ fontSize: 12, color: "var(--danger)", fontWeight: 700, marginTop: 6 }}>{t.rd_prt_photo_err}</div>}
                <button data-testid="ps-tester-send" disabled={!photo || submitting} onClick={() => void send(true)} style={{ ...primary(!!photo && !submitting), marginTop: 10 }}>{t.rd_prt_send}</button>
              </div>
            )}
            {result && !result.ok && <div data-testid="ps-tester-error" style={{ fontSize: 12, color: "var(--danger)", fontWeight: 700, marginTop: 8 }}>{t.rd_prt_send_failed}</div>}
          </div>
        )}
      </>)}
      <button data-testid="ps-tester-close" onClick={onClose} style={{ ...btn, width: "100%", marginTop: 12 }}>{t.rd_prt_close}</button>
    </div>
  );
}
