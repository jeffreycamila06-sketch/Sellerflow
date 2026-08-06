// "Orders by hour" — Today-tab bar graph: 24 bars (hours 0–23), height = COUNT
// of orders created that device-local hour today (derived client-side from the
// live-session orders, no fetch), with the count on top of each non-empty bar
// and the peak bar highlighted. Tapping a bar with orders opens the buyer
// drill-down for that hour today (reuses peak_hour_orders via usePeakHourOrders;
// p_dow = today's weekday, so the RPC's most-recent-match resolves to today).
import { type CSSProperties } from "react";
import { card, mono } from "../ui";
import { useT } from "../i18n";
import { hourLabel, peakHourIndex, usePeakHourOrders } from "../adapters/peakHours";
import PeakHourDrill from "./PeakHourDrill";

const HOURS = Array.from({ length: 24 }, (_, h) => h);

export default function OrdersByHour({ cur, enabled, byHour }: { cur: string; enabled: boolean; byHour: number[] }) {
  const t = useT();
  const drill = usePeakHourOrders(enabled);
  const counts = byHour.length === 24 ? byHour : new Array(24).fill(0);
  const max = Math.max(0, ...counts);
  const peak = peakHourIndex(counts);
  const total = counts.reduce((s, c) => s + c, 0);

  const tapHour = (hour: number) => {
    if (counts[hour] <= 0) return;                 // empty hour → not tappable
    drill.openCell(new Date().getDay(), hour);     // today's weekday + this hour
  };

  const tick: CSSProperties = { fontFamily: mono, fontSize: 8, color: "var(--text-muted)", textAlign: "center", whiteSpace: "nowrap" };

  return (
    <div style={{ ...card, padding: "16px 14px", marginBottom: 16 }}>
      <div className="sfl-anim-beat" style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 3 }}>{t.rd_pk_hh_title}</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12 }}>{t.rd_pk_hh_sub}</div>

      {total === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "18px 0" }}>{t.rd_pk_hh_empty}</div>
      ) : (
        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <div style={{ minWidth: 320 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(24, 1fr)", gap: 2, alignItems: "end", height: 108 }}>
              {HOURS.map((h) => {
                const c = counts[h];
                const isPeak = h === peak && c > 0;
                // 4%..100% of the track height, scaled to the busiest hour.
                const pct = c > 0 && max > 0 ? Math.max(8, Math.round((c / max) * 100)) : 2;
                return (
                  <button
                    key={h}
                    type="button"
                    onClick={() => tapHour(h)}
                    disabled={c <= 0}
                    title={c > 0 ? `${hourLabel(h)} · ${c}` : hourLabel(h)}
                    aria-label={`${hourLabel(h)} · ${c}`}
                    style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", height: "100%", gap: 3, border: "none", background: "transparent", padding: 0, cursor: c > 0 ? "pointer" : "default" }}
                  >
                    {c > 0 && <span style={{ fontFamily: mono, fontSize: 8.5, fontWeight: 700, color: isPeak ? "var(--ok)" : "var(--text-muted)", lineHeight: 1 }}>{c}</span>}
                    <div style={{ width: "100%", height: `${pct}%`, minHeight: 2, borderRadius: 3, background: c <= 0 ? "var(--surface-2)" : isPeak ? "var(--ok)" : "var(--accent)", opacity: c <= 0 ? 1 : isPeak ? 1 : 0.8 }} />
                  </button>
                );
              })}
            </div>
            {/* sparse hour axis: 12a / 6a / 12p / 6p */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(24, 1fr)", gap: 2, marginTop: 4 }}>
              {HOURS.map((h) => (
                <div key={h} style={tick}>{[0, 6, 12, 18].includes(h) ? hourLabel(h).replace(" ", "") : ""}</div>
              ))}
            </div>
          </div>
        </div>
      )}

      <PeakHourDrill cur={cur} drill={drill} />
    </div>
  );
}
