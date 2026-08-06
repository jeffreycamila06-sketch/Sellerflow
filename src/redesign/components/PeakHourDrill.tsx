// Peak Hours drill-down — buyers in one weekday+hour, MOST RECENT occurrence
// within the last 7 days (all the buyer-handle window contains; see sql/19).
// Rendered via createPortal(document.body) so the full-height sheet escapes the
// sticky-header stacking context (the raffle-wheel precedent). Own-scoped buyer
// PII — the same fields the seller already sees in Orders/Customers/live feed;
// @handle is accent-colored as the anti-fraud cross-check focus.
import { type CSSProperties, useEffect } from "react";
import { createPortal } from "react-dom";
import { mono } from "../ui";
import { fmt } from "../data";
import { useT, tpl } from "../i18n";
import { weekdayLabel, hourLabel, type UsePeakHourOrders } from "../adapters/peakHours";

function localTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  try { return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }
  catch { return ""; }
}

export default function PeakHourDrill({ cur, drill }: { cur: string; drill: UsePeakHourOrders }) {
  const t = useT();
  // Body scroll lock while open (raffle precedent).
  useEffect(() => {
    if (!drill.open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [drill.open]);
  // Escape closes.
  useEffect(() => {
    if (!drill.open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") drill.close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drill.open, drill]);

  if (!drill.open) return null;
  const d = drill.data;
  const slot = d ? `${weekdayLabel(d.dow)} ${hourLabel(d.hour)}` : "";

  const overlay: CSSProperties = { position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 16, fontFamily: "var(--font-ui)" };
  const sheet: CSSProperties = { width: "100%", maxWidth: 440, maxHeight: "82vh", display: "flex", flexDirection: "column", background: "var(--surface)", borderRadius: 22, boxShadow: "0 24px 60px rgba(9,7,24,.5)", marginBottom: "max(8px, env(safe-area-inset-bottom))", overflow: "hidden" };
  const head: CSSProperties = { padding: "18px 18px 14px", borderBottom: "1px solid var(--border)", position: "relative", flexShrink: 0 };

  return createPortal(
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t.rd_pk_drill_title} onClick={drill.close}>
      <div style={sheet} onClick={(e) => e.stopPropagation()} data-testid="peak-drill">
        <div style={head}>
          <button onClick={drill.close} aria-label={t.rd_upd_close} data-testid="peak-drill-close" style={{ position: "absolute", top: 14, right: 14, width: 30, height: 30, borderRadius: 999, border: "none", background: "var(--chip-bg)", color: "var(--text-dim)", cursor: "pointer", fontSize: 15, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 700, color: "var(--text)", letterSpacing: "-.01em", paddingRight: 34 }}>
            {t.rd_pk_drill_title}{slot ? ` · ${slot}` : ""}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 3 }}>{t.rd_pk_drill_recent}</div>
        </div>

        <div style={{ overflowY: "auto", padding: "8px 0 12px", WebkitOverflowScrolling: "touch" }}>
          {drill.state === "loading" && <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "26px 0" }}>{t.rd_pk_loading}</div>}
          {drill.state === "error" && <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "26px 0" }}>{t.rd_pk_error}</div>}
          {drill.state === "empty" && <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "26px 0" }}>{t.rd_pk_empty}</div>}
          {drill.state === "live" && d && (
            <>
              {d.rows.map((r, i) => (
                <div key={`${r.buyerNumber}-${i}`} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 16px", borderBottom: i < d.rows.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 800, color: "var(--text-muted)", minWidth: 30, textAlign: "right" }}>#{r.buyerNumber}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name || "—"}</div>
                    <div style={{ display: "flex", gap: 6, alignItems: "baseline", overflow: "hidden" }}>
                      {r.handle && <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--handle)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.handle}</span>}
                      {r.product && <span style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>· {r.product}</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{cur}{fmt(r.price)}</div>
                    <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 1 }}>{localTime(r.createdAt)}</div>
                  </div>
                </div>
              ))}
              <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", padding: "12px 16px 2px" }}>{tpl(t.rd_pk_drill_count, { n: d.rows.length })}</div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
