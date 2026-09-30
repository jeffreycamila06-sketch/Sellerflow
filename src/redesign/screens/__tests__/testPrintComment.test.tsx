// Test-print comment: LIVE layout v2 users (admin + allowlist) print "COMMENT / PRICE" on
// their test sticker (Printer settings + LIVE print pattern) and see it in the preview;
// every other seller keeps buildTestBuyer's "PRICE" (old layout cuts at 12 chars).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";
import { buildTestBuyer } from "../../adapters/printerBridge";
import { PREVIEW_COMMENT } from "../../adapters/stickerPreview";
import { DEF_SETTINGS } from "../../adapters/printing";

const routed = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({ ok: true, code: "", message: "" })));
vi.mock("../../adapters/printing", async (orig) => ({ ...(await orig() as object), printStickerBtRouted: routed }));
import PrinterSettings from "../PrinterSettings";

type W = { SellerFlowPrinter?: unknown };
beforeEach(() => {
  routed.mockClear();
  (window as W).SellerFlowPrinter = {
    scanBluetoothLabelPrinters: vi.fn(async () => ({ ok: true, printers: [] })),
    getBluetoothLabelPrinter: vi.fn(async () => ({ ok: true, savedPrinter: { name: "D520BT-Z", address: "AA" } })),
  };
});
afterEach(() => { delete (window as W).SellerFlowPrinter; });

const printerBt = (testComment?: string) => render(
  <TProvider lang="en"><PrinterSettings onBack={() => {}} psType="bt" psOut="sticker" onSetPsOut={() => {}} psSize="80x50mm" psSizeOpen={false} onTogglePsSize={() => {}} onPickPsSize={() => {}} settings={DEF_SETTINGS} testComment={testComment} /></TProvider>);
const sentItem = () => ((routed.mock.calls[0][0] as { orders: { item: string }[] }).orders[0].item);

describe("test print comment", () => {
  it("the placeholder is COMMENT / PRICE; buildTestBuyer itself is unchanged (PRICE)", () => {
    expect(PREVIEW_COMMENT).toBe("COMMENT / PRICE");
    expect(buildTestBuyer().orders[0].item).toBe("PRICE");
  });
  it("non-v2 seller: the Printer settings test sticker still prints PRICE", async () => {
    const v = printerBt();
    fireEvent.click(await v.findByText("Test Print"));
    await waitFor(() => expect(routed).toHaveBeenCalledTimes(1));
    expect(sentItem()).toBe("PRICE");
  });
  it("v2 user: the Printer settings test sticker prints COMMENT / PRICE (everything else the test buyer)", async () => {
    const v = printerBt(PREVIEW_COMMENT);
    fireEvent.click(await v.findByText("Test Print"));
    await waitFor(() => expect(routed).toHaveBeenCalledTimes(1));
    expect(sentItem()).toBe("COMMENT / PRICE");
    const b = routed.mock.calls[0][0] as { num: number; name: string };
    expect([b.num, b.name]).toEqual([buildTestBuyer().num, buildTestBuyer().name]);
  });
  it("RedesignApp: v2 users' LIVE print pattern test and Printer settings test use COMMENT / PRICE; others the default buyer", () => {
    const app = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(app).toContain("onTestPrint={() => void onTestPrint(stickerV2On ? testBuyerWithComment(PREVIEW_COMMENT) : undefined)}");
    expect(app).toContain("const onTestPrint = async (testBuyer: Buyer = buildTestBuyer()) => {");
    expect(app).toContain("testComment={stickerV2On ? PREVIEW_COMMENT : undefined}");
    expect(app).toContain("onTestPrintSample={stickerV2On && isAdmin ? (item) =>"); // long-comment buttons still admin-only
  });
});
