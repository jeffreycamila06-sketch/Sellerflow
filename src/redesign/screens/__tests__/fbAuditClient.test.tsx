// Facebook audit fixes, Part C (client). C1 fbConnect success needs 2xx AND ok:true; 429 →
// too_many_requests · C2 connect toasts never show a raw code · C3 FbChannels refresh on
// return + every 8 min, Authorize enabled at the cap, cap return text, Remove stops the
// poller first · C4 ReceiptSheet waits for the saved format, handles busy / try_later /
// mixed_buyer, and never says "nothing is sent yet" next to Send.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { from: vi.fn(), rpc: vi.fn(), auth: { getSession: async () => ({ data: { session: { user: { id: "u1" }, access_token: "jwt" } } }) } } }));
const m = vi.hoisted(() => ({ info: vi.fn(), send: vi.fn(), render: vi.fn(), load: vi.fn(), startAuth: vi.fn(), removePage: vi.fn(), disconnect: vi.fn() }));
vi.mock("../../adapters/receiptSettings", async (orig) => ({
  ...(await orig<typeof import("../../adapters/receiptSettings")>()),
  loadReceiptSettings: m.load,
}));
vi.mock("../../adapters/fbReceipt", async (orig) => ({
  ...(await orig<typeof import("../../adapters/fbReceipt")>()),
  fbReceiptInfo: m.info,
  fbReceiptSend: m.send,
}));
vi.mock("../../adapters/receiptImage", async (orig) => ({
  ...(await orig<typeof import("../../adapters/receiptImage")>()),
  renderReceiptPng: m.render,
}));
vi.mock("../../adapters/fb", async (orig) => {
  const real = await orig<typeof import("../../adapters/fb")>();
  return { ...real, startFbAuth: m.startAuth, removeFbPage: m.removePage, fbDisconnect: m.disconnect, __real: real };
});

import { TProvider, buildT } from "../../i18n";
import ReceiptSheet from "../../components/ReceiptSheet";
import FbChannels, { FB_AUTH_REFRESH_MS } from "../FbChannels";
import * as fbMod from "../../adapters/fb";
import type { BuyerReceipt } from "../../adapters/useReadData";

const real = (fbMod as unknown as { __real: typeof fbMod }).__real;
const t = buildT("en");
const mkRes = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const q = (id: string) => document.querySelector(`[data-testid='${id}']`) as HTMLElement | null;
const flush = async () => { await act(async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 5)); }); };

beforeEach(() => {
  vi.clearAllMocks();
  m.load.mockResolvedValue({ ok: true, settings: { opening: "Thanks!", note: "Pay in 3 days", qrImage: null } });
  m.render.mockImplementation(async () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1])], { type: "image/png" }));
  m.startAuth.mockResolvedValue({ ok: true, url: "https://www.facebook.com/dialog?state=1" });
  m.removePage.mockResolvedValue({ ok: true });
  m.disconnect.mockResolvedValue({ ok: true });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

// ── C1 ───────────────────────────────────────────────────────────────────────
describe("C1 fbConnect", () => {
  it("success only with a 2xx status AND ok === true", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mkRes(200, { ok: true, live_video_id: "LV1" })));
    expect(await real.fbConnect("P1")).toEqual({ ok: true, liveVideoId: "LV1" });
    for (const [status, body] of [[200, {}], [200, { ok: "yes" }], [202, { live_video_id: "LV1" }], [304, { ok: true }], [409, { ok: true }]] as const) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mkRes(status, body)));
      expect((await real.fbConnect("P1")).ok).toBe(false);
    }
  });
  it("HTTP 429 → too_many_requests", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mkRes(429, { error: "Too many connect attempts" })));
    expect(await real.fbConnect("P1")).toEqual({ ok: false, error: "too_many_requests" });
  });
  it("409 needs_reauth / 502 fb_check_failed / not_live come through", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mkRes(409, { ok: false, error: "needs_reauth" })));
    expect(await real.fbConnect("P1")).toEqual({ ok: false, reason: undefined, error: "needs_reauth" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mkRes(502, { ok: false, error: "fb_check_failed" })));
    expect(await real.fbConnect("P1")).toEqual({ ok: false, error: "fb_check_failed" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mkRes(200, { ok: false, reason: "not_live" })));
    expect(await real.fbConnect("P1")).toEqual({ ok: false, reason: "not_live", error: undefined });
  });
});

// ── C2 ───────────────────────────────────────────────────────────────────────
describe("C2 connect-failure toast never shows a raw code", () => {
  it("maps each answer to a text", () => {
    expect(real.fbConnectFailText({ ok: false, error: "needs_reauth" }, t)).toBe("Please authorize your Facebook Page again.");
    expect(real.fbConnectFailText({ ok: false, error: "page_not_found" }, t)).toBe("Please authorize your Facebook Page again.");
    expect(real.fbConnectFailText({ ok: false, error: "too_many_requests" }, t)).toBe("Too many attempts. Please wait a moment and try again.");
    expect(real.fbConnectFailText({ ok: false, reason: "not_live" }, t)).toBe(t.rd_fb_not_live);
    expect(real.fbConnectFailText({ ok: false, unreachable: true, error: "x" }, t)).toBe(t.rd_cm_cant_reach);
    for (const error of ["fb_check_failed", "plan_expired", "Server error", "HTTP 418", undefined]) {
      expect(real.fbConnectFailText({ ok: false, error }, t)).toBe(t.rd_cm_conn_failed);
    }
  });
  it("RedesignApp uses it for every non-iOS failure (no raw r.error toast left)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    const fn = src.slice(src.indexOf("const doFbConnect = async"), src.indexOf("const openLiveConnect"));
    expect(fn).toContain("fbConnectFailText(r, tApp)");
    expect(fn).not.toMatch(/msg:\s*r\.error/);
  });
});

// ── C3 ───────────────────────────────────────────────────────────────────────
const account = { email: "a@b.c", plan: "basic", planStatus: "active", role: "admin" } as never;
const page = { id: "row1", pageId: "P1", name: "My Page", username: "mypage", active: true };
const channels = (props: Record<string, unknown> = {}) => render(
  <TProvider lang="en"><FbChannels account={account} pages={[page]} onReload={vi.fn()} onBack={vi.fn()} onUpsell={vi.fn()} {...props} /></TProvider>,
);
const authLink = () => document.querySelector("a[href^='https://www.facebook.com']") as HTMLAnchorElement | null;

describe("C3 FbChannels", () => {
  it("at the plan cap: Authorize stays enabled (real link) and the cap notice shows", async () => {
    channels(); await flush();
    expect(authLink()).not.toBeNull();
    expect(document.body.textContent).toContain("Your plan allows 1 live account(s)");
  });
  it("returning to the app (visible / focus) reloads the page list and refreshes the link, once per return", async () => {
    const onReload = vi.fn();
    channels({ onReload }); await flush();
    expect(m.startAuth).toHaveBeenCalledTimes(1);
    m.startAuth.mockResolvedValue({ ok: true, url: "https://www.facebook.com/dialog?state=2" });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus")); });
    await flush();
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(m.startAuth).toHaveBeenCalledTimes(2);
    expect(authLink()!.href).toContain("state=2");
  });
  it("a hidden tab does not reload", async () => {
    const onReload = vi.fn();
    channels({ onReload }); await flush();
    const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    spy.mockRestore();
    expect(onReload).not.toHaveBeenCalled();
  });
  it("the link is refreshed every 8 minutes; a failed refresh disables Authorize", async () => {
    vi.useFakeTimers();
    channels();
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(m.startAuth).toHaveBeenCalledTimes(1);
    expect(FB_AUTH_REFRESH_MS).toBe(8 * 60 * 1000);
    m.startAuth.mockResolvedValue({ ok: false, error: "x" });
    await act(async () => { await vi.advanceTimersByTimeAsync(FB_AUTH_REFRESH_MS); });
    expect(m.startAuth).toHaveBeenCalledTimes(2);
    expect(authLink()).toBeNull();
  });
  it("Remove calls fbDisconnect(pageId) first, then deletes the row — even if the disconnect fails", async () => {
    vi.stubGlobal("confirm", () => true);
    m.disconnect.mockResolvedValue({ ok: false, error: "unreachable" });
    const onReload = vi.fn();
    channels({ onReload }); await flush();
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent === t.rd_fb_remove)!;
    await act(async () => { fireEvent.click(btn); });
    await flush();
    expect(m.disconnect).toHaveBeenCalledWith("P1");
    expect(m.removePage).toHaveBeenCalledWith("row1");
    expect(m.disconnect.mock.invocationCallOrder[0]).toBeLessThan(m.removePage.mock.invocationCallOrder[0]);
    expect(onReload).toHaveBeenCalled();
  });
  it("?fb=error&code=cap → the cap text (with the plan's limit), other codes → the generic error", () => {
    expect(real.fbReturnText({ status: "error", code: "cap" }, t, 3)).toBe("Your plan allows 3 live account(s). Remove one to add another, or contact support.");
    expect(real.fbReturnText({ status: "error", code: "no_pages" }, t, 3)).toBe(t.rd_fb_auth_error_toast);
    expect(real.fbReturnText({ status: "connected" }, t, 3)).toBe(t.rd_fb_authorized_toast);
  });
});

// ── C4 ───────────────────────────────────────────────────────────────────────
const SID = "11111111-2222-3333-4444-555555555555";
const receipt: BuyerReceipt = { num: 3, name: "Ann Reyes", handle: "@ann", lines: [{ item: "A1", total: 350 }], count: 1, total: 350, platform: "Facebook" };
const info = (over = {}) => ({ ok: true, canSend: true, sentCount: 0, lastSentAt: null, remaining: 2, ...over });
const sheet = (props: Record<string, unknown> = {}) =>
  render(<TProvider lang="en"><ReceiptSheet receipt={receipt} cur="NT$" onClose={vi.fn()} sessionId={SID} {...props} /></TProvider>);
const sendBtn = () => q("rs-send") as HTMLButtonElement | null;

describe("C4 ReceiptSheet", () => {
  it("Send is disabled until the saved format has loaded", async () => {
    let done!: (v: unknown) => void;
    m.load.mockReturnValue(new Promise((r) => { done = r; }));
    m.info.mockResolvedValue(info());
    sheet(); await flush();
    expect(sendBtn()!.disabled).toBe(true);
    fireEvent.click(sendBtn()!);
    expect(m.send).not.toHaveBeenCalled();
    await act(async () => { done({ ok: true, settings: { opening: "Hi", note: "N", qrImage: null } }); });
    await flush();
    expect(sendBtn()!.disabled).toBe(false);
  });
  it("a failed format load also enables Send", async () => {
    m.load.mockResolvedValue({ ok: false });
    m.info.mockResolvedValue(info());
    sheet(); await flush();
    expect(sendBtn()!.disabled).toBe(false);
  });
  it("busy → nothing shown (a send is already running)", async () => {
    m.info.mockResolvedValue(info());
    m.send.mockResolvedValue({ ok: false, error: "busy" });
    sheet(); await flush();
    fireEvent.click(sendBtn()!); await flush();
    expect(m.send).toHaveBeenCalledTimes(1);
    expect(q("rs-send-note")).toBeNull();
    expect(sendBtn()).not.toBeNull();
  });
  it("try_later → the existing 'failed, try again' note; Send still offered", async () => {
    m.info.mockResolvedValue(info());
    m.send.mockResolvedValue({ ok: false, error: "try_later", code: 613 });
    sheet(); await flush();
    fireEvent.click(sendBtn()!); await flush();
    expect(q("rs-send-note")!.textContent).toBe(t.rd_rs_failed);
    expect(sendBtn()).not.toBeNull();
  });
  it("mixed_buyer from send → the new note and no Send button", async () => {
    m.info.mockResolvedValue(info());
    m.send.mockResolvedValue({ ok: false, error: "mixed_buyer" });
    sheet(); await flush();
    fireEvent.click(sendBtn()!); await flush();
    expect(q("rs-send-note")!.textContent).toBe("This buyer number has comments from more than one Facebook account. Send this receipt by hand.");
    expect(sendBtn()).toBeNull();
  });
  it("mixed_buyer from info → the new note, no Send button", async () => {
    m.info.mockResolvedValue(info({ canSend: false, reason: "mixed_buyer" }));
    sheet(); await flush();
    expect(sendBtn()).toBeNull();
    expect(q("rs-send-note")!.textContent).toContain("more than one Facebook account");
  });
  it("'Nothing is sent yet' never shows while Send is offered; it stays when there is no Send", async () => {
    m.info.mockResolvedValue(info());
    const r = sheet(); await flush();
    expect(sendBtn()).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/nothing is sent yet/i);
    expect(q("rs-hint")!.textContent).toBe("Changes here are for this receipt only.");
    r.unmount();
    sheet({ sessionId: null }); await flush();
    expect(sendBtn()).toBeNull();
    expect(q("rs-hint")!.textContent).toBe(t.rd_rc_sheet_hint);
  });
});
