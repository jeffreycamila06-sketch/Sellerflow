// Phase 1 sanity check — proves the Vitest + jsdom toolchain runs.
// No feature logic here; real tests come in Phase 2.
import { describe, it, expect } from "vitest";

describe("vitest setup sanity", () => {
  it("does arithmetic", () => {
    expect(1 + 1).toBe(2);
  });

  it("handles strings and arrays", () => {
    expect("SellerFlowLive".toLowerCase()).toContain("flow");
    expect([1, 2, 3].map((n) => n * 2)).toEqual([2, 4, 6]);
  });

  it("has a jsdom environment (DOM available)", () => {
    const el = document.createElement("div");
    el.textContent = "hello";
    expect(el.textContent).toBe("hello");
    expect(typeof window.localStorage.setItem).toBe("function");
  });
});
