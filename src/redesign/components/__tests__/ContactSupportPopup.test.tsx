// ContactSupportPopup — neutral iOS popup: renders title + message, a Contact Support
// button linking to the Telegram SUPPORT CHAT (not a price page), and closes.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ContactSupportPopup from "../ContactSupportPopup";
import { TProvider } from "../../i18n";
import { TELEGRAM_URL } from "../../../lib/telegram";

const renderPopup = (onClose = () => {}) =>
  render(
    <TProvider lang="en">
      <ContactSupportPopup title="Plan inactive" message="Your plan is inactive. Please contact support." onClose={onClose} />
    </TProvider>,
  );

describe("ContactSupportPopup", () => {
  it("renders the neutral title + message (no price/upgrade wording)", () => {
    renderPopup();
    expect(screen.getByText("Plan inactive")).toBeTruthy();
    expect(screen.getByText(/Your plan is inactive/)).toBeTruthy();
    // no payment-tinged words
    expect(screen.queryByText(/upgrade/i)).toBeNull();
    expect(screen.queryByText(/NT\$/)).toBeNull();
  });

  it("Contact Support links to the Telegram support chat", () => {
    renderPopup();
    const link = screen.getByText("Contact Support").closest("a") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(TELEGRAM_URL);
  });

  it("clicking Contact Support and Close both fire onClose", () => {
    const onClose = vi.fn();
    renderPopup(onClose);
    fireEvent.click(screen.getByText("Contact Support"));
    fireEvent.click(screen.getByText("Maybe later"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
