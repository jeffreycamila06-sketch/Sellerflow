// sql/208 — the app side of "free orders per live account": the refusal's one line on every platform's return
// (Android / web and the iPhone app), the device note, the Admin list + Reset, and the Admin panel.
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { buildT, TProvider } from "../../i18n";

const H = vi.hoisted(() => ({ rpc: { fn: null as Mock<(...a: unknown[]) => unknown> | null } }));
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabaseConfigHint: "", supabase: { rpc: (...a: unknown[]) => H.rpc.fn!(...a) } }));

import { isFreeAccountUsedError, freeAccountUsedText, noteMyDevice, loadFreeSharing, resetFreeAccount } from "../freeAccountCap";
import { fbReturnText } from "../fb";
import { igReturnText } from "../ig";
import { shopeeLinkFailOf, shopeeLinkErrKey } from "../shopeeLink";
import { FreeSharingPanel } from "../../components/AdminFreeSharing";

const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"] as const;
const t = buildT("en");
const ios = (on: boolean) => window.history.replaceState({}, "", on ? "/?ios=1" : "/");
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };

beforeEach(() => { ios(false); localStorage.clear(); H.rpc.fn = vi.fn(async () => ({ data: null, error: null })); });

describe("the refusal", () => {
  it("is recognised in what a refused save throws or answers — and nothing else is", () => {
    expect(isFreeAccountUsedError(new Error("free_account_used (hint)"))).toBe(true);
    expect(isFreeAccountUsedError({ message: "free_account_used" })).toBe(true);
    expect(isFreeAccountUsedError("free_account_used")).toBe(true);
    for (const e of [new Error("account_limit"), new Error("free_tier_cap_reached"), null, undefined, {}, "network"]) expect(isFreeAccountUsedError(e)).toBe(false);
  });
  it("one line in every language; the iPhone line is a different one", () => {
    for (const l of LANGS) {
      const x = buildT(l);
      expect(x.rd_free_acct_used.length).toBeGreaterThan(8);
      expect(x.rd_free_acct_used_ios.length).toBeGreaterThan(8);
      expect(x.rd_free_acct_used_ios).not.toBe(x.rd_free_acct_used);
      expect(freeAccountUsedText(x, false)).toBe(x.rd_free_acct_used);
      expect(freeAccountUsedText(x, true)).toBe(x.rd_free_acct_used_ios);
    }
    expect(t.rd_free_acct_used_ios).not.toMatch(/upgrade|plan|price|pay|subscri|renew|free order|NT\$/i);
  });
  it("Facebook, Instagram and Shopee returns show the same line (Android / web, then iPhone)", () => {
    expect(fbReturnText({ status: "error", code: "free_account_used" }, t, 1)).toBe(t.rd_free_acct_used);
    expect(fbReturnText({ status: "error", code: "free_account_used" }, t, 1, true)).toBe(t.rd_free_acct_used);
    expect(igReturnText({ status: "error", code: "free_account_used" }, t, 1)).toBe(t.rd_free_acct_used);
    expect(shopeeLinkFailOf(409, "free_account_used")).toBe("free_account_used");
    expect(shopeeLinkErrKey("free_account_used", true)).toBe("rd_free_acct_used");
    expect(shopeeLinkErrKey("free_account_used", false)).toBe("rd_free_acct_used");
    ios(true);
    expect(fbReturnText({ status: "error", code: "free_account_used" }, t, 1)).toBe(t.rd_free_acct_used_ios);
    expect(igReturnText({ status: "error", code: "free_account_used" }, t, 1)).toBe(t.rd_free_acct_used_ios);
    expect(shopeeLinkErrKey("free_account_used", true)).toBe("rd_free_acct_used_ios");
  });
  it("the other return codes read as before", () => {
    expect(fbReturnText({ status: "error", code: "account_limit" }, t, 1)).toBe(t.rd_acct_limit_generic);
    expect(igReturnText({ status: "error", code: "account_limit" }, t, 1)).toBe(t.rd_acct_limit_generic_ios);
    expect(shopeeLinkFailOf(409, "shop_limit")).toBe("shop_limit");
    expect(shopeeLinkFailOf(409, "something_else")).toBe("unreachable");
    expect(shopeeLinkErrKey("shop_limit", true)).toBe("rd_sh_err_shop_limit");
  });
});

describe("the device note", () => {
  it("sends this browser's id; a database error is swallowed", async () => {
    await noteMyDevice();
    const [name, args] = H.rpc.fn!.mock.calls[0] as [string, { p_device: string }];
    expect(name).toBe("note_my_device");
    expect(args.p_device).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(JSON.parse(localStorage.getItem("sf_browser_session") || '""')).toBe(args.p_device);
    H.rpc.fn = vi.fn(async () => { throw new Error("down"); });
    await expect(noteMyDevice()).resolves.toBeUndefined();
  });
});

const ANSWER = {
  cap: 150, enforce: false,
  accounts: [{ platform: "tiktok", account_key: "usedshop", label: "usedshop", account_orders: 190,
    logins: [{ user_id: "u1", email: "first@example.com", plan: "free", free_orders: 150 }, { user_id: "u2", email: "second@example.com", plan: "free", free_orders: 40 }] },
    { platform: "facebook", account_key: "111", label: "Page One", account_orders: 12,
      logins: [{ user_id: "u3", email: "third@example.com", plan: "basic", free_orders: 5 }, { user_id: "u4", email: "fourth@example.com", plan: "free", free_orders: 7 }] }],
  devices: [{ device: "sf-17322", logins: [{ user_id: "u1", email: "first@example.com", plan: "free", free_orders: 150 }, { user_id: "u2", email: "second@example.com", plan: "free", free_orders: 40 }] }],
  would_refuse: [{}, {}, {}],
};

describe("Admin: the list and Reset", () => {
  it("reads the list; a failed read answers null", async () => {
    H.rpc.fn = vi.fn(async () => ({ data: ANSWER, error: null }));
    const r = await loadFreeSharing();
    expect(H.rpc.fn).toHaveBeenCalledWith("admin_free_sharing");
    expect(r).toMatchObject({ cap: 150, enforce: false, wouldRefuse: 3 });
    expect(r!.accounts[0]).toMatchObject({ platform: "tiktok", key: "usedshop", orders: 190 });
    expect(r!.accounts[0].logins[1]).toEqual({ userId: "u2", email: "second@example.com", plan: "free", freeOrders: 40 });
    expect(r!.devices[0].logins.length).toBe(2);
    H.rpc.fn = vi.fn(async () => ({ data: null, error: { message: "forbidden" } }));
    expect(await loadFreeSharing()).toBeNull();
  });
  it("Reset calls the database with the platform and the account, and reports failure", async () => {
    H.rpc.fn = vi.fn(async () => ({ data: { ok: true, was: 190 }, error: null }));
    expect(await resetFreeAccount("tiktok", "usedshop")).toEqual({ ok: true, was: 190 });
    expect(H.rpc.fn).toHaveBeenCalledWith("admin_free_account_reset", { p_platform: "tiktok", p_key: "usedshop" });
    H.rpc.fn = vi.fn(async () => ({ data: { ok: false, code: "not_found" }, error: null }));
    expect(await resetFreeAccount("tiktok", "nope")).toEqual({ ok: false });
  });
  it("the panel: shared accounts with every login's count, the shared device, Reset asks first", async () => {
    const calls: unknown[][] = [];
    H.rpc.fn = vi.fn(async (...a: unknown[]) => { calls.push(a); return a[0] === "admin_free_account_reset" ? { data: { ok: true, was: 190 }, error: null } : { data: ANSWER, error: null }; });
    const toast = vi.fn();
    render(<TProvider lang="en"><FreeSharingPanel onToast={toast} /></TProvider>);
    await flush();
    expect(screen.getByTestId("fs-mode").textContent).toBe("Log only: nothing is refused. Would have been refused lately: 3");
    expect(screen.getAllByTestId("fs-account").length).toBe(2);
    expect(screen.getAllByTestId("fs-count").map((n) => n.textContent)).toEqual(["190 / 150 free orders", "12 / 150 free orders"]);
    expect(screen.getAllByTestId("fs-account")[0].textContent).toContain("@usedshop");
    expect(screen.getAllByTestId("fs-account")[0].textContent).toContain("second@example.com");
    expect(screen.getAllByTestId("fs-account")[0].textContent).toContain("40 free");
    expect(screen.getAllByTestId("fs-device").length).toBe(1);
    fireEvent.click(screen.getAllByTestId("fs-reset")[0]);
    expect(calls.some((c) => c[0] === "admin_free_account_reset")).toBe(false);          // nothing yet: it asks first
    expect(screen.getByTestId("fs-confirm").textContent).toContain("It has 190 now");
    await act(async () => { fireEvent.click(screen.getByTestId("fs-confirm-yes")); });
    await flush();
    expect(calls.filter((c) => c[0] === "admin_free_account_reset")).toEqual([["admin_free_account_reset", { p_platform: "tiktok", p_key: "usedshop" }]]);
    expect(toast).toHaveBeenCalledWith("Reset. It had 190.", "ok");
    expect(calls.filter((c) => c[0] === "admin_free_sharing").length).toBe(2);            // the list is read again
  });
  it("the panel says so when the list can't be read", async () => {
    H.rpc.fn = vi.fn(async () => ({ data: null, error: { message: "x" } }));
    render(<TProvider lang="en"><FreeSharingPanel /></TProvider>);
    await flush();
    expect(screen.getByTestId("fs-error").textContent).toBe("Couldn't load the list.");
  });
});
