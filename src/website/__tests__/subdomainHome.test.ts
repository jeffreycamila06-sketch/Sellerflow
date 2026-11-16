// Seller Website hotfix 5 — <sub>.sellerflowlive.com/ stays on the subdomain. Vercel serves real
// files before vercel.json rewrites ("the filesystem takes precedence over rewrites"), so "/" got
// index.html (the seller app) whose guard sent buyers to www…/s/<sub>. middleware.ts runs before
// the filesystem for "/" and "/index.html" only: a shop host → /api/shop?sub=<sub> (the same page
// the vercel.json host rewrite serves for every other path); any other host → continue unchanged.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import middleware, { config } from "../../../middleware";
import { NOT_SHOPS } from "../route";

const call = (host: string, path = "/", headers: Record<string, string> = {}) =>
  middleware(new Request(`https://${host}${path}`, { headers: { host, ...headers } }));
const rewriteOf = (r: Response) => r.headers.get("x-middleware-rewrite");
const continues = (r: Response) => r.headers.get("x-middleware-next") === "1" && !rewriteOf(r) && r.status === 200;

describe("middleware: shop host home page", () => {
  it("only runs for / and /index.html (every other request never reaches it)", () => {
    expect(config).toEqual({ runtime: "nodejs", matcher: ["/", "/index.html"] });
  });
  it("<sub>.sellerflowlive.com/ → /api/shop?sub=<sub> on the same host (no redirect)", () => {
    for (const p of ["/", "/index.html", "/?fbclid=abc"]) {
      const r = call("budgetukay.sellerflowlive.com", p);
      expect(rewriteOf(r)).toBe("https://budgetukay.sellerflowlive.com/api/shop?sub=budgetukay");
      expect(r.headers.get("location")).toBeNull();
      expect(r.status).toBe(200);
    }
    expect(rewriteOf(call("Maria-Shop.SellerFlowLive.com"))).toBe("https://maria-shop.sellerflowlive.com/api/shop?sub=maria-shop");
    expect(rewriteOf(call("x.example", "/", { "x-forwarded-host": "budgetukay.sellerflowlive.com" }))).toBe("https://x.example/api/shop?sub=budgetukay");
  });
  it("www, the apex, reserved names, previews, other domains → continue exactly as before", () => {
    for (const h of ["www.sellerflowlive.com", "sellerflowlive.com", "sellerflow-git-preview-x.vercel.app", "localhost:5173", "evil.com", "a.b.sellerflowlive.com", "-bad.sellerflowlive.com"])
      expect(continues(call(h)), h).toBe(true);
    for (const n of NOT_SHOPS) expect(continues(call(`${n}.sellerflowlive.com`)), n).toBe(true);
  });
  it("the app's own query (APK thin shell ?apk=…) on www continues", () => {
    expect(continues(call("www.sellerflowlive.com", "/?apk=20260523-dark-mobile"))).toBe(true);
  });
  it("a broken request never breaks the home page (continue)", () => {
    const bad = { url: "not a url", headers: new Headers() } as unknown as Request;
    expect(continues(middleware(bad))).toBe(true);
  });
});

describe("vercel.json: every other shop path stays on the subdomain", () => {
  const vj = JSON.parse(readFileSync("vercel.json", "utf8"));
  const hostRule = vj.rewrites.find((r: { has?: { type: string }[] }) => r.has?.some((h) => h.type === "host"));
  it("the host rewrite still covers product / cart / checkout / store / sent / order paths, and not files the shop page needs", () => {
    const src = new RegExp(`^${hostRule.source}$`);
    for (const p of ["/p/12", "/cart", "/checkout", "/store", `/sent/${"a".repeat(40)}`, `/o/${"a".repeat(40)}`]) expect(src.test(p), p).toBe(true);
    for (const p of ["/assets/x.js", "/api/shop", "/shop.html", "/favicon.svg"]) expect(src.test(p), p).toBe(false);
    expect(hostRule.destination).toBe("/api/shop?sub=:sub");
  });
  it("vercel.json has no redirect and no rule for www / the apex (they stay as today)", () => {
    expect(vj.redirects).toBeUndefined();
    expect(JSON.stringify(vj.rewrites)).not.toMatch(/www\\\\\.sellerflowlive|"value":"sellerflowlive/);
  });
});

describe("api/shop: same-host shop.html fetch", () => {
  const run = async (host: string, cookie?: string) => {
    const { default: shop } = await import("../../../api/shop");
    const seen: { url: string; init?: RequestInit }[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (u: string, init?: RequestInit) => { seen.push({ url: String(u), init }); return new Response('<html><head><title>x</title><!--sfl-og--></head><body><div id="shop-root"></div></body></html>'); }) as typeof fetch;
    let status = 0;
    try {
      await shop({ query: { sub: "budgetukay" }, headers: { host, ...(cookie ? { cookie } : {}) } }, { setHeader: () => {}, status: (n: number) => ({ send: () => { status = n; } }) });
    } finally { globalThis.fetch = real; }
    const page = seen.find((x) => x.url.endsWith("/shop.html"))!;
    return { status, url: page.url, cookie: (page.init?.headers as Record<string, string> | undefined)?.cookie };
  };
  it("own hosts: the visitor's cookie goes along (a protected Preview works); production subdomain fetches its own host", async () => {
    expect(await run("budgetukay.sellerflowlive.com", "_vercel_jwt=x")).toEqual({ status: 200, url: "https://budgetukay.sellerflowlive.com/shop.html", cookie: "_vercel_jwt=x" });
    expect((await run("sellerflow-git-x.vercel.app", "_vercel_jwt=x")).cookie).toBe("_vercel_jwt=x");
    expect((await run("www.sellerflowlive.com")).cookie).toBeUndefined();
  });
  it("any other host: no cookie is sent", async () => {
    expect((await run("evil.com", "a=b")).cookie).toBeUndefined();
    expect((await run("sellerflowlive.com.evil.com", "a=b")).cookie).toBeUndefined();
  });
});
