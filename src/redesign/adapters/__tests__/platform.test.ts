// isIOS() — Capacitor iOS app OR ?ios=1 browser override → true; everything else false.
import { describe, it, expect, afterEach, vi } from "vitest";
import { isIOS, isCapacitorIOS, applyIOSViewportZoomLock, applyIOSShellClass, applyIOSStatusBarStyle, IOS_LOCKED_VIEWPORT, IOS_SHELL_CLASS, STATUS_BAR_BACKDROP_HEIGHT } from "../platform";

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

// STATUS_BAR_BACKDROP_HEIGHT — the app-root purple strip under the status bar.
// ANDROID SAFETY CONTRACT: the height must be PURE env(safe-area-inset-top) —
// the Android WebView draws below its status bar, so that inset is 0 there and
// the backdrop collapses to ZERO height (paints nothing; Android visuals
// byte-identical). Any pixel floor or max() would break this and put a visible
// purple strip on Android — these assertions exist to make that impossible.
describe("STATUS_BAR_BACKDROP_HEIGHT (Android = zero height, no-op)", () => {
  it("Android shell: pure env() with NO pixel floor → resolves to 0 → backdrop paints nothing", () => {
    (window as unknown as { Capacitor?: { getPlatform: () => string } }).Capacitor = { getPlatform: () => "android" };
    expect(STATUS_BAR_BACKDROP_HEIGHT).toBe("env(safe-area-inset-top)");
    expect(STATUS_BAR_BACKDROP_HEIGHT).not.toMatch(/px|max\(|calc\(/); // no floor, no minimum — 0 stays 0
  });
  it("same value on every platform (no branch that could diverge later)", () => {
    setSearch("");
    expect(STATUS_BAR_BACKDROP_HEIGHT).toBe("env(safe-area-inset-top)");
  });
});

describe("isCapacitorIOS", () => {
  it("true only for the real Capacitor ios platform (NOT ?ios=1)", () => {
    setSearch("?ios=1");
    expect(isCapacitorIOS()).toBe(false); // browser preview override is not the real shell
    (window as unknown as { Capacitor?: { getPlatform: () => string } }).Capacitor = { getPlatform: () => "ios" };
    expect(isCapacitorIOS()).toBe(true);
  });
});

// applyIOSShellClass() — html.sfl-ios-shell gates the 16px input floor CSS
// (the WKWebView input-focus auto-zoom fix). iOS shell + ?ios=1 preview only.
describe("applyIOSShellClass", () => {
  afterEach(() => { document.documentElement.classList.remove(IOS_SHELL_CLASS); });
  it("iOS shell: adds the class to <html>", () => {
    (window as unknown as { Capacitor?: { getPlatform: () => string } }).Capacitor = { getPlatform: () => "ios" };
    expect(applyIOSShellClass()).toBe(true);
    expect(document.documentElement.classList.contains(IOS_SHELL_CLASS)).toBe(true);
  });
  it("?ios=1 browser preview: adds the class (input sizing previewable on desktop)", () => {
    setSearch("?ios=1");
    expect(applyIOSShellClass()).toBe(true);
    expect(document.documentElement.classList.contains(IOS_SHELL_CLASS)).toBe(true);
  });
  it("Android shell / plain web: NO-OP — class never set", () => {
    (window as unknown as { Capacitor?: { getPlatform: () => string } }).Capacitor = { getPlatform: () => "android" };
    expect(applyIOSShellClass()).toBe(false);
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    setSearch("");
    expect(applyIOSShellClass()).toBe(false);
    expect(document.documentElement.classList.contains(IOS_SHELL_CLASS)).toBe(false);
  });
});

// applyIOSStatusBarStyle() — white status-bar text via the injected
// @capacitor/status-bar bridge; feature-detected so binaries without the
// plugin (and Android/web/?ios=1 preview) are clean no-ops.
describe("applyIOSStatusBarStyle", () => {
  type CapWindow = { Capacitor?: { getPlatform: () => string; Plugins?: { StatusBar?: { setStyle: (o: { style: string }) => Promise<void> } } } };
  it("real iOS shell + plugin present: calls setStyle with DARK (white text)", () => {
    const setStyle = vi.fn().mockResolvedValue(undefined);
    (window as unknown as CapWindow).Capacitor = { getPlatform: () => "ios", Plugins: { StatusBar: { setStyle } } };
    expect(applyIOSStatusBarStyle()).toBe(true);
    expect(setStyle).toHaveBeenCalledWith({ style: "DARK" });
  });
  it("iOS shell WITHOUT the plugin (old binary): clean no-op, never throws", () => {
    (window as unknown as CapWindow).Capacitor = { getPlatform: () => "ios", Plugins: {} };
    expect(applyIOSStatusBarStyle()).toBe(false);
  });
  it("Android shell / ?ios=1 preview: NO-OP even if a StatusBar plugin exists", () => {
    const setStyle = vi.fn().mockResolvedValue(undefined);
    (window as unknown as CapWindow).Capacitor = { getPlatform: () => "android", Plugins: { StatusBar: { setStyle } } };
    expect(applyIOSStatusBarStyle()).toBe(false);
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    setSearch("?ios=1");
    expect(applyIOSStatusBarStyle()).toBe(false);
    expect(setStyle).not.toHaveBeenCalled();
  });
});
