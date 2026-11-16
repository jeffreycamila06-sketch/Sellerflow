// Seller Website v3 — item 4: quick add on the Brand store (pure, unit-tested).
// A product whose only choice is its size (one colour or none) gets the sizes right on the card: on phones
// a "+" opens a size sheet, on laptop the sizes show over the photo on hover; sold-out sizes are disabled.
// Anything else — more than one colour, or no sizes — follows Build 1's quick-add rule (nothing to choose →
// straight into the cart; a choice still needed → open the product page).
import type { ShopProduct } from "../shopApi";
import { createContext, useContext } from "react";

export interface QuickSize { label: string; vid: number; stock: number }
export type QuickPlan = { kind: "sizes"; sizes: QuickSize[] } | { kind: "build1" };
export function quickPlan(p: ShopProduct): QuickPlan {
  const groups = p.groups || [];
  const colour = groups.find((g) => g.color);
  const others = groups.filter((g) => !g.color);
  const size = others[0];
  const vs = p.variants || [];
  // exactly one choice besides the colour, and at most one colour; anything else = Build 1's rule
  if (others.length !== 1 || !vs.length || (colour && colour.values.length > 1)) return { kind: "build1" };
  const sizes: QuickSize[] = [];
  for (const label of size.values) {
    const v = vs.find((x) => x.values.includes(label) && (!colour || x.values.includes(colour.values[0])));
    if (v) sizes.push({ label, vid: v.id, stock: v.stock });
  }
  return sizes.length ? { kind: "sizes", sizes } : { kind: "build1" };
}

/** What a Brand store card's quick-add controls do (provided by the shop app). */
export interface BrandActions { openSizes: (pid: number) => void; addSize: (pid: number, vid: number) => void }
export const BrandActionsCtx = createContext<BrandActions | null>(null);
export const useBrandActions = () => useContext(BrandActionsCtx);
