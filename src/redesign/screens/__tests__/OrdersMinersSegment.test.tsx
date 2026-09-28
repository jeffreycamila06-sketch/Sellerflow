// The "Orders | Miners" segment lives in the Orders tab (Miners moved inside it).
// Orders and Miners each render the segment via their `topTabs` header slot, and
// Settings no longer has a Sales entry.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TProvider } from "../../i18n";
import Orders from "../Orders";
import Miners from "../Miners";
import SettingsHub from "../SettingsHub";
import type { UseMinersReport } from "../../adapters/minersReport";

const noop = () => {};
const seg = <div data-testid="seg">Orders | Miners</div>;

describe("Orders/Miners segment + Settings has no Sales", () => {
  it("Orders renders its topTabs slot (the segment) in the header", () => {
    render(<TProvider lang="en"><Orders onGoPrint={noop} cur="NT$" orders={[]} state="live" topTabs={seg} /></TProvider>);
    expect(screen.getByTestId("seg")).toBeTruthy();
  });

  it("Miners renders its topTabs slot (the segment) in the header, body unchanged", () => {
    const rep: UseMinersReport = { data: null, state: "loading", load: vi.fn(), reload: vi.fn() } as unknown as UseMinersReport;
    render(<TProvider lang="en"><Miners cur="NT$" rep={rep} topTabs={seg} /></TProvider>);
    expect(screen.getByTestId("seg")).toBeTruthy();
  });

  it("SettingsHub no longer shows a Sales tile", () => {
    render(<TProvider lang="en"><SettingsHub onGeneral={noop} onCustomers={noop} onAdmin={noop} onShipping={noop} onCustomerData={noop} onLegal={noop} onDelete={noop} onLogout={noop} isAdmin={false} /></TProvider>);
    expect(screen.queryByText("Sales Report")).toBeNull(); // the old Sales entry is gone from Settings
  });
});
