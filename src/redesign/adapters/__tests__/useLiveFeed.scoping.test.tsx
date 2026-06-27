// Account-leak fix — the comment feed must scope to the USER's dropdown selection
// (not the server-driven activeAccounts), and tell the server via `select_account`.
// Verifies: (1) only the selected account's comments surface even when multiple
// accounts stream; (2) empty selection shows all; (3) select_account is emitted on
// mount and re-emitted when the selection changes (the switch).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Comment as ProdComment } from "../../../lib/orderTypes";
import type { ActiveAccounts } from "../useLiveFeed";

// Socket stub that lets us trigger registered handlers.
const H = vi.hoisted(() => ({ sockets: [] as Array<{ on: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> }));
vi.mock("socket.io-client", () => ({
  io: vi.fn(() => { const s = { on: vi.fn(), emit: vi.fn(), disconnect: vi.fn() }; H.sockets.push(s); return s; }),
}));

import { useLiveFeed } from "../useLiveFeed";

const sock = () => H.sockets[0];
const handlerFor = (event: string) =>
  sock().on.mock.calls.find((c) => c[0] === event)?.[1] as ((d: unknown) => void) | undefined;
const fireComment = (c: Partial<ProdComment>) => act(() => { handlerFor("comment")?.({ handle: "h", name: "n", comment: "buy", timestamp: new Date().toISOString(), ...c }); });
const selectCalls = () => sock().emit.mock.calls.filter((c) => c[0] === "select_account");

beforeEach(() => { vi.clearAllMocks(); H.sockets.length = 0; localStorage.clear(); });

describe("useLiveFeed — account scoping (leak fix)", () => {
  const sel = (a: Partial<ActiveAccounts>): ActiveAccounts => ({ TikTok: "", Facebook: "", ...a });

  it("shows ONLY the selected account's comments (others dropped) even when several stream", async () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com", undefined, sel({ TikTok: "shop_a" })));
    await fireComment({ handle: "buyerA", comment: "mine A", platform: "TikTok", sourceUsername: "shop_a" });
    await fireComment({ handle: "buyerB", comment: "mine B", platform: "TikTok", sourceUsername: "shop_b" });
    const texts = result.current.comments.map((c) => c.text ?? "");
    expect(texts.some((t) => /mine A/.test(t))).toBe(true);   // selected account kept
    expect(texts.some((t) => /mine B/.test(t))).toBe(false);  // other account dropped
  });

  it("empty selection → shows all accounts (no dropdown choice yet)", async () => {
    const { result } = renderHook(() => useLiveFeed(true, "g@x.com", undefined, sel({})));
    await fireComment({ handle: "b1", comment: "from A", platform: "TikTok", sourceUsername: "shop_a" });
    await fireComment({ handle: "b2", comment: "from B", platform: "TikTok", sourceUsername: "shop_b" });
    expect(result.current.comments.length).toBe(2);
  });

  it("emits select_account on mount with the current selection", () => {
    renderHook(() => useLiveFeed(true, "g@x.com", undefined, sel({ TikTok: "shop_a" })));
    expect(selectCalls()).toContainEqual(["select_account", { platform: "TikTok", username: "shop_a" }]);
  });

  it("re-emits select_account when the selection changes (the switch)", () => {
    const { rerender } = renderHook(({ s }) => useLiveFeed(true, "g@x.com", undefined, s), {
      initialProps: { s: sel({ TikTok: "shop_a" }) },
    });
    sock().emit.mockClear();
    rerender({ s: sel({ TikTok: "shop_b" }) });
    expect(selectCalls()).toContainEqual(["select_account", { platform: "TikTok", username: "shop_b" }]);
  });
});
