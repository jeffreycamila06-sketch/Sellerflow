// Seller Website hotfix — screenshots inside the REAL app shell (index.html → RedesignApp, with the
// bottom bar), at iPhone / Android / laptop width. Every Supabase call is answered HERE (Playwright
// routes on the fake host demo.supabase.co) with demo data — no real database, no real seller data.
// Run: (1) VITE_SUPABASE_URL=https://demo.supabase.co VITE_SUPABASE_ANON_KEY=demo npx vite --port 5198 --strictPort
//      (2) node docs/design/seller-website-hotfix/app-shell/shoot.cjs [preview|publish|all]
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const OUT = path.join(__dirname, "..", "shots");
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:5198/";
const SB = "https://demo.supabase.co";
const UID = "11111111-2222-4333-8444-555555555555";
const which = process.argv[2] || "all";
const PFX = process.env.SHOT_PREFIX || ""; // "before-" = run against main's editor for comparison

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const EXP = Math.floor(Date.now() / 1000) + 7 * 86400;
const JWT = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: UID, role: "authenticated", exp: EXP, email: "demo@example.com", aud: "authenticated" })}.sig`;
const USER = { id: UID, aud: "authenticated", role: "authenticated", email: "demo@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const SESSION = { access_token: JWT, refresh_token: "r", token_type: "bearer", expires_in: 604800, expires_at: EXP, user: USER };
const PROFILE = { id: 1, auth_user_id: UID, email: "demo@example.com", full_name: "Demo Seller", store_name: "BudgetUkay", phone: "0912000111", tiktok: "budgetukay", facebook: "", role: "seller", plan: "pro", plan_status: "active", plan_expiry: "2027-11-01", country: "TW", connected_accounts: [], created_at: "2026-01-01T00:00:00Z" };

const DESIGN = {
  name: "BudgetUkay", tagline: "Pre-loved & new clothes · Taipei", about: "We sell pre-loved and new clothes, checked one by one.",
  announcement: "Free shipping over NT$1,500 · New drops every Friday", live: "Live tonight 8:00 PM on Facebook & TikTok",
  color: "#EE4D2D", logo: "demo/logo.jpg", cover: "demo/cover.jpg", socials: { facebook: "budgetukay", tiktok: "budgetukay" }, chats: { line: "@budgetukay" },
};
const SETTINGS = { ship: { s711: { enabled: true, fee: 60 }, fm: { enabled: false, fee: 60 }, home: { enabled: false, fee: 120 } }, freeOver: 1500, bank: { enabled: true, bankName: "Cathay United Bank (013)", accountName: "BudgetUkay", accountNumber: "0123-4567-8901" }, qr: { enabled: false }, cod: { enabled: true }, autoCancelHours: 24 };
const PRODUCTS = [1, 2, 3, 4, 5, 6].map((i) => ({ id: i, user_id: UID, local_id: i, name: ["Floral midi dress", "Linen button shirt", "Mini shoulder bag", "White sneakers", "Wide-leg pants", "Knit cardigan"][i - 1], price: [350, 280, 300, 890, 420, 390][i - 1], stock: [3, 9, 2, 1, 5, 3][i - 1], code: `A0${i}`, category: "Clothes", platform: "TikTok", parent_local_id: null, image_path: `demo/p${i}.jpg`, created_at: "2026-11-10T00:00:00Z", updated_at: "2026-11-10T00:00:00Z" }));


const COLORS = ["#F9A8D4", "#93C5FD", "#FCD34D", "#A7F3D0", "#C4B5FD", "#FDBA74"];
function svg(p) {
  const i = [...p].reduce((a, c) => a + c.charCodeAt(0), 0);
  if (p.includes("cover")) return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#EE4D2D"/><stop offset="1" stop-color="#C026D3"/></linearGradient></defs><rect width="1200" height="400" fill="url(#g)"/></svg>`;
  if (p.includes("logo")) return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#111827"/><text x="100" y="125" font-size="76" font-family="Arial" font-weight="700" fill="#fff" text-anchor="middle">BU</text></svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="${COLORS[i % COLORS.length]}"/><circle cx="300" cy="260" r="120" fill="#fff" opacity=".55"/></svg>`;
}

/** state per page: the website row (draft/published) + what publish answers. */
function mount(page, st) {
  const unknown = new Set();
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
  return page.route(`${SB}/**`, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const p = u.pathname;
    const json = (body, status = 200, extra = {}) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "*", ...extra }, body: JSON.stringify(body) });
    if (req.method() === "OPTIONS") return json({});
    const single = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
    if (p.startsWith("/storage/v1/object/public/")) return route.fulfill({ status: 200, contentType: "image/svg+xml", body: svg(p) });
    if (p === "/auth/v1/user") return json(USER);
    if (p.startsWith("/auth/v1/token")) return json(SESSION);
    if (p.startsWith("/realtime/")) return route.abort();
    if (p.startsWith("/rest/v1/rpc/")) {
      const fn = p.slice("/rest/v1/rpc/".length);
      if (fn === "my_feature_access") return json({ seller_website: true });
      if (fn === "website_publish") {
        await new Promise((r) => setTimeout(r, st.publishDelay || 900));
        if (st.publishError) return json({ message: st.publishError, code: "P0001" }, 400);
        st.row.published = st.row.draft; st.row.published_at = new Date().toISOString();
        return json({ ok: true, at: st.row.published_at });
      }
      if (fn === "website_subdomain_free") return json(true);
      if (fn === "website_new_orders_count") return json(0);
      if (fn === "my_product_photo_quota") return json({ used: 6, limit: 1500 });
      if (fn === "session_status") return json({ current_session_id: null });
      unknown.add(`rpc ${fn}`);
      return json(null);
    }
    if (p === "/rest/v1/seller_profiles") return json(single ? PROFILE : [PROFILE]);
    if (p === "/rest/v1/seller_websites") {
      if (req.method() === "PATCH") { const b = JSON.parse(req.postData() || "{}"); if (b.draft) st.row.draft = b.draft; if (b.subdomain) st.row.subdomain = b.subdomain; return json(null, 204); }
      return json(single ? st.row : [st.row]);
    }
    if (p === "/rest/v1/app_settings") {
      const rows = [{ key: "seller_website_enabled", value: "false" }, ...(st.settings || [])];
      return json(single ? rows[0] : rows);
    }
    if (p === "/rest/v1/products") return json(PRODUCTS);
    unknown.add(`${req.method()} ${p}`);
    return json(single ? null : []);
  }).then(() => unknown);
}

const SIZES = [
  { tag: "iphone", ctx: { ...devices["iPhone 13"] } },
  { tag: "android", ctx: { ...devices["Pixel 7"] } },
  { tag: "laptop", ctx: { viewport: { width: 1366, height: 820 }, deviceScaleFactor: 1 } },
];

async function openEditor(browser, size, st) {
  const ctx = await browser.newContext({ ...size.ctx, locale: "en-US" });
  await ctx.addInitScript(([s]) => {
    try {
      localStorage.setItem("sf_supabase_auth", s);
      localStorage.setItem("sfl_rd_lang", "en");
      localStorage.setItem("sfl_rd_theme", "light");
    } catch { /* */ }
  }, [JSON.stringify(SESSION)]);
  const page = await ctx.newPage();
  const unknown = await mount(page, st);
  await page.goto(BASE, { waitUntil: "networkidle" });
  // Settings tab → Website tile
  await page.locator(".sfl-nav").getByText(/Settings/i).first().click();
  await page.getByText(/^Website$/).first().click();
  await page.getByTestId("wed-preview").waitFor({ timeout: 15000 });
  await page.waitForTimeout(700);
  return { ctx, page, unknown };
}

(async () => {
  const browser = await chromium.launch();
  for (const size of SIZES) {
    if (which === "all" || which === "preview") {
      const st = { row: { subdomain: "budgetukay", draft: DESIGN, published: DESIGN, published_at: "2026-11-14T02:00:00Z", settings: SETTINGS, custom_domain: null } };
      const { ctx, page, unknown } = await openEditor(browser, size, st);
      await page.screenshot({ path: path.join(OUT, `${PFX}preview-0-editor-${size.tag}.jpg`), quality: 80, type: "jpeg" });
      await page.getByTestId("wed-preview").click();
      await page.getByTestId("wed-preview-sheet").waitFor();
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(OUT, `${PFX}preview-1a-opening-${size.tag}.jpg`), quality: 80, type: "jpeg" });
      await page.waitForTimeout(1050); // past any entrance animation — what the seller sees
      const info = await page.evaluate(() => {
        const sheet = document.querySelector('[data-testid="wed-preview-sheet"]');
        const nav = document.querySelector(".sfl-nav");
        const cs = getComputedStyle(sheet);
        let n = sheet, op = 1;
        while (n && n !== document) { op *= Number(getComputedStyle(n).opacity || 1); n = n.parentElement; }
        const navR = nav ? nav.getBoundingClientRect() : null;
        const navHit = navR && navR.height > 0 ? document.elementFromPoint(navR.left + navR.width / 2, navR.top + navR.height / 2) : null;
        const close = document.querySelector('[data-testid="wed-preview-close"]').getBoundingClientRect();
        const anc = []; for (let a = sheet.parentElement; a && a !== document.documentElement; a = a.parentElement) { const c = getComputedStyle(a); if (c.transform !== "none" || c.animationName !== "none" || c.filter !== "none") anc.push(`${a.className || a.tagName}:${c.animationName}/${c.transform}`); }
        return {
          parentIsBody: sheet.parentElement === document.body, opacity: op, bg: cs.backgroundColor, z: cs.zIndex,
          sheetRect: sheet.getBoundingClientRect().toJSON(), viewport: [innerWidth, innerHeight],
          navCoveredBySheet: navHit ? sheet.contains(navHit) : "no-nav-on-screen",
          ancestorsWithTransformOrAnimation: anc, closeVisible: close.width > 0 && close.top >= 0 && close.right <= innerWidth,
        };
      });
      console.log(`[${size.tag}] preview`, JSON.stringify(info));
      await page.screenshot({ path: path.join(OUT, `${PFX}preview-1-open-${size.tag}.jpg`), quality: 80, type: "jpeg" });
      await page.evaluate(() => { const b = document.querySelector('[data-testid="wed-preview-body"]') || document.querySelector('[data-testid="wed-preview-sheet"]'); b.scrollTop = 700; });
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(OUT, `${PFX}preview-1b-scrolled-${size.tag}.jpg`), quality: 80, type: "jpeg" });
      await page.getByTestId("wed-preview-close").click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, `${PFX}preview-2-closed-${size.tag}.jpg`), quality: 80, type: "jpeg" });
      if (unknown.size) console.log("  unanswered:", [...unknown].join(", "));
      await ctx.close();
    }
    if (which === "all" || which === "publish") {
      // a draft with a change → Publish → Publishing… → ✓ Published + toast → Published ✓ (disabled)
      const st = { row: { subdomain: "budgetukay", draft: { ...DESIGN, tagline: "New tagline" }, published: DESIGN, published_at: "2026-11-14T02:00:00Z", settings: SETTINGS, custom_domain: null }, publishDelay: 1500 };
      const { ctx, page } = await openEditor(browser, size, st);
      const shot = (n) => page.screenshot({ path: path.join(OUT, `publish-${n}-${size.tag}.jpg`), quality: 80, type: "jpeg" });
      await shot("0-has-changes");
      await page.getByTestId("wed-publish").click();
      await page.waitForTimeout(500);
      await shot("1-publishing");
      await page.getByText("✓ Published", { exact: true }).waitFor({ timeout: 8000 });
      await page.waitForTimeout(150);
      await shot("2-published-toast");
      await page.waitForTimeout(3500);
      await shot("3-up-to-date");
      await ctx.close();
      // error: upgrade needed (the database says so)
      const st2 = { row: { subdomain: "budgetukay", draft: { ...DESIGN, tagline: "New tagline" }, published: DESIGN, published_at: "2026-11-14T02:00:00Z", settings: SETTINGS, custom_domain: null }, publishDelay: 400, publishError: "upgrade_required" };
      const o2 = await openEditor(browser, size, st2);
      await o2.page.getByTestId("wed-publish").click();
      await o2.page.waitForTimeout(1200);
      await o2.page.screenshot({ path: path.join(OUT, `publish-4-error-${size.tag}.jpg`), quality: 80, type: "jpeg" });
      await o2.ctx.close();
    }
  }
  await browser.close();
})();
