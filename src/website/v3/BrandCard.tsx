// Seller Website v3 — item 3: the Brand store product card (docs/design/seller-website-v3/site-v3.html, card()
// in the brand layout). No box; the photos swipe as in Build 1; ONE badge at the bottom left of the photo
// (Sold out › "N% Off" › "N left" when 2 or fewer › New); colour swatches; the name with "N sold"; the
// colour · condition line; the price with the old price struck through in the sale colour.
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useT, tpl } from "../../redesign/i18n";
import type { ShopProduct } from "../shopApi";
import { money } from "../shopApi";
import { cardFacts } from "../v2/cardFacts";
import { SmallPhoto } from "../ui";
import { VIcon } from "../v2/icons";
import { brandBadge } from "./brandBadge";
import { quickPlan, useBrandActions } from "./quickAdd";

type T = Record<string, string>;
export function BrandCard({ p, cur, nowMs, saved, onSave, onOpen, onQuick }: {
  p: ShopProduct; cur: string; nowMs: number; saved: boolean; onSave: () => void; onOpen: () => void;
  /** Build 1's quick add (used when the product isn't a sizes-only product) */
  onQuick: () => void;
}) {
  const t = useT() as unknown as T;
  const f = cardFacts(p, nowMs);
  const photos = p.photos.slice(0, 3);
  const badge = brandBadge(t, f);
  const key = (e: KeyboardEvent) => { if (e.key === "Enter") onOpen(); };
  const line = [f.colour?.values[0], p.condition].filter(Boolean).join(" · ");
  const act = useBrandActions();
  const plan = quickPlan(p);
  const stop = (e: MouseEvent, fn: () => void) => { e.stopPropagation(); fn(); };
  // item 4: sizes over the photo (laptop hover) + a "+" (phones: opens the size sheet); Build 1's rule otherwise
  let quick: ReactNode = null;
  if (f.stock > 0 && act) {
    quick = plan.kind === "sizes"
      ? <>
          <div className="v-qs" data-testid="card-qs" onClick={(e) => e.stopPropagation()}>
            {plan.sizes.map((s) => <button key={s.vid} type="button" disabled={s.stock <= 0} data-testid="card-qs-size" onClick={(e) => stop(e, () => act.addSize(p.id, s.vid))}>{s.label}</button>)}
          </div>
          <button type="button" className="v-qplus" data-testid="card-quick" aria-label={t.rd_shop_add_cart} onClick={(e) => stop(e, () => act.openSizes(p.id))}>+</button>
        </>
      : <button type="button" className="v-qplus v-qany" data-testid="card-quick" aria-label={t.rd_shop_add_cart} onClick={(e) => stop(e, onQuick)}>+</button>;
  }
  return (
    <div className={`v-card${f.stock ? "" : " v-sold"}`} data-testid="shop-item" data-card="brand" role="link" tabIndex={0} aria-label={p.name} onClick={onOpen} onKeyDown={key}>
      <div className="v-ph">
        <button type="button" className={`v-hrt${saved ? " v-on" : ""}`} data-testid="card-heart" aria-pressed={saved} aria-label={saved ? t.rd_shop_unsave : t.rd_shop_save}
          onClick={(e) => { e.stopPropagation(); onSave(); }}><VIcon n="heart" size={16} filled={saved} /></button>
        <div className="v-imgs" data-testid="card-photos">
          {photos.length ? photos.map((ph) => <SmallPhoto key={ph} path={ph} alt="" loading="lazy" className="v-art" style={{ flex: "0 0 100%", height: "100%", objectFit: "cover" }} />)
            : <div className="v-art v-ph0" style={{ flex: "0 0 100%" }}>{p.name.slice(0, 1)}</div>}
        </div>
        {badge && <span className="v-off2" data-testid="brand-badge" data-kind={badge.kind}>{badge.text}</span>}
        {quick}
      </div>
      <div className="v-inf">
        {f.colour && f.colour.values.length > 1 && (
          <div className="v-sw2" data-testid="card-swatches">{f.colour.values.slice(0, 6).map((v) => <i key={v} title={v} style={{ background: f.colour!.swatches?.[v] || "#9ca3af" }} />)}</div>
        )}
        <div className="v-t2"><span className="v-nm">{p.name}</span>{p.sold ? <span className="v-rt" data-testid="card-sold">{tpl(t.rd_shop_n_sold, { n: p.sold.toLocaleString("en-US") })}</span> : null}</div>
        {line && <div className="v-vr">{line}</div>}
        <div className="v-pr"><b data-testid="card-price">{f.from ? `${t.rd_shop_from} ` : ""}{money(cur, f.now)}</b>{f.was && <s data-testid="card-was">{money(cur, f.was)}</s>}</div>
      </div>
    </div>
  );
}
