// Nov 3, 2026 — the admin card: today's 429 count + last label, plan usage with the red
// banner from 70%, the cooldown list, and the one-tap clear (calls the admin route, then reloads).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { TProvider } from "../../i18n";

const { load, clear, clearDaily } = vi.hoisted(() => ({ load: vi.fn(), clear: vi.fn(), clearDaily: vi.fn() }));
vi.mock("../../adapters/tiktokConnectLimit", async (orig) => ({ ...(await orig<typeof import("../../adapters/tiktokConnectLimit")>()), loadTikTokCooldownStatus: () => load(), clearTikTokCooldown: (u: string) => clear(u), clearDailyLimit: () => clearDaily() }));

import { TikTokLimitCard } from "../Admin";

const status = (over: Record<string, unknown> = {}) => ({ ok: true, status: { count: 2, lastLabel: "daily_rooms", lastAt: Date.UTC(2026, 10, 3, 12, 59), cooldowns: [{ username: "thrifts.studio", sellerId: "j@x.com", remainingMs: 95_000 }], usage: { roomsToday: 12, concurrent: 3, dailyLimit: 1000, concurrentLimit: 100, warn: false }, daily: null, ...over } });

beforeEach(() => { cleanup(); load.mockReset(); clear.mockReset(); clearDaily.mockReset(); });

describe("TikTokLimitCard", () => {
  it("shows today's count + label, the usage line, and the cooldown rows", async () => {
    load.mockResolvedValue(status());
    render(<TProvider lang="en"><TikTokLimitCard /></TProvider>);
    expect((await screen.findByTestId("adm-ttl-today")).textContent).toContain("Limit hits today: 2");
    expect(screen.getByTestId("adm-ttl-today").textContent).toContain("daily_rooms");
    expect(screen.getByTestId("adm-ttl-usage").textContent).toBe("Rooms today 12/1000 · live now 3/100");
    expect(screen.queryByTestId("adm-ttl-warn")).toBeNull();
    const rows = screen.getAllByTestId("adm-ttl-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("@thrifts.studio");
    expect(rows[0].textContent).toContain("2 min left");
    expect(load).toHaveBeenCalledTimes(1);                      // read-on-open, no polling
  });
  it("red banner from 70% of either limit", async () => {
    load.mockResolvedValue(status({ usage: { roomsToday: 700, concurrent: 1, dailyLimit: 1000, concurrentLimit: 100, warn: true } }));
    render(<TProvider lang="en"><TikTokLimitCard /></TProvider>);
    expect((await screen.findByTestId("adm-ttl-warn")).textContent).toContain("Close to the plan limit");
  });
  it("no cooldowns → the empty line; clear is disabled until a name is typed", async () => {
    load.mockResolvedValue(status({ count: 0, lastLabel: null, cooldowns: [] }));
    render(<TProvider lang="en"><TikTokLimitCard /></TProvider>);
    expect((await screen.findByText("No accounts on cooldown"))).toBeTruthy();
    expect((screen.getByTestId("adm-ttl-clear") as HTMLButtonElement).disabled).toBe(true);
  });
  it("Clear → calls the admin route with the typed username, shows the count, reloads", async () => {
    load.mockResolvedValue(status());
    clear.mockResolvedValue({ ok: true, cleared: 1 });
    render(<TProvider lang="en"><TikTokLimitCard /></TProvider>);
    await screen.findByTestId("adm-ttl-today");
    fireEvent.change(screen.getByTestId("adm-ttl-input"), { target: { value: "@thrifts.studio" } });
    fireEvent.click(screen.getByTestId("adm-ttl-clear"));
    await waitFor(() => expect(screen.getByTestId("adm-ttl-note").textContent).toBe("Cooldown cleared (1)"));
    expect(clear).toHaveBeenCalledWith("@thrifts.studio");
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("a refused clear shows the error text", async () => {
    load.mockResolvedValue(status());
    clear.mockResolvedValue({ ok: false, error: "forbidden" });
    render(<TProvider lang="en"><TikTokLimitCard /></TProvider>);
    await screen.findByTestId("adm-ttl-today");
    fireEvent.change(screen.getByTestId("adm-ttl-input"), { target: { value: "shop" } });
    fireEvent.click(screen.getByTestId("adm-ttl-clear"));
    await waitFor(() => expect(screen.getByTestId("adm-ttl-note").textContent).toContain("Couldn't clear"));
  });
  it("daily limit → red 'Daily limit reached' banner with minutes left; its button clears the shared bench", async () => {
    load.mockResolvedValue(status({ daily: { remainingMs: 1_800_000 } }));
    clearDaily.mockResolvedValue({ ok: true });
    render(<TProvider lang="en"><TikTokLimitCard /></TProvider>);
    const banner = await screen.findByTestId("adm-ttl-daily");
    expect(banner.textContent).toContain("Daily limit reached");
    expect(banner.textContent).toContain("30 min left");
    fireEvent.click(screen.getByTestId("adm-ttl-clear-daily"));
    await waitFor(() => expect(clearDaily).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });
  it("no daily bench → no banner", async () => {
    load.mockResolvedValue(status());
    render(<TProvider lang="en"><TikTokLimitCard /></TProvider>);
    await screen.findByTestId("adm-ttl-today");
    expect(screen.queryByTestId("adm-ttl-daily")).toBeNull();
  });
  it("load failure → the load-error line", async () => {
    load.mockResolvedValue({ ok: false, error: "forbidden" });
    render(<TProvider lang="en"><TikTokLimitCard /></TProvider>);
    expect(await screen.findByText("Couldn't load the limit status.")).toBeTruthy();
  });
});
