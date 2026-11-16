// Seller Website v2 — the seller's shipping options list (pure, unit-tested).
// Saved in seller_websites.settings.shipOptions. Nothing saved yet → the list is derived from today's
// settings (Taiwan: 7-11 / FamilyMart / home exactly as today), plus the country's ready-made options
// (off). publicCheckoutV2 = a mirror of the database's website_checkout_v2 (the editor's live preview).
import type { WebsiteSettings } from "./websiteSeller";
import { ID_RE, SHIP_NEEDS, type CheckoutV2, type PayOpt, type ShipNeeds, type ShipOpt } from "../../website/shipPay";

export interface ShipSetting { id: string; name: string; note: string; fee: number; freeOver: number; needs: ShipNeeds; cod: boolean; on: boolean }
export const MAX_SHIP_OPTIONS = 10;

const o = (id: string, needs: ShipNeeds, fee: number, cod: boolean, on: boolean): ShipSetting => ({ id, name: "", note: "", fee, freeOver: 0, needs, cod, on });
/** The ready-made list for a country (Jeff 2026-11-16): Taiwan as today; others off, Local pickup on + free. */
export function readyShipOptions(country: string): ShipSetting[] {
  const c = (country || "TW").toUpperCase();
  if (c === "TW") return [o("s711", "store711", 60, true, true), o("fm", "storefm", 60, true, true), o("home", "address", 120, false, false)];
  if (c === "CA" || c === "AU") return [o("std", "address", 0, false, false), o("exp", "address", 0, false, false), o("pickup", "none", 0, true, true)];
  if (c === "PH") return [o("jt", "address", 0, true, false), o("lbc", "address", 0, true, false), o("pickup", "none", 0, true, true)];
  return [o("std", "address", 0, false, false), o("pickup", "none", 0, true, true)];
}

const n0 = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0; };
const bool = (v: unknown, d: boolean) => (v === true || v === "true" ? true : v === false || v === "false" ? false : d);
/** One saved entry → a clean setting, or null when unusable. Pure. */
function cleanShip(x: unknown): ShipSetting | null {
  const e = x && typeof x === "object" ? (x as Record<string, unknown>) : null;
  if (!e || typeof e.id !== "string" || !ID_RE.test(e.id) || !SHIP_NEEDS.includes(e.needs as ShipNeeds)) return null;
  return { id: e.id, name: typeof e.name === "string" ? e.name.slice(0, 40) : "", note: typeof e.note === "string" ? e.note.slice(0, 80) : "",
    fee: n0(e.fee), freeOver: n0(e.freeOver), needs: e.needs as ShipNeeds, cod: bool(e.cod, false), on: bool(e.on, false) };
}

/** What the editor shows: the saved list, else today's settings as a list; then the ready-made ones not in it (off). Pure. */
export function editorShipOptions(st: WebsiteSettings, country: string): ShipSetting[] {
  const tw = (country || "TW").toUpperCase() === "TW";
  let list: ShipSetting[];
  if (Array.isArray(st.shipOptions)) {
    const seen = new Set<string>();
    list = st.shipOptions.map(cleanShip).filter((x): x is ShipSetting => !!x && !seen.has(x.id) && !!seen.add(x.id))
      .filter((x) => tw || (x.needs !== "store711" && x.needs !== "storefm"));
  } else {
    const fo = n0(st.freeOver);
    const s711 = st.ship?.s711, fm = st.ship?.fm, home = st.ship?.home;
    list = [
      ...(tw ? [{ ...o("s711", "store711", s711?.fee === undefined ? 60 : n0(s711.fee), true, s711?.enabled !== false), freeOver: fo },
                { ...o("fm", "storefm", fm?.fee === undefined ? 60 : n0(fm.fee), true, fm?.enabled !== false), freeOver: fo }] : []),
      { ...o("home", "address", home?.fee === undefined ? 120 : n0(home.fee), false, home?.enabled === true), freeOver: fo },
      ...(tw ? [] : [o("pickup", "none", 0, true, true)]),
    ].filter((x) => tw || x.id !== "home" || x.on); // other countries: home only if it was on
  }
  const have = new Set(list.map((x) => x.id));
  return [...list, ...readyShipOptions(country).filter((r) => !have.has(r.id)).map((r) => ({ ...r, on: false }))];
}

/** Save the list; Taiwan's 7-11 / FamilyMart / home + free-over are also written to the old fields (for a rollback). Pure. */
export function withShipOptions(st: WebsiteSettings, list: ShipSetting[]): WebsiteSettings {
  const byId = new Map(list.map((x) => [x.id, x]));
  const ship = { ...st.ship };
  for (const k of ["s711", "fm", "home"] as const) {
    const x = byId.get(k);
    if (x) ship[k] = { enabled: x.on, fee: x.fee };
  }
  const fos = list.filter((x) => x.on && (x.id === "s711" || x.id === "fm" || x.id === "home")).map((x) => x.freeOver);
  return { ...st, shipOptions: list.map((x) => ({ ...x })), ship, ...(fos.length ? { freeOver: Math.min(...fos) } : {}) };
}

/** A new option the seller adds (typed name). Pure. */
export function newShipOption(rand: () => number = Math.random): ShipSetting {
  return { ...o(`c${Math.floor(rand() * 36 ** 5).toString(36).padStart(5, "0")}`, "address", 0, false, true) };
}

/** Problems that stop Save: no option on; an on option without a name where it has no ready name. Pure. */
export function shipProblems(list: ShipSetting[]): ("none" | "name")[] {
  const out: ("none" | "name")[] = [];
  if (!list.some((x) => x.on)) out.push("none");
  if (list.some((x) => x.on && x.id.startsWith("c") && !x.name.trim())) out.push("name");
  return out;
}

/** Mirror of the database's website_checkout_v2: settings + country → what a buyer may see. Pure. */
export function publicCheckoutV2(st: WebsiteSettings, country: string): CheckoutV2 {
  const c = (country || "TW").toUpperCase();
  const fo = n0(st.freeOver);
  let options: ShipOpt[] = [];
  if (Array.isArray(st.shipOptions)) {
    const seen = new Set<string>();
    for (const x of st.shipOptions) {
      const e = x && typeof x === "object" ? (x as unknown as Record<string, unknown>) : null;
      if (!e || typeof e.id !== "string" || !ID_RE.test(e.id) || !bool(e.on, false) || !SHIP_NEEDS.includes(e.needs as ShipNeeds)) continue;
      if (c !== "TW" && (e.needs === "store711" || e.needs === "storefm")) continue;
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      const name = typeof e.name === "string" ? e.name.trim().slice(0, 40) : "", note = typeof e.note === "string" ? e.note.trim().slice(0, 80) : "";
      const f = n0(e.freeOver);
      options.push({ id: e.id, fee: n0(e.fee), needs: e.needs as ShipNeeds, cod: bool(e.cod, false), ...(name ? { name } : {}), ...(note ? { note } : {}), ...(f > 0 ? { freeOver: f } : {}) });
      if (options.length >= MAX_SHIP_OPTIONS) break;
    }
  } else {
    const f = fo > 0 ? { freeOver: fo } : {};
    if (c === "TW" && st.ship?.s711?.enabled !== false) options.push({ id: "s711", fee: st.ship?.s711?.fee === undefined ? 60 : n0(st.ship.s711.fee), needs: "store711", cod: true, ...f });
    if (c === "TW" && st.ship?.fm?.enabled !== false) options.push({ id: "fm", fee: st.ship?.fm?.fee === undefined ? 60 : n0(st.ship.fm.fee), needs: "storefm", cod: true, ...f });
    if (st.ship?.home?.enabled === true) options.push({ id: "home", fee: st.ship.home.fee === undefined ? 120 : n0(st.ship.home.fee), needs: "address", cod: false, ...f });
    if (c !== "TW") options.push({ id: "pickup", fee: 0, needs: "none", cod: true });
  }
  options = options.slice(0, MAX_SHIP_OPTIONS);
  const methods: PayOpt[] = [];
  if (st.bank?.enabled) methods.push({ id: "bank", kind: "first", bank: { bankName: st.bank.bankName?.slice(0, 60) || undefined, accountName: st.bank.accountName?.slice(0, 60) || undefined, accountNumber: st.bank.accountNumber?.slice(0, 40) || undefined } });
  if (st.qr?.enabled && st.qr.path) methods.push({ id: "qr", kind: "first", qr: st.qr.path, ...(st.qr.label ? { name: st.qr.label.slice(0, 40) } : {}) });
  if (st.cod?.enabled) methods.push({ id: "cod", kind: "delivery" });
  const h = Math.round(Number(st.autoCancelHours));
  return { options, methods, autoCancelHours: Math.min(168, Math.max(1, Number.isFinite(h) && h ? h : 24)) };
}
