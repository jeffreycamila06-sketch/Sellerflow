// Seller Website part 2 — the public shop: routing (subdomain + /s/<sub> fallback), the link preview
// tags, the cart (quantity never above stock, free-shipping bar), the variant picker (sold-out values),
// the RPC answer parsing (offline = nothing), the pages, and the SQL whitelist + plan rule.
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { parseShopLocation, subFromHost, parsePage, pagePath } from "../route";
import { ogTags, injectOg, escapeHtml } from "../og";
import { addLine, setQty, validLines, freeShipping, subtotalOf, productStock, fromPrice } from "../cart";
import { toShop, shopLang, money } from "../shopApi";
import { variantFor, valueAvailable, sortProducts, filterShop, compact } from "../shopLogic";
import { socialUrl, chatHref } from "../shopLinks";
import ShopApp from "../ShopApp";
import { DEMO_SHOP } from "./fixtures";

const TOKEN = "a".repeat(40);
describe("routing", () => {
  it("subdomain shops; www / apex / reserved are not shops", () => {
    expect(subFromHost("budgetukay.sellerflowlive.com")).toBe("budgetukay");
    for (const h of ["www.sellerflowlive.com", "sellerflowlive.com", "api.sellerflowlive.com", "a.sellerflowlive.com", "x.y.sellerflowlive.com", "evil.com"]) expect(subFromHost(h)).toBeNull();
  });
  it("/s/<sub> fallback + pages; bad paths → missing", () => {
    expect(parseShopLocation("www.sellerflowlive.com", "/s/BudgetUkay/p/12")).toEqual({ sub: "budgetukay", base: "/s/budgetukay", route: { page: "product", id: 12 } });
    expect(parseShopLocation("budgetukay.sellerflowlive.com", "/cart").route).toEqual({ page: "cart" });
    expect(parsePage(`/o/${TOKEN}`)).toEqual({ page: "order", token: TOKEN });
    expect(parsePage("/o/W-1024")).toEqual({ page: "missing" }); // never the order number alone
    expect(parsePage("/p/abc")).toEqual({ page: "missing" });
    expect(pagePath("/s/budgetukay", { page: "home" })).toBe("/s/budgetukay");
    expect(pagePath("", { page: "checkout" })).toBe("/checkout");
  });
});

describe("link preview", () => {
  it("an online shop → title / description / image / url, escaped", () => {
    const tags = ogTags({ online: true, title: `Budget"Ukay<`, description: "Pre-loved", image: "u1/site-cover-1.jpg" }, "https://www.sellerflowlive.com/s/budgetukay", "https://x.supabase.co/storage/v1/object/public/product-images");
    expect(tags).toContain(`<meta property="og:title" content="Budget&quot;Ukay&lt;" />`);
    expect(tags).toContain(`og:image" content="https://x.supabase.co/storage/v1/object/public/product-images/u1/site-cover-1.jpg"`);
    expect(tags).toContain(`og:url" content="https://www.sellerflowlive.com/s/budgetukay"`);
    const html = injectOg("<head><!--sfl-og--><title>Shop</title></head>", { online: true, title: "BudgetUkay" }, "u", "b");
    expect(html).toContain("<title>BudgetUkay</title>");
  });
  it("offline / missing → nothing about the shop", () => {
    expect(ogTags({ online: false }, "u", "b")).not.toMatch(/description|og:image/);
    expect(injectOg("<!--sfl-og--><title>Shop</title>", null, "u", "b")).toContain("<title>Shop</title>");
    expect(escapeHtml(`<a href="x">'`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;");
  });
});

describe("cart", () => {
  it("quantity never above stock (variant stock for a variant); adding again adds up", () => {
    let l = addLine([], 1, 12, 2, 3);
    l = addLine(l, 1, 12, 5, 3);
    expect(l).toEqual([{ pid: 1, vid: 12, qty: 3 }]);
    expect(setQty(l, 0, 9, 3)).toEqual([{ pid: 1, vid: 12, qty: 3 }]);
    expect(addLine([], 4, null, 1, 0)).toEqual([]);
  });
  it("sold-out / missing lines drop; a line above stock is clamped; subtotal; free shipping", () => {
    const infos = validLines(DEMO_SHOP, [{ pid: 1, vid: 12, qty: 5 }, { pid: 1, vid: 13, qty: 1 }, { pid: 99, vid: null, qty: 1 }, { pid: 2, vid: null, qty: 2 }, { pid: 1, vid: null, qty: 1 }]);
    expect(infos.map((x) => [x.line.pid, x.line.vid, x.line.qty, x.price])).toEqual([[1, 12, 3, 350], [2, null, 2, 280]]);
    expect(subtotalOf(infos)).toBe(1610);
    expect(freeShipping(1210, 1500)).toEqual({ remaining: 290, pct: 1210 / 1500 });
    expect(freeShipping(1210, undefined)).toBeNull();
    expect(productStock(DEMO_SHOP.products[0])).toBe(6);
    expect(fromPrice(DEMO_SHOP.products[0])).toBe(350);
  });
});

describe("variant picker", () => {
  const p = DEMO_SHOP.products[0];
  it("a full choice → its variant; a partial choice → none", () => {
    expect(variantFor(p, ["M", "Blue"])?.id).toBe(14);
    expect(variantFor(p, ["M", null])).toBeNull();
  });
  it("a value with no stock left (for the other picks) is sold out", () => {
    expect(valueAvailable(p, [null, null], 0, "XL")).toBe(false);
    expect(valueAvailable(p, [null, null], 0, "L")).toBe(false);
    expect(valueAvailable(p, [null, "Blue"], 0, "S")).toBe(false);
    expect(valueAvailable(p, [null, "Blue"], 0, "M")).toBe(true);
    expect(valueAvailable(p, ["S", null], 1, "Blue")).toBe(false);
  });
});

describe("RPC answer + helpers", () => {
  it("offline / odd answers → {online:false}, nothing else", () => {
    expect(toShop({ online: false, shop: { name: "x" } })).toEqual({ online: false });
    expect(toShop(null)).toEqual({ online: false });
    expect(toShop({ online: true })).toEqual({ online: false });
  });
  it("language: the buyer's pick → the seller's → the country (TW = 繁體中文)", () => {
    expect(shopLang(DEMO_SHOP, null)).toBe("zh-TW");
    expect(shopLang({ ...DEMO_SHOP, country: "PH" }, null)).toBe("en"); // v2 item 12: the Philippines starts in English
    expect(shopLang(DEMO_SHOP, "en")).toBe("en");
    expect(money("NT$", 1210)).toBe("NT$1,210");
    expect(compact(12400)).toBe("12.4k");
  });
  it("sort + search + social / chat links", () => {
    expect(sortProducts(DEMO_SHOP.products, "price_low").map((x) => x.id)).toEqual([2, 3, 1, 4]);
    expect(filterShop(DEMO_SHOP.products, "a02", "").map((x) => x.id)).toEqual([2]);
    expect(filterShop(DEMO_SHOP.products, "", "Bags").map((x) => x.id)).toEqual([3]);
    expect(socialUrl("tiktok", "@budgetukay")).toBe("https://www.tiktok.com/@budgetukay");
    expect(socialUrl("facebook", "javascript:alert(1)")).toBe("https://www.facebook.com/javascriptalert1");
    expect(chatHref("whatsapp", "+886 912 345 678", "Hi")).toBe("https://wa.me/886912345678?text=Hi");
    expect(chatHref("line", "@budgetukay")).toBe("https://line.me/R/ti/p/@budgetukay");
  });
});

describe("pages", () => {
  it("home: name, verified, stats, announcement, live, socials, categories, grid, about, policy, Powered by", () => {
    render(<ShopApp preview={DEMO_SHOP} nowMs={Date.parse("2026-11-15T00:00:00Z")} />);
    expect(screen.getByTestId("shop-name").textContent).toBe("BudgetUkay");
    for (const id of ["shop-verified", "shop-stats", "shop-announcement", "shop-live", "shop-socials", "shop-cats", "shop-grid", "shop-about", "shop-policy", "shop-powered"]) expect(screen.getByTestId(id)).toBeTruthy();
    expect(screen.getAllByTestId("shop-item")).toHaveLength(4);
    expect(screen.getAllByText("認證賣家", { exact: false }).length).toBeGreaterThan(0); // Taiwan seller → 繁體中文 (v2: about + trust badge)
  });
  it("Master → no Powered by", () => {
    render(<ShopApp preview={{ ...DEMO_SHOP, powered: false }} />);
    expect(screen.queryByTestId("shop-powered")).toBeNull();
  });
  it("product: pick a variant, quantity stops at its stock, add to cart", () => {
    render(<ShopApp preview={DEMO_SHOP} />);
    fireEvent.click(screen.getAllByTestId("shop-item")[0]);
    const opts = screen.getAllByTestId("pd-opt");
    const xl = opts.find((o) => o.textContent === "XL") as HTMLButtonElement;
    expect(xl.disabled).toBe(true);
    fireEvent.click(opts.find((o) => o.textContent === "M")!);
    fireEvent.click(screen.getAllByTestId("pd-opt").find((o) => o.textContent === "Blue")!);
    expect(screen.getByTestId("pd-price").textContent).toBe("NT$380");
    fireEvent.click(screen.getByTestId("pd-plus"));
    fireEvent.click(screen.getByTestId("pd-plus"));
    expect(screen.getByTestId("pd-qty").textContent).toBe("2");
    fireEvent.click(screen.getByTestId("pd-add"));
    expect(screen.getByTestId("shop-cart-count").textContent).toBe("2");
  });
  it("cart: free-shipping bar, subtotal", () => {
    render(<ShopApp preview={DEMO_SHOP} />);
    fireEvent.click(screen.getAllByTestId("shop-item")[1]);
    fireEvent.click(screen.getByTestId("pd-add"));
    fireEvent.click(screen.getByTestId("shop-cart-btn"));
    expect(within(screen.getByTestId("cart-free")).getByText(/1,220/)).toBeTruthy();
    expect(screen.getByTestId("cart-subtotal").textContent).toBe("NT$280");
  });
  it("closed shop → the closed page and no shop data", () => {
    render(<ShopApp host="www.sellerflowlive.com" path="/nothing" />);
    expect(screen.getByTestId("shop-closed")).toBeTruthy();
  });
});

describe("sql/163 part 2", () => {
  const sql = readFileSync("sql/163_seller_website.sql", "utf8");
  const fn = (name: string) => sql.slice(sql.indexOf(`create or replace function public.${name}(`), sql.indexOf("$$;", sql.indexOf(`function public.${name}(`)) + 3);
  it("plan rule: only Basic / Plus / Pro / Master, active, not expired; switch or tester", () => {
    const f = fn("website_plan");
    expect(f).toContain("in ('basic','plus','pro','master')");
    expect(f).toContain("plan_status, 'active')) = 'active'");
    expect(f).toContain("plan_expiry is null or sp.plan_expiry > now()");
    expect(fn("website_switch_for")).toContain("feature = 'seller_website'");
  });
  it("publish refuses Free (upgrade_required) — enforced in the database", () => {
    const f = fn("website_publish");
    expect(f).toContain("if plan = 'free' then raise exception 'upgrade_required'");
    expect(f).toContain("set published = draft");
  });
  it("the public shop: offline → {online:false} only; a whitelist of fields (no email / phone / plan)", () => {
    const f = fn("website_shop");
    expect(f).toContain("if plan = 'free' or not public.website_switch_for(w.user_id) then return jsonb_build_object('online', false)");
    expect(f).toContain("'powered', plan <> 'master'");
    for (const bad of ["email", "phone", "plan_expiry", "role"]) expect(f + fn("website_public_fields") + fn("website_products_of")).not.toMatch(new RegExp(`'${bad}'`));
    expect(fn("website_products_of")).toContain("coalesce(p.show_on_website, true)");
    expect(sql).toContain("grant execute on function public.website_shop(text) to anon, authenticated;");
  });
  it("the website table: RLS own rows; published / order_seq never writable by the seller directly", () => {
    expect(sql).toContain("grant update (subdomain, draft, settings, updated_at) on table public.seller_websites to authenticated;");
    expect(sql).not.toMatch(/grant update \([^)]*published/);
    expect(sql).toMatch(/website_subdomain_ok[\s\S]*'www','app','admin','api','mail','help'/);
  });
});

describe("vercel.json subdomain rewrite (audit 8)", () => {
  const cfg = JSON.parse(readFileSync("vercel.json", "utf8")) as { rewrites: { source: string; has?: { type: string; value: string }[]; destination: string }[] };
  const rule = cfg.rewrites.find((r) => r.has?.some((h) => h.type === "host"))!;
  const host = new RegExp(`^${rule.has!.find((h) => h.type === "host")!.value}$`);
  it("skips exactly the reserved names the app skips; a normal shop name matches", async () => {
    const { NOT_SHOPS } = await import("../route");
    for (const n of NOT_SHOPS) expect(host.test(`${n}.sellerflowlive.com`), n).toBe(false);
    expect(host.exec("budgetukay.sellerflowlive.com")?.groups?.sub).toBe("budgetukay");
    expect(host.test("apple.sellerflowlive.com")).toBe(true); // a name that only STARTS with a reserved word is a shop
    expect(host.test("www.sellerflowlive.com")).toBe(false);
    const listed = /\(\?:([a-z|]+)\)/.exec(rule.has![0].value)![1].split("|").sort();
    expect(listed).toEqual([...NOT_SHOPS].sort());
  });
});

describe("link preview — '$' in a shop name (audit 9)", () => {
  it("is inserted as plain text; the page is not rewritten", () => {
    const page = "<html><head><!--sfl-og--><title>Shop</title></head><body>APP</body></html>";
    for (const name of ["A$&B", "Price $' cut", "$`$`", "Shop $1 $$"]) {
      const html = injectOg(page, { online: true, title: name, description: `desc ${name}` }, "https://x/s/a", "https://img");
      expect(html).toContain(`<title>${escapeHtml(name)}</title>`);
      expect(html).toContain(`content="${escapeHtml(name)}"`);
      expect(html).toContain(`content="desc ${escapeHtml(name)}"`);
      expect(html.match(/<body>APP<\/body>/g)).toHaveLength(1);
      expect(html.match(/<title>/g)).toHaveLength(1);
      expect(html).not.toContain("<!--sfl-og-->");
    }
  });
  it("api/shop.ts only injects through injectOg (no own string replace of shop data)", () => {
    const api = readFileSync("api/shop.ts", "utf8");
    expect(api).toContain("injectOg(");
    expect(api.match(/\.replace\(/g) || []).toHaveLength(0);
  });
});
