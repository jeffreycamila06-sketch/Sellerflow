// Seller Website v2 — item 3: the Shop page (as the preview). Phone: category chips + size / in-stock /
// on-sale chips, 2 columns. Laptop: a filter column on the left, 4 columns. "N items" + sort (newest ·
// best selling · price up · price down). Nothing matches → a helpful empty state with "Clear filters".
import { useMemo } from "react";
import { useT, tpl } from "../../redesign/i18n";
import type { Shop } from "../shopApi";
import { Card } from "../v2/Card";
import { applyFilter, sizesOf, isFiltered, NO_FILTER, type ShopFilter, type ShopSort } from "../shopFilter";

type T = Record<string, string>;
export default function ShopList({ shop, cur, nowMs, f, setF, saved, onSave, onOpen, onQuick, onHome }: {
  shop: Shop; cur: string; nowMs: number; f: ShopFilter; setF: (f: ShopFilter) => void;
  saved: number[]; onSave: (id: number) => void; onOpen: (id: number) => void; onQuick: (id: number) => void; onHome: () => void;
}) {
  const t = useT() as unknown as T;
  const cats = useMemo(() => [...new Set(shop.products.map((p) => p.category).filter((c): c is string => !!c))], [shop.products]);
  const sizes = useMemo(() => sizesOf(shop.products), [shop.products]);
  const list = useMemo(() => applyFilter(shop.products, f, nowMs), [shop.products, f, nowMs]);
  const set = (p: Partial<ShopFilter>) => setF({ ...f, ...p });
  const title = f.cat || (f.sale ? t.rd_shop_on_sale : t.rd_shop_all_products);
  const chip = (on: boolean) => `v-chip${on ? " v-on" : ""}`;
  const side = (on: boolean) => (on ? "v-on" : "");
  return (
    <div className="v-wrap" data-testid="shop-list">
      <div className="v-crumb"><button type="button" onClick={onHome}>{t.rd_shop_nav_home}</button> › {title}{f.q ? ` › “${f.q}”` : ""}</div>
      <div className="v-list">
        <div className="v-fside" data-testid="shop-fside">
          <b>{t.rd_shop_f_category}</b>
          <button type="button" className={side(!f.cat)} onClick={() => set({ cat: "" })}>{t.rd_shop_all_products}</button>
          {cats.map((c) => <button key={c} type="button" className={side(f.cat === c)} onClick={() => set({ cat: c })}>{c}</button>)}
          {sizes.length > 0 && <><b>{t.rd_shop_f_size}</b>
            <button type="button" className={side(!f.size)} onClick={() => set({ size: "" })}>{t.rd_shop_any_size}</button>
            {sizes.map((s) => <button key={s} type="button" className={side(f.size === s)} onClick={() => set({ size: s })}>{s}</button>)}</>}
          <b>{t.rd_shop_f_avail}</b>
          <button type="button" className={side(f.stock)} onClick={() => set({ stock: !f.stock })}>{t.rd_shop_in_stock}</button>
          <button type="button" className={side(f.sale)} onClick={() => set({ sale: !f.sale })}>{t.rd_shop_on_sale}</button>
        </div>
        <div>
          <h2 style={{ fontSize: 22 }} data-testid="shop-list-title">{title}</h2>
          <div className="v-chips v-fc" data-testid="shop-cat-chips">
            <button type="button" className={chip(!f.cat)} onClick={() => set({ cat: "" })}>{t.rd_shop_all}</button>
            {cats.map((c) => <button key={c} type="button" className={chip(f.cat === c)} data-testid="shop-cat-chip" onClick={() => set({ cat: c })}>{c}</button>)}
          </div>
          <div className="v-chips v-fc" style={{ paddingTop: 0 }} data-testid="shop-size-chips">
            {sizes.length > 0 && <button type="button" className={chip(!f.size)} onClick={() => set({ size: "" })}>{t.rd_shop_any_size}</button>}
            {sizes.map((s) => <button key={s} type="button" className={chip(f.size === s)} data-testid="shop-size-chip" onClick={() => set({ size: f.size === s ? "" : s })}>{tpl(t.rd_shop_size_n, { size: s })}</button>)}
            <button type="button" className={chip(f.stock)} data-testid="shop-stock-chip" aria-pressed={f.stock} onClick={() => set({ stock: !f.stock })}>{t.rd_shop_in_stock}</button>
            <button type="button" className={chip(f.sale)} data-testid="shop-sale-chip" aria-pressed={f.sale} onClick={() => set({ sale: !f.sale })}>{t.rd_shop_on_sale}</button>
          </div>
          <div className="v-tool">
            <span data-testid="shop-count">{tpl(t.rd_shop_n_items, { n: String(list.length) })}</span>
            <select data-testid="shop-sort" aria-label={t.rd_shop_sort} value={f.sort} onChange={(e) => set({ sort: e.target.value as ShopSort })}>
              <option value="new">{t.rd_shop_sort_new}</option>
              <option value="best">{t.rd_shop_sort_best}</option>
              <option value="lo">{t.rd_shop_sort_up}</option>
              <option value="hi">{t.rd_shop_sort_down}</option>
            </select>
          </div>
          {list.length
            ? <div className="v-grid v-g4" data-testid="shop-grid">{list.map((p) => <Card key={p.id} p={p} cur={cur} nowMs={nowMs} saved={saved.includes(p.id)} onSave={() => onSave(p.id)} onOpen={() => onOpen(p.id)} onQuick={() => onQuick(p.id)} />)}</div>
            : (
              <div className="v-empty" data-testid="shop-empty">
                <b>{t.rd_shop_nothing}</b><br />{isFiltered(f) ? t.rd_shop_nothing_sub : t.rd_shop_no_products}<br /><br />
                {isFiltered(f) && <button type="button" className="v-btn" data-testid="shop-clear" onClick={() => setF({ ...NO_FILTER, sort: f.sort })}>{t.rd_shop_clear_filters}</button>}
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
