// openExternalLink — must open via a real <a target="_blank" rel="noreferrer">
// click (the mechanism the Capacitor iOS shell honors), NOT window.open (blocked
// on iOS). Guards the expiry-modal "slide completes but Telegram never opens" fix.
import { describe, it, expect, vi, afterEach } from "vitest";
import { openExternalLink } from "../externalLink";

afterEach(() => vi.restoreAllMocks());

describe("openExternalLink", () => {
  it("clicks a freshly-created anchor with the right href/target/rel", () => {
    let clicked: HTMLAnchorElement | null = null;
    const spy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked = this;
    });
    openExternalLink("https://t.me/SellerFlowLive1995");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(clicked).not.toBeNull();
    expect(clicked!.getAttribute("href")).toBe("https://t.me/SellerFlowLive1995");
    expect(clicked!.getAttribute("target")).toBe("_blank");
    expect(clicked!.getAttribute("rel")).toBe("noreferrer");
  });

  it("does NOT use window.open (blocked in the iOS WKWebView shell)", () => {
    const winOpen = vi.spyOn(window, "open").mockImplementation(() => null);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    openExternalLink("https://t.me/SellerFlowLive1995");
    expect(winOpen).not.toHaveBeenCalled();
  });

  it("cleans up the anchor after clicking (no DOM leak)", () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const before = document.querySelectorAll("a").length;
    openExternalLink("https://t.me/SellerFlowLive1995");
    expect(document.querySelectorAll("a").length).toBe(before);
  });
});
