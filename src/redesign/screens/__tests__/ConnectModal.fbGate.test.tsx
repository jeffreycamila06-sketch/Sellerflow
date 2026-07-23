// ConnectModal Facebook HONEST GATE (addendum 2026-07-23). The FB tab STAYS a
// visible sales hook, but selecting it shows the activation gate (no green-able
// connect) instead of the FB connect UI. After this change there must be NO
// reachable UI path in the redesign tree that calls doConnect/onConnect for
// Facebook. Proven here two ways: behaviorally (FB tab → gate, onConnect never
// fires, real Telegram anchor) + a source contract (the connect button lives in
// the non-FB branch; onConnect("Facebook") is unreachable dead code).
import { describe, it, expect, vi, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent } from "@testing-library/react";
import ConnectModal from "../ConnectModal";
import { TProvider } from "../../i18n";
import { TELEGRAM_URL } from "../../../lib/telegram";
import type { AccountUser } from "../../../accountDb";

beforeAll(() => { (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}; });

// Pro plan with a saved TikTok + saved Facebook account, so BOTH tabs would have
// had a working connect UI before the gate — the strongest test of "even with FB
// data, no FB connect is reachable".
const profile: AccountUser = {
  email: "seller@example.com",
  profile: { fullName: "S", storeName: "Shop", phone: "0912345678", tiktok: "my_tt", facebook: "my_fb_page", adminContactNote: "" },
  plan: "pro", planStatus: "active", planExpiry: "2027-01-01", connectedAccounts: [],
};
const renderModal = (over: { initialTab?: "TikTok" | "Facebook"; onConnect?: (p: string, d: Record<string, string>) => Promise<{ ok: boolean }>; onClose?: () => void } = {}) => {
  const onConnect = over.onConnect ?? vi.fn(async () => ({ ok: true }));
  const onClose = over.onClose ?? vi.fn();
  render(
    <TProvider lang="en">
      <ConnectModal profile={profile} initialTab={over.initialTab ?? "TikTok"} onClose={onClose} onConnect={onConnect as never} />
    </TProvider>,
  );
  return { onConnect, onClose };
};

describe("ConnectModal — Facebook tab is a gated sales hook", () => {
  it("FB tab is still rendered and selectable (sales hook remains visible)", () => {
    renderModal({ initialTab: "TikTok" });
    const fbTab = screen.getByRole("button", { name: "Facebook" });
    expect(fbTab).toBeTruthy();
    fireEvent.click(fbTab); // selecting it must not throw / must switch content
    expect(screen.getByText("Advanced feature — activation required")).toBeTruthy();
  });

  it("selecting Facebook shows the gate + Contact anchor, NOT a connect button", () => {
    renderModal({ initialTab: "Facebook" });
    expect(screen.getByText("Advanced feature — activation required")).toBeTruthy();
    // No connect button for FB (label would be "Connect Facebook"); no FB inputs.
    expect(screen.queryByText("Connect Facebook")).toBeNull();
    expect(screen.queryByText(/Access Token|Live Video/i)).toBeNull();
    const link = screen.getByText("Contact us").closest("a") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(TELEGRAM_URL);
    expect(link.getAttribute("target")).toBe("_blank");
    const rel = link.getAttribute("rel") || "";
    expect(rel).toContain("noreferrer");
    expect(rel).toContain("noopener");
  });

  it("no interaction on the FB tab ever calls onConnect; the anchor closes the modal", () => {
    const onConnect = vi.fn(async () => ({ ok: true }));
    const onClose = vi.fn();
    renderModal({ initialTab: "Facebook", onConnect, onClose });
    // Click everything clickable in the gated FB view.
    screen.getAllByRole("button").forEach((b) => fireEvent.click(b));
    fireEvent.click(screen.getByText("Contact us"));
    expect(onConnect).not.toHaveBeenCalled();     // NO FB connect path reachable
    expect(onClose).toHaveBeenCalled();           // Contact anchor closes the modal
  });

  it("the TikTok tab still has its connect button (TikTok path unchanged)", () => {
    renderModal({ initialTab: "TikTok" });
    expect(screen.getByText("Connect TikTok")).toBeTruthy();
  });
});

describe("ConnectModal — source contract: FB connect is unwired (not deleted)", () => {
  const src = readFileSync(join(__dirname, "../ConnectModal.tsx"), "utf-8");
  it("the connect button is in the NON-Facebook branch; onConnect(Facebook) is unreachable dead code", () => {
    // The gate ternary exists and the connect button sits AFTER the FB gate
    // branch (i.e. in the else) — so it never renders for tab==='Facebook'.
    const gateIdx = src.indexOf('tab === "Facebook" ? (');
    const btnIdx = src.indexOf("void connect()");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(btnIdx).toBeGreaterThan(gateIdx); // button after the gate → in the else
    // The FB connect action still EXISTS in connect() (not deleted, per constraint)
    // but is only reached from the gated button.
    expect(src).toMatch(/onConnect\("Facebook",/);
    // No FB input fields remain (nothing to type an FB id/token into).
    expect(src).not.toMatch(/rd_cm_fb_id|rd_cm_access_token|rd_cm_add_fb/);
  });
});
