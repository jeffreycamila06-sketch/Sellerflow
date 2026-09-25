// Rule 3 — Dashboard low-stock chips + PERSISTENT dismissible sold-out banner.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Dashboard from "../Dashboard";
import { TProvider } from "../../i18n";

beforeAll(() => { (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}; });

const noop = () => {};
const base = {
  comments: [], cur: "NT$",
  ttOpen: false, fbOpen: false, ttIdx: 0, fbIdx: 0,
  onToggleTT: noop, onToggleFB: noop, onPickTT: noop,
  ttConnected: false, fbConnected: false, ttConnecting: false, fbConnecting: false,
  onConnectTT: noop, onRefreshTT: noop, ttAccounts: [] as string[], fbAccounts: [] as string[],
  printed: {}, entId: null, entPrice: "", onOneClick: noop, onOpenEnt: noop, onEntPrice: noop, onEntKey: noop,
};
const renderDash = (over: Record<string, unknown> = {}) =>
  render(<TProvider lang="en"><Dashboard {...base} {...over} /></TProvider>);

describe("Dashboard — Rule 3 indicators", () => {
  it("no auto status → neither banner nor chips render", () => {
    renderDash();
    expect(screen.queryByText("Sold out")).toBeNull();
    expect(screen.queryByText("Low stock")).toBeNull();
  });

  it("sold-out codes → persistent banner with a dismiss per code", () => {
    const onDismissSoldOut = vi.fn();
    renderDash({ autoSoldOut: [{ code: "A1", productName: "Tee", stock: 0 }], onDismissSoldOut });
    expect(screen.getByText("Sold out")).toBeTruthy();
    expect(screen.getByText("A1")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(onDismissSoldOut).toHaveBeenCalledWith("A1");
  });

  it("low-stock codes → amber chips with '{code} · {n} left'", () => {
    renderDash({ autoLowStock: [{ code: "B2", productName: "Bag", stock: 3 }] });
    expect(screen.getByText("Low stock")).toBeTruthy();
    expect(screen.getByText("B2 · 3 left")).toBeTruthy();
  });
});

describe("Dashboard — Rule 1/2/3 per-row feed badge (display-only)", () => {
  const c = (id: string, over: Record<string, unknown> = {}) => ({ id, name: "Ann", handle: "@ann", text: "A1", mine: false, time: "1m", platform: "TikTok", ...over });
  it("autoBadges[id] renders the matching label next to the row (duplicate/soldout)", () => {
    renderDash({
      comments: [c("k1"), c("k2")],
      autoBadges: { k1: "duplicate", k2: "soldout" },
    });
    expect(screen.getByText("Duplicate")).toBeTruthy();
    // "Sold out" also appears as a banner label elsewhere, but with no autoSoldOut prop
    // here the only source is the k2 row badge.
    expect(screen.getByText("Sold out")).toBeTruthy();
    expect(screen.queryByText("Not enough stock")).toBeNull(); // no quantity → no "short" outcome
  });
  it("no badge for a row absent from the map", () => {
    renderDash({ comments: [c("k1")], autoBadges: {} });
    expect(screen.queryByText("Duplicate")).toBeNull();
  });
});
