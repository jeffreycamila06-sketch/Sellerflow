// Sub-step 5 — the picker's immutability confirmation for 2/3/4-day sessions.
// 1-day is BYTE-UNCHANGED (immediate onPick). 2/3/4 show a confirm step; only
// Confirm calls onPick (→ start_session). Back returns to the list, no session.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TProvider } from "../../i18n";
import SessionPickerModal from "../SessionPickerModal";

const renderModal = () => {
  const onPick = vi.fn(); const onCancel = vi.fn();
  render(<TProvider lang="en"><SessionPickerModal onPick={onPick} onCancel={onCancel} /></TProvider>);
  return { onPick, onCancel };
};

describe("SessionPickerModal — 2/3/4-day confirmation", () => {
  it("1-day → onPick(1) immediately, NO confirmation (byte-unchanged path)", () => {
    const { onPick } = renderModal();
    fireEvent.click(screen.getByTestId("session-pick-1"));
    expect(onPick).toHaveBeenCalledWith(1);
    expect(screen.queryByTestId("session-confirm")).toBeNull();
  });

  it.each([2, 3, 4])("%i-day → shows the confirm step; onPick NOT called yet", (n) => {
    const { onPick } = renderModal();
    fireEvent.click(screen.getByTestId(`session-pick-${n}`));
    expect(screen.getByTestId("session-confirm")).toBeTruthy();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("confirm Back → returns to the length list, no session started", () => {
    const { onPick } = renderModal();
    fireEvent.click(screen.getByTestId("session-pick-3"));
    fireEvent.click(screen.getByTestId("session-confirm-back"));
    expect(screen.getByTestId("session-pick-1")).toBeTruthy();      // list is back
    expect(screen.queryByTestId("session-confirm")).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("confirm Confirm → onPick(N) (only now does the session start)", () => {
    const { onPick } = renderModal();
    fireEvent.click(screen.getByTestId("session-pick-4"));
    fireEvent.click(screen.getByTestId("session-confirm-go"));
    expect(onPick).toHaveBeenCalledWith(4);
  });

  it("✕ aborts from the list (no pick, no session)", () => {
    const { onPick, onCancel } = renderModal();
    fireEvent.click(screen.getByTestId("session-picker-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });
});
