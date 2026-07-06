// F-batch #1 — the LAST hardcoded UI strings are now keyed ×7 langs:
// (a) bottom-nav labels, (b) the client "can't reach the live server" connect
// error, (c) the native-printer failure alert fallback, (d) the Orders "New"
// status chip. Each proof renders/executes the real wiring in zh-TW and asserts
// the localized string appears (and the English literal does not).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { TProvider, buildT } from "../../i18n";
import Orders from "../Orders";
import ConnectModal from "../ConnectModal";
import type { AccountUser } from "../../../accountDb";
import { printSlip, setNativePrintAlertText, DEF_SETTINGS } from "../../adapters/printing";
import type { Buyer } from "../../../lib/orderTypes";

afterEach(() => { vi.restoreAllMocks(); delete (window as unknown as Record<string, unknown>).SellerFlowPrinter; });

describe("(a) nav labels — keyed, no hardcoded literals left (source contract)", () => {
  const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
  it("RedesignApp renders tApp.rd_nav_* for Live/Orders/Products/Settings/Admin", () => {
    for (const k of ["rd_nav_live", "rd_nav_orders", "rd_nav_products", "rd_nav_settings", "rd_nav_admin"]) {
      expect(src).toContain(`{tApp.${k}}`);
    }
    // the old literal label spans are gone ("Miners" stays literal on purpose — brand name)
    for (const lit of [">Live<", ">Orders<", ">Products<", ">Settings<", ">Admin<"]) {
      expect(src.includes(lit)).toBe(false);
    }
  });
  it("all five keys are filled in all 7 languages", () => {
    for (const lang of ["en", "fil", "zh", "zh-TW", "vi", "th", "id"]) {
      const t = buildT(lang) as unknown as Record<string, string>;
      for (const k of ["rd_nav_live", "rd_nav_orders", "rd_nav_products", "rd_nav_settings", "rd_nav_admin"]) {
        expect(t[k], `${k} in ${lang}`).toBeTruthy();
      }
    }
  });
});

describe("(d) Orders status chip — display translates, canonical value stays", () => {
  const order = { id: "#1", buyer: "Ann", handle: "@ann", items: "x", qty: 1, total: 100, status: "New", platform: "TikTok", time: "9:41" };
  it("zh-TW: chip shows 新訂單, not the English literal", () => {
    render(<TProvider lang="zh-TW"><Orders onGoPrint={() => {}} cur="NT$" state="live" orders={[order]} /></TProvider>);
    expect(screen.getByText("新訂單")).toBeTruthy();
    expect(screen.queryByText("New")).toBeNull();
  });
  it("en: byte-identical to before (chip still says New)", () => {
    render(<TProvider lang="en"><Orders onGoPrint={() => {}} cur="NT$" state="live" orders={[order]} /></TProvider>);
    expect(screen.getByText("New")).toBeTruthy();
  });
});

describe("(b) connect 'can't reach' — localized instead of the hardcoded English", () => {
  const profile: AccountUser = {
    authUserId: "u1", email: "s@x.com",
    profile: { fullName: "S", storeName: "S", phone: "", tiktok: "", facebook: "", adminContactNote: "" },
    plan: "pro", planStatus: "active", planExpiry: "", connectedAccounts: [], role: "seller",
  };
  it("ConnectModal (zh-TW): unreachable result shows the localized copy", async () => {
    const onConnect = vi.fn().mockResolvedValue({ ok: false, error: "Can't reach the live server. Check your connection.", account: "", unreachable: true });
    render(<TProvider lang="zh-TW"><ConnectModal profile={profile} onClose={() => {}} onConnect={onConnect} /></TProvider>);
    fireEvent.change(document.querySelector("input") as HTMLInputElement, { target: { value: "seclothingtw" } });
    // the primary connect button carries the TikTok connect label
    fireEvent.click(Array.from(document.querySelectorAll("button")).find((b) => /連接|connect/i.test(b.textContent || ""))!);
    await waitFor(() => expect(screen.getByText("無法連接直播伺服器。請檢查網路連線。")).toBeTruthy());
    expect(screen.queryByText(/Can't reach the live server/)).toBeNull();
  });
  it("a real server reason still passes through verbatim (unchanged behavior)", async () => {
    const onConnect = vi.fn().mockResolvedValue({ ok: false, error: "rate limited", account: "" });
    render(<TProvider lang="zh-TW"><ConnectModal profile={profile} onClose={() => {}} onConnect={onConnect} /></TProvider>);
    fireEvent.change(document.querySelector("input") as HTMLInputElement, { target: { value: "seclothingtw" } });
    fireEvent.click(Array.from(document.querySelectorAll("button")).find((b) => /連接|connect/i.test(b.textContent || ""))!);
    await waitFor(() => expect(screen.getByText("rate limited")).toBeTruthy());
  });
});

describe("(c) native-printer failure alert — localized fallback", () => {
  const buyer = { handle: "ann", name: "Ann", platform: "TikTok", num: 1, orders: [], totalOrders: 0, totalSpent: 0 } as unknown as Buyer;
  it("bridge failure with NO message alerts the localized text set by the app", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    (window as unknown as Record<string, unknown>).SellerFlowPrinter = { printSlip: () => ({ ok: false, message: "" }) };
    setNativePrintAlertText("本機列印失敗。"); // what the RedesignApp effect does per language
    printSlip(buyer, "NT$", "Shop", { ...DEF_SETTINGS, printerType: "lan", lanFormat: "receipt" });
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith("本機列印失敗。"));
    setNativePrintAlertText("Native printer failed."); // restore the default for other tests
  });
  it("a native-provided message still passes through untouched", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    (window as unknown as Record<string, unknown>).SellerFlowPrinter = { printSlip: () => ({ ok: false, message: "Paper jam" }) };
    printSlip(buyer, "NT$", "Shop", { ...DEF_SETTINGS, printerType: "lan", lanFormat: "receipt" });
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith("Paper jam"));
  });
});
