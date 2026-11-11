// What the Scan QR → Customers lookup shows above the Parcel Scan form (7-11 and FamilyMart use
// this same component). Renders NOTHING for "none" — no record / switch off = the screen as before.
//   found    one record was written into the blank form            (blue)
//   mismatch the details came from another username than the field (yellow)
//   suggest  one record, but something is typed already → "Use"    (blue)
//   choose   2+ records of this username → the seller picks        (yellow)
//   failed   the lookup could not be read → one short line         (grey)
import { tpl, useT } from "../i18n";
import { useLang } from "../i18n/langContext";
import { lookupDate, type ScanQrLookupRow, type ScanQrLookupView } from "../adapters/scanQrLookup";

const TONE = {
  info: { bd: "var(--accent)", bg: "var(--accent-soft)", fg: "var(--accent)" },
  warn: { bd: "var(--warn, #f59e0b)", bg: "var(--warn-soft, rgba(245,158,11,.12))", fg: "var(--warn, #f59e0b)" },
} as const;
const mono = "var(--font-mono)";
const storeChip = { flexShrink: 0, padding: "2px 7px", borderRadius: 7, background: "var(--surface)", border: "1px solid var(--border-strong)", fontFamily: mono, fontSize: 11.5, fontWeight: 800, color: "var(--text)" } as const;

export default function ScanQrLookupBox({ view, onPick, onDismiss, testId }: {
  view: ScanQrLookupView;
  onPick: (row: ScanQrLookupRow) => void;
  onDismiss: () => void;
  testId: string;
}) {
  const t = useT();
  const lang = useLang();
  if (view.kind === "none") return null;
  if (view.kind === "failed") {
    return (
      <div data-testid={testId} data-kind="failed" role="status"
        style={{ margin: "0 0 10px", padding: "8px 11px", borderRadius: 11, border: "1px solid var(--border-strong)", background: "var(--surface-2)", fontSize: 12, fontWeight: 700, color: "var(--text-dim)", lineHeight: 1.4, overflowWrap: "anywhere" }}>
        {t.rd_ql_failed}
      </div>
    );
  }
  const from = view.kind === "suggest" || view.kind === "choose" ? view.from : null;
  const tone = view.kind === "found" || view.kind === "suggest" ? TONE.info : TONE.warn;
  const updated = (iso: string): string => { const d = lookupDate(iso, lang); return d ? tpl(t.rd_ql_updated, { d }) : ""; };
  const title =
    view.kind === "found" || view.kind === "suggest" ? tpl(t.rd_ql_found, { h: view.handle })
    : view.kind === "mismatch" ? tpl(t.rd_ql_mismatch, { h: view.handle })
    : tpl(view.differs === "store" ? t.rd_ql_many_store : view.differs === "phone" ? t.rd_ql_many_phone : t.rd_ql_many, { n: String(view.rows.length), h: view.handle });
  const details = (r: ScanQrLookupRow) => (
    <span style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "3px 8px", marginTop: 3 }}>
      <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{r.phone}</span>
      <span style={storeChip}>{r.storeId}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)" }}>{updated(r.updatedAt)}</span>
    </span>
  );
  return (
    <div data-testid={testId} data-kind={view.kind} role="status"
      style={{ margin: "0 0 10px", padding: "9px 11px", borderRadius: 11, border: `1px solid ${tone.bd}`, background: tone.bg, display: "flex", gap: 9, alignItems: "flex-start" }}>
      <div aria-hidden="true" style={{ flexShrink: 0, width: 20, height: 20, borderRadius: 999, background: tone.fg, color: "var(--surface)", fontSize: 12, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
        {tone === TONE.info ? "✓" : "!"}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        {from && (
          <div style={{ fontSize: 12, fontWeight: 800, color: "var(--warn, #b45309)", overflowWrap: "anywhere", lineHeight: 1.35, marginBottom: 4 }} data-testid={`${testId}-from`}>{tpl(t.rd_ql_mismatch, { h: from })}</div>
        )}
        <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text)", overflowWrap: "anywhere", lineHeight: 1.35 }} data-testid={`${testId}-title`}>{title}</div>
        {view.kind === "found" && updated(view.updatedAt) !== "" && (
          <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-dim)", marginTop: 2, lineHeight: 1.35 }} data-testid={`${testId}-date`}>{updated(view.updatedAt)}</div>
        )}
        {view.kind === "suggest" && (
          <>
            <div style={{ marginTop: 5, fontSize: 12.5, fontWeight: 700, color: "var(--text)", overflowWrap: "anywhere" }} data-testid={`${testId}-row`}>
              {view.row.name}
              {details(view.row)}
            </div>
            <button type="button" onClick={() => onPick(view.row)} data-testid={`${testId}-use`}
              style={{ marginTop: 8, minHeight: 44, padding: "8px 16px", borderRadius: 10, border: "none", background: "var(--accent)", color: "#fff", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
              {t.rd_ql_use}
            </button>
          </>
        )}
        {view.kind === "choose" && (
          <>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-dim)", marginTop: 2, lineHeight: 1.35 }}>{t.rd_ql_many_hint}</div>
            <div style={{ maxHeight: 300, overflowY: "auto", marginTop: 2 }} data-testid={`${testId}-list`}>
              {view.rows.map((r) => (
                <button key={r.id} type="button" onClick={() => onPick(r)} data-testid={`${testId}-pick`}
                  style={{ display: "block", width: "100%", marginTop: 6, padding: "8px 10px", minHeight: 44, borderRadius: 9, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 700, textAlign: "left", cursor: "pointer", overflowWrap: "anywhere" }}>
                  {r.name}
                  {details(r)}
                </button>
              ))}
            </div>
            {view.more && <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)", marginTop: 6, lineHeight: 1.35 }} data-testid={`${testId}-more`}>{tpl(t.rd_ql_more, { n: String(view.rows.length) })}</div>}
            <button type="button" onClick={onDismiss} data-testid={`${testId}-none`}
              style={{ marginTop: 6, padding: "8px 10px", minHeight: 44, width: "100%", borderRadius: 9, border: "1px dashed var(--border-strong)", background: "transparent", color: "var(--text-dim)", fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
              {t.rd_ql_none}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
