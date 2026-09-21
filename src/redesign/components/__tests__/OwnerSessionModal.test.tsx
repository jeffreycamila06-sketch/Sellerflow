// Owner "Start Session" modal (Session V2) — a single fixed 5-day start button in
// place of the 1–5 picker. Tapping Start = onStart (start_session(5)); ✕ = onCancel.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TProvider } from "../../i18n";
import OwnerSessionModal from "../OwnerSessionModal";

const renderModal = () => {
  const onStart = vi.fn(); const onCancel = vi.fn();
  render(<TProvider lang="en"><OwnerSessionModal onStart={onStart} onCancel={onCancel} /></TProvider>);
  return { onStart, onCancel };
};

describe("OwnerSessionModal", () => {
  it("shows a single 'Start 7-day session' button (no 1–5 day list)", () => {
    renderModal();
    expect(screen.getByTestId("owner-session-start").textContent).toBe("Start 7-day session");
    expect(screen.queryByTestId("session-pick-1")).toBeNull(); // NOT the picker
    expect(screen.queryByTestId("session-pick-5")).toBeNull();
  });
  it("Start → onStart; ✕ → onCancel (aborts connect, no session)", () => {
    const { onStart, onCancel } = renderModal();
    fireEvent.click(screen.getByTestId("owner-session-start"));
    expect(onStart).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("owner-session-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
