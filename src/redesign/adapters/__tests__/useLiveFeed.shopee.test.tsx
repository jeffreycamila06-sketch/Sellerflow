// SHOPEE LIVE — Phase 3 status-model pins for useLiveFeed. The Shopee key is
// ADDITIVE: a platform_status platform:"Shopee" drives shopeeConnected +
// activeAccounts.Shopee, select_account emits a Shopee scope, a Shopee comment is
// scoped against the Shopee selection, and initial:true Shopee history goes to the
// DISPLAY-ONLY lane (never an order). CRITICALLY: TikTok/Facebook behavior is
// byte-unchanged (a Shopee status event never touches tt/fb state).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Comment as ProdComment } from "../../../lib/orderTypes";
import type { ActiveAccounts } from "../useLiveFeed";

const H = vi.hoisted(() => ({ sockets: [] as Array<{ on: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> }));
vi.mock("socket.io-client", () => ({
  io: vi.fn(() => { const s = { on: vi.fn(), emit: vi.fn(), disconnect: vi.fn() }; H.sockets.push(s); return s; }),
}));

import { useLiveFeed } from "../useLiveFeed";

const sock = () => H.sockets[0];
const handlerFor = (event: string) => sock().on.mock.calls.find((c) => c[0] === event)?.[1] as ((d: unknown) => void) | undefined;
const fireStatus = (p: Record<string, unknown>) => act(() => { handlerFor("platform_status")?.(p); });
const fireComment = (c: Partial<ProdComment> & { initial?: boolean; msgId?: string }) => act(() => { handlerFor("comment")?.({ handle: "h", name: "n", comment: "buy", timestamp: new Date().toISOString(), ...c }); });
const selectCalls = () => sock().emit.mock.calls.filter((c) => c[0] === "select_account");
const sel = (a: Partial<ActiveAccounts>): ActiveAccounts => ({ TikTok: "", Facebook: "", Shopee: "", ...a });

beforeEach(() => { vi.clearAllMocks(); H.sockets.length = 0; localStorage.clear(); });

describe("useLiveFeed — Shopee status key (additive)", () => {
  it("platform_status Shopee connected → shopeeConnected + activeAccounts.Shopee = shop id", () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    expect(result.current.shopeeConnected).toBe(false);
    fireStatus({ platform: "Shopee", connected: true, username: "555" });
    expect(result.current.shopeeConnected).toBe(true);
    expect(result.current.activeAccounts.Shopee).toBe("555");
  });

  it("platform_status Shopee connected:false → gray (shopeeConnected false, key cleared)", () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    fireStatus({ platform: "Shopee", connected: true, username: "555" });
    fireStatus({ platform: "Shopee", connected: false, username: "555" });
    expect(result.current.shopeeConnected).toBe(false);
    expect(result.current.activeAccounts.Shopee).toBe("");
  });

  it("a Shopee status event NEVER touches TikTok/Facebook (byte-unchanged)", () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    fireStatus({ platform: "TikTok", connected: true, username: "shop_a" });
    fireStatus({ platform: "Shopee", connected: true, username: "555" });
    fireStatus({ platform: "Shopee", connected: false, username: "555" }); // Shopee grays
    expect(result.current.ttConnected).toBe(true);                 // TikTok still green
    expect(result.current.activeAccounts.TikTok).toBe("shop_a");
    expect(result.current.fbConnected).toBe(false);
  });

  it("emits a Shopee select_account on mount with the selected shop id", () => {
    renderHook(() => useLiveFeed(true, "g@x.com", undefined, sel({ Shopee: "555" })));
    expect(selectCalls()).toContainEqual(["select_account", { platform: "Shopee", username: "555" }]);
  });

  it("scopes Shopee comments to the selected shop (other shop dropped)", async () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com", undefined, sel({ Shopee: "555" })));
    await fireComment({ handle: "a", comment: "mine A", platform: "Shopee", sourceUsername: "555" });
    await fireComment({ handle: "b", comment: "mine B", platform: "Shopee", sourceUsername: "999" });
    const texts = result.current.comments.map((c) => c.text ?? "");
    expect(texts.some((t) => /mine A/.test(t))).toBe(true);
    expect(texts.some((t) => /mine B/.test(t))).toBe(false);
  });

  it("Shopee comment keeps platform 'Shopee' in the rendered feed (badge identity)", async () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com"));
    await fireComment({ handle: "a", comment: "mine", platform: "Shopee", sourceUsername: "555" });
    expect(result.current.comments[0].platform).toBe("Shopee");
  });

  it("initial:true Shopee comment → DISPLAY-ONLY lane (never an order seam)", async () => {
    const onComment = vi.fn(); // the Auto-Mode seam
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com", onComment));
    await fireComment({ handle: "a", comment: "mine", platform: "Shopee", sourceUsername: "555", initial: true, msgId: "m1" });
    // seam NEVER fires for an initial comment; it lands in the history block, not feed
    expect(onComment).not.toHaveBeenCalled();
    expect(result.current.comments.length).toBe(0);
    expect(result.current.initialComments.length).toBe(1);
  });
});
