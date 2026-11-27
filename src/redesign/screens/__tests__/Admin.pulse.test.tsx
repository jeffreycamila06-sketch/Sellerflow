// Live Pulse (2026-11-27): the tile and the panel are on the web AND in the phone apps (Android + iPhone,
// isAppShell()). The tile is FIRST in Controls and shows "● N" + "N / LIMIT live" from the SAME server
// answer as the TikTok connection limit card (usage.concurrent / usage.concurrentLimit). The panel shows
// counts only — no money figure anywhere, also on iPhone.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import Admin, { AdminPanel } from "../Admin";
import { TProvider } from "../../i18n";
import type { PulseData } from "../../adapters/useBusinessPulse";

const setSearch = (s: string) => {
  Object.defineProperty(window, "location", { value: { ...window.location, search: s }, writable: true });
};
const usage = (concurrent: number, concurrentLimit: number) => ({ success: true, today: { count: 0, lastLabel: null, lastAt: null }, cooldowns: [], usage: { roomsToday: 12, concurrent, dailyLimit: 1000, concurrentLimit, warn: false } });
let answer: unknown = usage(38, 100);
let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  answer = usage(38, 100);
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify(answer), { status: 200 }));
});
afterEach(() => {
  cleanup();
  fetchSpy.mockRestore();
  setSearch("");
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };

const renderAdmin = (onOpenPanel: (k: string) => void = () => {}) =>
  render(
    <TProvider lang="en">
      <Admin onOpenPanel={onOpenPanel as never} cur="NT$" />
    </TProvider>,
  );
const statusCalls = () => fetchSpy.mock.calls.filter((c) => String(c[0]).includes("/admin/tiktok-cooldown/status")).length;

const SHELLS: Array<[string, () => void]> = [
  ["web browser", () => {}],
  ["Android app", () => { (window as unknown as { Capacitor?: unknown }).Capacitor = { getPlatform: () => "android" }; }],
  ["iPhone app", () => { (window as unknown as { Capacitor?: unknown }).Capacitor = { getPlatform: () => "ios" }; }],
];

describe("Live Pulse tile — web and phone apps", () => {
  for (const [where, set] of SHELLS) {
    it(`${where}: the tile is FIRST in Controls with the live count, and a tap opens the panel`, async () => {
      set();
      const open = vi.fn();
      renderAdmin(open);
      await flush();
      const tile = screen.getByTestId("admin-ctrl-pulse");
      expect(tile.parentElement!.firstElementChild).toBe(tile);           // first tile in Controls
      expect(screen.getByTestId("admin-pulse-num").textContent).toBe("38");
      expect(screen.getByTestId("admin-pulse-line").textContent).toBe("38 / 100 live");
      expect(tile.textContent).toContain("Live Pulse");
      expect(tile.getAttribute("data-level")).toBe("ok");
      expect(statusCalls()).toBe(1);
      fireEvent.click(tile);
      expect(open).toHaveBeenCalledWith("pulse");
      expect(screen.getByText("Sellers")).toBeTruthy();                   // the rest of Controls is unchanged
    });
  }
  it("the limit comes from the server answer (a bigger plan = a bigger limit; nothing written in the app)", async () => {
    answer = usage(89, 150);
    renderAdmin(); await flush();
    expect(screen.getByTestId("admin-pulse-line").textContent).toBe("89 / 150 live");
    expect(screen.getByTestId("admin-ctrl-pulse").getAttribute("data-level")).toBe("ok");     // 59.3 %
    cleanup();
    answer = usage(90, 150);
    renderAdmin(); await flush();
    expect(screen.getByTestId("admin-ctrl-pulse").getAttribute("data-level")).toBe("warn");   // 60 %
  });
  it("colours at 59 / 60 / 69 / 70 % of the limit: green / amber / amber / red (pill + tile border)", async () => {
    const cases: Array<[number, string, string]> = [[59, "ok", "var(--ok)"], [60, "warn", "var(--warn)"], [69, "warn", "var(--warn)"], [70, "bad", "var(--danger)"]];
    for (const [n, level, color] of cases) {
      answer = usage(n, 100);
      renderAdmin(); await flush();
      const tile = screen.getByTestId("admin-ctrl-pulse");
      expect(tile.getAttribute("data-level")).toBe(level);
      expect(tile.style.border).toBe(`1.5px solid ${color}`);
      expect(screen.getByTestId("admin-pulse-pill").style.color).toBe(color);
      cleanup();
    }
  });
  for (const [why, a, status] of [
    ["the server refuses", { success: false }, 200],
    ["not an admin (403)", { success: false }, 403],
    ["no usage in the answer", { success: true, today: { count: 0 }, cooldowns: [] }, 200],
    ["a limit of 0", usage(5, 0), 200],
  ] as Array<[string, unknown, number]>) {
    it(`${why} → grey "—", no pulse`, async () => {
      fetchSpy.mockImplementation(async () => new Response(JSON.stringify(a), { status }));
      renderAdmin(); await flush();
      const tile = screen.getByTestId("admin-ctrl-pulse");
      expect(tile.getAttribute("data-level")).toBe("unknown");
      expect(screen.getByTestId("admin-pulse-num").textContent).toBe("—");
      expect(screen.getByTestId("admin-pulse-line").textContent).toBe("— / — live");
      expect(screen.getByTestId("admin-pulse-pill").style.color).toBe("var(--text-muted)");
      expect(tile.querySelector(".sfl-lpt-dot")).toBeNull();
    });
  }
  it("the server cannot be reached → grey \"—\"", async () => {
    fetchSpy.mockImplementation(async () => { throw new Error("offline"); });
    renderAdmin(); await flush();
    expect(screen.getByTestId("admin-ctrl-pulse").getAttribute("data-level")).toBe("unknown");
  });
  it("the dot pulses only through the .sfl-lpt-dot class (motion off / reduced motion stop it in the CSS)", async () => {
    renderAdmin(); await flush();
    expect(screen.getByTestId("admin-ctrl-pulse").querySelector(".sfl-lpt-dot")).not.toBeNull();
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/redesign/redesign.css", "utf8");
    expect(css).toMatch(/\[data-redesign\]\[data-motion="off"\] \.sfl-lpt-dot \{ animation: none !important; \}/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.sfl-lpt-dot \{ animation: none !important; \} \}/);
  });
});

const PULSE: PulseData = {
  generatedAt: new Date().toISOString(),
  summary: { active_15m: 3, active_60m: 5, orders_60m: 40, orders_today: 512, active_today: 9 },
  hourly: [{ hr: 9, orders: 30 }, { hr: 10, orders: 44 }],
  sellers: [{ store_name: "Lia Closet", email: "lia@x.com", orders_today: 80, orders_60m: 12, last_order_at: new Date().toISOString() }],
};

describe("Live Pulse panel — opens in the phone apps, counts only", () => {
  for (const [where, set] of SHELLS) {
    it(`${where}: the panel shows, and has no money figure`, async () => {
      set();
      render(<TProvider lang="en"><AdminPanel panel="pulse" onClose={() => {}} cur="NT$" pulse={PULSE} pulseState="live" /></TProvider>);
      await flush();
      const text = document.body.textContent || "";
      expect(text).toContain("512");                                     // orders today
      expect(text).toContain("Lia Closet");
      expect(screen.getByTestId("adm-ttl-card")).toBeTruthy();           // the TikTok limit card is in the panel
      expect(text).not.toMatch(/NT\$|₱|\$|revenue|price|sales total|income/i);
    });
  }
});
