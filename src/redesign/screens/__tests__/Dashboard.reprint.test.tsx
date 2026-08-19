// REPRINT button UI (FLive-parity, 2026-07-12) — ONE clean green button for
// every already-ordered comment, replacing BOTH old chips ("Ordered ✓" on
// restored rows, "🖨 Printed" on rows ordered this session). A tap fires
// onReprint(id, msgId) ONCE — never the order handlers — and a ~2s per-row
// cooldown swallows double-taps. E1 stays intact: an unresolved history row
// still shows nothing tappable.
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { TProvider } from "../../i18n";

vi.mock("../../adapters/useRaffleConfig", () => ({
  useRaffleConfig: () => ({ enabled: false, enabledAt: null, loading: false, toggle: vi.fn() }),
}));
beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });
afterEach(() => { vi.useRealTimers(); });

import Dashboard from "../Dashboard";
import type { Comment } from "../../data";

const comment = (handle: string, id = handle, over: Partial<Comment> = {}): Comment =>
  ({ id, name: handle, handle: `@${handle}`, text: "mine", mine: true, time: "9:41:00 PM", platform: "TikTok", ...over });
const hist = (handle: string, id = handle, over: Partial<Comment> = {}): Comment =>
  comment(handle, id, { restored: true, msgId: `m-${id}`, ...over });

const noop = () => {};
const baseProps = {
  comments: [] as Comment[], cur: "NT$", historyReady: true,
  ttOpen: false, fbOpen: false, ttIdx: 0, fbIdx: 0,
  onToggleTT: noop, onToggleFB: noop, onPickTT: noop, onPickFB: noop,
  ttConnected: false, fbConnected: false, ttConnecting: false, fbConnecting: false,
  onConnectTT: noop, onConnectFB: noop,
  printed: {} as Record<string, string>, entId: null, entPrice: "",
  onOneClick: noop, onOpenEnt: noop, onEntPrice: noop, onEntKey: noop,
};
const renderDash = (over: Partial<typeof baseProps> & Record<string, unknown> = {}) =>
  render(<TProvider lang="en"><Dashboard {...baseProps} {...over} /></TProvider>);
const reprintButton = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Reprint") || b.textContent?.includes("Printing"));

describe("Reprint button — placement (both ordered states, one clean button)", () => {
  it("restored + ordered row → Reprint button; tap fires onReprint(id, msgId) once; order handlers NEVER fire", () => {
    const onReprint = vi.fn(); const onOneClick = vi.fn(); const onOpenEnt = vi.fn();
    const { container } = renderDash({ comments: [hist("buyer1", "c-h", { ordered: true })], onReprint, onOneClick, onOpenEnt });
    const btn = reprintButton(container)!;
    expect(btn).toBeDefined();
    fireEvent.click(btn);
    expect(onReprint).toHaveBeenCalledTimes(1);
    expect(onReprint).toHaveBeenCalledWith("c-h", "m-c-h");           // id + msgId → RedesignApp resolves the original order
    expect(onOneClick).not.toHaveBeenCalled();                        // ZERO order-path calls
    expect(onOpenEnt).not.toHaveBeenCalled();
  });

  it("live row ordered this session (printed map) → Reprint button REPLACES the '🖨 Printed' chip", () => {
    const onReprint = vi.fn();
    const { container } = renderDash({ comments: [comment("buyer2", "c-live")], printed: { "c-live": "NT$150" }, onReprint });
    const row = container.querySelector(".sfl-comm-row")!;
    expect(row.textContent).not.toContain("Printed");                 // old chip gone (FLive style: button only)
    expect(row.textContent).not.toContain("NT$150");
    const btn = reprintButton(container)!;
    fireEvent.click(btn);
    expect(onReprint).toHaveBeenCalledWith("c-live", undefined);      // live rows may have no msgId — RedesignApp's in-session map covers them
  });

  it("unordered rows show NO Reprint button (live actions / E1-gated history unchanged)", () => {
    const { container } = renderDash({ comments: [comment("b", "c1"), hist("h", "c2")], historyReady: false });
    expect(reprintButton(container)).toBeUndefined();
  });
});

describe("double-tap guard", () => {
  it("second tap within the cooldown is IGNORED; the button shows 'Printing…' then recovers", () => {
    vi.useFakeTimers();
    const onReprint = vi.fn();
    const { container } = renderDash({ comments: [hist("buyer1", "c-h", { ordered: true })], onReprint });
    const btn = reprintButton(container)!;
    fireEvent.click(btn);
    expect(btn.textContent).toContain("Printing");                    // busy state
    fireEvent.click(btn);                                             // frantic double-tap
    fireEvent.click(btn);
    expect(onReprint).toHaveBeenCalledTimes(1);                       // swallowed
    act(() => { vi.advanceTimersByTime(2100); });
    expect(reprintButton(container)!.textContent).toContain("Reprint"); // recovered
    fireEvent.click(reprintButton(container)!);
    expect(onReprint).toHaveBeenCalledTimes(2);                       // deliberate second copy still possible
  });
});
