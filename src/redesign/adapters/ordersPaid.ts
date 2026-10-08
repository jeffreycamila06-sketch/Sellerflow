// B2 — paid flag on an order (switch orders_paid_flag_enabled, sql/101). Display + one write per
// tap; nothing is ever sent to the buyer. The order loads are untouched: while the switch is on,
// Orders reads id + paid_at + created_at of the same orders with ONE small query (read on open,
// zero poll) and pairs each order with its row. An order without a row yet (still being saved)
// simply shows no paid control.
import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";
import type { Order } from "../data";

export const PAID_EXPIRE_MS = 24 * 60 * 60 * 1000;

export interface PaidRow { id: number; paidAt: string | null; createdAt: string }
interface DbRow { id: number; buyer_number: number; handle: string | null; platform: string | null; product: string | null; price: number | null; qty: number | null; created_at: string; paid_at: string | null }

const bare = (h: string | null | undefined) => String(h || "").replace(/^@/, "");
const groupKey = (bNum: number, handle: string, platform: string, item: string, total: number) => `${bNum}|${bare(handle)}|${platform}|${item}|${total}`;
export const orderKey = (o: Order) => `${o.orderNum ?? ""}|${o.id}|${o.handle}|${o.platform}|${o.items}|${o.total}`;

// Pure: pair orders with their rows. Same buyer#, handle, platform, item and total; inside a
// group the n-th oldest order takes the n-th oldest row. → Map orderKey → row.
export function matchPaidRows(orders: Order[], rows: DbRow[]): Map<string, PaidRow> {
  const byGroup = new Map<string, DbRow[]>();
  for (const r of rows) {
    const qty = Math.max(1, Math.floor(Number(r.qty) || 1));
    const k = groupKey(Number(r.buyer_number), bare(r.handle), String(r.platform || ""), String(r.product ?? ""), (Number(r.price) || 0) * qty);
    if (!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k)!.push(r);
  }
  for (const g of byGroup.values()) g.sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0) || a.id - b.id);
  const ordGroups = new Map<string, Order[]>();
  for (const o of orders) {
    const bNum = Number(String(o.id).replace(/^#/, ""));
    if (!Number.isFinite(bNum)) continue;
    const k = groupKey(bNum, o.handle, o.platform, o.items, o.total);
    if (!ordGroups.has(k)) ordGroups.set(k, []);
    ordGroups.get(k)!.push(o);
  }
  const out = new Map<string, PaidRow>();
  for (const [k, os] of ordGroups) {
    const rs = byGroup.get(k) || [];
    const sorted = [...os].sort((a, b) => (a.orderNum ?? 0) - (b.orderNum ?? 0));
    sorted.forEach((o, i) => { const r = rs[i]; if (r) out.set(orderKey(o), { id: r.id, paidAt: r.paid_at, createdAt: r.created_at }); });
  }
  return out;
}

// Unpaid more than 24 hours after the order → "Expired" (display only).
export function isPaidExpired(row: PaidRow | undefined, nowMs: number): boolean {
  if (!row || row.paidAt) return false;
  const t = Date.parse(row.createdAt);
  return Number.isFinite(t) && nowMs - t > PAID_EXPIRE_MS;
}

async function loadRows(sinceIso: string): Promise<DbRow[] | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const uid = (await supabase.auth.getSession()).data.session?.user?.id;
    if (!uid) return null;
    const out: DbRow[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("live_session_orders")
        .select("id,buyer_number,handle,platform,product,price,qty,created_at,paid_at")
        .eq("user_id", uid).gte("created_at", sinceIso)
        .order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, from + 999);
      if (error) return null;
      out.push(...((data || []) as DbRow[]));
      if (!data || data.length < 1000) return out;
    }
  } catch { return null; }
}

export async function savePaid(id: number, paid: boolean, nowMs: number = Date.now()): Promise<string | null | false> {
  if (!isSupabaseConfigured || !supabase) return false;
  const paidAt = paid ? new Date(nowMs).toISOString() : null;
  try {
    const { error } = await supabase.from("live_session_orders").update({ paid_at: paidAt }).eq("id", id);
    return error ? false : paidAt;
  } catch { return false; }
}

// on = the switch. Reads once per open (and when the order list grows), never when off.
export function usePaidFlags(on: boolean, orders: Order[]) {
  const [rows, setRows] = useState<DbRow[]>([]);
  const nums = orders.map((o) => o.orderNum).filter((n): n is number => typeof n === "number");
  const since = nums.length ? Math.min(...nums) - 60_000 : 0;
  const count = orders.length;
  useEffect(() => {
    if (!on || !since) return;
    let alive = true;
    void loadRows(new Date(since).toISOString()).then((r) => { if (alive && r) setRows(r); });
    return () => { alive = false; };
  }, [on, since, count]);
  const map = on ? matchPaidRows(orders, rows) : new Map<string, PaidRow>();
  const setPaid = useCallback(async (row: PaidRow, paid: boolean) => {
    const res = await savePaid(row.id, paid);
    if (res === false) return false;
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, paid_at: res } : r)));
    return true;
  }, []);
  return { map, setPaid };
}
