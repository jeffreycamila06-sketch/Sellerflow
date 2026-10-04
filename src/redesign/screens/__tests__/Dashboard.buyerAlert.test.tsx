// BUYER ALERT on the Dashboard comment rows + the sheet. FAKE DATA ONLY.
//   • no map (every non-gated seller) → rows render with no alert markup at all;
//   • red row: tint + "⚠ N returns" chip; amber row: tint + "📦 N days left" + the one line;
//   • no copy button, no banner/toast;
//   • the name opens the sheet; Forgive / Undo call through.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { render, fireEvent } from "@testing-library/react";
import { TProvider } from "../../i18n";

vi.mock("../../adapters/useRaffleConfig", () => ({
  useRaffleConfig: () => ({ enabled: false, enabledAt: null, loading: false, toggle: vi.fn() }),
}));
beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });

import Dashboard from "../Dashboard";
import BuyerAlertSheet from "../../components/BuyerAlertSheet";
import type { Comment } from "../../data";
import type { BuyerAlertView, BuyerRecord } from "../../adapters/buyerAlert";

const comment = (name: string, handle: string): Comment =>
  ({ id: `c-${name}`, name, handle, text: "mine", mine: true, time: "9:41:00 PM", platform: "TikTok" });
const noop = () => {};
const props = (comments: Comment[]) => ({
  comments, cur: "NT$", historyReady: true,
  ttOpen: false, fbOpen: false, ttIdx: 0, fbIdx: 0,
  onToggleTT: noop, onToggleFB: noop, onPickTT: noop, onPickFB: noop,
  ttConnected: true, fbConnected: false, ttConnecting: false, fbConnecting: false,
  onConnectTT: noop, onConnectFB: noop,
  printed: {}, entId: null, entPrice: "",
  onOneClick: noop, onOpenEnt: noop, onEntPrice: noop, onEntKey: noop,
});
const FEED = [comment("Red Buyer", "@Red_Buyer"), comment("Amber Buyer", "amber.buyer"), comment("Clean", "@clean"), comment("Nobody", "@nobody")];
const VIEWS = new Map<string, BuyerAlertView>([
  ["red_buyer", { returns: 4, red: true, near: null }],
  ["amber.buyer", { returns: 1, red: false, near: { days: 2, store: "大安門市" } }],
  ["clean", { returns: 0, red: false, near: null }],
]);
const rows = (c: HTMLElement) => [...c.querySelectorAll(".sfl-comm-row")] as HTMLElement[];

describe("non-gated seller (no map) — zero change", () => {
  it("renders no alert markup and an untappable plain name", () => {
    const { container } = render(<TProvider lang="en"><Dashboard {...props(FEED)} /></TProvider>);
    expect(container.querySelector("[data-buyer-alert]")).toBeNull();
    expect(container.querySelector("[data-testid^='ba-']")).toBeNull();
    expect(container.innerHTML).not.toContain("warn-soft");
  });
  it("rows are byte-identical with and without the prop absent vs undefined", () => {
    const a = render(<TProvider lang="en"><Dashboard {...props(FEED)} /></TProvider>).container.innerHTML;
    const b = render(<TProvider lang="en"><Dashboard {...props(FEED)} buyerAlerts={undefined} onBuyerTap={undefined} /></TProvider>).container.innerHTML;
    expect(a).toBe(b);
  });
});

describe("gated seller — red / amber rows", () => {
  const onTap = vi.fn();
  const mount = () => render(<TProvider lang="en"><Dashboard {...props(FEED)} buyerAlerts={VIEWS} onBuyerTap={onTap} /></TProvider>).container;

  it("red: danger-soft tint + inset red bar + '⚠ 4 returns' chip", () => {
    const r = rows(mount())[0];
    expect(r.getAttribute("data-buyer-alert")).toBe("red");
    expect(r.style.background).toBe("var(--danger-soft)");
    expect(r.style.boxShadow).toContain("var(--risk-risky-bg)");
    expect(r.querySelector("[data-testid='ba-chip-red']")!.textContent).toBe("⚠ 4 returns");
    expect(r.querySelector("[data-testid='ba-near-line']")).toBeNull();
  });
  it("amber: warn-soft tint + inset amber bar + '📦 2 days left' + the one line", () => {
    const r = rows(mount())[1];
    expect(r.getAttribute("data-buyer-alert")).toBe("amber");
    expect(r.style.background).toBe("var(--warn-soft)");
    expect(r.style.boxShadow).toContain("var(--risk-watch-bg)");
    expect(r.querySelector("[data-testid='ba-chip-amber']")!.textContent).toBe("📦 2 days left");
    expect(r.querySelector("[data-testid='ba-near-line']")!.textContent).toBe("May parcel sa 7-11 大安門市 — 2 days na lang bago ma-return");
  });
  it("matched but under thresholds → no tint/chip; unmatched handle → nothing, plain name", () => {
    const [, , clean, nobody] = rows(mount());
    expect(clean.getAttribute("data-buyer-alert")).toBe("none");
    expect(clean.querySelector("[data-testid^='ba-chip']")).toBeNull();
    expect(nobody.getAttribute("data-buyer-alert")).toBeNull();
    expect(nobody.querySelector("[data-testid='ba-name']")).toBeNull();
  });
  it("no copy button, no banner: only chips + the one amber line are added", () => {
    const c = mount();
    expect(c.textContent).not.toMatch(/copy/i);
    expect(c.querySelectorAll("[data-testid^='ba-chip'], [data-testid='ba-near-line']")).toHaveLength(3); // red chip + amber chip + amber line
  });
  it("tapping the buyer name passes the normalised handle", () => {
    const r = rows(mount())[0];
    fireEvent.click(r.querySelector("[data-testid='ba-name']")!);
    expect(onTap).toHaveBeenCalledWith("red_buyer");
  });
});

describe("Dashboard never queries (map lookup only)", () => {
  it("Dashboard.tsx does not import supabase or call rpc/from", () => {
    const src = readFileSync("src/redesign/screens/Dashboard.tsx", "utf8");
    expect(src).not.toMatch(/supabase|\.rpc\(|\.from\(/);
  });
});

describe("BuyerAlertSheet", () => {
  const record: BuyerRecord = {
    returned: [
      { id: "p1", returnedAt: "2026-09-01T03:00:00+00:00", store: "大安門市", amount: 350, forgiven: false },
      { id: "p2", returnedAt: "2026-09-10T03:00:00+00:00", store: "信義門市", amount: 200, forgiven: true },
    ],
    near: [], atStore: 1, pickedUp: 5,
  };
  it("counts Returned (after forgive) / Nasa 7-11 / Nakuha (7 days); Forgive and Undo call through", () => {
    const onForgive = vi.fn().mockResolvedValue(true);
    const { getByTestId, getAllByTestId, getByText } = render(
      <TProvider lang="en"><BuyerAlertSheet handle="ann" record={record} overrides={{}} cur="NT$" onForgive={onForgive} onClose={noop} /></TProvider>);
    expect(getByTestId("ba-returned").textContent).toBe("1Returned");
    expect(getByTestId("ba-at-store").textContent).toBe("1Nasa 7-11");
    expect(getByTestId("ba-picked-up").textContent).toBe("5Nakuha (7 days)");
    expect(getAllByTestId("ba-return")).toHaveLength(2);
    expect(getByText("2026-09-01 · NT$350")).toBeTruthy();
    fireEvent.click(getByTestId("ba-forgive"));
    expect(onForgive).toHaveBeenCalledWith("p1", true);
    fireEvent.click(getByTestId("ba-undo"));
    expect(onForgive).toHaveBeenCalledWith("p2", false);
  });
  it("local overrides win: an undone server-forgiven return counts again", () => {
    const { getByTestId } = render(
      <TProvider lang="en"><BuyerAlertSheet handle="ann" record={record} overrides={{ p2: false }} cur="NT$" onForgive={vi.fn()} onClose={noop} /></TProvider>);
    expect(getByTestId("ba-returned").textContent).toBe("2Returned");
  });
  it("never shows phone numbers or recipient names (the record has none)", () => {
    const { container } = render(
      <TProvider lang="en"><BuyerAlertSheet handle="ann" record={record} overrides={{}} cur="NT$" onForgive={vi.fn()} onClose={noop} /></TProvider>);
    expect(container.ownerDocument.body.textContent).not.toMatch(/09\d{8}/);
  });
});
