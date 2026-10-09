// Build 13 — Connect button tap feedback. Before the connect itself starts the app first
// checks the session (a silent pause → sellers tapped again). A Connect tap now shows a
// spinner + "Connecting…" at once and the button stays disabled until the tapped call
// settles, the menu closes, or 30 s pass. Look only: the same callbacks are called exactly
// as before (once per tap; Disconnect unchanged).
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, fireEvent, screen, within, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { TProvider } from "../../i18n";
import { CONNECT_TAP_FALLBACK_MS } from "../Dashboard";

vi.mock("../../adapters/useRaffleConfig", () => ({
  useRaffleConfig: () => ({ enabled: false, enabledAt: null, loading: false, toggle: vi.fn(), toggleErrors: 0 }),
}));
beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });
afterEach(() => { vi.useRealTimers(); });

import Dashboard from "../Dashboard";

const noop = () => {};
type Handler = () => void | Promise<unknown>;
const baseProps = {
  comments: [] as never[], cur: "NT$",
  ttOpen: false, fbOpen: false, ttIdx: 0, fbIdx: 0,
  onToggleTT: noop, onToggleFB: noop, onPickTT: noop, onManageTT: noop, onPickFB: noop, onManageFB: noop,
  ttConnected: false, fbConnected: false, ttConnecting: false, fbConnecting: false,
  onConnectTT: noop as Handler, onConnectFB: noop as Handler, onRefreshTT: noop,
  ttAccounts: ["shop_a"], fbAccounts: [] as string[],
  printed: {}, entId: null, entPrice: "",
  onOneClick: noop, onOpenEnt: noop, onEntPrice: noop, onEntKey: noop,
};
type P = Partial<typeof baseProps> & Record<string, unknown>;
const ui = (over: P = {}) => <TProvider lang="en"><Dashboard {...baseProps} {...over} /></TProvider>;
const fbOn = { fbConnectEnabled: true, fbPages: [{ pageId: "p1", name: "Page One", username: "one" }], fbPageIdx: 0 };

function deferred() {
  let resolve!: () => void; let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
// The Connect button of the open TikTok / Facebook dropdown (footer, last button).
const connectBtn = (): HTMLButtonElement => {
  const b = screen.getAllByRole("button").find((x) => /^(Connect|Connecting…|Disconnect)$/.test(x.textContent || ""));
  if (!b) throw new Error("no Connect button");
  return b as HTMLButtonElement;
};
const isBusy = (b: HTMLButtonElement) => b.disabled && b.textContent === "Connecting…" && !!b.querySelector('[data-testid="conn-spin"]');
const isNormal = (b: HTMLButtonElement) => !b.disabled && b.textContent === "Connect" && !b.querySelector('[data-testid="conn-spin"]');

describe.each([
  ["TikTok", (on: Handler) => ({ ttOpen: true, onConnectTT: on })],
  ["Facebook", (on: Handler) => ({ fbOpen: true, onConnectFB: on, ...fbOn })],
])("%s dropdown Connect", (_name, open) => {
  it("tap → spinner + \"Connecting…\" + disabled at once; a second tap does nothing", () => {
    const d = deferred(); const on = vi.fn(() => d.promise);
    render(ui(open(on)));
    expect(isNormal(connectBtn())).toBe(true);
    fireEvent.click(connectBtn());
    expect(isBusy(connectBtn())).toBe(true);
    fireEvent.click(connectBtn());                                   // disabled → ignored
    expect(on).toHaveBeenCalledTimes(1);
  });

  it("error (the call settles, nothing connected) → back to \"Connect\"", async () => {
    const d = deferred(); const on = vi.fn(() => d.promise);
    render(ui(open(on)));
    fireEvent.click(connectBtn());
    await act(async () => { d.resolve(); await d.promise; });
    expect(isNormal(connectBtn())).toBe(true);
  });

  it("a dialog opens instead (switch confirm / session-length picker / owner Start) → back to \"Connect\"", async () => {
    // The app's handler returns as soon as it opened the dialog; the dropdown may stay open.
    const d = deferred(); const on = vi.fn(() => d.promise);
    render(ui(open(on)));
    fireEvent.click(connectBtn());
    expect(isBusy(connectBtn())).toBe(true);
    await act(async () => { d.resolve(); await d.promise; });
    expect(isNormal(connectBtn())).toBe(true);
  });

  it("30 s with no answer → back to \"Connect\" (never stuck)", () => {
    vi.useFakeTimers();
    const on = vi.fn(() => new Promise<void>(() => {}));            // never settles
    render(ui(open(on)));
    fireEvent.click(connectBtn());
    act(() => { vi.advanceTimersByTime(CONNECT_TAP_FALLBACK_MS - 1); });
    expect(isBusy(connectBtn())).toBe(true);
    act(() => { vi.advanceTimersByTime(1); });
    expect(isNormal(connectBtn())).toBe(true);
    expect(CONNECT_TAP_FALLBACK_MS).toBe(30_000);
  });

  it("a handler that returns nothing (popup / screen opened at once) → never stuck", () => {
    const on = vi.fn(() => undefined);
    render(ui(open(on)));
    fireEvent.click(connectBtn());
    expect(isNormal(connectBtn())).toBe(true);
    expect(on).toHaveBeenCalledTimes(1);
  });

  it("a failing call still fails visibly (the error is passed on) and the button returns", async () => {
    const d = deferred(); const on = vi.fn(() => d.promise);
    const seen: unknown[] = [];
    const onUnhandled = (e: PromiseRejectionEvent | unknown) => { seen.push(e); };
    process.on("unhandledRejection", onUnhandled);
    render(ui(open(on)));
    fireEvent.click(connectBtn());
    await act(async () => { d.reject(new Error("boom")); await d.promise.catch(() => null); await new Promise((r) => setTimeout(r, 0)); });
    process.off("unhandledRejection", onUnhandled);
    expect(isNormal(connectBtn())).toBe(true);
    expect(seen.length).toBe(1);
  });
});

describe("handover to the app's own connecting state, success, close", () => {
  it("success: the connect starts (app flag on) → still Connecting; connected + dropdown closes; reopened = normal", async () => {
    const d = deferred(); const onConnectTT = vi.fn(() => d.promise);
    const r = render(ui({ ttOpen: true, onConnectTT }));
    fireEvent.click(connectBtn());
    r.rerender(ui({ ttOpen: true, onConnectTT, ttConnecting: true }));  // the connect itself started
    await act(async () => { d.resolve(); await d.promise; });            // the app's call returned
    expect(isBusy(connectBtn())).toBe(true);                            // flag keeps "Connecting…"
    r.rerender(ui({ ttOpen: false, onConnectTT, ttConnected: true }));  // connected → dropdown closes (as today)
    expect(screen.queryByText("Connecting…")).toBeNull();
    r.rerender(ui({ ttOpen: true, onConnectTT, ttConnected: true }));
    expect(connectBtn().textContent).toBe("Disconnect");
    expect(connectBtn().querySelector('[data-testid="conn-spin"]')).toBeNull();
  });

  it("the seller closes the dropdown while it waits → reopened shows a normal \"Connect\"", () => {
    const onConnectTT = vi.fn(() => new Promise<void>(() => {}));
    const r = render(ui({ ttOpen: true, onConnectTT }));
    fireEvent.click(connectBtn());
    expect(isBusy(connectBtn())).toBe(true);
    r.rerender(ui({ ttOpen: false, onConnectTT }));
    r.rerender(ui({ ttOpen: true, onConnectTT }));
    expect(isNormal(connectBtn())).toBe(true);
  });

  it("Disconnect (connected) is unchanged: called once, no spinner", () => {
    const onConnectTT = vi.fn();
    render(ui({ ttOpen: true, onConnectTT, ttConnected: true }));
    fireEvent.click(connectBtn());
    expect(onConnectTT).toHaveBeenCalledTimes(1);
    expect(connectBtn().textContent).toBe("Disconnect");
    expect(connectBtn().querySelector('[data-testid="conn-spin"]')).toBeNull();
  });
});

describe("live-source picker panel (admins) — the same button", () => {
  it("TikTok tile → Connect → spinner + disabled until the call settles", async () => {
    const d = deferred(); const onConnectTT = vi.fn(() => d.promise);
    render(ui({ livePicker: true, onConnectTT, ttAccounts: ["shop_a"] }));
    fireEvent.click(screen.getByTestId("lpk-tile-tt"));
    const panel = screen.getByTestId("lpk-panel-tt");
    fireEvent.click(within(panel).getByRole("button", { name: "Connect" }));
    const b = within(panel).getByRole("button", { name: /Connecting…/ }) as HTMLButtonElement;
    expect(isBusy(b)).toBe(true);
    await act(async () => { d.resolve(); await d.promise; });
    expect(isNormal(within(panel).getByRole("button", { name: "Connect" }) as HTMLButtonElement)).toBe(true);
  });
});

describe("look rules", () => {
  it("reduced motion and the in-app motion switch: no spinner, text only", () => {
    const css = readFileSync("src/redesign/redesign.css", "utf8");
    expect(css).toMatch(/\[data-redesign\]\[data-motion="off"\] \.sfl-conn-spin \{ display: none; \}/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\[data-redesign\] \.sfl-conn-spin \{ display: none; \}/);
  });

  it("\"Connecting…\" reuses the existing text in all 8 languages (Tagalog: Kumokonekta…)", async () => {
    const { buildT } = await import("../../i18n");
    expect(buildT("en").rd_dash_connecting).toBe("Connecting…");
    expect(buildT("fil").rd_dash_connecting).toBe("Kumokonekta…");
    for (const l of ["zh", "zh-TW", "vi", "th", "id", "bg"]) expect(buildT(l).rd_dash_connecting.length).toBeGreaterThan(0);
  });

  it("the app hands the button the promise it already makes; the connect itself is unchanged", () => {
    const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(src).toContain('onConnectTT={() => doConnect("TikTok")}');
    expect(src).toContain("return runSessionAware(target); // Build 13");
    expect(src).toContain("void performConnect(platform, acct); return;");      // connect start: untouched
    expect(src).toContain('return commitLiveConnect({ platform: "Facebook", pageId: selectedPage.pageId, scopeKey: fbScopeKey });');
  });
});
