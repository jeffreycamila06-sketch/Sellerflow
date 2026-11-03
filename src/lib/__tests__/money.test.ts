// Decimal prices (RM 2.90, ₱ 12.50) — one shared rule for every money input and display:
// whole amounts render EXACTLY as before (NT$ has no cents), cents always show 2 places.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fmtMoney, moneyText, priceInput, hasCents } from "../money";
import { buildOrderFromComment, rebuildSessionFromRows } from "../orderLogic";
import { formatAmount, receiptTotalText } from "../receiptLayout.js";
import { upsertProduct } from "../../redesign/adapters/products";
import { buildNativeStickerPayload } from "../../redesign/adapters/printing";
import { fmt } from "../../redesign/data";
import { DEF_SETTINGS } from "../../redesign/adapters/printing";
import type { Buyer } from "../orderTypes";

const src = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8"); // vitest cwd = repo root (Vite rewrites new URL(`…${p}`, import.meta.url))
const comment = { handle: "aisyah", name: "Aisyah", comment: "mine", platform: "TikTok" as const, isBuy: true, buyerNum: null, buyerData: null, time: "10:00" };
const NOW = new Date("2026-11-03T02:00:00Z");

describe("fmtMoney / moneyText / priceInput", () => {
  it("whole amounts are unchanged (NT$ golden); cents show 2 places", () => {
    expect(fmtMoney(350)).toBe("350");
    expect(fmtMoney(1200)).toBe("1,200");
    expect(fmtMoney(0)).toBe("0");
    expect(fmtMoney(2.9)).toBe("2.90");
    expect(fmtMoney(2.9 * 3)).toBe("8.70");      // 8.700000000000001 → 8.70
    expect(fmtMoney(1234.5)).toBe("1,234.50");
    expect(fmt).toBe(fmtMoney);                   // data.ts fmt = the shared rule (Orders/Products/SalesTab/exports)
    expect(moneyText(350)).toBe("350");
    expect(moneyText(1200)).toBe("1200");
    expect(moneyText(2.9)).toBe("2.90");
    expect(moneyText(2.9 * 3)).toBe("8.70");      // CSV / badge: no float noise
  });
  it("no-cents currencies (NT$) keep origin/main's digits-only rule verbatim", () => {
    for (const c of ["NT$", "₫", "Rp", "¥", "₩"]) expect(hasCents(c)).toBe(false);
    for (const c of ["RM", "₱", "$", "€", "฿", "A$"]) expect(hasCents(c)).toBe(true);
    const main = (v: string) => v.replace(/[^0-9]/g, "");   // origin/main RedesignApp onEntPrice
    for (const v of ["1,200", "1200", "2.90", "2,90", "12.", "-5", "abc", "", "1.200", " 3 5 "]) expect(priceInput(v, false)).toBe(main(v));
    expect(priceInput("1,200", false)).toBe("1200");
  });
  it("cent currencies: ',' is a decimal point only with 1–2 trailing digits; 3 = thousands; capped at 2; no negatives", () => {
    expect(priceInput("2,90")).toBe("2.90");
    expect(priceInput("2,9")).toBe("2.9");
    expect(priceInput("2.90")).toBe("2.90");
    expect(priceInput("1,200")).toBe("1200");
    expect(priceInput("1.200")).toBe("1200");
    expect(priceInput("1,234.50")).toBe("1234.50");
    expect(priceInput("2.")).toBe("2.");           // pending decimal while typing
    expect(priceInput("2,")).toBe("2.");
    expect(priceInput("12.5.")).toBe("12.5");      // a 2nd dot is dropped
    expect(priceInput("12.5.0")).toBe("12.50");    // first dot wins (origin/main tiktokSend rule)
    expect(priceInput("1..2")).toBe("1.2");
    expect(priceInput(".5")).toBe(".5");
    expect(priceInput("2.9051")).toBe("2.90");     // cap 2 decimals
    expect(priceInput("-2.90")).toBe("2.90");      // negatives rejected
    expect(priceInput("RM 2,9")).toBe("2.9");
    expect(priceInput("350")).toBe("350");
    expect(priceInput("abc")).toBe("");
    expect(Number(priceInput("2,90"))).toBe(2.9);
    expect(Number(priceInput("1,200"))).toBe(1200);
  });
});

describe("NT$ whole-number output = origin/main, byte for byte", () => {
  const whole = [0, 1, 7, 38, 100, 350, 999, 1000, 1200, 12345, 99999, 1000000];
  it("display / text / receipt / item", () => {
    for (const n of whole) {
      expect(fmtMoney(n)).toBe(n.toLocaleString("en-US"));                       // data.ts fmt (main)
      expect(moneyText(n)).toBe(String(n));                                        // orderLogic item (main) + CSV `${cur}${total}`
      expect(formatAmount("NT$", n)).toBe(`NT$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`); // receiptLayout (main)
      expect(buildOrderFromComment(comment, [], n, NOW).order.item).toBe(n > 0 ? String(n) : "mine");
    }
  });
});

describe("save path keeps 2 decimals", () => {
  it("Products: 2.90 saves as 2.9 and shows 2.90; stock stays a whole number", () => {
    const form = { name: "Tudung", sku: "", price: "2.90", stock: "3.7", platform: "TikTok", liveCode: "" };
    const [p] = upsertProduct([], form, null, 1);
    expect(p.price).toBe(2.9);
    expect(fmtMoney(p.price)).toBe("2.90");
    expect(p.stock).toBe(3);
  });
  it("live order: item/sticker code is '2.90' (and '350' stays '350'); total keeps the cents", () => {
    const r = buildOrderFromComment(comment, [], 2.9, NOW);
    expect(r.order.item).toBe("2.90");
    expect(r.order.price).toBe(2.9);
    expect(r.order.total).toBe(2.9);
    expect(buildOrderFromComment(comment, [], 350, NOW).order.item).toBe("350");
    expect(buildOrderFromComment(comment, [], 2.9, NOW, 3).order.total).toBeCloseTo(8.7);
    // reload from the DB keeps the stored product string + numeric price untouched
    const re = rebuildSessionFromRows([{ buyer_number: 1, handle: "aisyah", customer_name: "Aisyah", platform: "TikTok", product: "2.90", price: "2.90", created_at: NOW.toISOString() }]);
    expect(re.orders[0].price).toBe(2.9);
    expect(re.orders[0].item).toBe("2.90");
  });
  it("receipt: lines and total show 2.90 / 5.80; NT$ whole amounts unchanged", () => {
    expect(formatAmount("RM", 2.9)).toBe("RM2.90");
    expect(formatAmount("NT$", 350)).toBe("NT$350");
    expect(receiptTotalText([{ item: "a", total: 2.9 }, { item: "b", total: 2.9 }], "RM", "tbc")).toEqual({ text: "RM5.80", allPriced: true });
    expect(receiptTotalText([{ item: "a", total: 350 }, { item: "b", total: 280 }], "NT$", "tbc")).toEqual({ text: "NT$630", allPriced: true });
  });
  it("sticker payload carries the order item '2.90' (the big code line) and the numeric price", () => {
    const r = buildOrderFromComment(comment, [], 2.9, NOW);
    const buyer: Buyer = r.singleOrderBuyer;
    const p = buildNativeStickerPayload(buyer, "RM", "Kedai", DEF_SETTINGS);
    expect(p.buyer.orders[0].item).toBe("2.90");
    expect(p.buyer.orders[0].price).toBe(2.9);
    expect(JSON.stringify(p)).not.toContain("parseInt");
  });
});

describe("every money input accepts decimals (source pins)", () => {
  it("step=0.01 + inputMode=decimal on the number inputs; priceInput on the text inputs", () => {
    const products = src("src/redesign/screens/Products.tsx");
    expect(products).toMatch(/data-testid="prd-price"[^\n]*/);
    expect(products).toMatch(/type="text" inputMode=\{hasCents\(cur\) \? "decimal" : "numeric"\} value=\{form\.price\} onChange=\{\(e\) => setForm\(\(f\) => \(\{ \.\.\.f, price: priceInput\(e\.target\.value, hasCents\(cur\)\) \}\)\)\} required/);
    expect(products).toMatch(/type="number" min="0" inputMode="numeric" value=\{form\.stock\}/); // stock: whole only (no step)
    const post = src("src/redesign/screens/PostSales.tsx");
    expect(post).toMatch(/type="text" inputMode=\{hasCents\(cur\) \? "decimal" : "numeric"\} value=\{r\.priceText \?\? \(r\.price \|\| ""\)\}/);
    expect(post).toMatch(/type="text" inputMode=\{hasCents\(cur\) \? "decimal" : "numeric"\} value=\{draft\.priceText\}/);
    expect(post.match(/priceInput\(e\.target\.value, hasCents\(cur\)\)/g)?.length).toBe(2);
    expect(post).toMatch(/inputMode="numeric" min=\{0\} placeholder="∞" value=\{r\.stock/); // stock whole
    expect(src("src/redesign/screens/Dashboard.tsx")).toMatch(/value=\{entPrice\} onChange=\{\(e\) => onEntPrice\(e\.target\.value\)\} onKeyDown=\{onEntKey\} inputMode=\{hasCents\(cur\) \? "decimal" : "numeric"\}/);
    const app = src("src/redesign/RedesignApp.tsx");
    expect(app).toContain("onEntPrice={(v) => setEntPrice(priceInput(v, hasCents(cur)))}");
    expect(app).toContain("[id]: cur + moneyText(price)");          // printed badge
    expect(app).toContain("[key]: cur + moneyText(autoPrice)");
    expect(app).toContain("`${cur}${moneyText(Number(c.spent) || 0)}`"); // customers CSV
    expect(src("src/redesign/components/TikTokSendSheet.tsx")).toContain("value={totalOverride ?? moneyText(sum)}");
    expect(src("src/redesign/screens/SalesTab.tsx")).toContain("moneyText(Number(b.label))");
    const gs = src("src/redesign/screens/GeneralSettings.tsx");
    expect(gs).toMatch(/ref=\{spInputRef\} inputMode="decimal"/);
    expect(gs).toContain("setSpDraft(priceInput(e.target.value, hasCents(cur)))");
    expect(src("src/redesign/screens/FmCustomerDetails.tsx")).toMatch(/setPrice\(priceInput\(e\.target\.value, hasCents\(cur\)\)\); setImportErr\(""\); \}\} inputMode=\{hasCents\(cur\) \? "decimal" : "numeric"\}/);
    expect(src("src/redesign/screens/CustomerDetails.tsx")).toMatch(/setPrice\(priceInput\(e\.target\.value, hasCents\(cur\)\)\); setImportErr\(""\); \}\}\s+inputMode=\{hasCents\(cur\) \? "decimal" : "numeric"\}/);
    expect(src("src/redesign/components/ReceiptSheet.tsx")).toContain("setLine(l.id, { price: priceInput(e.target.value, hasCents(cur)) })");
    expect(src("src/redesign/components/TikTokSendSheet.tsx")).toMatch(/inputMode=\{hasCents\(cur\) \? "decimal" : "numeric"\} value=\{l\.price\} onChange=\{\(e\) => setPrice\(l\.key, priceInput\(e\.target\.value, hasCents\(cur\)\)\)\}/);
    expect(src("src/redesign/components/ReceiptSheet.tsx")).toMatch(/inputMode=\{hasCents\(cur\) \? "decimal" : "numeric"\} value=\{l\.price\}/);
    const legacy = src("src/App.tsx");
    expect(legacy).toContain('<input type="text" value={form.price} onChange={e=>setForm(f=>({...f,price:priceInput(e.target.value,hasCents(cur))}))} inputMode={hasCents(cur)?"decimal":"numeric"} required/>');
    expect(legacy.match(/\$\{cur\}\$\{moneyText\((o\.total|b\.totalSpent)\)\}/g)?.length).toBe(3); // the 3 CSV exports
  });
  it("no integer rounding on the price save path", () => {
    expect(src("src/redesign/adapters/products.ts")).toMatch(/const price = parseFloat\(form\.price\) \|\| 0;/);
    expect(src("src/lib/orderLogic.ts")).toContain("price > 0 ? moneyText(price)");
    for (const f of ["src/redesign/adapters/useOrders.ts", "src/db.ts", "src/lib/orderLogic.ts", "src/redesign/adapters/products.ts"]) {
      expect(src(f)).not.toMatch(/Math\.(round|floor|trunc)\((order\.)?(price|total)\b/);
      expect(src(f)).not.toMatch(/parseInt\(form\.price/);
    }
  });
});
