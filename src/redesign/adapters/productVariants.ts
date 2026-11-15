// Seller Website Part 1 — Shopee-style variants (PURE helpers, unit-tested).
// A product may have up to 2 option groups (e.g. Size, Color). Every combination is its OWN
// products row (parentId = the product's id) with its own code, stock and (optional) own price —
// so a variant code is just another product code to Auto Mode / 1-Click / the stock RPC.
// A product WITHOUT variants never goes through this file.
import { statusForStock, type Product, type VariantGroup } from "./products";

export const MAX_GROUPS = 2;
export const MAX_VALUES = 20;
export const MAX_PHOTOS = 8; // image_path (photo 1) + photoPaths (photos 2..8)

/** One option word for a code: letters / digits only, upper case, at most 12 characters. */
export function codePart(v: string): string {
  return String(v ?? "").normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "").toUpperCase().slice(0, 12);
}
/** The auto variant code: <product code>-<value 1>[-<value 2>] — "A01" + ["M", "Pink"] → "A01-M-PINK". */
export function variantCode(parentCode: string, values: string[]): string {
  const base = String(parentCode ?? "").trim().toUpperCase();
  const parts = values.map(codePart).filter(Boolean);
  return [base, ...parts].filter(Boolean).join("-");
}
/** Clean groups: ≤ 2 named groups, each with 1..20 distinct non-empty values (order kept). */
export function cleanGroups(groups: VariantGroup[] | undefined | null): VariantGroup[] {
  const out: VariantGroup[] = [];
  for (const g of groups || []) {
    if (out.length >= MAX_GROUPS) break;
    const name = String(g?.name ?? "").trim().slice(0, 20);
    const seen = new Set<string>();
    const values: string[] = [];
    for (const v of g?.values || []) {
      const s = String(v ?? "").trim().slice(0, 20);
      if (!s || seen.has(s.toLowerCase())) continue;
      seen.add(s.toLowerCase()); values.push(s);
      if (values.length >= MAX_VALUES) break;
    }
    if (name && values.length) out.push({ name, values });
  }
  return out;
}
/** Every combination, in group order: [["S","Pink"],["S","Blue"],["M","Pink"],…]. */
export function combos(groups: VariantGroup[]): string[][] {
  const gs = cleanGroups(groups);
  if (!gs.length) return [];
  return gs.reduce<string[][]>((acc, g) => acc.flatMap((a) => g.values.map((v) => [...a, v])), [[]]);
}
export const comboKey = (values: string[]) => values.map((v) => v.toLowerCase()).join("\u0001");

/** A variant row of a product (its children), and the products a seller sees in the list (no children). */
export const isVariant = (p: Product) => p.parentId !== undefined && p.parentId !== null;
export const childrenOf = (list: Product[], parentId: number) => list.filter((p) => p.parentId === parentId);
export const listProducts = (list: Product[]) => list.filter((p) => !isVariant(p));
export const hasVariants = (list: Product[], parentId: number) => list.some((p) => p.parentId === parentId);
/** The parent of a product with variants still has its own code — the seller is told to use the variant codes in live. */
export const parentCodeHint = (list: Product[], p: Product) => !isVariant(p) && !!(p.liveCode || "").trim() && hasVariants(list, p.id);

// The editor's rows (one per combination) → what to save.
export interface VariantRow { values: string[]; code: string; stock: number; price: number | null; photo: number | null; id?: number }
export interface VariantPlan { parent: Product; upsert: Product[]; remove: number[]; errors: VariantError[] }
export type VariantError = { kind: "code_empty" | "code_dup" | "code_taken" | "stock_bad" | "price_bad"; index: number };

/** Rows for the editor from the saved children (existing ids / codes / stock kept; new combos get the auto code). */
export function editorRows(parent: Product, groups: VariantGroup[], children: Product[]): VariantRow[] {
  const byKey = new Map(children.map((c) => [comboKey(c.variant?.values || []), c]));
  return combos(groups).map((values) => {
    const c = byKey.get(comboKey(values));
    if (c) return { values, code: c.liveCode || "", stock: c.stock, price: c.variant?.ownPrice ? c.price : null, photo: c.variant?.photo ?? null, id: c.id };
    return { values, code: variantCode(parent.liveCode || parent.sku || "", values), stock: 0, price: null, photo: null };
  });
}

/** Plan the save: the parent gets the groups, every row becomes/updates a child, children of dropped
 *  combos are removed. Codes must be non-empty, unique among the rows AND not used by any other product
 *  of the seller (case-insensitive, like the live matcher). New child ids = `nextId()`. Pure. */
export function planVariants(parent: Product, groups: VariantGroup[], rows: VariantRow[], all: Product[], nextId: () => number): VariantPlan {
  const gs = cleanGroups(groups);
  const errors: VariantError[] = [];
  const existing = childrenOf(all, parent.id);
  const mine = new Set(existing.map((c) => c.id));
  const taken = new Set(all.filter((p) => p.id !== parent.id && !mine.has(p.id)).map((p) => (p.liveCode || "").trim().toLowerCase()).filter(Boolean));
  if ((parent.liveCode || "").trim()) taken.add(parent.liveCode!.trim().toLowerCase());
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const code = r.code.trim().toLowerCase();
    if (!code) errors.push({ kind: "code_empty", index: i });
    else if (seen.has(code)) errors.push({ kind: "code_dup", index: i });
    else if (taken.has(code)) errors.push({ kind: "code_taken", index: i });
    seen.add(code);
    if (!Number.isInteger(r.stock) || r.stock < 0 || r.stock > 100000) errors.push({ kind: "stock_bad", index: i });
    if (r.price !== null && !(Number.isFinite(r.price) && r.price >= 0 && r.price <= 10_000_000)) errors.push({ kind: "price_bad", index: i });
  });
  const keep = new Set(combos(gs).map(comboKey));
  const byKey = new Map(existing.map((c) => [comboKey(c.variant?.values || []), c]));
  const upsert: Product[] = [];
  for (const r of rows) {
    const key = comboKey(r.values);
    if (!keep.has(key)) continue;
    const prev = byKey.get(key);
    const ownPrice = r.price !== null;
    upsert.push({
      id: prev ? prev.id : nextId(),
      name: `${parent.name} · ${r.values.join(" · ")}`.slice(0, 200),
      sku: parent.sku, platform: parent.platform,
      price: ownPrice ? (r.price as number) : parent.price,
      stock: r.stock, status: statusForStock(r.stock),
      liveCode: r.code.trim(),
      parentId: parent.id,
      variant: { values: r.values, ownPrice, photo: r.photo },
    });
  }
  const remove = existing.filter((c) => !keep.has(comboKey(c.variant?.values || []))).map((c) => c.id);
  return { parent: { ...parent, variant: { groups: gs } }, upsert, remove, errors }; // no groups → {groups:[]} (clears the column's meaning, never undefined)
}
