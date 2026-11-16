// REAL screens of Invite friends (sql/165), from the real app on the preview database
// (src/dev/fakeSupabase.ts — ?inv=choose / ?inv=free / default, ?admin=1, ?anon=1).
//   1) npx vite --config vite.preview.config.ts --port 5199
//   2) node docs/design/invite-referral/make-shots.cjs
const { chromium } = require("playwright");
const OUT = __dirname;
const DEVICES = [
  { id: "iphone390", w: 390, h: 844 },
  { id: "android360", w: 360, h: 800 },
  { id: "android430", w: 430, h: 932 },
  { id: "laptop1280", w: 1280, h: 800 },
];
const BASE = "http://localhost:5199/";
async function settings(p, q) {
  await p.goto(BASE + q, { waitUntil: "networkidle" });
  await p.waitForTimeout(900);
  await p.locator("button", { hasText: /^Settings$/ }).last().click();
  await p.waitForTimeout(400);
}
const SHOTS = [
  { id: "1-hub-card", q: "", run: async (p) => { await settings(p, ""); } },
  { id: "2-choose-code", q: "?inv=choose", run: async (p) => {
    await settings(p, "?inv=choose"); await p.click('[data-testid="invite-card"]'); await p.waitForTimeout(500);
    await p.fill('[data-testid="inv-code-input"]', "budgetukay"); await p.waitForTimeout(900); } },
  { id: "3-confirm-save", q: "?inv=choose", run: async (p) => {
    await settings(p, "?inv=choose"); await p.click('[data-testid="invite-card"]'); await p.waitForTimeout(500);
    await p.fill('[data-testid="inv-code-input"]', "budgetukay"); await p.waitForTimeout(900);
    await p.click('[data-testid="inv-save"]'); await p.waitForTimeout(300); } },
  { id: "4-has-code", q: "", full: true, run: async (p) => { await settings(p, ""); await p.click('[data-testid="invite-card"]'); await p.waitForTimeout(800); } },
  { id: "5-free-seller", q: "?inv=free", full: true, run: async (p) => {
    await settings(p, "?inv=free"); await p.click('[data-testid="invite-card"]'); await p.waitForTimeout(600);
    await p.fill('[data-testid="inv-enter-input"]', "lheyukay"); await p.waitForTimeout(900); } },
  { id: "6-iphone-app-wording", q: "?ios=1", full: true, run: async (p) => { await settings(p, "?ios=1"); await p.click('[data-testid="invite-card"]'); await p.waitForTimeout(800); } },
  { id: "7-signup", q: "?anon=1", run: async (p) => {
    await p.goto(BASE + "?anon=1", { waitUntil: "networkidle" }); await p.waitForTimeout(900);
    await p.locator("button, a", { hasText: /^Create free account$/ }).first().click({ timeout: 8000 }); await p.waitForTimeout(900);
    if (!(await p.locator('[data-testid="su-invite"]').count())) {
      const more = p.locator("button, a, span", { hasText: /^Create account$/ });
      if (await more.count()) { await more.first().click({ timeout: 5000 }); await p.waitForTimeout(700); }
    }
    await p.fill('[data-testid="su-invite"]', "budgetukay", { timeout: 8000 }); await p.waitForTimeout(900);
    await p.locator('[data-testid="su-invite-state"]').scrollIntoViewIfNeeded(); await p.mouse.wheel(0, 400); await p.waitForTimeout(300); } },
];
const ADMIN = [
  { id: "8-admin-seller-card", run: async (p) => {
    await p.goto(BASE + "?admin=1", { waitUntil: "networkidle" }); await p.waitForTimeout(900);
    await p.locator(".sfl-nav-admin").last().evaluate((el) => el.click()); await p.waitForTimeout(700);
    await p.getByText(/^Sellers$/).first().click({ timeout: 8000 }); await p.waitForTimeout(1200);
    await p.locator('[data-testid="adm-invite"]').first().scrollIntoViewIfNeeded({ timeout: 8000 }); await p.mouse.wheel(0, -120); await p.waitForTimeout(300); } },
  { id: "9-admin-invite-rewards", run: async (p) => {
    await p.goto(BASE + "?admin=1", { waitUntil: "networkidle" }); await p.waitForTimeout(900);
    await p.locator(".sfl-nav-admin").last().evaluate((el) => el.click()); await p.waitForTimeout(700);
    await p.click('[data-testid="admin-ctrl-invrewards"]', { timeout: 8000 }); await p.waitForTimeout(800); } },
  { id: "10-admin-invite-history", run: async (p) => {
    await p.goto(BASE + "?admin=1", { waitUntil: "networkidle" }); await p.waitForTimeout(900);
    await p.locator(".sfl-nav-admin").last().evaluate((el) => el.click()); await p.waitForTimeout(700);
    await p.click('[data-testid="admin-ctrl-invhistory"]', { timeout: 8000 }); await p.waitForTimeout(1000);
    await p.locator('[data-testid="ih-revoke"]').first().click({ timeout: 8000 }); await p.waitForTimeout(300); } },
];
(async () => {
  const filter = process.argv[2] || "";
  const b = await chromium.launch();
  for (const d of DEVICES) {
    for (const s of [...SHOTS, ...ADMIN]) {
      if (filter && !filter.split(",").some((f) => s.id.includes(f))) continue;
      const c = await b.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: 2 });
      const p = await c.newPage();
      try { await s.run(p); await p.screenshot({ path: `${OUT}/${s.id}_${d.id}.jpg`, type: "jpeg", quality: 78, fullPage: !!s.full }); console.log("ok", s.id, d.id); }
      catch (e) { console.log("FAIL", s.id, d.id, String(e).slice(0, 160)); }
      await c.close();
    }
  }
  await b.close();
})();
