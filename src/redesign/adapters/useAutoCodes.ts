// Auto Mode setup — code→product map editor state. Composes the cross-device
// products catalog (Step 1) + the seller_auto_codes store (Step 2). READ-ON-LOAD
// (one products read + one codes read on open) + WRITE-ON-ACTION (stock edit writes
// the product; Save writes the code map). NO polling. Import-only; no protected files.
//
// Inventory = the catalog product's stock (no separate field): editing a row's stock
// writes products.stock (mirrored to the local cache, like the Products screen).
import { useCallback, useEffect, useState } from "react";
import { loadProducts, saveProducts, statusForStock, type Product } from "./products";
import { resolveInitialProducts, saveProductDb } from "./productsDb";
import { loadCodes, saveCodes } from "./autoCodesDb";
import { normalizeCode, type AutoCode } from "./autoMode";

export const MAX_CODES = 26; // A–Z is plenty; soft cap on rows

// ── Pure helpers (no DB / React — unit-tested) ────────────────────────────────

// A fresh row defaults to the first catalog product (so price/name/stock resolve);
// empty catalog → an inert row (productLocalId 0).
export function blankRow(products: Product[]): AutoCode {
  const p = products[0];
  return { code: "", productLocalId: p?.id ?? 0, price: p?.price ?? 0, productName: p?.name ?? "" };
}

// Selecting a product fills price + name from the catalog (price stays editable after).
export function applyProductToRow(row: AutoCode, p: Product): AutoCode {
  return { ...row, productLocalId: p.id, price: p.price, productName: p.name };
}

// The rows to persist: drop blanks / unmapped rows, and dedup by normalized code
// (first wins — the table PK is (user_id, code), so duplicates can't be stored).
export function codesForSave(rows: AutoCode[]): AutoCode[] {
  const seen = new Set<string>();
  const out: AutoCode[] = [];
  for (const r of rows) {
    const key = normalizeCode(r.code);
    if (!key || !r.productLocalId || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...r, code: r.code.trim() });
  }
  return out;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseAutoCodes {
  products: Product[];
  codes: AutoCode[];
  loaded: boolean;
  saving: boolean;
  saved: boolean;
  saveError: boolean;   // U1 — the code-map Save write failed (honest error, not silent)
  stockError: boolean;  // U2 — a stock write-through to the DB failed
  addCode: () => void;
  removeCode: (i: number) => void;
  setCode: (i: number, code: string) => void;
  setProduct: (i: number, localId: number) => void;
  setPrice: (i: number, price: number) => void;
  setStock: (localId: number, stock: number) => void;
  stockFor: (localId: number) => number;
  save: () => Promise<boolean>;
}

// onSaved (5b): fired after a SUCCESSFUL save with the persisted code list + a
// {productLocalId → stock} map, so the caller can lift the just-saved data straight
// into the live matcher refs — codes apply immediately, no reload, still no polling.
export function useAutoCodes(enabled: boolean = true, onSaved?: (codes: AutoCode[], stock: Map<number, number>) => void): UseAutoCodes {
  const [products, setProducts] = useState<Product[]>([]);
  const [codes, setCodes] = useState<AutoCode[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [stockError, setStockError] = useState(false);

  // READ-ON-LOAD: catalog (DB-wins, local fallback) + the saved code map. No poll.
  useEffect(() => {
    if (!enabled) { setLoaded(true); return; }
    let active = true;
    (async () => {
      const [resolved, dbCodes] = await Promise.all([resolveInitialProducts(loadProducts()), loadCodes()]);
      if (!active) return;
      setProducts(resolved.products);
      setCodes(dbCodes ?? []);
      setLoaded(true);
    })();
    return () => { active = false; };
  }, [enabled]);

  const dirty = () => { setSaved(false); setSaveError(false); };
  const addCode = useCallback(() => { setCodes((cs) => (cs.length >= MAX_CODES ? cs : [...cs, blankRow(products)])); dirty(); }, [products]);
  const removeCode = useCallback((i: number) => { setCodes((cs) => cs.filter((_, j) => j !== i)); dirty(); }, []);
  const setCode = useCallback((i: number, code: string) => { setCodes((cs) => cs.map((r, j) => (j === i ? { ...r, code } : r))); dirty(); }, []);
  const setPrice = useCallback((i: number, price: number) => { setCodes((cs) => cs.map((r, j) => (j === i ? { ...r, price } : r))); dirty(); }, []);
  const setProduct = useCallback((i: number, localId: number) => {
    setCodes((cs) => cs.map((r, j) => {
      if (j !== i) return r;
      const p = products.find((x) => x.id === localId);
      return p ? applyProductToRow(r, p) : { ...r, productLocalId: localId };
    }));
    dirty();
  }, [products]);

  // Editing inventory writes the PRODUCT stock (local cache mirror + DB write-through),
  // exactly like the Products screen. Status is re-derived from stock.
  const setStock = useCallback((localId: number, stock: number) => {
    setStockError(false);
    setProducts((prev) => {
      const next = prev.map((p) => (p.id === localId ? { ...p, stock, status: statusForStock(stock) } : p));
      const changed = next.find((p) => p.id === localId);
      // U2 — surface a failed cloud write-through (was silently discarded). Local
      // cache still updates; the honest error tells the seller the DB copy is stale.
      if (changed) { saveProducts(next); void saveProductDb(changed).then((ok) => { if (!ok) setStockError(true); }); }
      return next;
    });
    dirty();
  }, []);

  const stockFor = useCallback((localId: number) => products.find((p) => p.id === localId)?.stock ?? 0, [products]);

  const save = useCallback(async () => {
    setSaving(true); setSaved(false); setSaveError(false);
    const toSave = codesForSave(codes);
    const ok = await saveCodes(toSave);
    setSaving(false); setSaved(ok); setSaveError(!ok); // U1 — no longer silent on failure
    if (ok) {
      // 5b — hand the persisted map + each code's product stock to the caller so the
      // live matcher applies it immediately (no reload). Stock from the catalog state.
      const stock = new Map<number, number>();
      for (const c of toSave) { const p = products.find((x) => x.id === c.productLocalId); if (p) stock.set(p.id, p.stock); }
      onSaved?.(toSave, stock);
    }
    return ok;
  }, [codes, products, onSaved]);

  return { products, codes, loaded, saving, saved, saveError, stockError, addCode, removeCode, setCode, setProduct, setPrice, setStock, stockFor, save };
}
