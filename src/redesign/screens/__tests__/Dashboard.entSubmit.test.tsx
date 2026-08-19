// iPhone Enterprise-print fix (2026-07-13) — the in-app ✓ submit contract.
// The iOS number pad has NO return key: Enter can never be delivered on
// iPhone, so the typed-price order needs a visible in-app ✓ (the keyboard's
// own ✓ is a bare dismiss/blur — and blur-as-print would GHOST-PRINT when a
// fast feed pushes the row past the render cap and unmounts the input).
// Pinned here (Dashboard layer):
//   • the ✓ renders inside the price chip while the flow is open, ≥34px
//     thumb hitbox, and fires onEntSubmit on POINTERDOWN (before any blur —
//     no focus race) exactly once per tap (no onClick double-fire);
//   • Enter still routes through onEntKey (desktop/Android/iPad unchanged);
//   • blur = NO submit, NO field clear (deliberately no onBlur handler);
//   • row unmount (render-cap push-out) = NO submit — ghost-print protection.
// The submit-side guards (double-tap dedup, price>0 validation) live in
// RedesignApp.submitEnt — pinned by the entSubmit source-contract below.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TProvider } from "../../i18n";

vi.mock("../../adapters/useRaffleConfig", () => ({
  useRaffleConfig: () => ({ enabled: false, enabledAt: null, loading: false, toggle: vi.fn() }),
}));
beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });

import Dashboard from "../Dashboard";
import type { Comment } from "../../data";

const comment = (id: string): Comment =>
  ({ id, name: "Marie", handle: "@marieobor", text: "mine", mine: true, time: "1:24:49 PM", platform: "TikTok" });

const noop = () => {};
const baseProps = {
  comments: [comment("c1")], cur: "NT$", historyReady: true,
  ttOpen: false, fbOpen: false, ttIdx: 0, fbIdx: 0,
  onToggleTT: noop, onToggleFB: noop, onPickTT: noop, onPickFB: noop,
  ttConnected: false, fbConnected: false, ttConnecting: false, fbConnecting: false,
  onConnectTT: noop, onConnectFB: noop,
  printed: {} as Record<string, string>, entId: "c1", entPrice: "150",
  onOneClick: noop, onOpenEnt: noop, onEntPrice: noop, onEntKey: noop,
};
const renderDash = (over: Partial<typeof baseProps> & Record<string, unknown> = {}) =>
  render(<TProvider lang="en"><Dashboard {...baseProps} {...over} /></TProvider>);
const tick = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "✓");

describe("the in-app ✓ (iPhone typed-price path)", () => {
  it("renders inside the open price chip with a ≥34px thumb hitbox; POINTERDOWN fires onEntSubmit once", () => {
    const onEntSubmit = vi.fn();
    const { container } = renderDash({ onEntSubmit });
    const btn = tick(container)!;
    expect(btn).toBeDefined();
    expect(parseInt(btn.style.minWidth)).toBeGreaterThanOrEqual(34);   // thumb hitbox habang live
    expect(parseInt(btn.style.height)).toBeGreaterThanOrEqual(34);
    fireEvent.pointerDown(btn);
    fireEvent.click(btn);                                              // the tap's click phase must NOT double-fire
    expect(onEntSubmit).toHaveBeenCalledTimes(1);                      // pointerdown-only binding
  });

  it("pointerdown prevents default — the tap can never lose a race to input blur (focus stays)", () => {
    const onEntSubmit = vi.fn();
    const { container } = renderDash({ onEntSubmit });
    const btn = tick(container)!;
    const e = fireEvent.pointerDown(btn);                              // fireEvent returns !defaultPrevented
    expect(e).toBe(false);                                             // preventDefault() was called
    expect(onEntSubmit).toHaveBeenCalledTimes(1);
  });

  it("Enter still routes through onEntKey (desktop/Android/iPad path unchanged)", () => {
    const onEntKey = vi.fn(); const onEntSubmit = vi.fn();
    const { container } = renderDash({ onEntKey, onEntSubmit });
    const input = container.querySelector(".sfl-comm-row input") as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onEntKey).toHaveBeenCalledTimes(1);                         // same wiring as before
    expect(onEntSubmit).not.toHaveBeenCalled();                        // ✓ untouched by the keyboard
  });

  it("BLUR = no submit, no clear — the iOS keyboard-dismiss ✓ must do NOTHING (deliberately no onBlur)", () => {
    const onEntSubmit = vi.fn(); const onEntPrice = vi.fn(); const onEntKey = vi.fn();
    const { container } = renderDash({ onEntSubmit, onEntPrice, onEntKey });
    const input = container.querySelector(".sfl-comm-row input") as HTMLInputElement;
    fireEvent.blur(input);                                             // keyboard dismiss / tap elsewhere
    expect(onEntSubmit).not.toHaveBeenCalled();                        // no ghost print
    expect(onEntKey).not.toHaveBeenCalled();
    expect(onEntPrice).not.toHaveBeenCalled();                         // typed price untouched
    expect(input.value).toBe("150");                                   // field keeps its value
  });

  it("row UNMOUNT (render-cap push-out sa mabilis na feed) = no submit — ghost-print protection", () => {
    const onEntSubmit = vi.fn();
    const { unmount } = renderDash({ onEntSubmit });
    unmount();                                                         // input unmounts mid-typing
    expect(onEntSubmit).not.toHaveBeenCalled();
  });
});

// The submit-side guards live in RedesignApp.submitEnt — a unit render can't
// reach them (full-app harness), so this pins the SOURCE CONTRACT (iosGates
// pattern): sync double-tap dedup marked BEFORE the create, price>0 required,
// and both triggers (Enter + ✓) share the ONE submitEnt path.
describe("submitEnt source contract (RedesignApp — money-path guards)", () => {
  const src = readFileSync(resolve(__dirname, "../../RedesignApp.tsx"), "utf8");
  it("double-tap guard: entSubmittedRef checked AND marked synchronously before createOrder", () => {
    expect(src).toMatch(/entSubmittedRef\.current\.has\(id\) \|\| printed\[id\]\) return;/);
    const guardIdx = src.indexOf("entSubmittedRef.current.add(id)");
    const createIdx = src.indexOf("orders.createOrder(prod, price)", src.indexOf("const submitEnt"));
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(createIdx);                          // marked BEFORE the create — same-batch taps blocked
  });
  it("validation: price <= 0 returns before any create (empty/zero/invalid = walang order)", () => {
    expect(src).toMatch(/if \(price <= 0\) return;/);
  });
  it("ONE code path: onEntKey delegates to submitEnt; the Dashboard ✓ receives the same function", () => {
    expect(src).toMatch(/if \(e\.key !== "Enter"\) return;\s*\n\s*e\.preventDefault\(\);\s*\n\s*submitEnt\(\);/);
    expect(src).toMatch(/onEntSubmit=\{submitEnt\}/);
  });
});
