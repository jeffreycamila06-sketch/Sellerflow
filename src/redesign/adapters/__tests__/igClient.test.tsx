// INSTAGRAM phase 1 — client pins: the useLiveFeed Instagram lane (status, scoping, never folded
// into TikTok, no extra socket emit for anyone without Instagram), the picker tile (only with
// the ig prop; "soon" otherwise, the same look), the Settings entry, the accounts screen, the
// OAuth return text, and the Session-RPC v2 follow-up (a) wiring.
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { renderHook, act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import type { Comment as ProdComment } from "../../../lib/orderTypes";
import type { ActiveAccounts } from "../useLiveFeed";

const H = vi.hoisted(() => ({ sockets: [] as Array<{ on: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> }));
vi.mock("socket.io-client", () => ({
  io: vi.fn(() => { const s = { on: vi.fn(), emit: vi.fn(), disconnect: vi.fn() }; H.sockets.push(s); return s; }),
}));
vi.mock("../useRaffleConfig", () => ({
  useRaffleConfig: () => ({ enabled: false, enabledAt: null, loading: false, toggle: vi.fn(), toggleErrors: 0 }),
}));

import { useLiveFeed } from "../useLiveFeed";
import { TProvider, buildT } from "../../i18n";
import Dashboard from "../../screens/Dashboard";
import ManageChannels from "../../screens/ManageChannels";
import IgChannels from "../../screens/IgChannels";
import { parseIgReturn, igReturnText, igConnectFailText, igScopeKey } from "../ig";

beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });
beforeEach(() => { vi.clearAllMocks(); H.sockets.length = 0; localStorage.clear(); });

const sock = () => H.sockets[0];
const handlerFor = (event: string) => sock().on.mock.calls.find((c) => c[0] === event)?.[1] as ((d: unknown) => void) | undefined;
const fireStatus = (p: Record<string, unknown>) => act(() => { handlerFor("platform_status")?.(p); });
const fireComment = (c: Partial<ProdComment> & { msgId?: string }) => act(() => { handlerFor("comment")?.({ handle: "h", name: "n", comment: "buy", timestamp: new Date().toISOString(), ...c }); });
const selectCalls = () => sock().emit.mock.calls.filter((c) => c[0] === "select_account");
const sel = (a: Partial<ActiveAccounts>): ActiveAccounts => ({ TikTok: "", Facebook: "", Shopee: "", ...a });

describe("useLiveFeed — Instagram lane", () => {
  it("platform_status Instagram drives igConnected only; TikTok / Facebook untouched", () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    fireStatus({ platform: "TikTok", connected: true, username: "shop_a" });
    fireStatus({ platform: "Instagram", connected: true, username: "shop.ig" });
    expect(result.current.igConnected).toBe(true);
    expect(result.current.activeAccounts.Instagram).toBe("shop.ig");
    fireStatus({ platform: "Instagram", connected: false, username: "shop.ig" });
    expect(result.current.igConnected).toBe(false);
    expect(result.current.ttConnected).toBe(true);
    expect(result.current.activeAccounts.TikTok).toBe("shop_a");
    expect(result.current.fbConnected).toBe(false);
  });
  it("an Instagram comment keeps platform 'Instagram' (never folded into TikTok) and is scoped by the IG selection", async () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com", undefined, sel({ TikTok: "shop_a", Instagram: "shop.ig" })));
    await fireComment({ handle: "buyer1", comment: "mine A", platform: "Instagram" as never, sourceUsername: "shop.ig" });
    await fireComment({ handle: "buyer2", comment: "mine B", platform: "Instagram" as never, sourceUsername: "other.ig" });
    const c = result.current.comments;
    expect(c.map((x) => x.platform)).toEqual(["Instagram"]);
    expect(c[0].text).toMatch(/mine A/);
  });
  it("no Instagram selection → NO Instagram select_account emit (identical for everyone else)", () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com", undefined, sel({ TikTok: "shop_a" })));
    expect(selectCalls().map((c) => (c[1] as { platform: string }).platform)).toEqual(["TikTok", "Facebook", "Shopee"]);
    act(() => { result.current.ensureJoined(); });   // the room join re-sends the selection
    expect(selectCalls().some((c) => (c[1] as { platform: string }).platform === "Instagram")).toBe(false);
  });
  it("an Instagram selection → its own select_account emit", () => {
    renderHook(() => useLiveFeed(true, "g@x.com", undefined, sel({ Instagram: "shop.ig" })));
    expect(selectCalls()).toContainEqual(["select_account", { platform: "Instagram", username: "shop.ig" }]);
  });
});

const noop = () => {};
const dashProps = {
  comments: [] as never[], cur: "NT$", ttOpen: false, fbOpen: false, ttIdx: 0, fbIdx: 0,
  onToggleTT: noop, onToggleFB: noop, onPickTT: noop, onManageTT: noop,
  ttConnected: false, fbConnected: false, ttConnecting: false, fbConnecting: false,
  onConnectTT: noop, onRefreshTT: noop, ttAccounts: ["shop_a"], fbAccounts: [] as string[],
  printed: {}, entId: null, entPrice: "", onOneClick: noop, onOpenEnt: noop, onEntPrice: noop, onEntKey: noop,
  livePicker: true,
};
const igProp = (o: Record<string, unknown> = {}) => ({ accounts: [{ igUserId: "178", name: "@shop.ig" }], idx: 0, onPick: vi.fn(), connected: false, connecting: false, onConnect: vi.fn(), onManage: vi.fn(), ...o });

describe("picker — the Instagram tile", () => {
  it("without the ig prop: disabled, 'soon' — exactly as before", () => {
    render(<TProvider lang="en"><Dashboard {...dashProps} /></TProvider>);
    const tile = screen.getByTestId("lpk-tile-ig") as HTMLButtonElement;
    expect(tile.disabled).toBe(true);
    expect(tile.textContent).toContain(buildT("en").rd_ls_soon);
  });
  it("with the ig prop: enabled; its menu lists the accounts and calls the IG callbacks", () => {
    const ig = igProp();
    render(<TProvider lang="en"><Dashboard {...dashProps} ig={ig} /></TProvider>);
    const tile = screen.getByTestId("lpk-tile-ig") as HTMLButtonElement;
    expect(tile.disabled).toBe(false);
    fireEvent.click(tile);
    const panel = screen.getByTestId("lpk-panel-ig");
    expect(panel.textContent).toContain("@shop.ig");
    fireEvent.click(screen.getByText(buildT("en").rd_dash_connect));
    expect(ig.onConnect).toHaveBeenCalledTimes(1);
  });
  it("Instagram live → the full-width source button shows the IG account", () => {
    render(<TProvider lang="en"><Dashboard {...dashProps} ig={igProp({ connected: true })} /></TProvider>);
    expect(screen.getByTestId("lpk-source-button").textContent).toContain("@shop.ig");
  });
});

describe("Settings entry + accounts screen", () => {
  it("ManageChannels shows the Instagram entry only when onInstagram is passed", () => {
    const { unmount } = render(<TProvider lang="en"><ManageChannels platform="tiktok" onBack={noop} /></TProvider>);
    expect(screen.queryByTestId("ig-entry")).toBeNull();
    unmount();
    const go = vi.fn();
    render(<TProvider lang="en"><ManageChannels platform="tiktok" onBack={noop} onInstagram={go} /></TProvider>);
    fireEvent.click(screen.getByTestId("ig-entry"));
    expect(go).toHaveBeenCalled();
  });
  it("IgChannels lists accounts and renders Authorize as a real <a> to the signed URL", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ url: "https://www.facebook.com/v25.0/dialog/oauth?x=1" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const account = { email: "test@gmail.com", plan: "free", planStatus: "active", role: "seller" } as never;
    render(<TProvider lang="en"><IgChannels account={account} accounts={[{ id: "1", igUserId: "178", username: "shop.ig", pageName: "My Page", active: true }]} onReload={noop} onBack={noop} onUpsell={noop} /></TProvider>);
    expect(screen.getByTestId("ig-account").textContent).toContain("@shop.ig");
    await waitFor(() => expect(screen.getByTestId("ig-authorize").getAttribute("href")).toBe("https://www.facebook.com/v25.0/dialog/oauth?x=1"));
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("/ig/oauth/start");
    vi.unstubAllGlobals();
  });
});

describe("texts", () => {
  const t = buildT("en");
  it("OAuth return: connected / no IG account / cap / cancelled", () => {
    expect(parseIgReturn("?ig=connected")).toEqual({ status: "connected" });
    expect(parseIgReturn("?fb=connected")).toBeNull();
    expect(igReturnText({ status: "connected" }, t, 2)).toBe(t.rd_ig_authorized_toast);
    expect(igReturnText({ status: "error", code: "no_ig_account" }, t, 2)).toBe(t.rd_ig_no_account);
    expect(igReturnText({ status: "error", code: "cap" }, t, 2)).toContain("2");
    expect(igReturnText({ status: "error", code: "cancelled" }, t, 2)).toBeNull();
  });
  it("connect failures never show a raw code", () => {
    expect(igConnectFailText({ ok: false, reason: "not_live" }, t)).toBe(t.rd_ig_not_live);
    expect(igConnectFailText({ ok: false, error: "needs_reauth" }, t)).toBe(t.rd_ig_reauth_toast);
    expect(igConnectFailText({ ok: false, error: "weird_code" }, t)).toBe(t.rd_cm_conn_failed);
  });
  it("no Instagram text mentions a plan, a price or upgrading (iOS rule)", () => {
    for (const [k, v] of Object.entries(t)) if (k.startsWith("rd_ig_")) expect(String(v), k).not.toMatch(/plan|price|upgrade|subscri|NT\$|pay/i);
  });
  it("scope key = username, else the IG user id (the server's key)", () => {
    expect(igScopeKey({ username: "shop.ig", igUserId: "178" })).toBe("shop.ig");
    expect(igScopeKey({ username: "", igUserId: "178" })).toBe("178");
  });
});

describe("Session-RPC v2 follow-up (a) — the switch confirm uses the length just picked (source contract)", () => {
  const app = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
  it("both first-connect sites hand the picked length to the confirm", () => {
    expect(app).toContain("if (sid === SESSION_SWITCH_NEEDED) { askSwitch(targetOfPending(pending), days); return; }");
    expect(app).toContain("if (sid === SESSION_SWITCH_NEEDED) { askSwitch(targetOfPending(pending), SESSION_V2_DAYS); return; }");
  });
  it("confirmSwitch takes the picked length first and clears it; every other switch passes none", () => {
    expect(app).toContain("const days = picked ?? sessionInstance.sessionWindowDays ?? SESSION_V2_DAYS;");
    expect(app).toContain("switchDaysRef.current = null;");
    expect(app).toContain("askSwitch(target); return;");
    expect(app).toContain('askSwitch({ platform: "TikTok", username: acct }); return;');
    expect((app.match(/setSwitchConfirm\(target\)/g) || []).length).toBe(1); // only inside askSwitch
  });
});
