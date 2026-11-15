// Seller Website — checkout flow (part 3). Part 2 ships the shop; checkout lands in part 3.
import type { ShopPage } from "./route";
import type { Shop } from "./shopApi";
import type { LineInfo } from "./cart";
export function CheckoutFlow(_p: { shop: Shop; cur: string; route: ShopPage; go: (r: ShopPage) => void; infos: LineInfo[]; preview: boolean; onPlaced: () => void }) {
  return null;
}
