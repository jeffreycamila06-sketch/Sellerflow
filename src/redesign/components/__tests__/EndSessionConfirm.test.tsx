// "End session?" confirm — only Confirm ends; Cancel closes with no effect.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TProvider } from "../../i18n";
import EndSessionConfirm from "../EndSessionConfirm";

const renderIt = () => {
  const onConfirm = vi.fn(); const onCancel = vi.fn();
  render(<TProvider lang="en"><EndSessionConfirm onConfirm={onConfirm} onCancel={onCancel} /></TProvider>);
  return { onConfirm, onCancel };
};

describe("EndSessionConfirm", () => {
  it("shows the title, the irreversible warning, and two buttons", () => {
    renderIt();
    expect(screen.getByText("End session?")).toBeTruthy();
    expect(screen.getByText("Your next session will restart at buyer #1. This can't be undone.")).toBeTruthy();
    expect(screen.getByTestId("end-session-cancel").textContent).toBe("Cancel");
    expect(screen.getByTestId("end-session-go").textContent).toBe("End session");
  });
  it("Confirm → onConfirm; Cancel → onCancel (no end)", () => {
    const { onConfirm, onCancel } = renderIt();
    fireEvent.click(screen.getByTestId("end-session-go"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("end-session-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
