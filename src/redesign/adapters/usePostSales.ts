// FACEBOOK POST SALES — the Orders "Posts" state (read-on-open, zero poll). One hook so
// RedesignApp adds a few lines: loads sales + orders + waitlist counts when Orders opens (and
// after every action), prints a buyer's NEW post orders through the caller's sticker path
// (MANUAL only — nothing here prints by itself), marks them printed, creates / ends / edits sales.
// readOnly (fix round 1: the seller's plan does not include Posts but they have post orders): the
// same reads; Print new / Sell / End now / Edit do nothing (the screen hides or turns them off and
// the database refuses them too).
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Buyer } from "../../lib/orderTypes";
import { loadProducts, type Product } from "./products";
import type { PostsUi } from "../screens/PostSales";
import {
  type PostSale, type PostOrder, type NewPostItem, type PostSaleMode,
  loadPostSales, loadPostOrders, loadPostWaitlistCounts, createPostSale, endPostSale, updatePostItem, markPostOrdersPrinted,
  loadPagePosts, groupPostOrders, postBuyerForPrint, hasAnyPostOrders,
} from "./fbPostSales";

// Fix round 1: does this seller have post orders? Asked only when the plan rule fails (need), once
// per signed-in user; a failed read is asked again the next time Orders opens. null = not known
// (→ "Posts 🔒" until it is).
export function usePostOrdersExist(userId: string | null | undefined, need: boolean, active: boolean): boolean | null {
  const [known, setKnown] = useState<{ uid: string; v: boolean } | null>(null);
  const uidKey = userId || "";
  const have = known !== null && known.uid === uidKey;
  useEffect(() => {
    if (!need || !uidKey || have) return;
    let alive = true;
    void hasAnyPostOrders().then((v) => { if (alive && v !== null) setKnown({ uid: uidKey, v }); });
    return () => { alive = false; };
  }, [need, uidKey, have, active]);
  return have ? known!.v : null;
}

export interface PostSalesTexts { printed: (n: number) => string; nothingNew: string; started: string; printFailed: string }

export function usePostSales(a: {
  enabled: boolean; active: boolean;                 // gate passed + Orders is the current screen
  readOnly?: boolean;                                // view only (no plan, has post orders)
  pages: { pageId: string; name: string }[];
  print: (buyer: Buyer) => boolean;                  // the existing sticker path (RedesignApp wraps printSlip)
  texts: PostSalesTexts;
}): PostsUi | null {
  const { enabled, active, pages, print, texts } = a;
  const readOnly = a.readOnly === true;
  const [state, setState] = useState<PostsUi["state"]>("loading");
  const [sales, setSales] = useState<PostSale[]>([]);
  const [orders, setOrders] = useState<PostOrder[]>([]);
  const [waitlistCounts, setWaitlistCounts] = useState<Map<number, number>>(new Map());
  // The local Products cache (pure localStorage read) — re-read each time Orders opens.
  const products = useMemo<Product[]>(() => (enabled && active ? loadProducts() : []), [enabled, active]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [s, o] = await Promise.all([loadPostSales(), loadPostOrders()]);
    if (s === null || o === null) { setState("error"); return; }
    setSales(s); setOrders(o); setState("ready");
    setWaitlistCounts(await loadPostWaitlistCounts(s));
  }, []);
  /* eslint-disable react-hooks/set-state-in-effect -- the read-on-open fetch (state is set after the await, the repo's convention) */
  useEffect(() => {
    if (!enabled || !active) return;
    void reload();
  }, [enabled, active, reload]);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => { if (!note) return; const id = setTimeout(() => setNote(null), 3500); return () => clearTimeout(id); }, [note]);

  const onPrintNew = useCallback(() => {
    if (busy || readOnly) return;
    const groups = groupPostOrders(orders, sales).filter((g) => !g.printed);
    const ids: number[] = [];
    let printed = 0;
    for (const g of groups) {
      const buyer = postBuyerForPrint(g, sales);
      if (!buyer) continue;
      if (print(buyer)) { printed++; ids.push(...g.orders.filter((o) => !o.printedAt).map((o) => o.id)); }
    }
    if (!ids.length) { setNote(printed === 0 && groups.length ? texts.printFailed : texts.nothingNew); return; }
    setBusy(true);
    void markPostOrdersPrinted(ids).then(() => { setBusy(false); setNote(texts.printed(printed)); void reload(); });
  }, [busy, readOnly, orders, sales, texts, reload, print]);

  const onCreate = useCallback(async (x: { pageId: string; postId: string; postMessage: string; postPicture: string; mode: PostSaleMode; endsAt: string; items: NewPostItem[] }) => {
    if (readOnly) return { ok: false as const, error: "not_allowed" };
    const r = await createPostSale(x);
    if (r.ok) { setNote(texts.started); void reload(); }
    return r;
  }, [readOnly, reload, texts]);
  const onEnd = useCallback(async (id: number) => { if (readOnly) return false; const ok = await endPostSale(id); if (ok) void reload(); return ok; }, [readOnly, reload]);
  const onUpdateItem = useCallback(async (id: number, price: number, stock: number | null) => { if (readOnly) return false; const ok = await updatePostItem(id, price, stock); if (ok) void reload(); return ok; }, [readOnly, reload]);

  if (!enabled) return null;
  return { state, sales, orders, waitlistCounts, pages, products, busy, note, readOnly, onReload: () => { setState("loading"); void reload(); }, onPrintNew, onCreate, onEnd, onUpdateItem, loadPosts: loadPagePosts };
}
