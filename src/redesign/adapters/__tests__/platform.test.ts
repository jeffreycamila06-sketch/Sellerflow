// isIOS() — Capacitor iOS app OR ?ios=1 browser override → true; everything else false.
import { describe, it, expect, afterEach, vi } from "vitest";
import { isIOS, applyIOSViewportZoomLock, IOS_LOCKED_VIEWPORT } from "../platform";

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

// applyIOSViewportZoomLock() — rewrites the viewport meta ONLY on the iOS shell.
describe("applyIOSViewportZoomLock", () => {
  const WEB_VIEWPORT = "width=device-width, initial-scale=1.0, viewport-fit=cover";
  const addMeta = () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "viewport");
    meta.setAttribute("content", WEB_VIEWPORT);
    document.head.appendChild(meta);
    return meta;
  };
  afterEach(() => { document.querySelectorAll('meta[name="viewport"]').forEach((m) => m.remove()); });

  it("iOS shell: locks zoom and keeps viewport-fit=cover (safe-area env() stays live)", () => {
    (window as unknown as { Capacitor?: { getPlatform: () => string } }).Capacitor = { getPlatform: () => "ios" };
    const meta = addMeta();
    expect(applyIOSViewportZoomLock()).toBe(true);
    expect(meta.getAttribute("content")).toBe(IOS_LOCKED_VIEWPORT);
    expect(IOS_LOCKED_VIEWPORT).toContain("maximum-scale=1.0");
    expect(IOS_LOCKED_VIEWPORT).toContain("user-scalable=no");
    expect(IOS_LOCKED_VIEWPORT).toContain("viewport-fit=cover");
  });
  it("Android shell: NO-OP — the web viewport meta is untouched", () => {
    (window as unknown as { Capacitor?: { getPlatform: () => string } }).Capacitor = { getPlatform: () => "android" };
    const meta = addMeta();
    expect(applyIOSViewportZoomLock()).toBe(false);
    expect(meta.getAttribute("content")).toBe(WEB_VIEWPORT);
  });
  it("plain web: NO-OP (accessibility pinch-zoom preserved)", () => {
    setSearch("");
    const meta = addMeta();
    expect(applyIOSViewportZoomLock()).toBe(false);
    expect(meta.getAttribute("content")).toBe(WEB_VIEWPORT);
  });
  it("returns false when no viewport meta exists (never throws)", () => {
    (window as unknown as { Capacitor?: { getPlatform: () => string } }).Capacitor = { getPlatform: () => "ios" };
    expect(applyIOSViewportZoomLock()).toBe(false);
  });
});
