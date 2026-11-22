// The last Shopee link, remembered per signed-in seller on this device (adapters/shopeeLastLink.ts).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { lastLinkKey, readLastLink, saveLastLink, clearLastLink, useShopeeLastLink, SHOPEE_LAST_LINK_MAX, SHOPEE_LAST_LINK_PREFIX } from "../shopeeLastLink";

const LINK = "https://ph.shp.ee/AbCdEf12";
beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("storage helpers", () => {
  it("one key per signed-in seller", () => {
    expect(lastLinkKey("u1")).toBe(`${SHOPEE_LAST_LINK_PREFIX}u1`);
    saveLastLink("u1", `  ${LINK}  `);
    expect(localStorage.getItem("sfl_rd_shopee_last_link:u1")).toBe(LINK);
    expect(readLastLink("u1")).toBe(LINK);
    expect(readLastLink("u2")).toBe("");                     // another seller on the same device
    clearLastLink("u1");
    expect(localStorage.getItem("sfl_rd_shopee_last_link:u1")).toBeNull();
  });
  it("no user id → nothing is read or written", () => {
    saveLastLink("", LINK);
    expect(localStorage.length).toBe(0);
    expect(readLastLink("")).toBe("");
  });
  it("empty or over-long links are never stored; an over-long stored value reads as none", () => {
    saveLastLink("u1", "   ");
    saveLastLink("u1", "x".repeat(SHOPEE_LAST_LINK_MAX + 1));
    expect(localStorage.length).toBe(0);
    localStorage.setItem(lastLinkKey("u1"), "y".repeat(SHOPEE_LAST_LINK_MAX + 1));
    expect(readLastLink("u1")).toBe("");
  });
  it("browser storage that throws (blocked / full / private mode) never breaks the app", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readLastLink("u1")).toBe("");
    expect(() => saveLastLink("u1", LINK)).not.toThrow();
    expect(() => clearLastLink("u1")).not.toThrow();
    const { result } = renderHook(() => useShopeeLastLink("u1"));
    act(() => result.current.save(LINK));
    expect(result.current.link).toBe(LINK);                  // kept in memory for this app session
    act(() => result.current.clear());
    expect(result.current.link).toBe("");
  });
});

describe("useShopeeLastLink", () => {
  it("reads the seller's link; save / clear update it and the device", () => {
    saveLastLink("u1", LINK);
    const { result } = renderHook(() => useShopeeLastLink("u1"));
    expect(result.current.link).toBe(LINK);
    act(() => result.current.save("https://ph.shp.ee/NewLive99"));
    expect(result.current.link).toBe("https://ph.shp.ee/NewLive99");
    expect(readLastLink("u1")).toBe("https://ph.shp.ee/NewLive99");
    act(() => result.current.clear());
    expect(result.current.link).toBe("");
    expect(readLastLink("u1")).toBe("");
  });
  it("another seller signed in on the same device sees no link — in the very first render", () => {
    saveLastLink("u1", LINK);
    const seen: string[] = [];
    const { rerender } = renderHook(({ uid }) => { const r = useShopeeLastLink(uid); seen.push(`${uid}:${r.link}`); return r; }, { initialProps: { uid: "u1" } });
    rerender({ uid: "u2" });
    expect(seen.filter((x) => x.startsWith("u2:"))).toEqual(seen.filter((x) => x.startsWith("u2:")).map(() => "u2:"));
    expect(seen.some((x) => x === `u2:${LINK}`)).toBe(false);
    rerender({ uid: "u1" });
    expect(seen[seen.length - 1]).toBe(`u1:${LINK}`);        // back to the first seller → their link again
  });
  it("signed out (no id) → no link, and save does nothing", () => {
    const { result } = renderHook(() => useShopeeLastLink(""));
    act(() => result.current.save(LINK));
    expect(result.current.link).toBe("");
    expect(localStorage.length).toBe(0);
  });
});
