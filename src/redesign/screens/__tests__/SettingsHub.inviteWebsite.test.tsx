// Settings hub after main's Seller Website merged into the invite branch: BOTH the Invite friends
// card (opens the Invite screen) and the Seller Website row show together, each opening its own screen.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SettingsHub from "../SettingsHub";
import { TProvider } from "../../i18n";

const noop = () => {};
const renderHub = (onInvite?: () => void, onWebsite?: () => void) =>
  render(
    <TProvider lang="en">
      <SettingsHub
        onGeneral={noop} onCustomers={noop} onAdmin={noop}
        onShipping={noop} onCustomerData={noop} onLegal={noop} onDelete={noop}
        onLogout={noop} onInvite={onInvite} onWebsite={onWebsite}
      />
    </TProvider>,
  );

describe("SettingsHub — Invite friends + Seller Website together", () => {
  it("shows both entries; each tap opens its own screen", () => {
    const onInvite = vi.fn();
    const onWebsite = vi.fn();
    renderHub(onInvite, onWebsite);
    const website = screen.getByTestId("tile-website");
    fireEvent.click(website);
    expect(onWebsite).toHaveBeenCalledTimes(1);
    expect(onInvite).not.toHaveBeenCalled();
    const buttons = Array.from(document.querySelectorAll("button"));
    expect(buttons[0].textContent).toContain("Invite friends");
    fireEvent.click(buttons[0]);
    expect(onInvite).toHaveBeenCalledTimes(1);
    expect(onWebsite).toHaveBeenCalledTimes(1);
  });

  it("Website off (no onWebsite) → only the Invite friends card", () => {
    renderHub(vi.fn(), undefined);
    expect(screen.queryByTestId("tile-website")).toBeNull();
    expect(screen.getByText("Invite friends")).toBeTruthy();
  });
});
