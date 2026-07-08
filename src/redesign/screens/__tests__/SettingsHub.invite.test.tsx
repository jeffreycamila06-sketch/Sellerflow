// Settings hub — the "Invite friends" share card is pinned to the TOP of the
// grid (first interactive element, above General Settings) and shows for every
// user regardless of admin state.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SettingsHub from "../SettingsHub";
import { TProvider } from "../../i18n";

const noop = () => {};
const renderHub = (isAdmin = false) =>
  render(
    <TProvider lang="en">
      <SettingsHub
        onGeneral={noop} onCustomers={noop} onAdmin={noop} onSales={noop}
        onShipping={noop} onCustomerData={noop} onLegal={noop} onDelete={noop}
        onLogout={noop} isAdmin={isAdmin}
      />
    </TProvider>,
  );

describe("SettingsHub — Invite friends card", () => {
  it("renders the invite card as the first item, above General Settings", () => {
    renderHub();
    const buttons = Array.from(document.querySelectorAll("button"));
    // first grid button is the invite card, not a settings tile
    expect(buttons[0].textContent).toContain("Invite friends");
    expect(screen.getByText("Invite friends")).toBeTruthy();
  });

  it("shows for non-admin users too (share is not gated)", () => {
    renderHub(false);
    expect(screen.getByText("Invite friends")).toBeTruthy();
  });
});
