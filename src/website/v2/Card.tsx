// Seller Website v2 — the product card (as the preview): up to 3 photos you can swipe (dots), badges
// (-N% · New · "N left" when 1–2 · Sold out), a heart to save it on this device, the name, colour dots
// (or the sizes), the price with the old price struck through, "N sold" (real sold units — no ratings),
// and a quick-add "+" that opens the product when a choice is needed.
import type { KeyboardEvent } from "react";
import { useT, tpl } from "../../redesign/i18n";
import type { ShopProduct } from "../shopApi";
import { money } from "../shopApi";
import { cardFacts } from "./cardFacts";
import { SmallPhoto } from "../ui";
import { VIcon } from "./icons";

type T = Record<string, string>;
export function Card({ p, cur, nowMs, saved, onSave, onOpen, onQuick, rank }: {
  p: ShopProduct; cur: string; nowMs: number; saved: boolean; onSave: () => void; onOpen: () => void; onQuick: () => void; rank?: number;
}) {
  const t = useT() as unknown as T;
  const f = cardFacts(p, nowMs);
  const photos = p.photos.slice(0, 3);
  const key = (e: KeyboardEvent) => { if (e.key === "Enter") onOpen(); };
  return (
    <div className={`v-card${f.stock ? "" : " v-sold"}`} data-testid="shop-item" role="link" tabIndex={0} aria-label={p.name} onClick={onOpen} onKeyDown={key}>
      <div className="v-ph">
        {rank
          ? <div className="v-rank" data-testid="card-rank">#{rank}</div>
          : (
            <div className="v-bdg">
              {f.stock === 0 && <span className="v-x" data-testid="badge-sold">{t.rd_shop_sold_out}</span>}
              {f.off > 0 && <span data-testid="badge-off">-{f.off}%</span>}
              {f.isNew && f.stock > 0 && <span className="v-n" data-testid="badge-new">{t.rd_shop_new}</span>}
              {f.stock > 0 && f.stock <= 2 && <span className="v-l" data-testid="badge-left">{tpl(t.rd_shop_n_left, { n: String(f.stock) })}</span>}
            </div>
          )}
        <button type="button" className={`v-hrt${saved ? " v-on" : ""}`} data-testid="card-heart" aria-pressed={saved} aria-label={saved ? t.rd_shop_unsave : t.rd_shop_save}
          onClick={(e) => { e.stopPropagation(); onSave(); }}><VIcon n="heart" size={16} filled={saved} /></button>
        <div className="v-imgs" data-testid="card-photos">
          {photos.length ? photos.map((ph) => <SmallPhoto key={ph} path={ph} alt="" loading="lazy" className="v-art" style={{ flex: "0 0 100%", height: "100%", objectFit: "cover" }} />)
            : <div className="v-art v-ph0" style={{ flex: "0 0 100%" }}>{p.name.slice(0, 1)}</div>}
        </div>
        {photos.length > 1 && <div className="v-pd3">{photos.map((ph) => <i key={ph} />)}</div>}
      </div>
      <div className="v-inf">
        <div className="v-nm">{p.name}</div>
        <div className="v-sw" data-testid="card-swatches">
          {f.colour
            ? <>{f.colour.values.slice(0, 5).map((v) => <i key={v} title={v} style={{ background: f.colour!.swatches?.[v] || "#9ca3af" }} />)}<small>{tpl(t.rd_shop_n_colours, { n: String(f.colour.values.length) })}</small></>
            : f.sizes ? <small>{f.sizes.values.slice(0, 6).join(" · ")}</small> : null}
        </div>
        <div className="v-pr"><b data-testid="card-price">{f.from ? `${t.rd_shop_from} ` : ""}{money(cur, f.now)}</b>{f.was && <s data-testid="card-was">{money(cur, f.was)}</s>}</div>
        <div className="v-meta">
          <span>{p.sold ? tpl(t.rd_shop_n_sold, { n: p.sold.toLocaleString("en-US") }) : f.isNew ? t.rd_shop_just_in : ""}</span>
          {f.stock > 0 && <button type="button" className="v-qa" data-testid="card-quick" aria-label={t.rd_shop_add_cart} onClick={(e) => { e.stopPropagation(); onQuick(); }}>+</button>}
        </div>
      </div>
    </div>
  );
}
