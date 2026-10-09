// Facebook authorization from the phone app — client half. Pins: with the native SellerFlowAuth
// plugin, Authorize opens the in-app sheet (app-mode link) and the result drives a toast + page
// reload; without the plugin (old app builds, normal browsers) the flow is exactly today's
// <a target="_blank"> with the unchanged start request.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { from: vi.fn(), rpc: vi.fn(), auth: { getSession: async () => ({ data: { session: { user: { id: "u1" }, access_token: "jwt" } } }) } } }));
const m = vi.hoisted(() => ({ startAuth: vi.fn(), removePage: vi.fn(), disconnect: vi.fn() }));
vi.mock("../../adapters/fb", async (orig) => {
  const real = await orig<typeof import("../../adapters/fb")>();
  return { ...real, startFbAuth: m.startAuth, removeFbPage: m.removePage, fbDisconnect: m.disconnect, __real: real };
});

import { TProvider, buildT } from "../../i18n";
import FbChannels from "../FbChannels";
import * as fbMod from "../../adapters/fb";

const real = (fbMod as unknown as { __real: typeof fbMod }).__real;
const t = buildT("en");
type W = { Capacitor?: unknown };
const account = { email: "a@b.c", plan: "pro", planStatus: "active", role: "admin" } as never;
const flush = async () => { await act(async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 5)); }); };
const URL_APP = "https://www.facebook.com/v25.0/dialog/oauth?state=APPSTATE";
function plugin(result: unknown) {
  const openAuthSession = vi.fn(async () => result);
  (window as W).Capacitor = { Plugins: { SellerFlowAuth: { openAuthSession } } };
  return openAuthSession;
}
const screen = (props: Record<string, unknown> = {}) => render(
  <TProvider lang="en"><FbChannels account={account} pages={[]} onReload={vi.fn()} onBack={vi.fn()} onUpsell={vi.fn()} {...props} /></TProvider>,
);
const inApp = () => document.querySelector("[data-testid='fb-authorize-inapp']") as HTMLButtonElement | null;
const anchor = () => document.querySelector("a[href^='https://www.facebook.com']") as HTMLAnchorElement | null;

beforeEach(() => {
  vi.clearAllMocks();
  m.startAuth.mockResolvedValue({ ok: true, url: URL_APP });
});
afterEach(() => { delete (window as W).Capacitor; vi.unstubAllGlobals(); });

describe("startFbAuth", () => {
  const mk = (url: string) => ({ ok: true, status: 200, json: async () => ({ url }) });
  it("app: adds ?client=app; default: the request is unchanged", async () => {
    const f = vi.fn().mockResolvedValue(mk("https://www.facebook.com/x"));
    vi.stubGlobal("fetch", f);
    await real.startFbAuth({ app: true });
    await real.startFbAuth();
    // Build 11 (H4): + the new-app marker
    expect(String(f.mock.calls[0][0])).toMatch(/\/fb\/oauth\/start\?client=app&sfl_codes=1$/);
    expect(String(f.mock.calls[1][0])).toMatch(/\/fb\/oauth\/start\?sfl_codes=1$/);
  });
});

describe("nativeAuthSession", () => {
  it("null without the plugin (old builds, browsers); a function with it", () => {
    expect(real.nativeAuthSession()).toBeNull();
    (window as W).Capacitor = { Plugins: { SellerFlowPrinter: {} } };
    expect(real.nativeAuthSession()).toBeNull();
    plugin({ status: "connected" });
    expect(typeof real.nativeAuthSession()).toBe("function");
  });
});

describe("FbChannels with the in-app sheet", () => {
  it("asks for an app-mode link and shows an Authorize button (no new-tab link)", async () => {
    plugin({ status: "connected" });
    screen(); await flush();
    expect(m.startAuth).toHaveBeenCalledWith({ app: true });
    expect(inApp()).not.toBeNull();
    expect(anchor()).toBeNull();
  });
  it("connected → opens the sheet with the link, toasts 'authorized', reloads the pages, fetches a fresh link", async () => {
    const open = plugin({ status: "connected" });
    const onReload = vi.fn(); const onToast = vi.fn();
    screen({ onReload, onToast }); await flush();
    await act(async () => { fireEvent.click(inApp()!); });
    await flush();
    expect(open).toHaveBeenCalledWith({ url: URL_APP });
    expect(onToast).toHaveBeenCalledWith(t.rd_fb_authorized_toast, "ok");
    expect(onReload).toHaveBeenCalled();
    expect(m.startAuth).toHaveBeenCalledTimes(2);
  });
  it("cancelled → the list is reloaded (the Page may already be saved) and no toast is shown", async () => {
    plugin({ status: "cancelled" });
    const onReload = vi.fn(); const onToast = vi.fn();
    screen({ onReload, onToast }); await flush();
    await act(async () => { fireEvent.click(inApp()!); });
    await flush();
    expect(onToast).not.toHaveBeenCalled();
    expect(onReload).toHaveBeenCalledTimes(1);
  });
  it("every result reloads the list once; only connected / error toast", async () => {
    for (const [result, toasts] of [[{ status: "busy" }, 0], [{ status: "error", code: "no_pages" }, 1], [{ status: "connected" }, 1]] as const) {
      plugin(result);
      const onReload = vi.fn(); const onToast = vi.fn();
      const r = screen({ onReload, onToast }); await flush();
      await act(async () => { fireEvent.click(inApp()!); });
      await flush();
      expect(onReload, result.status).toHaveBeenCalledTimes(1);
      expect(onToast, result.status).toHaveBeenCalledTimes(toasts);
      r.unmount();
    }
  });
  it("error → the same texts as the web return (cap → cap text; other → generic)", async () => {
    plugin({ status: "error", code: "cap" });
    const onToast = vi.fn();
    screen({ onToast }); await flush();
    await act(async () => { fireEvent.click(inApp()!); });
    await flush();
    expect(onToast).toHaveBeenCalledWith(real.fbReturnText({ status: "error", code: "cap" }, t, 3), "err");
  });
  it("one sheet at a time: a second tap while open is ignored", async () => {
    let finish!: (v: unknown) => void;
    const open = vi.fn(() => new Promise((r) => { finish = r; }));
    (window as W).Capacitor = { Plugins: { SellerFlowAuth: { openAuthSession: open } } };
    screen(); await flush();
    await act(async () => { fireEvent.click(inApp()!); });
    expect(inApp()!.disabled).toBe(true);
    await act(async () => { fireEvent.click(inApp()!); });
    expect(open).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ status: "cancelled" }); });
    await flush();
    expect(inApp()!.disabled).toBe(false);
  });
  it("the plugin throwing → generic error toast, never a crash", async () => {
    (window as W).Capacitor = { Plugins: { SellerFlowAuth: { openAuthSession: vi.fn(async () => { throw new Error("x"); }) } } };
    const onToast = vi.fn();
    screen({ onToast }); await flush();
    await act(async () => { fireEvent.click(inApp()!); });
    await flush();
    expect(onToast).toHaveBeenCalledWith(t.rd_fb_auth_error_toast, "err");
  });
});

describe("old app builds and normal browsers: exactly today's flow", () => {
  it("no plugin → the unchanged start request and a real <a target=_blank> link", async () => {
    screen(); await flush();
    expect(m.startAuth).toHaveBeenCalledWith({});
    const a = anchor()!;
    expect(a).not.toBeNull();
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("href")).toBe(URL_APP);
    expect(inApp()).toBeNull();
  });
});
