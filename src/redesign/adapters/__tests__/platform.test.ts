// isIOS() — Capacitor iOS app OR ?ios=1 browser override → true; everything else false.
import { describe, it, expect, afterEach, vi } from "vitest";
import { isIOS } from "../platform";

const setSearch = (s: string) => {
  Object.defineProperty(window, "location", { value: { ...window.location, search: s }, writable: true });
};
afterEach(() => { setSearch(""); delete (window as unknown as { Capacitor?: unknown }).Capacitor; vi.restoreAllMocks(); });

describe("isIOS", () => {
  it("false on plain web (no Capacitor, no ?ios)", () => {
    setSearch("");
    expect(isIOS()).toBe(false);
  });
  it("true when ?ios=1 is present (browser test override)", () => {
    setSearch("?ios=1");
    expect(isIOS()).toBe(true);
  });
  it("true when Capacitor.getPlatform() === 'ios'", () => {
    (window as unknown as { Capacitor?: { getPlatform: () => string } }).Capacitor = { getPlatform: () => "ios" };
    expect(isIOS()).toBe(true);
  });
  it("false when Capacitor.getPlatform() === 'android'", () => {
    (window as unknown as { Capacitor?: { getPlatform: () => string } }).Capacitor = { getPlatform: () => "android" };
    expect(isIOS()).toBe(false);
  });
});
