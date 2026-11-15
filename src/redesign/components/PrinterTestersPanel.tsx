// Admin → Printer testers (sql/160). Three tabs:
//  • Testers — add / remove an email (feature key printer_tester in feature_access_emails);
//  • Test reports — newest first; a Clean report offers "Add to printer list";
//  • Approved — the approved_printers rows; Remove = active false (Add back = active true).
// Every tab tap re-reads the lists (a report sent while the panel is open shows without closing it).
// Every call is an admin-only RPC (is_admin() inside). The approved list reaches sellers' scan on
// their next app open (one read per session).
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  adminAddTester, adminApprovePrinter, adminListApproved, adminListReports, adminListTesters, adminPhotoUrl,
  adminRemoveTester, adminSetApprovedActive, adminSetApprovedLayout, defaultPrefix, parseShiftMm, LANG_LABEL,
  type ApprovedRow, type ReportRow, type TesterRow,
} from "../adapters/printerTesters";
import { useT, tpl } from "../i18n";

type Tab = "testers" | "reports" | "approved";
const tabBtn = (on: boolean): CSSProperties => ({ flex: 1, minHeight: 40, padding: "9px 0", border: "none", borderRadius: 10, fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", ...(on ? { background: "var(--surface)", color: "var(--accent-fg)", boxShadow: "var(--shadow)" } : { background: "transparent", color: "var(--text-dim)" }) });
const row: CSSProperties = { display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface-2)" };
const small: CSSProperties = { fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.4 };
const btn: CSSProperties = { minHeight: 36, fontSize: 12, fontWeight: 700, color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border-strong)", padding: "7px 11px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)", flexShrink: 0 };
const primary: CSSProperties = { ...btn, border: "none", background: "var(--accent)", color: "var(--accent-text)" };
const input: CSSProperties = { width: "100%", boxSizing: "border-box", minHeight: 44, padding: "10px 12px", border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 16, outline: "none" };
const day = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); };

function Photo({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let live = true; void adminPhotoUrl(path).then((u) => { if (live) setUrl(u); }); return () => { live = false; }; }, [path]);
  if (!url) return <div style={{ width: 56, height: 56, borderRadius: 8, background: "var(--surface)", border: "1px solid var(--border)", flexShrink: 0 }} />;
  return <a href={url} target="_blank" rel="noreferrer"><img data-testid="pt-photo" src={url} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)", flexShrink: 0 }} /></a>;
}

type Loaded = { ok: boolean; testers: TesterRow[]; reports: ReportRow[]; approved: ApprovedRow[] };
async function fetchAll(): Promise<Loaded> {
  const [a, b, c] = await Promise.all([adminListTesters(), adminListReports(), adminListApproved()]);
  return { ok: a.ok && b.ok && c.ok, testers: a.data || [], reports: b.data || [], approved: c.data || [] };
}

// "Flip 180°" + "Shift left (mm)" for an approved printer (sql/161): upside-down print / right edge cut.
// Shift 0–8, step 0.5; both saved with one Save.
const validShiftText = (v: string): number | null => {
  const s = v.trim().replace(",", ".");
  if (!/^\d+(\.\d)?$/.test(s)) return null;
  const n = Number(s);
  return n >= 0 && n <= 8 ? n : null;
};
function LayoutBox({ saved, savedFlip, busy, onSave }: { saved: number; savedFlip: boolean; busy: boolean; onSave: (mm: number, flip: boolean) => Promise<boolean> }) {
  const t = useT();
  const [v, setV] = useState(String(saved));
  const [flip, setFlip] = useState(savedFlip);
  const n = validShiftText(v);
  const changed = n !== null && (n !== saved || flip !== savedFlip);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
      <label style={{ ...small, flex: "1 1 120px", display: "flex", flexDirection: "column", gap: 3 }}>{t.rd_prt_shift}
        <input data-testid="pt-shift" type="number" inputMode="decimal" min={0} max={8} step={0.5} value={v} onChange={(e) => setV(e.target.value)} style={input} />
        {n === null && <span data-testid="pt-shift-bad" style={{ color: "var(--danger)", fontWeight: 700 }}>{t.rd_prt_shift_bad}</span>}
      </label>
      <button data-testid="pt-flip" type="button" aria-pressed={flip} onClick={() => setFlip((f) => !f)} style={{ ...btn, minHeight: 44, border: flip ? "2px solid var(--accent)" : btn.border, background: flip ? "var(--accent-softer)" : btn.background }}>{t.rd_prt_flip}: {flip ? t.rd_prt_on : t.rd_prt_off}</button>
      <button data-testid="pt-shift-save" disabled={busy || !changed} onClick={() => { if (n !== null) void onSave(n, flip); }} style={{ ...primary, minHeight: 44, opacity: busy || !changed ? 0.5 : 1 }}>{t.rd_prt_save}</button>
    </div>
  );
}

export default function PrinterTestersPanel() {
  const t = useT();
  const [tab, setTab] = useState<Tab>("testers");
  const [testers, setTesters] = useState<TesterRow[] | null>(null);
  const [reports, setReports] = useState<ReportRow[] | null>(null);
  const [approved, setApproved] = useState<ApprovedRow[] | null>(null);
  const [err, setErr] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [approving, setApproving] = useState<{ report: ReportRow; prefix: string; brand: string; model: string } | null>(null);

  const apply = useCallback((r: Loaded) => {
    setErr(!r.ok); setTesters(r.testers); setReports(r.reports); setApproved(r.approved);
  }, []);
  const load = useCallback(async () => { apply(await fetchAll()); }, [apply]);
  useEffect(() => { let live = true; void fetchAll().then((r) => { if (live) apply(r); }); return () => { live = false; }; }, [apply]);
  const run = async (fn: () => Promise<{ ok: boolean }>) => { setBusy(true); const r = await fn(); setBusy(false); if (!r.ok) setErr(true); await load(); return r.ok; };

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  return (
    <div data-testid="pt-panel">
      <div style={{ display: "flex", gap: 6, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12, padding: 4, marginBottom: 12 }}>
        <button data-testid="pt-tab-testers" style={tabBtn(tab === "testers")} onClick={() => { setTab("testers"); void load(); }}>{t.rd_prt_tab_testers}</button>
        <button data-testid="pt-tab-reports" style={tabBtn(tab === "reports")} onClick={() => { setTab("reports"); void load(); }}>{t.rd_prt_tab_reports}</button>
        <button data-testid="pt-tab-approved" style={tabBtn(tab === "approved")} onClick={() => { setTab("approved"); void load(); }}>{t.rd_prt_tab_approved}</button>
      </div>
      {err && <div data-testid="pt-error" style={{ fontSize: 12, fontWeight: 700, color: "var(--danger)", marginBottom: 10 }}>{t.rd_prt_load_failed}</div>}

      {tab === "testers" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={small}>{t.rd_prt_testers_hint}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input data-testid="pt-email" type="email" inputMode="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" style={input} />
            <button data-testid="pt-add" disabled={!validEmail || busy} onClick={() => void run(() => adminAddTester(email)).then((ok) => { if (ok) setEmail(""); })} style={{ ...primary, minHeight: 44, opacity: validEmail && !busy ? 1 : 0.5 }}>{t.rd_prt_add}</button>
          </div>
          {testers && testers.length === 0 && <div style={small}>{t.rd_prt_none}</div>}
          {(testers || []).map((x) => (
            <div key={x.email} data-testid="pt-tester" style={row}>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis" }}>{x.email}</div><div style={small}>{day(x.created_at)}</div></div>
              <button data-testid="pt-remove" disabled={busy} onClick={() => void run(() => adminRemoveTester(x.email))} style={btn}>{t.rd_prt_remove}</button>
            </div>
          ))}
        </div>
      )}

      {tab === "reports" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {reports && reports.length === 0 && <div style={small}>{t.rd_prt_none}</div>}
          {(reports || []).map((r) => (
            <div key={r.id} data-testid="pt-report" style={{ ...row, alignItems: "flex-start", flexDirection: "column" }}>
              <div style={{ display: "flex", gap: 10, width: "100%" }}>
                {r.photo_path && <Photo path={r.photo_path} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", overflowWrap: "anywhere" }}>{r.printer_name || "—"} · {LANG_LABEL[r.lang] || r.lang}</div>
                  <div data-testid="pt-report-clean" style={{ fontSize: 12, fontWeight: 800, color: r.clean ? "var(--ok)" : "var(--danger)", marginTop: 2 }}>{r.clean ? t.rd_prt_clean : t.rd_prt_not_clean}{!r.send_ok ? ` · ${r.send_code || "error"}` : ""}</div>
                  <div style={{ ...small, overflowWrap: "anywhere" }}>{r.email} · {day(r.created_at)} · {r.sticker_size}</div>
                </div>
              </div>
              {r.clean && approving?.report.id !== r.id && (
                <button data-testid="pt-approve" onClick={() => setApproving({ report: r, prefix: defaultPrefix(r.printer_name), brand: "Other", model: r.printer_name })} style={{ ...primary, width: "100%" }}>{t.rd_prt_add_list}</button>
              )}
              {approving?.report.id === r.id && (
                <div data-testid="pt-approve-form" style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={small}>{t.rd_prt_prefix}<input data-testid="pt-prefix" value={approving.prefix} onChange={(e) => setApproving({ ...approving, prefix: e.target.value })} style={input} /></label>
                  <label style={small}>{t.rd_prt_brand}<input data-testid="pt-brand" value={approving.brand} onChange={(e) => setApproving({ ...approving, brand: e.target.value })} style={input} /></label>
                  <label style={small}>{t.rd_prt_model}<input data-testid="pt-model" value={approving.model} onChange={(e) => setApproving({ ...approving, model: e.target.value })} style={input} /></label>
                  <div style={small}>{tpl(t.rd_prt_approve_lang, { lang: LANG_LABEL[r.lang] || r.lang })}</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button data-testid="pt-approve-save" disabled={busy || approving.prefix.trim().length < 2} onClick={() => void run(() => adminApprovePrinter({ reportId: r.id, prefix: approving.prefix, brand: approving.brand, model: approving.model || approving.prefix, lang: r.lang })).then((ok) => { if (ok) setApproving(null); })} style={{ ...primary, flex: 1, minHeight: 44 }}>{t.rd_prt_save}</button>
                    <button onClick={() => setApproving(null)} style={{ ...btn, flex: 1, minHeight: 44 }}>{t.rd_prt_cancel}</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "approved" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {approved && approved.length === 0 && <div style={small}>{t.rd_prt_none}</div>}
          {(approved || []).map((a) => (
            <div key={a.id} data-testid="pt-approved" style={{ ...row, opacity: a.active ? 1 : 0.55, flexDirection: "column", alignItems: "stretch" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", overflowWrap: "anywhere" }}>{a.brand} {a.model} · {LANG_LABEL[a.lang] || a.lang}</div>
                  <div style={small}>{a.prefix}… · {day(a.approved_at)}{a.active ? "" : ` · ${t.rd_prt_removed}`}</div>
                </div>
                <button data-testid="pt-approved-toggle" disabled={busy} onClick={() => void run(() => adminSetApprovedActive(a.id, !a.active))} style={btn}>{a.active ? t.rd_prt_remove : t.rd_prt_add_back}</button>
              </div>
              <LayoutBox key={`${a.id}:${String(a.shift_mm ?? 0)}:${a.flip === true}`} saved={parseShiftMm(a.shift_mm)} savedFlip={a.flip === true} busy={busy} onSave={(mm, flip) => run(() => adminSetApprovedLayout(a.id, mm, flip))} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
