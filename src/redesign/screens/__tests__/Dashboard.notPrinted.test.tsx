// WEB print (laptop) — a row whose sticker didn't print shows a red "Not printed"
// badge + the one-tap Reprint (re-enqueues via the existing zero-write reprint).
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
const c = (id: string, over: Record<string, unknown> = {}) => ({ id, name: "Ann", handle: "@ann", text: "A1", mine: false, time: "1m", platform: "TikTok", ...over });

describe("Dashboard — web NOT-PRINTED badge + reprint", () => {
  it("notPrinted row → red 'Not printed' badge + Reprint that calls onReprint", () => {
    const onReprint = vi.fn();
    renderDash({ comments: [c("k1", { msgId: "m1" })], notPrinted: { k1: true }, onReprint });
    expect(screen.getByText("Not printed")).toBeTruthy();
    fireEvent.click(screen.getByText("Reprint"));
    expect(onReprint).toHaveBeenCalledWith("k1", "m1"); // re-enqueues the zero-write reprint
  });

  it("no notPrinted flag → no badge, no reprint on a plain comment row", () => {
    renderDash({ comments: [c("k1")], notPrinted: {} });
    expect(screen.queryByText("Not printed")).toBeNull();
    expect(screen.queryByText("Reprint")).toBeNull();
  });
});
