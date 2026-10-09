// Build 6 — "Stock freshness" (switch stock_refresh_v2, sql/107), client only. Pins:
//   • the race guard: a product with a deduction in flight, or one within 15 s, keeps its local
//     count on a reload; others take the database value; new / removed products follow the DB;
//   • debounce: at most one reload per 10 s;
//   • triggers: page visible again + native app resume (only when the switch is on, cleaned up);
//   • RedesignApp wiring (source contracts): the reload touches only codes + stock (never the
//     dedup refs / processed set / codesReadyRef), skips while the sign-in load is in flight,
//     and is called from the triggers + Orders open only with the switch on; the sold-out re-check
//     that finds stock orders the comment through the normal Auto path and sends no message; the
//     waitlist Give reads the database first (0 → no order + note, unreadable → today's flow).
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { createStockGuard, mergeReloadedStock, debounceAllows, useStockRefreshTriggers, STOCK_REFRESH_DEBOUNCE_MS, STOCK_TOUCH_GUARD_MS } from "../stockRefresh";
import { buildT } from "../../i18n";

const prod = (id: number, stock: number) => ({ id, name: `P${id}`, sku: "", price: 100, stock, platform: "All", status: "Active", liveCode: `A${id}` });

describe("race guard + merge", () => {
  it("in flight / touched within 15 s → keep local; otherwise the DB value", () => {
    const g = createStockGuard();
    const local = new Map([[1, 3], [2, 5], [3, 9], [4, 1]]);
    g.begin(1, 1000);                                        // deduction in flight
    g.touch(2, 100_000 - STOCK_TOUCH_GUARD_MS + 1);          // Auto order just now
    g.touch(3, 100_000 - STOCK_TOUCH_GUARD_MS - 1);          // long ago
    const out = mergeReloadedStock(local, [prod(1, 10), prod(2, 10), prod(3, 10), prod(4, 10), prod(5, 7)], g, 100_000);
    expect([...out.entries()]).toEqual([[1, 3], [2, 5], [3, 10], [4, 10], [5, 7]]); // 5 = new on the laptop; 6 gone
    g.end(1, 120_000);
    expect(g.pendingCount(1)).toBe(0);
    expect(g.canOverwrite(1, 120_000 + STOCK_TOUCH_GUARD_MS + 1)).toBe(true);
  });
  it("two deductions in flight: one ending is not enough", () => {
    const g = createStockGuard();
    g.begin(7, 0); g.begin(7, 0); g.end(7, 0);
    expect(g.canOverwrite(7, 10 * STOCK_TOUCH_GUARD_MS)).toBe(false);
    g.end(7, 0);
    expect(g.canOverwrite(7, 10 * STOCK_TOUCH_GUARD_MS)).toBe(true);
  });
  it("debounce: at most once per 10 s", () => {
    expect(debounceAllows(0, 5)).toBe(true);
    expect(debounceAllows(1000, 1000 + STOCK_REFRESH_DEBOUNCE_MS - 1)).toBe(false);
    expect(debounceAllows(1000, 1000 + STOCK_REFRESH_DEBOUNCE_MS)).toBe(true);
    expect(STOCK_REFRESH_DEBOUNCE_MS).toBe(10_000);
  });
});

describe("triggers", () => {
  afterEach(() => { delete (window as unknown as { Capacitor?: unknown }).Capacitor; vi.restoreAllMocks(); });
  const setVis = (v: string) => Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });
  it("OFF: no listener at all", () => {
    const add = vi.spyOn(document, "addEventListener");
    const appAdd = vi.fn();
    (window as unknown as { Capacitor: unknown }).Capacitor = { Plugins: { App: { addListener: appAdd } } };
    renderHook(() => useStockRefreshTriggers(false, vi.fn()));
    expect(add.mock.calls.some((c) => c[0] === "visibilitychange")).toBe(false);
    expect(appAdd).not.toHaveBeenCalled();
  });
  it("ON: visible again → callback (hidden → nothing); native resume → callback; cleaned up", async () => {
    const cb = vi.fn();
    const remove = vi.fn();
    let resume: () => void = () => {};
    (window as unknown as { Capacitor: unknown }).Capacitor = { Plugins: { App: { addListener: vi.fn((e: string, f: () => void) => { if (e === "resume") resume = f; return Promise.resolve({ remove }); }) } } };
    const h = renderHook(() => useStockRefreshTriggers(true, cb));
    setVis("hidden"); document.dispatchEvent(new Event("visibilitychange"));
    expect(cb).not.toHaveBeenCalled();
    setVis("visible"); document.dispatchEvent(new Event("visibilitychange"));
    expect(cb).toHaveBeenCalledTimes(1);
    resume();
    expect(cb).toHaveBeenCalledTimes(2);
    await Promise.resolve(); await Promise.resolve();
    h.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(cb).toHaveBeenCalledTimes(2);
  });
  it("no Capacitor App plugin (web): visibility only, no throw", () => {
    const cb = vi.fn();
    expect(() => renderHook(() => useStockRefreshTriggers(true, cb))).not.toThrow();
  });
});

describe("RedesignApp wiring (source contract)", () => {
  const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
  const body = (name: string) => { const s = src.indexOf(`const ${name} = `); const a = src.slice(s); const n = a.slice(10).search(/\n {2}const [a-zA-Z]+ = /); return n < 0 ? a : a.slice(0, n + 10); };
  it("the reload touches only codes + stock; skips while the sign-in load runs; debounced; empty / failed read changes nothing", () => {
    const all = body("reloadAutoProducts");
    const b = all.slice(0, all.indexOf("\n  };") + 5);             // the function only
    expect(b).toContain("if (!codesReadyRef.current) return;");
    expect(b).toContain("if (!debounceAllows(lastStockReloadRef.current, startedAt)) return;");
    expect(b).toContain("if (gen !== productsGenRef.current || !codesReadyRef.current || !rows || rows.length === 0) return;");
    expect(b).toContain("autoCodesRef.current = codesFromProducts(rows);");
    expect(b).toContain("autoStockRef.current = mergeReloadedStock(autoStockRef.current, rows, stockGuardRef.current, startedAt);");
    expect(b).not.toMatch(/autoProcessedRef|autoDupRef|codesReadyRef\.current\s*=|setAutoBadges|soldoutSentRef/);
  });
  it("triggers + Orders open only with the switch on; no timer", () => {
    expect(src).toContain("useStockRefreshTriggers(featureSw.stockRefreshV2, () => { void reloadAutoProductsRef.current(); });");
    expect(src).toContain('useEffect(() => { if (featureSw.stockRefreshV2 && screen === "orders") void reloadAutoProductsRef.current(); }, [featureSw.stockRefreshV2, screen]);');
    expect((src.match(/reloadAutoProductsRef\.current\(\)/g) || []).length).toBe(2);
    expect(src).not.toMatch(/setInterval\([^)]*reloadAutoProducts/);
  });
  it("deductions are guarded (1-Click begin/end, Auto touch, waitlist begin/end)", () => {
    expect(body("deductOneClickStock")).toContain("stockGuardRef.current.begin(code.productLocalId, Date.now());");
    expect(body("deductOneClickStock")).toContain("stockGuardRef.current.end(code.productLocalId, Date.now());");
    expect(src).toContain("stockGuardRef.current.touch(plan.code.productLocalId, Date.now());");
    expect(body("onWaitlistGive")).toContain('adjustStockLogged(lid, -1, "waitlist", r.commentId).finally(() => stockGuardRef.current.end(lid, Date.now()));');
  });
  it("sold-out re-check finds stock → the normal Auto path, no message; still one try per comment", () => {
    const b = body("onSoldOutFacebook");
    expect(b.indexOf("soldoutSentRef.current.add(target.commentId);")).toBeLessThan(b.indexOf("loadProductStock("));
    const branch = b.slice(b.indexOf("if (stock > 0) {"), b.indexOf("// F3: join the line BEFORE"));
    expect(branch).toContain("if (featureSw.stockRefreshV2) {");
    expect(branch).toContain("autoCommentRef.current(c);");
    expect(branch).toContain("return;");
    expect(branch).not.toMatch(/sendSoldOut|joinWaitlist/);
  });
  it("waitlist Give: DB read first with the switch on; 0 → no order + note; unreadable / OFF → today's flow", () => {
    const b = body("onWaitlistGive");
    const v2 = b.slice(b.indexOf("if (featureSw.stockRefreshV2 && checkLid != null) {"));
    expect(v2.indexOf("loadProductStock(checkLid)")).toBeLessThan(v2.indexOf("give();"));
    expect(v2).toContain("if (st === 0) { wlGiveRef.current.delete(r.id); setWlNote(tApp.rd_wl_no_stock); return; }");
    expect(b.indexOf("const give = () => {")).toBeLessThan(b.indexOf("if (featureSw.stockRefreshV2 && checkLid != null) {"));
    expect(b.trimEnd().endsWith("give();\n  };") || /give\(\);\s*\};\s*$/.test(b)).toBe(true); // OFF / null id → today's flow
  });
  it("note text in 8 languages", () => {
    expect(buildT("en").rd_wl_no_stock).toBe("No stock left for this code — restock first.");
    expect(buildT("fil").rd_wl_no_stock).toBe("Wala nang stock para sa code na ito — mag-restock muna.");
    for (const l of ["zh", "zh-TW", "vi", "th", "id", "bg"]) expect(String(buildT(l).rd_wl_no_stock).trim()).not.toBe("");
  });
});
