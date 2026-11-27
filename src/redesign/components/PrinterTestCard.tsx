// "Printer test" card — printer testers only (feature key printer_tester), for a printer that is NOT
// on the list. Pick a language → Test print (the existing generic path, nothing saved) → "Did it print
// clean?" → Yes (needs a photo of the sticker) / No → one report to Admin. No Save: the printer can be
// used for live only after Admin adds it.
// mode "tuning" (Printer setup help, sql/230): the seller's SAVED printer, while Admin helps set it up. No
// language picker; the test sticker goes through the real print route (`tuningPrint` — the seller's own
// tuning applies there); the report carries the tuning version it printed with.
import { useState, type CSSProperties } from "react";
import type { BluetoothPrinterDevice } from "../adapters/printerBridge";
import type { Settings } from "../adapters/printing";
import type { PrinterLang } from "../adapters/printerModels";
import {
  LANG_LABEL, TESTER_LANGS, resizeTestPhoto, submitPrinterTestReport, testPrintInLang,
  type SubmitResult, type TesterSendResult,
} from "../adapters/printerTesters";
import { useT } from "../i18n";

const card: CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 15, boxShadow: "var(--shadow)", marginTop: 12 };
const btn: CSSProperties = { minHeight: 44, padding: "10px 12px", border: "1px solid var(--border-strong)", borderRadius: 12, background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const primary = (on: boolean): CSSProperties => ({ ...btn, width: "100%", border: "none", background: on ? "var(--accent)" : "var(--surface-2)", color: on ? "var(--accent-text)" : "var(--text-muted)", cursor: on ? "pointer" : "not-allowed" });

export interface PrinterTestDeps {
  testPrint: typeof testPrintInLang;
  resize: typeof resizeTestPhoto;
  submit: typeof submitPrinterTestReport;
}
const DEFAULT_DEPS: PrinterTestDeps = { testPrint: testPrintInLang, resize: resizeTestPhoto, submit: submitPrinterTestReport };

export default function PrinterTestCard({ printer, settings, cur, storeName, stickerSize, onClose, deps = DEFAULT_DEPS, mode = "test", tuningPrint, tuningVersion = null, tuningLang = "tspl" }: {
  printer: BluetoothPrinterDevice; settings?: Settings; cur: string; storeName: string; stickerSize: string;
  onClose?: () => void; deps?: PrinterTestDeps;
  mode?: "test" | "tuning"; tuningPrint?: () => Promise<TesterSendResult & { version?: number | null }>; tuningVersion?: number | null; tuningLang?: PrinterLang;
}) {
  const tuning = mode === "tuning";
  const t = useT();
  const [pickedLang, setLang] = useState<PrinterLang | null>(null);
  const lang: PrinterLang | null = tuning ? tuningLang : pickedLang;
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ lang: PrinterLang; r: TesterSendResult } | null>(null);
  const [answer, setAnswer] = useState<"clean" | null>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoErr, setPhotoErr] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [printedVersion, setPrintedVersion] = useState<number | null>(null); // the tuning version the test sticker really printed with

  async function doTest() {
    if (!lang || !settings || sending) return;
    setSending(true); setAnswer(null); setPhoto(null); setResult(null);
    const tr = tuning ? (tuningPrint ? await tuningPrint().catch(() => ({ ok: false, code: "BT_PRINT_FAILED" })) : { ok: false, code: "BT_PRINT_FAILED" }) : null;
    if (tr) { const v = (tr as { version?: number | null }).version; setPrintedVersion(v !== undefined ? v : tuningVersion); }
    const r = tr ? { ok: tr.ok, code: tr.code } : await deps.testPrint(printer, lang, settings, cur, storeName);
    setSending(false); setSent({ lang, r });
  }
  async function send(clean: boolean) {
    if (!sent || submitting) return;
    if (clean && !photo) return;
    setSubmitting(true);
    const r = await deps.submit({ printer, lang: sent.lang, stickerSize, send: sent.r, clean, photo: clean ? photo : null, ...(tuning ? { tuningVersion: printedVersion } : {}) });
    setSubmitting(false); setResult(r);
  }
  async function onPhoto(f: File | undefined) {
    setPhotoErr(false); setPhoto(null);
    if (!f) return;
    const b = await deps.resize(f);
    if (b) setPhoto(b); else setPhotoErr(true);
  }

  const done = result?.ok === true;
  return (
    <div data-testid={tuning ? "ps-tuning-card" : "ps-tester-card"} style={card}>
      <div style={{ fontSize: 14.5, fontWeight: 800, color: "var(--text)" }}>{tuning ? t.rd_ptt_title : t.rd_prt_title}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{printer.name || t.rd_ps_bt_device}</div>
      {tuning
        ? <div data-testid="ps-tuning-help" style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45, marginTop: 6 }}>{t.rd_ptt_help}</div>
        : <div data-testid="ps-tester-no-save" style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45, marginTop: 6 }}>{t.rd_prt_no_save}</div>}
      {done ? (
        <div role="status" data-testid="ps-tester-sent" style={{ marginTop: 12, padding: "11px 13px", borderRadius: 12, background: "var(--ok-soft, rgba(5,150,105,.1))", border: "1px solid var(--ok)", fontSize: 13, fontWeight: 600, color: "var(--text)", lineHeight: 1.45 }}>{tuning ? t.rd_ptt_sent : t.rd_prt_sent}</div>
      ) : (<>
        {!tuning && (<>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)", margin: "12px 0 6px" }}>{t.rd_prt_lang}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {TESTER_LANGS.map((l) => (
              <button key={l} data-testid={`ps-tester-lang-${l}`} aria-pressed={lang === l} onClick={() => setLang(l)} style={{ ...btn, border: lang === l ? "2px solid var(--accent)" : btn.border, background: lang === l ? "var(--accent-softer)" : "var(--surface)" }}>{LANG_LABEL[l]}</button>
            ))}
          </div>
        </>)}
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
      {onClose && <button data-testid="ps-tester-close" onClick={onClose} style={{ ...btn, width: "100%", marginTop: 12 }}>{t.rd_prt_close}</button>}
      {tuning && done && <button data-testid="ps-tuning-again" onClick={() => { setResult(null); setSent(null); setAnswer(null); setPhoto(null); }} style={{ ...btn, width: "100%", marginTop: 12 }}>{t.rd_ptt_again}</button>}
    </div>
  );
}
