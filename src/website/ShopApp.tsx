// Seller Website — the buyer side. Reads the shop through website_shop (sql/163), keeps the cart on
// this device, routes with the History API under /s/<sub> (or the subdomain root).
// `preview` = the seller editor's live preview: the given shop, in-memory routing, no network, no
// device storage touched.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { TProvider, useT } from "../redesign/i18n";
import { parseShopLocation, pagePath, type ShopPage } from "./route";
import { loadShop, shopLang, readPickedLang, savePickedLang, currencyFor, type Shop, type ShopResult } from "./shopApi";
import { addLine, loadCart, saveCart, setQty, removeLine, validLines, countOf, type CartLine } from "./cart";
import { ShopTop, BottomNav, ClosedPage, LangPicker } from "./ui";
import { SHOP_CSS, shopColor } from "./shopStyle";
import { firstChatHref } from "./shopLinks";
import Home from "./pages/Home";
import Product from "./pages/Product";
import Cart from "./pages/Cart";
import { CheckoutFlow } from "./checkoutPages";
import type { OrderApi } from "./orderApi";

export interface ShopAppProps { host?: string; path?: string; preview?: Shop; nowMs?: number; orderApi?: OrderApi; startRoute?: ShopPage }

export default function ShopApp({ host, path, preview, nowMs, orderApi, startRoute }: ShopAppProps) {
  const start = useMemo(() => parseShopLocation(host ?? (typeof location !== "undefined" ? location.host : ""), path ?? (typeof location !== "undefined" ? location.pathname : "/")), [host, path]);
  const [route, setRoute] = useState<ShopPage>(startRoute ?? (preview ? { page: "home" } : start.route));
  const [result, setResult] = useState<ShopResult | null | "loading">(preview ?? (start.sub ? "loading" : { online: false }));
  const [picked, setPicked] = useState<string | null>(() => (preview ? null : readPickedLang()));
  useEffect(() => {
    if (preview || !start.sub) return;
    let live = true;
    void loadShop(start.sub).then((r) => { if (live) setResult(r ?? { online: false }); });
    return () => { live = false; };
  }, [preview, start.sub]);
  useEffect(() => {
    if (preview) return;
    const onPop = () => setRoute(parseShopLocation(location.host, location.pathname).route);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [preview]);
  const go = useCallback((r: ShopPage) => {
    setRoute(r);
    if (!preview) { try { history.pushState(null, "", pagePath(start.base, r)); } catch { /* sandboxed */ } }
    try { window.scrollTo(0, 0); } catch { /* jsdom */ }
  }, [preview, start.base]);

  const shop = result && result !== "loading" && result.online ? result : null;
  const lang = shopLang(shop, picked);
  if (result === "loading") return <div style={{ minHeight: "100vh", background: "#F5F5F7" }} />;
  return (
    <TProvider lang={lang}>
      {shop ? <ShopBody shop={shop} route={route} go={go} lang={lang} onLang={(l) => { setPicked(l); if (!preview) savePickedLang(l); }} preview={!!preview} nowMs={nowMs} orderApi={orderApi}
        linkFor={(r) => (preview || typeof location === "undefined" ? "" : `${location.origin}${pagePath(start.base, r)}`)} /> : <ClosedPage />}
    </TProvider>
  );
}

function ShopBody({ shop, route, go, lang, onLang, preview, nowMs, orderApi, linkFor }: { shop: Shop; route: ShopPage; go: (r: ShopPage) => void; lang: string; onLang: (l: string) => void; preview: boolean; nowMs?: number; orderApi?: OrderApi; linkFor: (r: ShopPage) => string }) {
  const t = useT();
  const cur = currencyFor(shop);
  const [lines, setLines] = useState<CartLine[]>(() => (preview ? [] : loadCart(shop.sub)));
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState("");
  const catRef = useRef<HTMLDivElement | null>(null);
  const [clock] = useState(() => nowMs ?? Date.now());
  const update = (next: CartLine[]) => { setLines(next); if (!preview) saveCart(shop.sub, next); };
  const infos = useMemo(() => validLines(shop, lines), [shop, lines]);
  const count = countOf(infos.map((x) => x.line));
  const say = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2200); };
  useEffect(() => { try { document.title = shop.shop.name || "Shop"; } catch { /* */ } }, [shop.shop.name]);

  const product = route.page === "product" ? shop.products.find((p) => p.id === route.id) : null;
  const add = (pid: number, vid: number | null, qty: number, stock: number) => { update(addLine(lines, pid, vid, qty, stock)); };
  const stockOf = (pid: number, vid: number | null) => {
    const p = shop.products.find((x) => x.id === pid);
    if (!p) return 0;
    return vid === null ? p.stock : p.variants?.find((v) => v.id === vid)?.stock ?? 0;
  };
  const home = () => go({ page: "home" });
  let body: ReactNode;
  if (route.page === "home") body = <Home shop={shop} cur={cur} query={query} onOpen={(id) => go({ page: "product", id })} catRef={catRef} nowMs={clock} />;
  else if (route.page === "product" && product) body = <Product key={product.id} shop={shop} product={product} cur={cur}
    onAdd={(vid, q) => { add(product.id, vid, q, stockOf(product.id, vid)); say(t.rd_shop_added); }}
    onBuy={(vid, q) => { add(product.id, vid, q, stockOf(product.id, vid)); go({ page: "cart" }); }} />;
  else if (route.page === "cart") body = <Cart shop={shop} cur={cur} infos={infos} lines={lines} onQty={(i, q, s) => update(setQty(lines, i, q, s))} onRemove={(i) => update(removeLine(lines, i))} onCheckout={() => go({ page: "checkout" })} onShop={home} />;
  else if (route.page === "checkout" || route.page === "store" || route.page === "sent" || route.page === "order") body = <CheckoutFlow shop={shop} cur={cur} route={route} go={go} infos={infos} preview={preview} onPlaced={() => update([])} api={orderApi} linkFor={linkFor} />;
  else body = <div className="sfl-wrap" style={{ padding: 30, textAlign: "center" }}><p>{t.rd_shop_not_found}</p><button type="button" className="sfl-btn sfl-btn-main" style={{ padding: "0 18px" }} onClick={home}>{t.rd_shop_keep_shopping}</button></div>;

  const showNav = route.page === "home" || route.page === "cart";
  return (
    <div className="sfl-shop" style={{ ["--sc" as string]: shopColor(shop.shop.color) }}>
      <style>{SHOP_CSS}</style>
      <ShopTop shop={shop} cartCount={count} onHome={home} onCart={() => go({ page: "cart" })} onBack={route.page === "home" ? undefined : () => (route.page === "store" ? go({ page: "checkout" }) : route.page === "product" ? home() : route.page === "cart" ? home() : route.page === "checkout" ? go({ page: "cart" }) : home())}
        search={route.page === "home" ? query : undefined} onSearch={route.page === "home" ? setQuery : undefined} />
      {body}
      {route.page === "home" && <div className="sfl-wrap" style={{ padding: "0 12px 80px", display: "flex", justifyContent: "center" }}><LangPicker lang={lang} onPick={onLang} /></div>}
      {showNav && <BottomNav active={route.page === "cart" ? "cart" : "shop"} cartCount={count} onShop={home} onCategories={() => { if (route.page !== "home") home(); setTimeout(() => catRef.current?.scrollIntoView({ behavior: "smooth" }), 50); }} onCart={() => go({ page: "cart" })} chatHref={firstChatHref(shop)} />}
      {toast && <div role="status" data-testid="shop-toast" style={{ position: "fixed", left: "50%", bottom: 100, transform: "translateX(-50%)", background: "#111827", color: "#fff", padding: "10px 16px", borderRadius: 999, fontSize: 13.5, fontWeight: 700, zIndex: 50 }}>{toast}</div>}
    </div>
  );
}
