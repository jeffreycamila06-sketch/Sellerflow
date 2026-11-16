// Seller Website v2 — item 7: two pages that live on THIS device only (no account):
// Saved (the ♡ items) and Orders (the order links of orders placed from this device).
import { useT } from "../../redesign/i18n";
import type { Shop } from "../shopApi";
import { money } from "../shopApi";
import { Card } from "../v2/Card";
import type { DeviceOrder } from "../saved";

type T = Record<string, string>;
export function SavedPage({ shop, cur, nowMs, saved, onSave, onOpen, onQuick, onShop }: {
  shop: Shop; cur: string; nowMs: number; saved: number[]; onSave: (id: number) => void; onOpen: (id: number) => void; onQuick: (id: number) => void; onShop: () => void;
}) {
  const t = useT() as unknown as T;
  const list = saved.map((id) => shop.products.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p);
  return (
    <div className="v-wrap" data-testid="saved-page">
      <h2 style={{ fontSize: 22, margin: "14px 0 10px" }}>{t.rd_shop_saved_title}</h2>
      {list.length
        ? <div className="v-grid">{list.map((p) => <Card key={p.id} p={p} cur={cur} nowMs={nowMs} saved onSave={() => onSave(p.id)} onOpen={() => onOpen(p.id)} onQuick={() => onQuick(p.id)} />)}</div>
        : <div className="v-empty" data-testid="saved-empty">{t.rd_shop_saved_empty}<br /><br /><button type="button" className="v-btn" onClick={onShop}>{t.rd_shop_start}</button></div>}
    </div>
  );
}

export function OrdersPage({ orders, cur, onOpen, onShop }: { orders: DeviceOrder[]; cur: string; onOpen: (token: string) => void; onShop: () => void }) {
  const t = useT() as unknown as T;
  return (
    <div className="v-wrap" data-testid="orders-page">
      <h2 style={{ fontSize: 22, margin: "14px 0 4px" }}>{t.rd_shop_orders_title}</h2>
      <p style={{ color: "var(--s-mut)", fontSize: 12.5, margin: "0 0 12px" }}>{t.rd_shop_orders_device}</p>
      {orders.length
        ? <div style={{ display: "grid", gap: 8 }}>{orders.map((o) => (
            <button key={o.token} type="button" className="v-ci" data-testid="device-order" onClick={() => onOpen(o.token)} style={{ width: "100%", textAlign: "left", cursor: "pointer", color: "inherit", alignItems: "center" }}>
              <span className="v-m"><b>{o.no}</b><small>{fmtDate(o.at)}</small></span>
              <b style={{ color: "var(--s-acc)" }}>{money(cur, o.total)}</b><span aria-hidden="true" style={{ marginLeft: 6 }}>›</span>
            </button>
          ))}</div>
        : <div className="v-empty" data-testid="orders-empty"><b>{t.rd_shop_orders_none}</b><br />{t.rd_shop_orders_none_sub}<br /><br /><button type="button" className="v-btn" onClick={onShop}>{t.rd_shop_start}</button></div>}
    </div>
  );
}
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
}
