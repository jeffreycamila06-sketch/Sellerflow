// WAYBILL USERNAME (TikTok Shop, Philippines) — Settings → Shipping → Waybill username.
// The seller uploads two TikTok Shop files: the Order list CSV and the waybill PDF. The app adds each
// buyer's "@username" to their waybill and gives back ONE new PDF (phone: Download / Share; laptop:
// Print + Download). Both files stay in the browser: never uploaded, saved or logged. The only database
// read is the seller's OWN TikTok buyers of today + yesterday, once when the screen opens (no polling).
// pdf-lib is loaded only here (dynamic import of adapters/waybillPdf).
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { headerBar, headerTitle } from "../ui";
import { HeaderWithBack } from "../components/BackButton";
import { tpl, useT } from "../i18n";
import { readCsvFile, type CsvResult } from "../adapters/waybillCsv";
import { loadWaybillCandidates, searchCandidates, type Candidate, type CandidateLoad } from "../adapters/waybillMatch";
import { buildRows, counts, showRow, stampsOf, tailOf, type Choice, type PageFacts, type ShownRow } from "../adapters/waybillRows";
import type { ScanResult } from "../adapters/waybillPdf";
import { deliverXlsmMobile } from "../adapters/shippingExport";
import { isAppShell } from "../adapters/appShell";
import { useScreenTimers } from "../adapters/useScreenTimers";
import { fmtMoney } from "../../lib/money";
import { downloadPdf, pdfFilename, printPdf } from "../adapters/waybillOut";
import BoldMarks from "../components/BoldMarks";

type PdfMod = typeof import("../adapters/waybillPdf");
let pdfMod: Promise<PdfMod> | null = null;
const loadPdfMod = (): Promise<PdfMod> => (pdfMod ??= import("../adapters/waybillPdf"));

const WIDE_AT = 900;
function useWide(): boolean {
  const read = () => (typeof window !== "undefined" ? window.innerWidth >= WIDE_AT : false);
  const [wide, setWide] = useState(read);
  useEffect(() => {
    const on = () => setWide(read());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return wide;
}

// ── styles ──────────────────────────────────────────────────────────────────────────────────────
const card: CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 14, boxShadow: "var(--shadow)", display: "flex", flexDirection: "column", gap: 10, minWidth: 0 };
const stepDot: CSSProperties = { width: 26, height: 26, borderRadius: "50%", background: "var(--accent-soft)", color: "var(--accent-fg)", fontWeight: 800, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
const hint: CSSProperties = { fontSize: 12, color: "var(--text-dim)", lineHeight: 1.4 };
const btnPrimary: CSSProperties = { minHeight: 52, border: "none", borderRadius: 14, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 16, fontWeight: 800, cursor: "pointer", padding: "0 16px", width: "100%" };
const btnGhost: CSSProperties = { minHeight: 44, border: "1px solid var(--border-strong)", borderRadius: 12, background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, cursor: "pointer", padding: "0 16px" };
const linkBtn: CSSProperties = { minHeight: 44, padding: "0 10px", border: "none", background: "transparent", color: "var(--accent-fg)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, cursor: "pointer", flexShrink: 0 };
const mono: CSSProperties = { fontFamily: "var(--font-mono)", fontWeight: 600, overflowWrap: "anywhere" };
const err: CSSProperties = { fontSize: 12.5, fontWeight: 700, color: "var(--danger)", lineHeight: 1.4 };

// ── the screen ──────────────────────────────────────────────────────────────────────────────────
type PdfState = { name: string; bytes: Uint8Array; scan: "reading" | ScanResult };
type Built = { key: string; bytes: Uint8Array } | null;

export default function WaybillUsername({ onBack, userId, cur, loadCandidates = loadWaybillCandidates }: {
  onBack: () => void;
  userId: string;
  cur: string;
  loadCandidates?: (userId: string) => Promise<CandidateLoad>;
}) {
  const t = useT();
  const wide = useWide();
  const phoneApp = isAppShell();
  const later = useScreenTimers();
  const [cands, setCands] = useState<CandidateLoad | "loading">("loading");
  const [csv, setCsv] = useState<{ name: string; res: CsvResult } | null>(null);
  const [pdf, setPdf] = useState<PdfState | null>(null);
  const [mod, setMod] = useState<PdfMod | null>(null);
  const [stage, setStage] = useState<"upload" | "results">("upload");
  const [choices, setChoices] = useState<Map<number, Choice>>(new Map());
  const [filter, setFilter] = useState<"all" | "needs">("all");
  const [sheetFor, setSheetFor] = useState<number | null>(null);
  const [built, setBuilt] = useState<Built>(null);
  const [buildFailed, setBuildFailed] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const csvInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const pdfGen = useRef(0);

  // the seller's own TikTok buyers of today + yesterday — once per open (+ Try again)
  const [loadNo, setLoadNo] = useState(0); // Try again → read once more
  useEffect(() => {
    let alive = true;
    void loadCandidates(userId).then((r) => { if (alive) setCands(r); }).catch(() => { if (alive) setCands({ ok: false }); });
    return () => { alive = false; };
  }, [loadCandidates, userId, loadNo]);
  const loadBuyers = () => { setCands("loading"); setLoadNo((n) => n + 1); };

  const say = useCallback((m: string) => { setMsg(m); later(() => setMsg(null), 4500); }, [later]);
  const reset = () => { setStage("upload"); setChoices(new Map()); setBuilt(null); setBuildFailed(false); setFilter("all"); };

  const onCsv = async (file: File | undefined) => {
    if (!file) return;
    reset();
    const res = await readCsvFile(file);
    setCsv({ name: file.name, res });
  };
  const onPdf = async (file: File | undefined) => {
    if (!file) return;
    reset();
    const gen = ++pdfGen.current;
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(await file.arrayBuffer()); } catch { setPdf({ name: file.name, bytes: new Uint8Array(), scan: { ok: false, error: "not_pdf" } }); return; }
    setPdf({ name: file.name, bytes, scan: "reading" });
    try {
      const m = await loadPdfMod();
      const scan = await m.scanWaybills(bytes);
      if (gen !== pdfGen.current) return;
      setMod(m);
      setPdf({ name: file.name, bytes, scan });
    } catch {
      if (gen === pdfGen.current) setPdf({ name: file.name, bytes, scan: { ok: false, error: "not_pdf" } });
    }
  };

  const orders = csv?.res.ok ? csv.res.orders : null;
  const pages = pdf && pdf.scan !== "reading" && pdf.scan.ok ? pdf.scan.pages : null;
  const buyers = cands !== "loading" && cands.ok ? cands.candidates : null;
  const ready = !!orders && !!pages && !!buyers;

  const baseRows = useMemo(() => {
    if (!orders || !pages || !buyers) return [];
    const facts: PageFacts[] = pages.map((p) => ({ index: p.index, orderId: p.orderId, words: p.words, slot: "reason" in p.slot ? { ok: false, reason: p.slot.reason } : { ok: true } }));
    return buildRows(facts, orders, buyers);
  }, [orders, pages, buyers]);
  const canPlace = useCallback((index: number, handle: string) => !!(mod && pages && pages[index] && mod.placeOn(pages[index], handle)), [mod, pages]);
  const rows = useMemo(() => baseRows.map((r) => showRow(r, choices.get(r.index), canPlace)), [baseRows, choices, canPlace]);
  const n = counts(rows);
  const stamps = useMemo(() => stampsOf(rows), [rows]);
  const stampKey = useMemo(() => JSON.stringify([...stamps]), [stamps]);

  // Build the new PDF as soon as the results are shown and after every change (the phone's share must
  // start inside the tap with ready bytes — the Parcel Scan phone-export rule).
  useEffect(() => {
    if (stage !== "results" || !pdf || !pages || !mod) return;
    let alive = true;
    const id = setTimeout(() => {
      void mod.stampWaybills(pdf.bytes, pages, stamps)
        .then((r) => { if (alive) { setBuilt({ key: stampKey, bytes: r.bytes }); setBuildFailed(false); } })
        .catch(() => { if (alive) setBuildFailed(true); });
    }, 250);
    return () => { alive = false; clearTimeout(id); };
  }, [stage, pdf, pages, mod, stamps, stampKey]);
  const out = built && built.key === stampKey ? built.bytes : null;

  const download = () => {
    if (!out) return;
    const name = pdfFilename();
    if (phoneApp) {
      // ⚠️ share() starts NOW, inside the tap (nothing awaited before it)
      const share = deliverXlsmMobile(out, name, "application/pdf");
      void share.then((d) => { if (!d.ok && !d.cancelled) say(d.unsupported ? t.rd_export_phone_unsupported : t.rd_wb_build_failed); }).catch(() => say(t.rd_wb_build_failed));
      return;
    }
    if (!downloadPdf(out, name)) say(t.rd_wb_build_failed);
  };
  const printBusy = useRef(false);
  const print = () => {
    if (!out || printBusy.current) return; // one print window per tap (a double tap opens nothing more)
    printBusy.current = true;
    later(() => { printBusy.current = false; }, 3000);
    if (!printPdf(out)) say(t.rd_wb_print_failed);
  };

  const choose = (index: number, handle: string | null) => {
    setChoices((m) => { const next = new Map(m); next.set(index, { handle }); return next; });
    setSheetFor(null);
  };

  const shown = filter === "needs" ? rows.filter((r) => r.kind === "pick") : rows;
  const sheetRow = sheetFor === null ? null : rows.find((r) => r.index === sheetFor) ?? null;

  // ── pieces ──
  const csvCard = (
    <div style={card} data-testid="wb-csv-card">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={stepDot}>1</span><span style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>{t.rd_wb_csv_title}</span></div>
      {csv?.res.ok
        ? <FileOk name={csv.name} line={tpl(t.rd_wb_csv_found, { n: csv.res.orders.length })} onChange={() => csvInput.current?.click()} change={t.rd_wb_change} testid="wb-csv-ok" />
        : <DropButton label={t.rd_wb_csv_pick} onClick={() => csvInput.current?.click()} testid="wb-csv-pick" />}
      {csv && "error" in csv.res && <div role="alert" style={err} data-testid="wb-csv-err">{csvErrText(csv.res.error, t)}</div>}
      <span style={hint}>{t.rd_wb_csv_hint}</span>
      <input ref={csvInput} type="file" accept=".csv,text/csv,text/comma-separated-values,application/vnd.ms-excel" style={{ display: "none" }} data-testid="wb-csv-input"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void onCsv(f); }} />
    </div>
  );
  const pdfCard = (
    <div style={card} data-testid="wb-pdf-card">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={stepDot}>2</span><span style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>{t.rd_wb_pdf_title}</span></div>
      {pdf && pdf.scan === "reading"
        ? <div style={{ ...hint, fontWeight: 700, minHeight: 44, display: "flex", alignItems: "center" }} data-testid="wb-pdf-reading">{t.rd_wb_reading}</div>
        : pdf && pdf.scan !== "reading" && "pages" in pdf.scan
          ? <FileOk name={pdf.name} line={tpl(t.rd_wb_pdf_found, { n: pdf.scan.pages.length })} onChange={() => pdfInput.current?.click()} change={t.rd_wb_change} testid="wb-pdf-ok" />
          : <DropButton label={t.rd_wb_pdf_pick} sub={t.rd_wb_pdf_pick_sub} onClick={() => pdfInput.current?.click()} testid="wb-pdf-pick" big />}
      {pdf && pdf.scan !== "reading" && "error" in pdf.scan && <div role="alert" style={err} data-testid="wb-pdf-err">{pdf.scan.error === "locked" ? t.rd_wb_pdf_locked : t.rd_wb_pdf_err}</div>}
      <span style={hint}>{t.rd_wb_pdf_hint}</span>
      <input ref={pdfInput} type="file" accept="application/pdf,.pdf" style={{ display: "none" }} data-testid="wb-pdf-input"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void onPdf(f); }} />
    </div>
  );
  const note = <div className="sfl-wb-note" style={{ borderRadius: 12, padding: "10px 12px", fontSize: 12.5, lineHeight: 1.45 }}><BoldMarks text={t.rd_wb_note} /></div>;
  const buyersLine = cands === "loading"
    ? <span style={{ ...hint, textAlign: "center" }} data-testid="wb-buyers-loading">{t.rd_wb_loading_buyers}</span>
    : !cands.ok
      ? <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flexWrap: "wrap" }} data-testid="wb-buyers-failed"><span style={err}>{t.rd_wb_buyers_failed}</span><button type="button" style={linkBtn} onClick={() => loadBuyers()}>{t.rd_wb_retry}</button></div>
      : null;
  const goHint = !orders ? t.rd_wb_need_csv : !pages ? t.rd_wb_need_pdf : null;
  const goButton = (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <button type="button" style={{ ...btnPrimary, opacity: ready ? 1 : 0.45, cursor: ready ? "pointer" : "default" }} disabled={!ready} onClick={() => setStage("results")} data-testid="wb-go">{t.rd_wb_go}</button>
      {buyersLine ?? (goHint && <span style={{ ...hint, textAlign: "center" }} data-testid="wb-go-hint">{goHint}</span>)}
    </div>
  );

  const tiles = (
    <div style={{ display: "flex", gap: 10 }}>
      <div className="sfl-wb-ok" style={{ flex: 1, borderRadius: 14, padding: 12, display: "flex", flexDirection: "column" }} data-testid="wb-tile-added"><span style={{ fontSize: 24, fontWeight: 800 }}>{n.added}</span><span style={{ fontSize: 12, fontWeight: 700 }}>{t.rd_wb_added}</span></div>
      <div className="sfl-wb-warn" style={{ flex: 1, borderRadius: 14, padding: 12, display: "flex", flexDirection: "column", border: "none" }} data-testid="wb-tile-needs"><span style={{ fontSize: 24, fontWeight: 800 }}>{n.needs}</span><span style={{ fontSize: 12, fontWeight: 700 }}>{t.rd_wb_pick_tile}</span></div>
    </div>
  );
  const chips = (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {(["all", "needs"] as const).map((f) => (
        <button key={f} type="button" onClick={() => setFilter(f)} data-testid={`wb-chip-${f}`} aria-pressed={filter === f}
          style={{ minHeight: 44, padding: "0 16px", borderRadius: 999, fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, cursor: "pointer", ...(filter === f ? { border: "none", background: "var(--accent)", color: "var(--accent-text)" } : { border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)" }) }}>
          {f === "all" ? tpl(t.rd_wb_all, { n: n.all }) : tpl(t.rd_wb_needs, { n: n.needs })}
        </button>
      ))}
    </div>
  );
  const skipNote = <div className="sfl-wb-info" style={{ borderRadius: 12, padding: "10px 12px", fontSize: 12.5, lineHeight: 1.45 }}>{t.rd_wb_skip_note}</div>;
  const preparing = !out && !buildFailed;
  const failedLine = buildFailed ? <div role="alert" style={{ ...err, textAlign: "center" }} data-testid="wb-build-failed">{t.rd_wb_build_failed}</div> : null;

  return (
    <div>
      <div style={headerBar} data-hb-top>
        <HeaderWithBack onBack={() => { if (!wide && stage === "results") setStage("upload"); else onBack(); }}>
          <div className="sfl-anim-beat" style={headerTitle}>{t.rd_wb_title}</div>
          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 1 }}>{t.rd_wb_sub}</div>
        </HeaderWithBack>
      </div>

      {wide ? (
        <div style={{ padding: "22px 24px 28px", display: "flex", gap: 22, alignItems: "flex-start" }} data-testid="wb-wide">
          <div style={{ width: 340, flexShrink: 0, display: "flex", flexDirection: "column", gap: 14 }}>
            {csvCard}{pdfCard}{note}
            {stage === "upload" && goButton}
          </div>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
            {stage === "results" ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span className="sfl-wb-ok" style={{ borderRadius: 999, padding: "7px 14px", fontWeight: 800, fontSize: 14 }} data-testid="wb-tile-added">{n.added} {t.rd_wb_added}</span>
                  <span className="sfl-wb-warn" style={{ borderRadius: 999, padding: "7px 14px", fontWeight: 800, fontSize: 14, border: "none" }} data-testid="wb-tile-needs">{n.needs} {t.rd_wb_pick_tile}</span>
                  <span style={{ flex: 1 }} />
                  <button type="button" style={{ ...btnGhost, opacity: out ? 1 : 0.5 }} disabled={!out} onClick={download} data-testid="wb-download">{t.rd_wb_download}</button>
                  {/* Print = the browser's print window: a real browser only (in the phone / tablet app it does nothing) */}
                  {!phoneApp && <button type="button" style={{ ...btnPrimary, width: "auto", minHeight: 44, fontSize: 14, opacity: out ? 1 : 0.5 }} disabled={!out} onClick={print} data-testid="wb-print">{preparing ? t.rd_wb_preparing : tpl(t.rd_wb_print_n, { n: n.all })}</button>}
                </div>
                {!phoneApp && <div className="sfl-wb-note" style={{ borderRadius: 12, padding: "10px 12px", fontSize: 12.5, lineHeight: 1.45 }} data-testid="wb-print-note">{t.rd_wb_print_note}</div>}
                {chips}
                {failedLine}
                <div style={{ ...card, padding: 0, gap: 0, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, color: "var(--text)" }} data-testid="wb-table">
                    <thead><tr style={{ textAlign: "left", color: "var(--text-dim)", fontSize: 12 }}>
                      {[t.rd_wb_col_order, t.rd_wb_col_tiktok, t.rd_wb_col_wb, t.rd_wb_col_note].map((h) => <th key={h} style={{ padding: "12px 14px", fontWeight: 700 }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {shown.map((r) => (
                        <tr key={r.index} style={{ borderTop: "1px solid var(--border)" }} data-testid={`wb-row-${r.index}`}>
                          <td style={{ padding: "10px 14px", color: "var(--text-dim)" }}>{tailOf(r) ? `…${tailOf(r)}` : tpl(t.rd_wb_page, { n: r.index + 1 })}</td>
                          <td style={{ padding: "10px 14px", ...mono }}>{r.masked || "—"}</td>
                          <td style={{ padding: "10px 14px" }}><RowAction r={r} t={t} onPick={() => setSheetFor(r.index)} /></td>
                          <td style={{ padding: "10px 14px", color: "var(--text-dim)", fontSize: 13 }}>{rowNote(r, t)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {skipNote}
              </>
            ) : (
              <div style={{ ...card, alignItems: "center", justifyContent: "center", minHeight: 220, color: "var(--text-dim)", fontSize: 14, textAlign: "center" }} data-testid="wb-empty">{t.rd_wb_empty_results}</div>
            )}
          </div>
        </div>
      ) : stage === "upload" ? (
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }} data-testid="wb-upload">
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: "var(--text-dim)" }}><BoldMarks text={t.rd_wb_intro} /></p>
          {csvCard}{pdfCard}{note}
          <div style={{ height: 4 }} />
          {goButton}
        </div>
      ) : (
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }} data-testid="wb-results">
          {tiles}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            {chips}
            <button type="button" style={linkBtn} onClick={() => setStage("upload")} data-testid="wb-new-files">{t.rd_wb_new_files}</button>
          </div>
          <div style={{ ...card, padding: 0, gap: 0, overflow: "hidden" }} data-testid="wb-list">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "10px 12px", fontSize: 12, color: "var(--text-dim)", fontWeight: 700 }}>
              <span>{t.rd_wb_col_tiktok}</span><span style={{ textAlign: "right" }}>{t.rd_wb_col_wb}</span>
            </div>
            {shown.map((r) => (
              <div key={r.index} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderTop: "1px solid var(--border)" }} data-testid={`wb-row-${r.index}`}>
                <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{tailOf(r) ? tpl(t.rd_wb_order, { n: tailOf(r)! }) : tpl(t.rd_wb_page, { n: r.index + 1 })}</span>
                  <span style={{ ...mono, fontSize: 14, color: "var(--text)" }}>{r.masked || "—"}</span>
                </div>
                <div style={{ flexShrink: 1, minWidth: 0, maxWidth: "58%", display: "flex", justifyContent: "flex-end" }}><RowAction r={r} t={t} onPick={() => setSheetFor(r.index)} /></div>
              </div>
            ))}
          </div>
          {skipNote}
          {failedLine}
          <div style={{ position: "sticky", bottom: 0, paddingTop: 8, paddingBottom: 8, background: "linear-gradient(to bottom, transparent, var(--app-bg) 30%)" }}>
            <button type="button" style={{ ...btnPrimary, opacity: out ? 1 : 0.55 }} disabled={!out} onClick={download} data-testid="wb-download">{preparing ? t.rd_wb_preparing : tpl(t.rd_wb_download_n, { n: n.all })}</button>
          </div>
        </div>
      )}

      {msg && <div role="status" data-testid="wb-msg" style={{ position: "fixed", left: 16, right: 16, bottom: "calc(90px + env(safe-area-inset-bottom))", zIndex: 1250, maxWidth: 460, margin: "0 auto", background: "var(--text)", color: "var(--surface)", borderRadius: 12, padding: "12px 14px", fontSize: 13.5, fontWeight: 700, textAlign: "center", boxShadow: "var(--shadow)" }}>{msg}</div>}
      {sheetRow && <PickSheet row={sheetRow} all={buyers ?? []} cur={cur} wide={wide} t={t} onUse={(h) => choose(sheetRow.index, h)} onBlank={() => choose(sheetRow.index, null)} onClose={() => setSheetFor(null)} />}
    </div>
  );
}

type T = ReturnType<typeof useT>;

function csvErrText(e: string, t: T): string {
  return e === "no_username_col" ? t.rd_wb_csv_err_username : e === "no_order_col" ? t.rd_wb_csv_err_order : e === "no_rows" ? t.rd_wb_csv_err_rows : t.rd_wb_csv_err_empty;
}

function rowNote(r: ShownRow, t: T): string {
  if (r.kind === "stamp") return r.picked ? t.rd_wb_note_picked : r.cands[0]?.day === "yesterday" ? t.rd_wb_note_yday : t.rd_wb_note_today;
  if (r.kind === "pick") return t.rd_wb_note_needs;
  if (r.kind === "blank") return t.rd_wb_left_blank;
  return "";
}

function RowAction({ r, t, onPick }: { r: ShownRow; t: T; onPick: () => void }) {
  if (r.kind === "stamp") {
    return (
      <button type="button" onClick={onPick} data-testid={`wb-chip-user-${r.index}`} style={{ minHeight: 44, padding: 0, border: "none", background: "transparent", cursor: "pointer", maxWidth: "100%", display: "inline-flex", alignItems: "center" }}>
        <span className="sfl-wb-ok" style={{ minHeight: 32, display: "inline-flex", alignItems: "center", padding: "0 12px", borderRadius: 999, fontSize: 13, fontWeight: 800, overflowWrap: "anywhere", textAlign: "left" }}>@{r.final}</span>
      </button>
    );
  }
  if (r.kind === "pick") {
    return <button type="button" className="sfl-wb-warn" onClick={onPick} data-testid={`wb-pick-${r.index}`} style={{ minHeight: 44, padding: "0 14px", borderRadius: 12, borderWidth: 1.5, borderStyle: "solid", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" }}>{t.rd_wb_pick_btn}</button>;
  }
  if (r.kind === "blank") {
    return <button type="button" onClick={onPick} data-testid={`wb-blank-${r.index}`} style={{ minHeight: 44, padding: "0 10px", border: "1px dashed var(--border-strong)", borderRadius: 12, background: "transparent", color: "var(--text-dim)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{t.rd_wb_left_blank}</button>;
  }
  const text = r.kind === "cant_place" || r.kind === "no_room" ? t.rd_wb_cant_place : r.kind === "not_in_list" ? t.rd_wb_not_in_list : t.rd_wb_unreadable;
  return <span style={{ fontSize: 12.5, color: "var(--text-dim)", fontWeight: 600, textAlign: "right", lineHeight: 1.35 }} data-testid={`wb-msg-${r.index}`}>{text}</span>;
}

function FileOk({ name, line, onChange, change, testid }: { name: string; line: string; onChange: () => void; change: string; testid: string }) {
  return (
    <div className="sfl-wb-ok" style={{ display: "flex", alignItems: "center", gap: 10, borderRadius: 12, padding: "6px 4px 6px 12px" }} data-testid={testid}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0 }}><path d="M5 12l5 5L20 7" /></svg>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 700, overflowWrap: "anywhere" }}>{name}</span>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{line}</span>
      </div>
      <button type="button" onClick={onChange} style={linkBtn}>{change}</button>
    </div>
  );
}

function DropButton({ label, sub, onClick, testid, big = false }: { label: string; sub?: string; onClick: () => void; testid: string; big?: boolean }) {
  return (
    <button type="button" onClick={onClick} data-testid={testid}
      style={{ minHeight: big ? 92 : 64, border: "2px dashed var(--accent)", borderRadius: 12, background: "var(--accent-softer, var(--accent-soft))", color: "var(--accent-fg)", fontFamily: "var(--font-ui)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer", padding: "8px 10px" }}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" /></svg>
      <span style={{ fontSize: 14, fontWeight: 800 }}>{label}</span>
      {sub && <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{sub}</span>}
    </button>
  );
}

// ── "Pick the buyer" ────────────────────────────────────────────────────────────────────────────
function PickSheet({ row, all, cur, wide, t, onUse, onBlank, onClose }: {
  row: ShownRow; all: Candidate[]; cur: string; wide: boolean; t: T;
  onUse: (handle: string) => void; onBlank: () => void; onClose: () => void;
}) {
  const [sel, setSel] = useState<string | null>(row.final ?? (row.kind === "pick" ? null : row.handle));
  const [q, setQ] = useState("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const found = q.trim() ? searchCandidates(q, all).slice(0, 60) : [];
  const order = tailOf(row) ? tpl(t.rd_wb_order, { n: tailOf(row)! }) : tpl(t.rd_wb_page, { n: row.index + 1 });
  const line = (c: Candidate) => `${c.day === "today" ? t.rd_wb_today : t.rd_wb_yesterday} · ${c.orders === 1 ? t.rd_wb_orders_1 : tpl(t.rd_wb_orders_n, { n: c.orders })} · ${cur}${fmtMoney(c.total)}`;
  const root = (typeof document !== "undefined" && document.querySelector("[data-redesign]")) || document.body;
  const candButton = (c: Candidate, part: "m" | "s") => {
    const on = sel === c.handle;
    return (
      <button key={`${part}-${c.key}`} type="button" onClick={() => setSel(c.handle)} data-testid={part === "m" ? `wb-cand-${c.key}` : `wb-found-${c.key}`} aria-pressed={on}
        style={{ minHeight: 60, display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderRadius: 14, border: `1.5px solid ${on ? "var(--accent)" : "var(--border)"}`, background: on ? "var(--accent-soft)" : "var(--surface)", fontFamily: "var(--font-ui)", textAlign: "left", width: "100%", cursor: "pointer", flexShrink: 0 }}>
        <span aria-hidden style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--accent-soft)", color: "var(--accent-fg)", fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{c.handle.slice(0, 1).toUpperCase()}</span>
        <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", overflowWrap: "anywhere" }}>@{c.handle}</span>
          <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{line(c)}</span>
        </span>
        {on && <span aria-hidden style={{ color: "var(--accent-fg)", fontWeight: 800 }}>✓</span>}
      </button>
    );
  };
  return createPortal(
    <div onClick={onClose} data-testid="wb-sheet" style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.5)", display: "flex", alignItems: wide ? "center" : "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t.rd_wb_sheet_title}
        style={{ width: "100%", maxWidth: wide ? 460 : undefined, boxSizing: "border-box", background: "var(--surface-2)", borderRadius: wide ? 18 : "22px 22px 0 0", padding: "10px 16px calc(16px + env(safe-area-inset-bottom))", boxShadow: "0 -14px 40px rgba(0,0,0,.35)", maxHeight: "86vh", display: "flex", flexDirection: "column", gap: 10 }}>
        {!wide && <span aria-hidden style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 4, background: "var(--border-strong)" }} />}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>{t.rd_wb_sheet_title}</span>
            <span style={{ fontSize: 13, color: "var(--text-dim)", overflowWrap: "anywhere" }}>{tpl(t.rd_wb_sheet_sub, { order, mask: row.masked })}</span>
          </div>
          <button type="button" onClick={onClose} aria-label={t.rd_close} style={{ minWidth: 44, minHeight: 44, border: "none", background: "transparent", color: "var(--text-dim)", fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ overflowY: "auto", minHeight: 0, display: "flex", flexDirection: "column", gap: 8 }} data-testid="wb-sheet-list">
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-dim)" }}>{t.rd_wb_sheet_from}</span>
          {!row.cands.length && <span style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.4 }} data-testid="wb-sheet-none">{tpl(t.rd_wb_sheet_none, { mask: row.masked })}</span>}
          {row.cands.map((c) => candButton(c, "m"))}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.rd_wb_search} aria-label={t.rd_wb_search} data-testid="wb-search"
            style={{ minHeight: 44, flexShrink: 0, borderRadius: 12, border: "1.5px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)", fontSize: 16, padding: "0 12px", fontFamily: "var(--font-ui)", boxSizing: "border-box", width: "100%", marginTop: 4 }} />
          {q.trim() && !found.length && <span style={{ fontSize: 13, color: "var(--text-dim)" }} data-testid="wb-search-none">{t.rd_wb_no_results}</span>}
          {found.map((c) => candButton(c, "s"))}
        </div>
        <button type="button" onClick={onBlank} data-testid="wb-sheet-blank" style={{ minHeight: 44, border: "none", background: "transparent", color: "var(--danger)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>{t.rd_wb_blank}</button>
        <button type="button" disabled={!sel} onClick={() => sel && onUse(sel)} data-testid="wb-sheet-use" style={{ ...btnPrimary, opacity: sel ? 1 : 0.5, flexShrink: 0 }}>{sel ? tpl(t.rd_wb_use, { u: sel }) : t.rd_wb_choose_first}</button>
      </div>
    </div>,
    root,
  );
}
