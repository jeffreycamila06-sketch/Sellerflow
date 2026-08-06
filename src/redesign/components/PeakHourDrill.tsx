// Peak Hours drill-down — buyers in one weekday+hour, MOST RECENT occurrence
// within the last 7 days (all the buyer-handle window contains; see sql/19).
// FULL-SCREEN page (owner: the small modal was cramped): fills the viewport via
// createPortal(document.body) so it escapes the sticky-header stacking context.
// ⚠️ Tokens are scoped to [data-redesign] (a wrapper div, NOT body), so the
// portal STAMPS data-redesign + the live theme/accent/motion onto its root or
// var(--…) would not resolve outside the stage. Own-scoped buyer PII — the same
// fields shown in Orders/Customers/live feed; @handle is accent-colored + large
// as the anti-fraud cross-check focus.
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

// Read the live theme/accent/motion off the app stage so the portal (mounted on
// document.body, outside [data-redesign]) resolves the same tokens.
function stageAttrs(): { theme?: string; accent?: string; motion?: string } {
  if (typeof document === "undefined") return {};
  const stage = document.querySelector("[data-redesign]");
  return {
    theme: stage?.getAttribute("data-theme") ?? undefined,
    accent: stage?.getAttribute("data-accent") ?? undefined,
    motion: stage?.getAttribute("data-motion") ?? undefined,
  };
}

const backArrow = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

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
  const { theme, accent, motion } = stageAttrs();

  // Full-viewport page (not a floating card): solid surface, header + scroll body.
  const page: CSSProperties = { position: "fixed", inset: 0, zIndex: 1300, background: "var(--surface)", display: "flex", flexDirection: "column", fontFamily: "var(--font-ui)" };
  const header: CSSProperties = { background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "max(12px, env(safe-area-inset-top)) 12px 14px", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 };
  const backBtn: CSSProperties = { width: 44, height: 44, flexShrink: 0, borderRadius: 12, border: "none", background: "rgba(255,255,255,.16)", color: "var(--on-header)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };
  const scroll: CSSProperties = { flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" };
  const inner: CSSProperties = { maxWidth: 640, margin: "0 auto", padding: "6px 14px calc(20px + env(safe-area-inset-bottom))" };
  const note: CSSProperties = { fontSize: 14, color: "var(--text-muted)", textAlign: "center", padding: "48px 16px" };

  return createPortal(
    <div data-redesign="" data-theme={theme} data-accent={accent} data-motion={motion} className="sfl-anim-screen" style={page} role="dialog" aria-modal="true" aria-label={t.rd_pk_drill_title} data-testid="peak-drill">
      <div style={header}>
        <button onClick={drill.close} aria-label={t.rd_pk_back} data-testid="peak-drill-close" style={backBtn}>{backArrow}</button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, letterSpacing: "-.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t.rd_pk_drill_title}{slot ? ` · ${slot}` : ""}
          </div>
          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>{t.rd_pk_drill_recent}</div>
        </div>
      </div>

      <div style={scroll}>
        {drill.state === "loading" && <div style={note}>{t.rd_pk_loading}</div>}
        {drill.state === "error" && <div style={note}>{t.rd_pk_error}</div>}
        {drill.state === "empty" && <div style={note}>{t.rd_pk_empty}</div>}
        {drill.state === "live" && d && (
          <div style={inner}>
            {d.rows.map((r, i) => (
              <div key={`${r.buyerNumber}-${i}`} style={{ display: "flex", alignItems: "center", gap: 13, padding: "14px 4px", borderBottom: i < d.rows.length - 1 ? "1px solid var(--border)" : "none" }}>
                <span style={{ fontFamily: mono, fontSize: 15, fontWeight: 800, color: "var(--accent-fg)", minWidth: 40, textAlign: "right" }}>#{r.buyerNumber}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name || "—"}</div>
                  {r.handle && <div style={{ fontSize: 14, fontWeight: 700, color: "var(--handle)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.handle}</div>}
                  {r.product && <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.product}</div>}
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontFamily: mono, fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{cur}{fmt(r.price)}</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{localTime(r.createdAt)}</div>
                </div>
              </div>
            ))}
            <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: "16px 0 2px" }}>{tpl(t.rd_pk_drill_count, { n: d.rows.length })}</div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
