// Seller Website v2 (item 9) — the seller's OWN units-sold totals (sql/167 product_sold_totals, RLS own rows),
// for the editor's preview. Read on Preview only. Before sql/167 / any error → an empty map (no "sold").
import { isSupabaseConfigured, supabase } from "../../supabase";

export async function loadSoldUnits(): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!isSupabaseConfigured || !supabase) return out;
  try {
    const { data, error } = await supabase.from("product_sold_totals").select("product_local_id,units").limit(5000);
    if (error || !Array.isArray(data)) return out;
    for (const r of data as { product_local_id: unknown; units: unknown }[]) {
      const id = Number(r.product_local_id), n = Number(r.units);
      if (Number.isFinite(id) && Number.isFinite(n) && n > 0) out.set(id, n);
    }
  } catch { /* none */ }
  return out;
}
