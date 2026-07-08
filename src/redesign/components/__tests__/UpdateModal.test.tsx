// UpdateModal — render + ✕ (only when not forced) + iOS-safe copy + the action
// rendered as a REAL anchor (target=_blank) whose href is the passed store link,
// with an onAction dismissal side-effect on tap.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import UpdateModal from "../UpdateModal";
import { TProvider } from "../../i18n";

const STORE = "https://apps.apple.com/app/id6783770354";
const renderModal = (over: { force?: boolean; messageKey?: string; href?: string; onDismiss?: () => void; onAction?: () => void } = {}) =>
  render(
    <TProvider lang="en">
      <UpdateModal
        messageKey={over.messageKey ?? "rd_upd_msg_ble"}
        force={over.force ?? false}
        href={over.href ?? STORE}
        onDismiss={over.onDismiss ?? (() => {})}
        onAction={over.onAction ?? (() => {})}
      />
    </TProvider>,
  );

describe("UpdateModal", () => {
  it("renders headline + message + an Update-now action button", () => {
    renderModal();
    expect(screen.getByText("Time for an update")).toBeTruthy();
    expect(screen.getByText(/Sticker printing and fixes/)).toBeTruthy();
    expect(screen.getByText("Update now")).toBeTruthy();
  });

  it("action is a real anchor opening the passed store link in a new tab", () => {
    renderModal({ href: STORE });
    const a = screen.getByTestId("update-action");
    expect(a.tagName).toBe("A");
    expect(a.getAttribute("href")).toBe(STORE);
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noreferrer");
  });

  it("tapping the action fires onAction (dismissal side-effect)", () => {
    const onAction = vi.fn();
    renderModal({ onAction });
    fireEvent.click(screen.getByTestId("update-action"));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("shows the ✕ when dismissible, hides it when force=true", () => {
    const { rerender } = renderModal({ force: false });
    expect(screen.queryByTestId("update-close")).not.toBeNull();
    rerender(
      <TProvider lang="en">
        <UpdateModal messageKey="rd_upd_msg_ble" force href={STORE} onDismiss={() => {}} onAction={() => {}} />
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
    for (const messageKey of ["rd_upd_msg_ble", "rd_upd_msg_generic"]) {
      const { unmount } = renderModal({ messageKey });
      const text = document.body.innerHTML.toLowerCase();
      for (const bad of ["price", "subscribe", "subscription", "$", "plan", "upgrade", "free", "pay"]) {
        expect(text.includes(bad)).toBe(false);
      }
      unmount();
    }
  });
});
