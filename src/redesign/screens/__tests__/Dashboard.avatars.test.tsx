// Commenter profile pictures (FLive/Chotdon parity) — DISPLAY-ONLY contract.
// The avatar URL already rides the relay payload (server untouched); this
// suite pins the client render rules:
//   • avatar present → <img> with loading="lazy" + referrerPolicy="no-referrer";
//   • no avatar (FB / test comments / absent field) → the colored initials
//     circle, byte-preserved (the pre-feature render);
//   • onError (expired/blocked CDN URL) → img gone, initials remain, wrapper
//     stays 34px — ZERO layout shift in every state;
//   • history/restored rows follow the same rule (the initial buffer/ring
//     relay carries avatars too — fresh URLs; rows without one → initials);
//   • toRedesignComment maps avatar through (default "") — and nothing stores
//     the URL anywhere (display-only; expiring signed CDN links).
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TProvider } from "../../i18n";

vi.mock("../../adapters/useRaffleConfig", () => ({
  useRaffleConfig: () => ({ enabled: false, enabledAt: null, loading: false, toggle: vi.fn() }),
}));
beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });

import Dashboard from "../Dashboard";
import { toRedesignComment } from "../../adapters/useLiveFeed";
import type { Comment } from "../../data";
import type { Comment as ProdComment } from "../../../lib/orderTypes";

const CDN = "https://p16-sign.tiktokcdn.example/avatar~c5_100x100.webp?x-expires=1";
const comment = (name: string, over: Partial<Comment> = {}): Comment =>
  ({ id: `c-${name}`, name, handle: `@${name}`, text: "mine", mine: true, time: "9:41:00 PM", platform: "TikTok", ...over });

const noop = () => {};
const props = (comments: Comment[]) => ({
  comments, cur: "NT$", historyReady: true,
  ttOpen: false, fbOpen: false, ttIdx: 0, fbIdx: 0,
  onToggleTT: noop, onToggleFB: noop, onPickTT: noop, onPickFB: noop,
  ttConnected: false, fbConnected: false, ttConnecting: false, fbConnecting: false,
  onConnectTT: noop, onConnectFB: noop,
  printed: {}, entId: null, entPrice: "",
  onOneClick: noop, onOpenEnt: noop, onEntPrice: noop, onEntKey: noop,
});
const renderFeed = (comments: Comment[]) =>
  render(<TProvider lang="en"><Dashboard {...props(comments)} /></TProvider>);
const rowImg = (container: HTMLElement) => container.querySelector(".sfl-comm-row img") as HTMLImageElement | null;

describe("avatar render rules", () => {
  it("avatar present → <img> with the CDN src, lazy, no-referrer — over the initials base", () => {
    const { container } = renderFeed([comment("Aileen Go", { avatar: CDN })]);
    const img = rowImg(container)!;
    expect(img).not.toBeNull();
    expect(img.getAttribute("src")).toBe(CDN);
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("referrerPolicy")).toBe("no-referrer");
    expect(container.querySelector(".sfl-comm-row")!.textContent).toContain("AG"); // initials base layer stays (zero flicker while loading)
  });

  it("no avatar (FB / absent field) → NO img; the colored initials circle renders exactly as before", () => {
    const { container } = renderFeed([comment("Mei Lin")]);
    expect(rowImg(container)).toBeNull();
    const row = container.querySelector(".sfl-comm-row")!;
    expect(row.textContent).toContain("ML");                       // initials, pre-feature behavior
  });

  it("onError (expired/blocked URL) → img removed, initials remain, wrapper stays 34px — zero layout shift", () => {
    const { container } = renderFeed([comment("Jai", { avatar: CDN })]);
    const img = rowImg(container)!;
    const wrapper = img.parentElement as HTMLElement;
    expect(wrapper.style.width).toBe("34px");
    fireEvent.error(img);                                          // CDN says no
    expect(rowImg(container)).toBeNull();                          // img gone
    expect(wrapper.style.width).toBe("34px");                      // same box, no shift
    expect(wrapper.textContent).toContain("J");                    // initials still there
  });

  it("history/restored rows: same rule — avatar when the relay carried one, initials when not", () => {
    const { container } = renderFeed([
      comment("WithPic", { restored: true, msgId: "m1", avatar: CDN }),
      comment("NoPic", { restored: true, msgId: "m2" }),
    ]);
    const imgs = container.querySelectorAll(".sfl-comm-row img");
    expect(imgs.length).toBe(1);                                   // only the row whose payload had a URL
    expect((imgs[0] as HTMLImageElement).getAttribute("src")).toBe(CDN);
    expect(container.textContent).toContain("N");                  // NoPic → initials
  });
});

describe("toRedesignComment mapping (display-only pass-through)", () => {
  it("maps avatar through; absent → empty string (never undefined leaking into <img src>)", () => {
    const base = { platform: "TikTok", handle: "b1", name: "B One", comment: "mine", timestamp: "2026-07-12T00:00:00Z", time: "8:00" } as ProdComment;
    expect(toRedesignComment({ ...base, avatar: CDN } as ProdComment).avatar).toBe(CDN);
    expect(toRedesignComment(base).avatar).toBe("");
  });
});
