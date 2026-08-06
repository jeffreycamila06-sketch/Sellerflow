// Peak Hours — the Sales Report "Today" tab shows an "Orders by hour" bar graph
// (order COUNT per device-local hour, derived client-side from the current
// live-session orders — no fetch), and tapping a bar opens a drill-down of the
// buyers in that hour today. The drill reuses peak_hour_orders(p_dow,p_hour,p_tz)
// (sql/19, live_session_orders, 7d, own-scoped SECURITY INVOKER + explicit
// user_id filter). For the Today tab, p_dow = today's weekday, so "most recent
// occurrence of this weekday+hour in the last 7 days" resolves to TODAY.
// (The 7×24 90-day heatmap + peak_hours(p_tz) RPC were removed — the RPC is
// still live in the DB but now unreferenced by the client, which is harmless.)
// Timezone is the device IANA name (Intl…timeZone); the RPC buckets with
// AT TIME ZONE p_tz so +6:30 offsets (Yangon) are exact. Pure helpers are
// unit-tested; the drill hook is user-action driven (fetch-on-tap).
import { useCallback, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";

// Device IANA timezone name (e.g. "Asia/Taipei", "Asia/Yangon"). Passed verbatim
// to the RPC so the grid and the drill-down bucket by the SAME local clock.
export function deviceTz(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Taipei"; }
  catch { return "Asia/Taipei"; }
}

const num = (v: unknown): number => Number(v) || 0;

export type PeakState = "idle" | "loading" | "live" | "empty" | "error";

// ── Today "Orders by hour" (pure, client-side) ───────────────────────────────
// Bucket the CURRENT live-session orders by DEVICE-LOCAL hour. orderNum is epoch
// ms (Date.now()-style — see lib/orderTypes), so new Date(orderNum).getHours()
// is the device-local hour with no extra fetch/RPC. Returns a dense length-24
// count array (index = hour 0..23). Rows with a non-finite orderNum are skipped.
export function ordersByHour(orders: { orderNum: number }[]): number[] {
  const counts = new Array(24).fill(0);
  for (const o of orders) {
    const ms = Number(o?.orderNum);
    if (!Number.isFinite(ms)) continue;
    const h = new Date(ms).getHours();
    if (h >= 0 && h < 24) counts[h] += 1;
  }
  return counts;
}

// Index of the busiest hour (for the peak highlight); -1 when all hours are 0.
export function peakHourIndex(counts: number[]): number {
  let idx = -1, max = 0;
  for (let h = 0; h < counts.length; h++) {
    if (counts[h] > max) { max = counts[h]; idx = h; }
  }
  return idx;
}

// ── Drill-down: buyers in one weekday+hour (most recent, last 7 days) ─────────
export interface PeakOrderRow {
  buyerNumber: number;
  name: string;
  handle: string;
  platform: string;
  product: string;
  price: number;
  createdAt: string;   // ISO — the order time
}
export interface PeakHourOrdersData {
  dow: number;
  hour: number;
  date: string | null;   // the resolved local date, or null when no occurrence
  rows: PeakOrderRow[];
}

// peak_hour_orders jsonb → rows (pure, garbage-safe).
export function mapPeakHourOrders(raw: unknown): PeakHourOrdersData {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rows: PeakOrderRow[] = Array.isArray(r.rows)
    ? (r.rows as Record<string, unknown>[]).map((x) => ({
        buyerNumber: num(x.buyer_number),
        name: String(x.customer_name ?? ""),
        handle: String(x.handle ?? ""),
        platform: String(x.platform ?? ""),
        product: String(x.product ?? ""),
        price: num(x.price),
        createdAt: String(x.created_at ?? ""),
      }))
    : [];
  return {
    dow: num(r.dow),
    hour: num(r.hour),
    date: r.date == null ? null : String(r.date),
    rows,
  };
}

export interface UsePeakHourOrders {
  data: PeakHourOrdersData | null;
  state: PeakState;
  open: boolean;
  openCell: (dow: number, hour: number) => void;  // fetch that cell's buyers
  close: () => void;
}

export function usePeakHourOrders(enabled: boolean): UsePeakHourOrders {
  const [data, setData] = useState<PeakHourOrdersData | null>(null);
  const [state, setState] = useState<PeakState>("idle");
  const [open, setOpen] = useState(false);
  const openCell = useCallback((dow: number, hour: number) => {
    setOpen(true);
    setData(null);
    if (!enabled || !isSupabaseConfigured || !supabase) { setState("error"); return; }
    setState("loading");
    supabase.rpc("peak_hour_orders", { p_dow: dow, p_hour: hour, p_tz: deviceTz() }).then(
      ({ data: raw, error }) => {
        if (error) { setState("error"); return; }
        const mapped = mapPeakHourOrders(raw);
        setData(mapped);
        setState(mapped.rows.length > 0 ? "live" : "empty");
      },
      () => setState("error"),
    );
  }, [enabled]);
  const close = useCallback(() => { setOpen(false); }, []);
  return { data, state, open, openCell, close };
}

// ── Pure label helpers (device-locale where practical; unit-tested) ──────────
// A reference date whose UTC weekday == dow (2024-01-07 is a Sunday = dow 0).
function refDateForDow(dow: number): Date { return new Date(Date.UTC(2024, 0, 7 + (((dow % 7) + 7) % 7))); }

// Full localized weekday, e.g. "Wednesday" / "星期三". Falls back to a fixed
// English name if Intl is unavailable.
const EN_DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function weekdayLabel(dow: number, locale?: string): string {
  const i = (((dow % 7) + 7) % 7);
  try { return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(refDateForDow(i)); }
  catch { return EN_DOW[i]; }
}
// Short localized weekday for the grid axis, e.g. "Wed" / "三".
export function weekdayShort(dow: number, locale?: string): string {
  const i = (((dow % 7) + 7) % 7);
  try { return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(refDateForDow(i)); }
  catch { return EN_DOW[i].slice(0, 3); }
}
// 12-hour clock label for a 0..23 hour, e.g. 21 → "9 PM", 0 → "12 AM". Pure +
// deterministic (no locale — the AM/PM words are localized separately if needed).
export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ampm}`;
}
