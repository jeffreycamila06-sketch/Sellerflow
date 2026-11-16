// Order tracking — item 8: "…and upload your receipt" in the order-link note only for pay-first orders.
import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { TProvider, buildT } from "../../redesign/i18n";
import { CheckoutFlow } from "../checkoutPages";
import type { ShopPage } from "../route";
import type { Shop } from "../shopApi";
import { viewOf } from "./orderPageCases";
import type { OrderView } from "../orderApi";
import { DEMO_SHOP } from "./fixtures";

afterEach(() => cleanup());
const EN: Shop = { ...DEMO_SHOP, shop: { ...DEMO_SHOP.shop, lang: "en" } };
async function hint(v: Partial<OrderView>, lang = "en") {
  const api = { place: vi.fn(), load: vi.fn(async () => viewOf(v)), uploadReceipt: vi.fn() };
  function H() { const [r, go] = useState<ShopPage>({ page: "order", token: "f".repeat(64) }); return <TProvider lang={lang}><CheckoutFlow shop={EN} cur="NT$" route={r} go={go} infos={[]} preview={false} onPlaced={() => {}} api={api} linkFor={() => "https://shop.example/o/1"} /></TProvider>; }
  render(<H />);
  const link = await screen.findByTestId("od-link");
  return link.parentElement!.previousElementSibling!.textContent;
}

describe("the order-link note", () => {
  it("pay first (bank / QR): with 'upload your receipt'", async () => {
    expect(await hint({ payment: "bank", paidAt: "2026-11-16T15:00:00Z" })).toBe("Keep this link to check your order and upload your receipt.");
    cleanup();
    expect(await hint({ status: "awaiting_payment", payment: "qr", tracking: undefined })).toBe("Keep this link to check your order and upload your receipt.");
  });
  it("pay on delivery: without", async () => {
    expect(await hint({})).toBe("Keep this link to check your order.");
    cleanup();
    expect(await hint({ status: "confirmed", tracking: undefined })).toBe("Keep this link to check your order.");
  });
  it("all 8 languages have the shorter note (and it differs from the pay-first one)", async () => {
    for (const l of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"]) {
      const t = buildT(l) as unknown as Record<string, string>;
      expect(t.rd_ot_link_hint_cod, l).toBeTruthy();
      expect(t.rd_ot_link_hint_cod, l).not.toBe(t.rd_shop_od_link_hint);
    }
    expect(await hint({}, "zh-TW")).toBe("請保留此連結，用來查看訂單。");
  });
});
