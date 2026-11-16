// Seller Website v3 — the Brand store card's one badge (pure, unit-tested).
import { tpl } from "../../redesign/i18n";
import type { cardFacts } from "../v2/cardFacts";

type T = Record<string, string>;
/** The one badge, in the preview's order. Pure. */
export function brandBadge(t: T, f: ReturnType<typeof cardFacts>): { kind: "sold" | "off" | "left" | "new"; text: string } | null {
  if (f.stock === 0) return { kind: "sold", text: t.rd_shop_sold_out };
  if (f.off > 0) return { kind: "off", text: tpl(t.rd_brand_off, { n: String(f.off) }) };
  if (f.stock <= 2) return { kind: "left", text: tpl(t.rd_shop_n_left, { n: String(f.stock) }) };
  if (f.isNew) return { kind: "new", text: t.rd_brand_new };
  return null;
}
