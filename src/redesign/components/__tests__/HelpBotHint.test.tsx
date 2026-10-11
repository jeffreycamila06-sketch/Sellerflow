// Help bot hint ("Do you have a question?"): ~1 s after Settings opens, 5 s on screen, once a
// day per device (every 3 days after the chat was used), side follows the bubble, tap opens the
// chat, × closes, hidden while dragging / chat open, no animation with motion off, only where
// the bot bubble shows.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

const rpc = vi.fn();
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: (...a: unknown[]) => rpc(...a), auth: { getSession: async () => ({ data: { session: null } }) } },
}));

import { TProvider } from "../../i18n";
import HelpBot from "../HelpBot";
import SettingsHub from "../../screens/SettingsHub";
import { resetHintSession, saveBubblePos, HINT_DAY_MS, BUBBLE } from "../../adapters/helpBot";

const T0 = new Date("2026-10-11T02:00:00Z").getTime();
const SHOWN = T0 + 1000; // the hint records its time when it appears (1 s after open)
const ui = (node: React.ReactNode) => render(<TProvider lang="en">{node}</TProvider>);
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const setWidth = (w: number) => Object.defineProperty(window, "innerWidth", { value: w, configurable: true });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  localStorage.clear();
  resetHintSession();
  rpc.mockReset();
  rpc.mockResolvedValue({ data: [], error: null });
  setWidth(375);
  Object.defineProperty(window, "innerHeight", { value: 700, configurable: true });
});
afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, "matchMedia");
});

describe("hint timing", () => {
  it("appears ~1 s after Settings opens and hides after 5 s with a fade", () => {
    const r = ui(<HelpBot />);
    tick(999);
    expect(r.queryByTestId("helpbot-hint")).toBeNull();
    tick(1);
    expect(r.getByTestId("helpbot-hint").textContent).toBe("Do you have a question?");
    expect(r.getByTestId("helpbot-hint-box").className).toBe("sfl-hb-hint");
    expect(r.getByTestId("helpbot-icon").className).toBe("sfl-hb-wave");
    tick(5000);
    expect(r.getByTestId("helpbot-hint-box").className).toBe("sfl-hb-hint sfl-hb-hint-out");
    tick(300);
    expect(r.queryByTestId("helpbot-hint")).toBeNull();
    expect(r.getByTestId("helpbot-icon").className).toBe("");
  });
});

describe("frequency", () => {
  const shows = () => { const r = ui(<HelpBot />); tick(1000); const on = !!r.queryByTestId("helpbot-hint"); r.unmount(); return on; };
  it("at most once a day per device", () => {
    expect(shows()).toBe(true);
    expect(shows()).toBe(false); // same app session
    resetHintSession(); // next app open, same day
    vi.setSystemTime(SHOWN + HINT_DAY_MS - 1); // checked when Settings opens: 1 ms short of a day
    expect(shows()).toBe(false);
    resetHintSession();
    vi.setSystemTime(SHOWN + HINT_DAY_MS); // exactly one day later
    expect(shows()).toBe(true);
  });
  it("after the chat was opened: at most once every 3 days", () => {
    const r = ui(<HelpBot />);
    tick(1000);
    fireEvent.click(r.getByTestId("helpbot-hint"));
    expect(r.getByTestId("helpbot-chat")).toBeTruthy();
    r.unmount();
    for (const days of [1, 2.9]) {
      resetHintSession();
      vi.setSystemTime(SHOWN + days * HINT_DAY_MS);
      expect(shows(), `${days} days`).toBe(false);
    }
    resetHintSession();
    vi.setSystemTime(SHOWN + 3 * HINT_DAY_MS);
    expect(shows()).toBe(true);
  });
  it("opening the chat from the bubble also counts as using it", () => {
    const r = ui(<HelpBot />);
    tick(1000);
    fireEvent.click(r.getByTestId("helpbot-hint-close"));
    const b = r.getByTestId("helpbot-bubble");
    fireEvent.pointerDown(b, { clientX: 1, clientY: 1 }); fireEvent.pointerUp(b, { clientX: 1, clientY: 1 });
    expect(r.getByTestId("helpbot-chat")).toBeTruthy();
    r.unmount();
    resetHintSession();
    vi.setSystemTime(SHOWN + 2 * HINT_DAY_MS);
    expect(shows()).toBe(false);
  });
  it("storage blocked → once per app session", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(shows()).toBe(true);
    expect(shows()).toBe(false);
    resetHintSession();
    expect(shows()).toBe(true);
    get.mockRestore(); set.mockRestore();
  });
});

describe("hint actions", () => {
  it("tap on the hint opens the chat", () => {
    const r = ui(<HelpBot />);
    tick(1000);
    fireEvent.click(r.getByTestId("helpbot-hint"));
    expect(r.getByTestId("helpbot-chat")).toBeTruthy();
    expect(r.queryByTestId("helpbot-hint")).toBeNull();
  });
  it("× closes the hint only", () => {
    const r = ui(<HelpBot />);
    tick(1000);
    fireEvent.click(r.getByTestId("helpbot-hint-close"));
    expect(r.queryByTestId("helpbot-hint")).toBeNull();
    expect(r.queryByTestId("helpbot-chat")).toBeNull();
    expect(r.getByTestId("helpbot-bubble")).toBeTruthy();
  });
  it("hidden while the bubble is dragged, back after the drop", () => {
    const r = ui(<HelpBot />);
    tick(1000);
    const b = r.getByTestId("helpbot-bubble");
    fireEvent.pointerDown(b, { clientX: 340, clientY: 500 });
    fireEvent.pointerMove(b, { clientX: 300, clientY: 480 });
    expect(r.queryByTestId("helpbot-hint")).toBeNull();
    fireEvent.pointerUp(b, { clientX: 300, clientY: 480 });
    expect(r.getByTestId("helpbot-hint")).toBeTruthy();
  });
});

describe("side and screen edges", () => {
  for (const w of [320, 375]) {
    it(`right-edge bubble → hint on its left, inside the screen (${w} px)`, () => {
      setWidth(w);
      const r = ui(<HelpBot />);
      tick(1000);
      const wrap = r.getByTestId("helpbot-hint-wrap") as HTMLElement;
      expect(wrap.getAttribute("data-side")).toBe("right");
      const right = parseFloat(wrap.style.right), max = parseFloat(wrap.style.maxWidth);
      const bubbleLeft = w - BUBBLE - 12;
      expect(w - right).toBeLessThanOrEqual(bubbleLeft - 10); // ends before the bubble
      expect(w - right - max).toBeGreaterThanOrEqual(12); // never off the left edge
    });
    it(`left-edge bubble → hint on its right, inside the screen (${w} px)`, () => {
      setWidth(w);
      saveBubblePos({ side: "left", y: 400 });
      const r = ui(<HelpBot />);
      tick(1000);
      const wrap = r.getByTestId("helpbot-hint-wrap") as HTMLElement;
      expect(wrap.getAttribute("data-side")).toBe("left");
      const left = parseFloat(wrap.style.left), max = parseFloat(wrap.style.maxWidth);
      expect(left).toBeGreaterThanOrEqual(12 + BUBBLE + 10);
      expect(left + max).toBeLessThanOrEqual(w - 12);
      expect(wrap.style.top).toBe("400px");
      expect(wrap.style.height).toBe(`${BUBBLE}px`); // same band as the bubble → never over header / bottom bar
    });
  }
  it("the side switches when the bubble is moved to the other edge", () => {
    const r = ui(<HelpBot />);
    tick(1000);
    const b = r.getByTestId("helpbot-bubble");
    fireEvent.pointerDown(b, { clientX: 340, clientY: 500 });
    fireEvent.pointerMove(b, { clientX: 200, clientY: 480 });
    fireEvent.pointerMove(b, { clientX: 30, clientY: 480 });
    fireEvent.pointerUp(b, { clientX: 30, clientY: 480 });
    expect(r.getByTestId("helpbot-hint-wrap").getAttribute("data-side")).toBe("left");
  });
});

describe("motion off", () => {
  it("reduced motion: no animation classes, just appear and disappear", () => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: (q: string) => ({ matches: q.includes("reduce"), media: q }) });
    const r = ui(<HelpBot />);
    tick(1000);
    expect(r.getByTestId("helpbot-hint-box").className).toBe("");
    expect(r.getByTestId("helpbot-icon").className).toBe("");
    tick(5000);
    expect(r.queryByTestId("helpbot-hint")).toBeNull(); // no fade phase
  });
  it("in-app motion switch off → same", () => {
    const root = document.createElement("div");
    root.setAttribute("data-redesign", "");
    root.setAttribute("data-motion", "off");
    document.body.appendChild(root);
    ui(<HelpBot />);
    tick(1000);
    expect(root.querySelector("[data-testid=helpbot-hint-box]")?.className).toBe("");
    root.remove();
  });
});

describe("only where the bot bubble shows", () => {
  const noop = () => {};
  const base = { onGeneral: noop, onCustomers: noop, onAdmin: noop, onCustomerData: noop, onLegal: noop, onDelete: noop, onLogout: noop };
  it("bot off → no hint", () => {
    const r = ui(<SettingsHub {...base} />);
    tick(2000);
    expect(r.queryByTestId("helpbot-hint")).toBeNull();
    expect(r.getByTestId("help-card")).toBeTruthy();
  });
  it("bot on → hint on Settings", () => {
    const r = ui(<SettingsHub {...base} helpBot />);
    tick(1000);
    expect(r.getByTestId("helpbot-hint")).toBeTruthy();
  });
});
