// Products — LOCAL CRUD, byte-faithful to App.tsx `Products` (1295-1314). Same
// localStorage key ("sf_prods"), same default seed, same status rule, same
// add/edit/delete/search/CSV. Shares the key with production, so a seller's local
// products are identical in both apps. ⚠️ Supabase cross-device sync is NOT in main
// → that part stays "Soon"; this is the real current backend (localStorage).
export interface Product { id: number; name: string; sku: string; price: number; stock: number; platform: string; status: string }
export interface ProductForm { name: string; sku: string; price: string; stock: string; platform: string }

const KEY = "sf_prods";

// App.tsx:1296 `def` — the exact 5-item seed used when nothing is stored yet.
export const PRODUCT_DEFAULTS: Product[] = [
  { id: 1, name: "Red dress, size M", sku: "RD-M-001", price: 350, stock: 24, platform: "TikTok / FB", status: "Active" },
  { id: 2, name: "Blue blouse, size XL", sku: "BB-XL-003", price: 380, stock: 8, platform: "TikTok", status: "Active" },
  { id: 3, name: "Green top, size S", sku: "GT-S-007", price: 250, stock: 3, platform: "FB Live", status: "Low stock" },
  { id: 4, name: "White sneakers sz 38", sku: "WS-38-012", price: 890, stock: 0, platform: "TikTok", status: "Out of stock" },
  { id: 5, name: "Floral skirt, size L", sku: "FS-L-009", price: 420, stock: 15, platform: "TikTok / FB", status: "Active" },
];

// App.tsx:1302 stat() — status derived from stock.
export function statusForStock(stock: number): string {
  return stock === 0 ? "Out of stock" : stock <= 5 ? "Low stock" : "Active";
}

// LS format parity: App.tsx LS.get/LS.set wrap JSON, so the value is a JSON array.
export function loadProducts(): Product[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return PRODUCT_DEFAULTS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Product[]) : PRODUCT_DEFAULTS;
  } catch { return PRODUCT_DEFAULTS; }
}

export function saveProducts(list: Product[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

// App.tsx:1307-1313 submit() — add (id=Date.now) or edit (by eid). `now` injectable
// for deterministic tests. Pure.
export function upsertProduct(list: Product[], form: ProductForm, eid: number | null, now: number): Product[] {
  const price = parseFloat(form.price) || 0;
  const stock = parseInt(form.stock, 10) || 0;
  const status = statusForStock(stock);
  if (eid !== null) {
    return list.map((p) => (p.id === eid ? { ...p, name: form.name, sku: form.sku, price, stock, platform: form.platform, status } : p));
  }
  return [...list, { id: now, name: form.name, sku: form.sku, price, stock, platform: form.platform, status }];
}

export function deleteProduct(list: Product[], id: number): Product[] {
  return list.filter((p) => p.id !== id);
}

// App.tsx:1314 — case-insensitive name/sku match.
export function filterProducts(list: Product[], q: string): Product[] {
  const s = q.toLowerCase();
  return list.filter((p) => p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s));
}
