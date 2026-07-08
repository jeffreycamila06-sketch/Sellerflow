// UpdateModal — render + ✕ (only when not forced) + iOS-safe copy + the
// slide-to-update gesture (drag to threshold → onComplete; partial → snap back).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import UpdateModal from "../UpdateModal";
import { TProvider } from "../../i18n";

const renderModal = (over: { force?: boolean; messageKey?: string; onDismiss?: () => void; onComplete?: () => void } = {}) =>
  render(
    <TProvider lang="en">
      <UpdateModal
        messageKey={over.messageKey ?? "rd_upd_msg_ble"}
        force={over.force ?? false}
        onDismiss={over.onDismiss ?? (() => {})}
        onComplete={over.onComplete ?? (() => {})}
      />
    </TProvider>,
  );

afterEach(() => vi.restoreAllMocks());

// jsdom returns a zero-size rect; give the track a real width so slide math works.
function mockTrackWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width, height: 56, top: 0, left: 0, right: width, bottom: 56, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
}

describe("UpdateModal", () => {
  it("renders headline + message + slide label", () => {
    renderModal();
    expect(screen.getByText("Time for an update")).toBeTruthy();
    expect(screen.getByText(/Sticker printing and fixes/)).toBeTruthy();
    expect(screen.getByText("Slide to update")).toBeTruthy();
  });

  it("shows the ✕ when dismissible, hides it when force=true", () => {
    const { rerender } = renderModal({ force: false });
    expect(screen.queryByTestId("update-close")).not.toBeNull();
    rerender(
      <TProvider lang="en">
        <UpdateModal messageKey="rd_upd_msg_ble" force onDismiss={() => {}} onComplete={() => {}} />
      </TProvider>,
    );
    expect(screen.queryByTestId("update-close")).toBeNull();
  });

  it("✕ calls onDismiss", () => {
    const onDismiss = vi.fn();
    renderModal({ onDismiss });
    fireEvent.click(screen.getByTestId("update-close"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("copy stays iOS 3.1.1-safe (no pricing/subscription wording), both message keys", () => {
    const { unmount } = renderModal({ messageKey: "rd_upd_msg_ble" });
    let text = document.body.innerHTML.toLowerCase();
    for (const bad of ["price", "subscribe", "subscription", "$", "plan", "upgrade", "free", "pay"]) {
      expect(text.includes(bad)).toBe(false);
    }
    unmount();
    renderModal({ messageKey: "rd_upd_msg_generic" });
    text = document.body.innerHTML.toLowerCase();
    for (const bad of ["price", "subscribe", "subscription", "$", "plan", "upgrade", "free", "pay"]) {
      expect(text.includes(bad)).toBe(false);
    }
  });

  it("dragging the knob past the threshold fires onComplete", () => {
    mockTrackWidth(300); // maxTravel = 300 - 50 knob = 250
    const onComplete = vi.fn();
    renderModal({ onComplete });
    const knob = screen.getByTestId("update-knob");
    fireEvent.pointerDown(knob, { clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 245 }); // 245/250 = 0.98 ≥ 0.95
    fireEvent.pointerUp(window, { clientX: 245 });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("releasing before the threshold snaps back and does NOT fire onComplete", () => {
    mockTrackWidth(300);
    const onComplete = vi.fn();
    renderModal({ onComplete });
    const knob = screen.getByTestId("update-knob");
    fireEvent.pointerDown(knob, { clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 100 }); // 100/250 = 0.4
    fireEvent.pointerUp(window, { clientX: 100 });
    expect(onComplete).not.toHaveBeenCalled();
  });
});
