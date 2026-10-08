// Build 2 — "Stop reasons", client half. Pins:
//   • useLiveFeed records a Facebook stop reason only AFTER the existing seller / session /
//     account filters, never for TikTok, and the pill still goes gray exactly as before;
//   • one seller-worded toast per green → gray fall for the reason; none after this device's
//     own Disconnect, none for an unknown reason, none for an older stop or another Page,
//     none with the switch OFF; toast texts carry no technical words in any language;
//   • needsReconnect; FbChannels "Connect again" badge = the Authorize flow; Dashboard picker
//     badge + Disconnect kept when Facebook access is gone; switch-OFF wiring (source contracts).
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from "vitest";
import { render, renderHook, act } from "@testing-library/react";
import { readFileSync } from "node:fs";

const H = vi.hoisted(() => ({ sockets: [] as Array<{ on: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> }));
vi.mock("socket.io-client", () => ({
  io: vi.fn(() => { const s = { on: vi.fn(), emit: vi.fn(), disconnect: vi.fn() }; H.sockets.push(s); return s; }),
}));
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { from: vi.fn(), rpc: vi.fn(), auth: { getSession: async () => ({ data: { session: { user: { id: "u1" }, access_token: "jwt" } } }) } } }));
const m = vi.hoisted(() => ({ startAuth: vi.fn(), fbConnect: vi.fn() }));
vi.mock("../fb", async (orig) => ({ ...(await orig() as object), startFbAuth: m.startAuth, fbConnect: m.fbConnect }));
vi.mock("../useRaffleConfig", () => ({ useRaffleConfig: () => ({ enabled: false, enabledAt: null, loading: false, toggle: vi.fn() }) }));
beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });

import { useLiveFeed } from "../useLiveFeed";
import { browserSessionId } from "../serverIdentity";
import { fbStopToastFor, useFbStopToast, needsReconnect, FB_STOP_TOASTS, type FbStop } from "../fbStopReasons";
import { TProvider, buildT } from "../../i18n";
import FbChannels from "../../screens/FbChannels";
import Dashboard from "../../screens/Dashboard";

const t = buildT("en");
const handlerFor = (event: string) => H.sockets[0].on.mock.calls.find((c) => c[0] === event)?.[1] as ((d?: unknown) => void) | undefined;
const fire = (event: string, d?: unknown) => act(() => { handlerFor(event)?.(d); });
beforeEach(() => { vi.clearAllMocks(); H.sockets.length = 0; localStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());

describe("useLiveFeed records the stop reason after the existing filters", () => {
  async function greenFb() {
    const hook = renderHook(() => useLiveFeed(true, "s@x.com"));
    m.fbConnect.mockResolvedValue({ ok: true });
    await act(async () => { await hook.result.current.connectFacebook("P1", "mypage"); });
    fire("platform_status", { platform: "Facebook", connected: true, username: "mypage", sessionId: browserSessionId() });
    expect(hook.result.current.fbConnected).toBe(true);
    return hook;
  }
  it("connected:false with a reason → gray (as before) + fbLastStop", async () => {
    const { result } = await greenFb();
    fire("platform_status", { platform: "Facebook", connected: false, username: "mypage", sessionId: browserSessionId(), reason: "session_end" });
    expect(result.current.fbConnected).toBe(false);
    expect(result.current.fbLastStop).toMatchObject({ reason: "session_end", scopeKey: "mypage" });
  });
  it("other session / other Page / TikTok / no reason → nothing recorded", async () => {
    const { result } = await greenFb();
    fire("platform_status", { platform: "Facebook", connected: false, username: "mypage", sessionId: "other-phone", reason: "restart" });
    fire("platform_status", { platform: "Facebook", connected: false, username: "otherpage", sessionId: browserSessionId(), reason: "auth" });
    fire("platform_status", { platform: "TikTok", connected: false, username: "x", sessionId: browserSessionId(), reason: "disconnect" });
    expect(result.current.fbLastStop).toBeNull();
    expect(result.current.fbConnected).toBe(true);
    fire("platform_status", { platform: "Facebook", connected: false, username: "mypage", sessionId: browserSessionId() });
    expect(result.current.fbConnected).toBe(false);
    expect(result.current.fbLastStop).toBeNull();
  });
});

describe("the toast", () => {
  const stop = (reason: string, at = 2000, scopeKey = "mypage"): FbStop => ({ reason, scopeKey, at });
  const green = { key: "mypage", at: 1000 };
  it("maps every reason to the seller wording; unknown → none", () => {
    const exp: Record<string, string> = {
      session_end: t.rd_fb_stop_session_end, idle: t.rd_fb_stop_stalled, fetch_error: t.rd_fb_stop_stalled, shutdown: t.rd_fb_stop_stalled,
      max_session: t.rd_fb_stop_max, auth: t.rd_fb_stop_auth, no_token: t.rd_fb_stop_auth, inactive: t.rd_fb_stop_auth,
      feature_gate: t.rd_fb_stop_gate, restart: t.rd_fb_stop_restart, disconnect: t.rd_fb_stop_other_device,
    };
    for (const [reason, msg] of Object.entries(exp)) expect(fbStopToastFor({ on: true, offByThisDevice: false, stop: stop(reason), green }, t)?.msg, reason).toBe(msg);
    expect(fbStopToastFor({ on: true, offByThisDevice: false, stop: stop("session_end"), green }, t)?.kind).toBe("ok");
    expect(fbStopToastFor({ on: true, offByThisDevice: false, stop: stop("restart"), green }, t)?.kind).toBe("err");
    expect(fbStopToastFor({ on: true, offByThisDevice: false, stop: stop("stopped"), green }, t)).toBeNull();
    expect(fbStopToastFor({ on: true, offByThisDevice: false, stop: stop("cap"), green }, t)).toBeNull();
  });
  it("none: switch off / this device tapped Disconnect / older stop / another Page / never green", () => {
    expect(fbStopToastFor({ on: false, offByThisDevice: false, stop: stop("session_end"), green }, t)).toBeNull();
    expect(fbStopToastFor({ on: true, offByThisDevice: true, stop: stop("disconnect"), green }, t)).toBeNull();
    expect(fbStopToastFor({ on: true, offByThisDevice: false, stop: stop("session_end", 500), green }, t)).toBeNull();
    expect(fbStopToastFor({ on: true, offByThisDevice: false, stop: stop("session_end", 2000, "otherpage"), green }, t)).toBeNull();
    expect(fbStopToastFor({ on: true, offByThisDevice: false, stop: stop("session_end"), green: null }, t)).toBeNull();
  });
  it("useFbStopToast: one toast per green → gray fall", () => {
    const onToast = vi.fn();
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const base = { liveKey: "mypage", offByThisDevice: false, on: true, t, onToast };
    const h = renderHook((p: { connected: boolean; stop: FbStop | null; liveKey: string }) => useFbStopToast({ ...base, ...p }), { initialProps: { connected: false, stop: null as FbStop | null, liveKey: "" } });
    h.rerender({ connected: true, stop: null, liveKey: "mypage" });
    now = 5000;
    h.rerender({ connected: false, stop: { reason: "session_end", scopeKey: "mypage", at: 5000 }, liveKey: "" });
    expect(onToast).toHaveBeenCalledTimes(1);
    expect(onToast).toHaveBeenCalledWith({ msg: t.rd_fb_stop_session_end, kind: "ok" });
    h.rerender({ connected: false, stop: { reason: "session_end", scopeKey: "mypage", at: 5000 }, liveKey: "" });
    expect(onToast).toHaveBeenCalledTimes(1);                         // no repeat while gray
    vi.restoreAllMocks();
  });
  it("seller words only — no technical terms, codes or raw reason words, max 2 sentences (all 8 languages)", () => {
    const banned = /server|poller|limit|feature|token|\bAPI\b|device|restart|timeout|\b\d+\s*(hours?|minutes?|h|min)\b|session_end|fetch_error|max_session|feature_gate|no_token/i;
    const keys = [...new Set(Object.values(FB_STOP_TOASTS).map((x) => x.key)), "rd_fb_needs_reconnect"] as const;
    for (const l of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"]) {
      const tl = buildT(l);
      for (const k of keys) {
        const v = String(tl[k as keyof typeof tl] || "");
        expect(v.trim(), `${l}.${k}`).not.toBe("");
        if (l === "en" || l === "fil") expect(v, `${l}.${k}`).not.toMatch(banned);
        expect((v.match(/[.!?。！？]/g) || []).length, `${l}.${k}`).toBeLessThanOrEqual(2);
      }
    }
    expect(t.rd_fb_needs_reconnect).toBe("Connect again");
    expect(buildT("fil").rd_fb_needs_reconnect).toBe("I-connect ulit");
  });
});

describe("needsReconnect", () => {
  it("inactive, or the token expiry has passed", () => {
    expect(needsReconnect({ active: false }, 1000)).toBe(true);
    expect(needsReconnect({ active: true, tokenExpiresAt: new Date(999).toISOString() }, 1000)).toBe(true);
    expect(needsReconnect({ active: true, tokenExpiresAt: new Date(1000).toISOString() }, 1000)).toBe(true);
    expect(needsReconnect({ active: true, tokenExpiresAt: new Date(1001).toISOString() }, 1000)).toBe(false);
    expect(needsReconnect({ active: true, tokenExpiresAt: null }, 1000)).toBe(false);
    expect(needsReconnect({ active: true }, 1000)).toBe(false);
    expect(needsReconnect({ active: true, tokenExpiresAt: "garbage" }, 1000)).toBe(false);
  });
});

describe("FbChannels badge", () => {
  const page = (id: string) => ({ id: `r${id}`, pageId: id, name: `Page ${id}`, username: `p${id}`, active: true });
  const view = (props: Record<string, unknown>) => render(<TProvider lang="en"><FbChannels account={{ email: "a@b.c", plan: "pro", planStatus: "active", role: "seller" } as never} pages={[page("1"), page("2")]} onReload={vi.fn()} onBack={vi.fn()} onUpsell={vi.fn()} {...props} /></TProvider>);
  const flush = async () => { await act(async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 5)); }); };
  it("only the listed Page shows \"Connect again\", and it is the Authorize link", async () => {
    m.startAuth.mockResolvedValue({ ok: true, url: "https://www.facebook.com/dialog/oauth?state=S" });
    const { container } = view({ needsReconnectIds: ["2"] });
    await flush();
    const badges = container.querySelectorAll("[data-testid='fb-needs-reconnect']");
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toBe("Connect again");
    expect((badges[0] as HTMLAnchorElement).getAttribute("href")).toBe("https://www.facebook.com/dialog/oauth?state=S");
  });
  it("no list (switch off) → the rows as before", async () => {
    m.startAuth.mockResolvedValue({ ok: true, url: "https://www.facebook.com/dialog/oauth?state=S" });
    const a = view({}); await flush();
    const b = view({ needsReconnectIds: [] }); await flush();
    expect(a.container.querySelector("[data-testid='fb-needs-reconnect']")).toBeNull();
    expect(b.container.innerHTML).toBe(a.container.innerHTML);
  });
});

describe("Dashboard Facebook menu", () => {
  const noop = () => {};
  const props = (extra: Record<string, unknown>) => ({
    comments: [], cur: "NT$", historyReady: true, ttOpen: false, fbOpen: true, ttIdx: 0, fbIdx: 0,
    onToggleTT: noop, onToggleFB: noop, onPickTT: noop, onPickFB: noop, ttConnected: false, fbConnected: false,
    ttConnecting: false, fbConnecting: false, onConnectTT: noop, onConnectFB: noop, printed: {}, entId: null, entPrice: "",
    onOneClick: noop, onOpenEnt: noop, onEntPrice: noop, onEntKey: noop, ...extra,
  });
  const dash = (extra: Record<string, unknown>) => render(<TProvider lang="en"><Dashboard {...(props(extra) as unknown as Parameters<typeof Dashboard>[0])} /></TProvider>);
  it("picker: \"Connect again\" on the listed Page only", () => {
    const { container } = dash({ fbConnectEnabled: true, fbPages: [{ pageId: "1", name: "A", username: "a" }, { pageId: "2", name: "B", username: "b" }], fbReconnectIds: ["2"] });
    const b = container.querySelectorAll("[data-testid='fb-needs-reconnect']");
    expect(b).toHaveLength(1);
    expect(b[0].textContent).toBe("Connect again");
  });
  it("access gone while connected: Disconnect stays above the notice (switch on); off / not connected → notice only", () => {
    const onConnectFB = vi.fn();
    const on = dash({ fbConnectEnabled: false, fbConnected: true, fbKeepDisconnect: true, onConnectFB });
    const btn = on.container.querySelector("[data-testid='fb-keep-disconnect']") as HTMLButtonElement;
    expect(btn.textContent).toBe(t.rd_dash_disconnect);
    act(() => { btn.click(); });
    expect(onConnectFB).toHaveBeenCalledTimes(1);
    on.unmount();
    const off = dash({ fbConnectEnabled: false, fbConnected: true });
    expect(off.container.querySelector("[data-testid='fb-keep-disconnect']")).toBeNull();
    off.unmount();
    const gray = dash({ fbConnectEnabled: false, fbConnected: false, fbKeepDisconnect: true });
    expect(gray.container.querySelector("[data-testid='fb-keep-disconnect']")).toBeNull();
  });
});

describe("RedesignApp wiring (source contract)", () => {
  const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
  it("toast hook gets the switch; expiry read and badge list only with the switch on", () => {
    expect(src).toContain("useFbStopToast({ connected: fbConnected, liveKey: liveFeed.activeAccounts.Facebook, stop: liveFeed.fbLastStop, offByThisDevice: fbOff, on: featureSw.fbStopReasons, t: tApp, onToast: setToast });");
    expect(src).toContain("if (!featureSw.fbStopReasons || fbPages.length === 0) return;");
    expect(src).toMatch(/const fbReconnectIds = featureSw\.fbStopReasons\s*\? /);
    expect(src).toContain("fbReconnectIds={fbReconnectIds} fbKeepDisconnect={featureSw.fbStopReasons}");
  });
  it("Connect on a Page that needs reconnect → Authorize screen (switch on); lost-access Disconnect stops the last live Page", () => {
    expect(src).toContain('if (featureSw.fbStopReasons && fbReconnectIds.includes(selectedPage.pageId)) { setFbOpen(false); setChanBack("dashboard"); setScreen("fbpages"); return; }');
    expect(src).toContain("if (featureSw.fbStopReasons && fbLastLivePageRef.current) void fbDisconnect(fbLastLivePageRef.current);");
  });
});
