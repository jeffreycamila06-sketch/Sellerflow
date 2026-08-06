// Peak Hours — a 7×24 (weekday × hour) heatmap of ORDER COUNT over the last 90
// days, in the SELLER'S DEVICE timezone, plus a per-cell drill-down of the
// buyers in that slot. Two RPCs, both own-scoped (SECURITY INVOKER + explicit
// user_id filter), zero poll:
//   • peak_hours(p_tz)                    → counts (sql/17, from public.orders, 90d)
//   • peak_hour_orders(p_dow,p_hour,p_tz) → buyer rows (sql/19, live_session_orders, 7d)
// Timezone is the device IANA name (Intl…timeZone); the RPC buckets with
// AT TIME ZONE p_tz so +6:30 offsets (Yangon) are exact. Pure mappers are
// unit-tested; the hooks are user-action driven (load-on-tap, cached).
import { useCallback, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";

// Device IANA timezone name (e.g. "Asia/Taipei", "Asia/Yangon"). Passed verbatim
// to the RPC so the grid and the drill-down bucket by the SAME local clock.
export function deviceTz(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Taipei"; }
  catch { return "Asia/Taipei"; }
}

const num = (v: unknown): number => Number(v) || 0;

// ── Heatmap counts ────────────────────────────────────────────────────────────
export interface PeakCell { dow: number; hour: number; c: number }
export interface PeakHoursData {
  tz: string;
  total: number;
  cells: PeakCell[];        // only non-empty cells (as returned)
  grid: number[][];         // [dow 0..6][hour 0..23] dense count grid
  max: number;              // busiest single cell (for the intensity scale)
}

// peak_hours jsonb → dense 7×24 grid (pure, garbage-safe).
export function mapPeakHours(raw: unknown): PeakHoursData {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const grid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const cells: PeakCell[] = [];
  let max = 0;
  const rawCells = Array.isArray(r.cells) ? (r.cells as Record<string, unknown>[]) : [];
  for (const x of rawCells) {
    const dow = num(x.dow), hour = num(x.hour), c = num(x.c);
    if (dow >= 0 && dow < 7 && hour >= 0 && hour < 24) {
      grid[dow][hour] = c;
      cells.push({ dow, hour, c });
      if (c > max) max = c;
    }
  }
  return { tz: String(r.tz ?? ""), total: num(r.total), cells, grid, max };
}

export type PeakState = "idle" | "loading" | "live" | "empty" | "error";

export interface UsePeakHours {
  data: PeakHoursData | null;
  state: PeakState;
  load: () => void;   // one RPC, cached until reload (load-once)
  reload: () => void;
}

export function usePeakHours(enabled: boolean): UsePeakHours {
  const [data, setData] = useState<PeakHoursData | null>(null);
  const [state, setState] = useState<PeakState>("idle");
  const fetchNow = useCallback(() => {
    if (!enabled || !isSupabaseConfigured || !supabase) { setState("error"); return; }
    setState("loading");
    supabase.rpc("peak_hours", { p_tz: deviceTz() }).then(
      ({ data: raw, error }) => {
        if (error) { setState("error"); return; }
        const mapped = mapPeakHours(raw);
        setData(mapped);
        setState(mapped.total > 0 ? "live" : "empty");
      },
      () => setState("error"),
    );
  }, [enabled]);
  const load = useCallback(() => { if (state === "idle" || state === "error") fetchNow(); }, [state, fetchNow]);
  const reload = useCallback(() => { setData(null); fetchNow(); }, [fetchNow]);
  return { data, state, load, reload };
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
