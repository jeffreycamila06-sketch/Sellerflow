// Build 12 (Fix A): right after the app opens, the Facebook manage screen used to show the old
// "Facebook page 1" boxes for a moment, until the feature switches had loaded (found by the
// smoke robot). While the switches load, the Facebook side now shows only a loading line.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import ManageChannels from "../ManageChannels";
import { TProvider } from "../../i18n";
import type { AccountUser } from "../../../accountDb";

const acct: AccountUser = {
  authUserId: "u", email: "g@x.com",
  profile: { fullName: "O", storeName: "S", phone: "", tiktok: "saved_tt", facebook: "", adminContactNote: "" },
  plan: "pro", planStatus: "active", planExpiry: "", connectedAccounts: [], role: "seller",
};
type Opts = { fbPagesEnabled?: boolean; fbActivationOnly?: boolean; fbSwitchesLoading?: boolean };
const view = (platform: "tiktok" | "facebook", o: Opts = {}) =>
  render(<TProvider lang="en"><ManageChannels platform={platform} account={acct} onBack={() => {}}
    onSaveChannels={async () => ({ ok: true })} onFbPages={() => {}} {...o} /></TProvider>);
const BOXES = "Facebook page 1";
const PAGES_BUTTON = "Manage Facebook pages";

describe("Facebook manage screen while the switches load", () => {
  it("switches still loading → only the loading line: no name boxes, no notice, no Pages button", () => {
    const { container } = view("facebook", { fbSwitchesLoading: true, fbPagesEnabled: true });
    expect(screen.getByTestId("mc-fb-loading").textContent).toBe("Loading…");
    expect(screen.queryByText(BOXES)).toBeNull();
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(screen.queryByTestId("mc-fb-activation")).toBeNull();
    expect(screen.queryByText(PAGES_BUTTON)).toBeNull();
  });

  it("loaded with Facebook Pages on → the Manage Facebook pages button only, no boxes", () => {
    const { container } = view("facebook", { fbSwitchesLoading: false, fbPagesEnabled: true });
    expect(screen.getByText(PAGES_BUTTON)).toBeTruthy();
    expect(screen.queryByText(BOXES)).toBeNull();
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(screen.queryByTestId("mc-fb-loading")).toBeNull();
  });

  it("loaded, Facebook not open + fb_polish_v2 on → the activation notice (unchanged)", () => {
    view("facebook", { fbSwitchesLoading: false, fbActivationOnly: true });
    expect(screen.getByTestId("mc-fb-activation")).toBeTruthy();
    expect(screen.queryByText(BOXES)).toBeNull();
  });

  it("loaded, switch off → today's name boxes (unchanged)", () => {
    view("facebook", { fbSwitchesLoading: false });
    expect(screen.getByText(BOXES)).toBeTruthy();
    expect(screen.queryByTestId("mc-fb-loading")).toBeNull();
  });

  it("TikTok side: byte-identical render whether the switches are loading or not", () => {
    const before = view("tiktok").container.innerHTML;
    const loading = view("tiktok", { fbSwitchesLoading: true }).container.innerHTML;
    expect(loading).toBe(before);
    expect(before).not.toContain("mc-fb-loading");
  });

  it("the app passes 'still loading' from the switch read (switchesLoaded)", () => {
    const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(src).toContain("const featureSwReady = switchesLoaded(featureSw);");
    expect(src).toContain("fbSwitchesLoading={!featureSwReady}");
  });
});
