// Peak Hours heatmap — 7 weekdays × 24 hours of ORDER COUNT over the last 90
// days, in the seller's DEVICE timezone (sql/17 peak_hours). Each cell is a
// button; tapping opens the 7-day buyer drill-down (PeakHourDrill). Intensity =
// --accent alpha (theme/accent-aware); empty = --surface-2. Ungated, all tiers.
import { type CSSProperties } from "react";
import { card, mono } from "../ui";
import { useT, tpl } from "../i18n";
import { weekdayShort, hourLabel, usePeakHourOrders, type UsePeakHours } from "../adapters/peakHours";
import PeakHourDrill from "./PeakHourDrill";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const DOWS = [0, 1, 2, 3, 4, 5, 6];       // Sun..Sat (postgres dow)
const AXIS_TICKS = [0, 6, 12, 18];         // sparse hour labels under the grid

export default function PeakHours({ cur, enabled, peak }: { cur: string; enabled: boolean; peak: UsePeakHours }) {
  const t = useT();
  const drill = usePeakHourOrders(enabled);
  const d = peak.data;
  const max = d?.max ?? 0;

  const cellBg = (c: number): string =>
    c <= 0 || max <= 0 ? "var(--surface-2)" : `rgba(var(--_accent-rgb), ${(0.15 + 0.85 * (c / max)).toFixed(3)})`;

  const labelCol: CSSProperties = { width: 30, flexShrink: 0, fontFamily: mono, fontSize: 9.5, color: "var(--text-muted)", display: "flex", alignItems: "center" };

  return (
    <div style={{ ...card, padding: "16px 14px", marginBottom: 16 }}>
      <div className="sfl-anim-beat" style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 3 }}>{t.rd_pk_title}</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12 }}>{t.rd_pk_sub}</div>

      {peak.state === "loading" && <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "22px 0" }}>{t.rd_pk_loading}</div>}
      {peak.state === "error" && <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "22px 0" }}>{t.rd_pk_error}</div>}
      {peak.state === "empty" && <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "22px 0" }}>{t.rd_pk_empty_grid}</div>}

      {peak.state === "live" && d && (
        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <div style={{ minWidth: 320 }}>
            {DOWS.map((dow) => (
              <div key={dow} style={{ display: "flex", gap: 2, marginBottom: 2, alignItems: "stretch" }}>
                <div style={labelCol}>{weekdayShort(dow)}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(24, 1fr)", gap: 2, flex: 1 }}>
                  {HOURS.map((hour) => {
                    const c = d.grid[dow][hour];
                    return (
                      <button
                        key={hour}
                        type="button"
                        onClick={() => drill.openCell(dow, hour)}
                        title={`${weekdayShort(dow)} ${hourLabel(hour)} · ${tpl(t.rd_pk_cell_orders, { n: c })}`}
                        aria-label={`${weekdayShort(dow)} ${hourLabel(hour)} · ${tpl(t.rd_pk_cell_orders, { n: c })}`}
                        style={{ height: 15, borderRadius: 3, border: "none", padding: 0, cursor: "pointer", background: cellBg(c) }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
            {/* sparse hour axis */}
            <div style={{ display: "flex", gap: 2, marginTop: 4 }}>
              <div style={{ width: 30, flexShrink: 0 }} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(24, 1fr)", gap: 2, flex: 1 }}>
                {HOURS.map((hour) => (
                  <div key={hour} style={{ fontFamily: mono, fontSize: 8, color: "var(--text-muted)", textAlign: "center", whiteSpace: "nowrap" }}>
                    {AXIS_TICKS.includes(hour) ? hourLabel(hour).replace(" ", "") : ""}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <PeakHourDrill cur={cur} drill={drill} />
    </div>
  );
}
