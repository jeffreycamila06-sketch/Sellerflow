// Audit Oct 14 (1): every way out of a signed-in session is a FULL reload, so nothing in memory
// (feed, session buyers/orders, report caches, Buyer Alert, products) reaches the next account.
// A reload is the reset: after it the app starts from nothing, whoever signs in next.
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, act, screen, fireEvent } from "@testing-library/react";
import { buildT } from "../i18n";

beforeAll(() => { (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}; });
const H = vi.hoisted(() => ({
  status: "authed" as "authed" | "anon" | "loading",
  order: [] as string[],
  signOut: null as null | (() => Promise<void>),
  del: null as null | (() => Promise<{ ok: boolean }>),
}));
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };

vi.mock("../adapters/useAuthSession", async (orig) => ({
  ...(await orig() as object),
  useAuthSession: () => ({
    status: H.status,
    profile: H.status === "authed" ? {
      authUserId: "user-A", email: "a@x.com", plan: "pro", planStatus: "active", planExpiry: "", role: "seller", connectedAccounts: [],
      profile: { fullName: "A", storeName: "Shop A", phone: "", tiktok: "shopa", facebook: "", adminContactNote: "", country: "TW" },
    } : null,
    reloadProfile: vi.fn(async () => {}),
    signOut: () => H.signOut!(),
    deleteAccount: () => H.del!(),
  }),
}));
vi.mock("../adapters/useLiveFeed", async (orig) => ({
  ...(await orig() as object),
  useLiveFeed: () => ({
    comments: [], connected: false, canInject: false, injectSynthetic: () => {}, getComment: () => undefined,
    activeAccounts: { TikTok: "", Facebook: "" }, ttConnected: false, fbConnected: false, shopeeConnected: false, igConnected: false,
    connect: vi.fn(async () => ({ ok: true, account: "shopa" })),
  }),
}));
vi.mock("../adapters/useLiveSession", async (orig) => ({
  ...(await orig() as object),
  useLiveSession: () => ({
    session: { buyers: [], orders: [] }, state: "empty", loadError: false, dayId: "2026-10-14",
    getBuyers: () => [], applyOrder: () => {}, reset: () => {}, orderedMsgIds: new Map(), orderedLoaded: true, addOrderedMsgId: () => {}, canOrder: () => true,
  }),
}));
vi.mock("../adapters/outbox", async (orig) => {
  const o = await orig() as { useOutbox: (...a: unknown[]) => Record<string, unknown> };
  return { ...o, useOutbox: (...a: unknown[]) => ({ ...o.useOutbox(...a), dropOwner: (id: string) => H.order.push(`dropOwner:${id}`) }) };
});
vi.mock("../adapters/products", async (orig) => ({ ...(await orig() as object), clearProductsCacheFor: (id: string) => H.order.push(`clearProducts:${id}`) }));
vi.mock("../analytics", async (orig) => ({ ...(await orig() as object), resetAnalytics: () => H.order.push("resetAnalytics") }));

import RedesignApp from "../RedesignApp";
import { appReload } from "../adapters/logoutReset";

const t = buildT("en");
const nav = (label: string) => { fireEvent.click(screen.getAllByText(label).find((el) => el.closest("button"))!.closest("button")!); };
let reload: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  localStorage.clear(); H.status = "authed"; H.order = [];
  H.signOut = async () => { H.order.push("signOut"); };
  H.del = async () => { H.order.push("deleteAccount"); return { ok: true }; };
  reload?.mockRestore();
  reload = vi.spyOn(appReload, "run").mockImplementation(() => { H.order.push("reload"); });
});

describe("Logout", () => {
  it("runs the existing cleanups in the same order, awaits signOut, then reloads once", async () => {
    render(<RedesignApp />);
    await flush();
    nav(t.rd_nav_settings);
    fireEvent.click(screen.getByText(t.rd_sh_logout).closest("button")!);
    await flush();
    expect(H.order).toEqual(["dropOwner:user-A", "clearProducts:user-A", "resetAnalytics", "signOut", "reload"]);
  });
  it("a failing signOut still reloads", async () => {
    H.signOut = async () => { H.order.push("signOut"); throw new Error("offline"); };
    render(<RedesignApp />);
    await flush();
    nav(t.rd_nav_settings);
    fireEvent.click(screen.getByText(t.rd_sh_logout).closest("button")!);
    await flush();
    expect(H.order.slice(-2)).toEqual(["signOut", "reload"]);
  });
  it("the signed-out change after Logout does not reload a second time", async () => {
    const r = render(<RedesignApp />);
    await flush();
    nav(t.rd_nav_settings);
    fireEvent.click(screen.getByText(t.rd_sh_logout).closest("button")!);
    await flush();
    H.status = "anon"; r.rerender(<RedesignApp />); await flush();
    expect(H.order.filter((x) => x === "reload")).toHaveLength(1);
  });
});

describe("other ways out", () => {
  it("session expired / logout in another tab (authed → anon) → analytics reset + one full reload", async () => {
    const r = render(<RedesignApp />);
    await flush();
    expect(reload).not.toHaveBeenCalled();
    H.status = "anon"; r.rerender(<RedesignApp />); await flush();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(H.order).toEqual(["resetAnalytics", "reload"]); // Audit Oct 22 (4)
  });
  it("opening the app signed out never reloads (no loop)", async () => {
    H.status = "anon";
    const r = render(<RedesignApp />);
    await flush();
    r.rerender(<RedesignApp />); await flush();
    expect(reload).not.toHaveBeenCalled();
  });
  it("account deleted → the same cleanups, then one reload; a failed delete → no reload", async () => {
    render(<RedesignApp />);
    await flush();
    nav(t.rd_nav_settings);
    fireEvent.click(screen.getByText(t.rd_sh_delete).closest("button")!);
    await flush();
    fireEvent.change(document.querySelector("input")!, { target: { value: "a@x.com" } });
    H.del = async () => { H.order.push("deleteAccount"); return { ok: false }; };
    fireEvent.click(screen.getByText(t.rd_del_confirm_btn).closest("button")!);
    await flush();
    expect(H.order).toEqual(["deleteAccount"]);
    H.del = async () => { H.order.push("deleteAccount"); return { ok: true }; };
    fireEvent.click(screen.getByText(t.rd_del_confirm_btn).closest("button")!);
    await flush();
    expect(H.order).toEqual(["deleteAccount", "deleteAccount", "dropOwner:user-A", "clearProducts:user-A", "resetAnalytics", "reload"]);
  });
});
