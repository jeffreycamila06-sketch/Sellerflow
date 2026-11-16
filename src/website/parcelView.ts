// Seller Website — the parcel's state from Pickup Status, as the order page and the seller's Website orders
// receive it (sql/171: same seller, same chain, same number; exactly one parcel). PURE, unit-tested.
// Only these six fields are ever kept; anything else in the answer is dropped.
export type ParcelState = "in_transit" | "at_store" | "picked_up" | "returned";
export interface ParcelView { state: ParcelState; arrivedAt?: string; deadline?: string; pickedUpAt?: string; returnedAt?: string; checkedAt?: string }
const STATES: ParcelState[] = ["in_transit", "at_store", "picked_up", "returned"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const when = (v: unknown) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : undefined);
/** The answer's `parcel` → a ParcelView, or undefined (no match / a state the page doesn't show / odd data). */
export function cleanParcel(raw: unknown): ParcelView | undefined {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o || !STATES.includes(o.state as ParcelState)) return undefined;
  const p: ParcelView = { state: o.state as ParcelState };
  const a = when(o.arrivedAt), pu = when(o.pickedUpAt), r = when(o.returnedAt), c = when(o.checkedAt);
  if (a) p.arrivedAt = a;
  if (typeof o.deadline === "string" && DAY.test(o.deadline)) p.deadline = o.deadline;
  if (pu) p.pickedUpAt = pu;
  if (r) p.returnedAt = r;
  if (c) p.checkedAt = c;
  return p;
}
