// Seller Website — the buyer side. Reads the shop through website_shop (sql/163 + sql/167), keeps the cart
// on this device, routes with the History API under /s/<sub> (or the subdomain root).
// `preview` = the seller editor's live preview: the given shop, in-memory routing, no network, no
// device storage touched.
// v2: the look of docs/design/seller-website-v2/site-v2.html — three themes (Pop / Boutique / Bold) + the
// shop's accent colour, one frame (v2/Shell) around every page, phone + laptop from the same page.
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { TProvider, useT } from "../redesign/i18n";
import { parseShopLocation, pagePath, type ShopPage } from "./route";
import { loadShop, shopLang, readPickedLang, savePickedLang, currencyFor, type Shop, type ShopResult } from "./shopApi";
import { loadSaved, storeSaved, toggleSaved, loadDeviceOrders, storeDeviceOrders, addDeviceOrder, type DeviceOrder } from "./saved";
import { SavedPage, OrdersPage } from "./pages/DevicePages";
import ShopList from "./pages/ShopList";
import { NO_FILTER, type ShopFilter } from "./shopFilter";
import { addLine, loadCart, saveCart, setQty, removeLine, validLines, countOf, type CartLine } from "./cart";
import { ClosedPage } from "./ui";
import { SHOP_CSS } from "./shopStyle";
import { V2_CSS } from "./v2/styles";
import { themeOf, themeClass, accentVars } from "./v2/theme";
import { V3_CSS } from "./v3/styles";
import { lookStyle } from "./v3/look";
import BrandHome from "./v3/BrandHome";
import { LayoutCtx } from "./v3/layoutCtx";
import { Header, Footer, BottomNav, ChatSheet, Sheet, Fab } from "./v2/Shell";
import { useToast } from "./v2/useToast";
import { checkoutOf, shipLabel, payLabel } from "./shipPay";
import { money } from "./shopApi";
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

  // the editor preview runs inside the seller app: load the themes' fonts there once (shop.html has them)
  useEffect(() => { if (preview) ensureThemeFonts(); }, [preview]);
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

export const THEME_FONTS_URL = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Space+Grotesk:wght@500;700&display=swap";
function ensureThemeFonts() {
  try {
    if (document.querySelector("link[data-sfl-theme-fonts]")) return;
    const l = document.createElement("link");
    l.rel = "stylesheet"; l.href = THEME_FONTS_URL; l.setAttribute("data-sfl-theme-fonts", "1");
    document.head.appendChild(l);
  } catch { /* no document */ }
}

type Info = "how" | "ship" | "returns" | null;
function ShopBody({ shop, route, go, lang, onLang, preview, nowMs, orderApi, linkFor }: { shop: Shop; route: ShopPage; go: (r: ShopPage) => void; lang: string; onLang: (l: string) => void; preview: boolean; nowMs?: number; orderApi?: OrderApi; linkFor: (r: ShopPage) => string }) {
  const t = useT() as unknown as Record<string, string>;
  const cur = currencyFor(shop);
  const [lines, setLines] = useState<CartLine[]>(() => (preview ? [] : loadCart(shop.sub)));
  const [saved, setSaved] = useState<number[]>(() => (preview ? [] : loadSaved(shop.sub)));
  const [devOrders, setDevOrders] = useState<DeviceOrder[]>(() => (preview ? [] : loadDeviceOrders(shop.sub)));
  const placed = (o?: { token: string; orderNo: string; total: number }) => {
    update([]);
    if (!o) return;
    const next = addDeviceOrder(devOrders, { token: o.token, no: o.orderNo, at: new Date().toISOString(), total: o.total });
    setDevOrders(next); if (!preview) storeDeviceOrders(shop.sub, next);
  };
  const toggleSave = (id: number) => { const next = toggleSaved(saved, id); setSaved(next); if (!preview) storeSaved(shop.sub, next); say(next.includes(id) ? t.rd_shop_saved_toast : t.rd_shop_removed_toast); };
  const [filter, setFilter] = useState<ShopFilter>(NO_FILTER);
  const query = filter.q;
  const [toast, say] = useToast();
  const [chat, setChat] = useState(false);
  const [info, setInfo] = useState<Info>(null);
  const [clock] = useState(() => nowMs ?? Date.now());
  const update = (next: CartLine[]) => { setLines(next); if (!preview) saveCart(shop.sub, next); };
  const infos = useMemo(() => validLines(shop, lines), [shop, lines]);
  const count = countOf(infos.map((x) => x.line));
  const cats = useMemo(() => [...new Set(shop.products.map((p) => p.category).filter((c): c is string => !!c))], [shop.products]);
  useEffect(() => { try { document.title = shop.shop.name || "Shop"; } catch { /* */ } }, [shop.shop.name]);

  const product = route.page === "product" ? shop.products.find((p) => p.id === route.id) : null;
  const add = (pid: number, vid: number | null, qty: number, stock: number) => { update(addLine(lines, pid, vid, qty, stock)); };
  const stockOf = (pid: number, vid: number | null) => {
    const p = shop.products.find((x) => x.id === pid);
    if (!p) return 0;
    return vid === null ? p.stock : p.variants?.find((v) => v.id === vid)?.stock ?? 0;
  };
  const home = () => go({ page: "home" });
  // quick add: straight into the cart when there's nothing to choose, else open the product to choose
  const quick = (id: number) => {
    const p = shop.products.find((x) => x.id === id);
    if (!p) return;
    const vs = p.variants || [];
    if (vs.length > 1) { go({ page: "product", id }); say(t.rd_shop_pick_first); return; }
    const vid = vs.length === 1 ? vs[0].id : null;
    add(id, vid, 1, stockOf(id, vid)); say(t.rd_shop_added);
  };
  const toShop = (p: Partial<ShopFilter> = {}) => { setFilter({ ...NO_FILTER, sort: filter.sort, ...p }); go({ page: "shop" }); };
  let body: ReactNode;
  const look = shop.shop.look;
  const brand = look?.layout === "brand";
  if (route.page === "home") body = look && brand
    ? <BrandHome shop={shop} look={look} cur={cur} onOpen={(id) => go({ page: "product", id })} nowMs={clock} saved={saved} onSave={toggleSave} onQuick={quick} onShop={(f) => toShop(f)} />
    : <Home shop={shop} cur={cur} onOpen={(id) => go({ page: "product", id })} nowMs={clock} saved={saved} onSave={toggleSave} onQuick={quick} onShop={(f) => toShop(f)} />;
  else if (route.page === "product" && product) body = <Product key={product.id} shop={shop} product={product} cur={cur} nowMs={clock}
    onAdd={(vid, q) => { add(product.id, vid, q, stockOf(product.id, vid)); say(t.rd_shop_added); }}
    onBuy={(vid, q) => { add(product.id, vid, q, stockOf(product.id, vid)); go({ page: "checkout" }); }}
    saved={saved} onSave={toggleSave} onOpen={(id) => go({ page: "product", id })} onQuick={quick} onChat={() => setChat(true)} onShop={(cat) => toShop(cat ? { cat } : {})} onHome={home} />;
  else if (route.page === "cart") body = <Cart shop={shop} cur={cur} nowMs={clock} infos={infos} lines={lines} onQty={(i, q, s) => update(setQty(lines, i, q, s))} onRemove={(i) => update(removeLine(lines, i))} onCheckout={() => go({ page: "checkout" })} onShop={() => toShop()}
    saved={saved} onSave={toggleSave} onOpen={(id) => go({ page: "product", id })} onQuick={quick} />;
  else if (route.page === "checkout" || route.page === "store" || route.page === "sent" || route.page === "order") body = <CheckoutFlow shop={shop} cur={cur} route={route} go={go} infos={infos} preview={preview} onPlaced={placed} api={orderApi} linkFor={linkFor} />;
  else if (route.page === "shop") body = <ShopList shop={shop} cur={cur} nowMs={clock} f={filter} setF={setFilter} saved={saved} onSave={toggleSave} onOpen={(id) => go({ page: "product", id })} onQuick={quick} onHome={home} />;
  else if (route.page === "saved") body = <SavedPage shop={shop} cur={cur} nowMs={clock} saved={saved} onSave={toggleSave} onOpen={(id) => go({ page: "product", id })} onQuick={quick} onShop={home} />;
  else if (route.page === "orders") body = <OrdersPage orders={devOrders} cur={cur} onOpen={(token) => go({ page: "order", token })} onShop={home} />;
  else body = <div className="v-wrap"><div className="v-empty"><p>{t.rd_shop_not_found}</p><button type="button" className="v-btn" onClick={home}>{t.rd_shop_keep_shopping}</button></div></div>;

  const onBack = route.page === "home" ? undefined : () => (route.page === "store" ? go({ page: "checkout" }) : route.page === "checkout" ? go({ page: "cart" }) : home());
  const navActive = route.page === "home" ? "home" : route.page === "shop" ? "shop" : route.page === "cart" ? "cart" : route.page === "orders" ? "orders" : route.page === "saved" ? "saved" : "other";
  const showNav = route.page === "home" || route.page === "shop" || route.page === "saved" || route.page === "orders" || (route.page === "cart" && infos.length === 0);
  const withFooter = route.page === "home" || route.page === "shop" || route.page === "product";
  const k = themeOf(shop.shop);
  const ck = checkoutOf(shop);
  // v3: a shop with a look takes the look's colours / font / corners; without one = Build 1, exactly as before
  const ls = look ? lookStyle(look) : null;
  return (
    <div className={ls ? `sfl-v2 ${ls.className} sfl-shop` : `sfl-v2 ${themeClass(k)} sfl-shop`} data-testid="shop-root" data-theme-key={ls ? `look-${look!.layout}` : k}
      style={(ls ? ls.vars : accentVars(shop.shop, k)) as CSSProperties}>
      <style>{ls ? V2_CSS + SHOP_CSS + V3_CSS : V2_CSS + SHOP_CSS}</style>
      <Header shop={shop} active={navActive} overBand={brand && route.page === "home"} onBack={onBack} onHome={home} cartCount={count} onCart={() => go({ page: "cart" })}
        query={query} onQuery={(q) => setFilter({ ...filter, q })} onSearch={(q) => toShop({ q })} cats={cats} onCat={(c) => toShop({ cat: c })}
        savedCount={saved.length} onSaved={() => go({ page: "saved" })} onTrack={() => go({ page: "orders" })} />
      <main className="v-main"><LayoutCtx.Provider value={look?.layout ?? null}>{body}</LayoutCtx.Provider></main>
      {withFooter && <Footer shop={shop} cur={cur} lang={lang} onLang={onLang} links={[
        [{ label: t.rd_shop_all_products, go: () => toShop() }, { label: t.rd_shop_new_arrivals, go: () => toShop({ sort: "new" }) }, { label: t.rd_shop_best_sellers, go: () => toShop({ sort: "best" }) }, { label: t.rd_shop_on_sale, go: () => toShop({ sale: true }) }],
        [{ label: t.rd_shop_f_how, go: () => setInfo("how") }, { label: t.rd_shop_track, go: () => go({ page: "orders" }) }, { label: t.rd_shop_f_shipping, go: () => setInfo("ship") }, ...(shop.shop.policy ? [{ label: t.rd_shop_returns, go: () => setInfo("returns") }] : [])],
      ]} />}
      {showNav && <BottomNav active={navActive} cartCount={count} onHome={home} onShop={() => toShop()} onCart={() => go({ page: "cart" })} onOrders={() => go({ page: "orders" })} onChat={() => setChat(true)} />}
      {(route.page === "home" || route.page === "shop" || route.page === "saved" || route.page === "orders") && <Fab onClick={() => setChat(true)} />}
      {chat && <ChatSheet shop={shop} onClose={() => setChat(false)} />}
      {info && (
        <Sheet title={info === "how" ? t.rd_shop_f_how : info === "ship" ? t.rd_shop_f_shipping : t.rd_shop_returns} onClose={() => setInfo(null)}>
          {info === "ship" && <div className="v-sum">{ck.options.map((o) => <div key={o.id}><span>{shipLabel(t, o)}{o.note ? ` · ${o.note}` : ""}</span><b>{o.fee ? money(cur, o.fee) : t.rd_shop_co_free}</b></div>)}</div>}
          {info === "how" && <ol style={{ paddingLeft: 18, fontSize: 13.5, color: "var(--s-mut)" }}><li>{t.rd_shop_how1}</li><li>{t.rd_shop_how2}</li><li>{t.rd_shop_how3}</li></ol>}
          {info === "returns" && <p style={{ fontSize: 13.5, color: "var(--s-mut)", whiteSpace: "pre-wrap" }}>{shop.shop.policy}</p>}
          {info === "ship" && ck.methods.length > 0 && <p style={{ fontSize: 12.5, color: "var(--s-mut)" }}>{ck.methods.map((m) => payLabel(t, m)).join(" · ")}</p>}
        </Sheet>
      )}
      {toast && <div role="status" className="v-toast" data-testid="shop-toast">{toast}</div>}
    </div>
  );
}
