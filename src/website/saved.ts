// Seller Website v2 — saved items (♡) and the orders placed from this device. Both live on THIS device
// only (localStorage, per shop): no account, nothing sent anywhere. Pure helpers + storage.
const SAVED = (sub: string) => `sfl_shop_saved_${sub}`;
const ORDERS = (sub: string) => `sfl_shop_orders_${sub}`;
export const MAX_SAVED = 200;
export const MAX_DEVICE_ORDERS = 30;

export function toggleSaved(list: number[], id: number): number[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [id, ...list].slice(0, MAX_SAVED);
}
export function loadSaved(sub: string): number[] {
  try {
    const j = JSON.parse(localStorage.getItem(SAVED(sub)) || "[]");
    return Array.isArray(j) ? j.filter((x) => Number.isSafeInteger(x)).slice(0, MAX_SAVED) : [];
  } catch { return []; }
}
export function storeSaved(sub: string, list: number[]): void { try { localStorage.setItem(SAVED(sub), JSON.stringify(list)); } catch { /* per device */ } }

export interface DeviceOrder { token: string; no: string; at: string; total: number }
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
export function addDeviceOrder(list: DeviceOrder[], o: DeviceOrder): DeviceOrder[] {
  return [o, ...list.filter((x) => x.token !== o.token)].slice(0, MAX_DEVICE_ORDERS);
}
export function loadDeviceOrders(sub: string): DeviceOrder[] {
  try {
    const j = JSON.parse(localStorage.getItem(ORDERS(sub)) || "[]");
    return Array.isArray(j) ? j.filter((x) => x && TOKEN_RE.test(String(x.token)) && typeof x.no === "string")
      .map((x) => ({ token: String(x.token), no: String(x.no).slice(0, 12), at: String(x.at || ""), total: Number(x.total) || 0 })).slice(0, MAX_DEVICE_ORDERS) : [];
  } catch { return []; }
}
export function storeDeviceOrders(sub: string, list: DeviceOrder[]): void { try { localStorage.setItem(ORDERS(sub), JSON.stringify(list)); } catch { /* per device */ } }
