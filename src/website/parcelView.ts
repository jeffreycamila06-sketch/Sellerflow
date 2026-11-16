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

/** Item 2: the parcel the order page may show — only for a shipped 7-ELEVEN / FamilyMart order with a tracking
 *  number (the database already checks this; the page checks again). Otherwise undefined → the page as today. */
export function orderParcel(v: { status: string; delivery: string; tracking?: string; parcel?: ParcelView }): ParcelView | undefined {
  return v.status === "shipped" && (v.delivery === "s711" || v.delivery === "fm") && !!v.tracking ? v.parcel : undefined;
}

/** A time for the order page, in the shop's language on the buyer's device (e.g. "Nov 19, 9:30 AM"). */
export function parcelWhen(iso: string, lang: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  try { return d.toLocaleString(lang, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return d.toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
}
/** The pickup deadline (a date, no time zone shift), e.g. "Nov 26". */
export function parcelDay(day: string, lang: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  try { return d.toLocaleDateString(lang, { month: "short", day: "numeric" }); } catch { return d.toLocaleDateString("en", { month: "short", day: "numeric" }); }
}
/** The styles the parcel parts need — rendered ONLY with a parcel, so an order without one is untouched. */
export const PARCEL_CSS = `
.sfl-v2 .v-tl .v-sub2{display:flex;flex-direction:column;min-width:0}
.sfl-v2 .v-tl .v-sub2 small{display:block;font-weight:500;color:var(--s-mut);font-size:12.5px}
.sfl-v2 .v-tl .v-bad{color:var(--s-fg);font-weight:700}
.sfl-v2 .v-pnote{padding:12px 14px;margin-top:12px;font-size:13.5px;display:flex;flex-direction:column;gap:2px;border:1px solid;border-radius:var(--s-r,10px)}
.sfl-v2 .v-pnote b{font-size:15px}
.sfl-v2 .v-pnote span{color:var(--s-fg)}
.sfl-v2 .v-pnote.v-warn{background:color-mix(in srgb,#f59e0b 12%,var(--s-card));color:color-mix(in srgb,#b45309 72%,var(--s-fg));border-color:color-mix(in srgb,#f59e0b 38%,transparent)}
.sfl-v2 .v-pnote.v-bad{background:color-mix(in srgb,#dc2626 9%,var(--s-card));color:color-mix(in srgb,#dc2626 78%,var(--s-fg));border-color:color-mix(in srgb,#dc2626 32%,transparent)}
.sfl-v2 .v-tl .v-bad::before{background:color-mix(in srgb,#dc2626 78%,var(--s-fg));box-shadow:0 0 0 4px color-mix(in srgb,#dc2626 18%,transparent)}
`;

/** Days left to the pickup deadline, counted on the buyer's device (its own calendar day). Negative = passed. */
export function daysLeft(day: string, now: number = Date.now()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const end = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const d = new Date(now); const today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((end - today) / 86400000);
}
