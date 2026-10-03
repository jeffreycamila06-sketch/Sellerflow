// 1.15.0 popup "Duty" row (chrome-extension/popup.js, the REAL file in jsdom): a config
// problem first (Multi-seller off), then a lease failure (the role below it would be
// stale), then the role. Labels are set as TEXT, never HTML.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";

const storage: Record<string, unknown> = {};
let renderStatus: () => Promise<void>;

beforeAll(() => {
  vi.useFakeTimers();
  const html = readFileSync("chrome-extension/popup.html", "utf8");
  document.body.innerHTML = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? "").replace(/<script[\s\S]*?<\/script>/gi, "");
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local: {
      get: (k: string[], cb: (r: Record<string, unknown>) => void) => cb({ [k[0]]: storage[k[0]] }),
      set: (o: Record<string, unknown>, cb?: () => void) => { Object.assign(storage, o); cb?.(); },
    } },
    runtime: { sendMessage: () => {} },
  };
  // indirect eval = global script: function declarations become globals
  (0, eval)(readFileSync("chrome-extension/popup.js", "utf8"));
  renderStatus = (globalThis as unknown as { pcRenderStatus: () => Promise<void> }).pcRenderStatus;
});
afterAll(() => { vi.useRealTimers(); });

const duty = async (status: Record<string, unknown>, config: Record<string, unknown> = { multiSeller: true }) => {
  storage.pc_status = status; storage.pc_config = config;
  await renderStatus();
  const el = document.getElementById("pcRole")!;
  return { text: el.textContent, dot: el.querySelector(".dot")?.className };
};

describe("popup Duty row", () => {
  it("Multi-seller OFF says so plainly — before anything else (even a lease failure)", async () => {
    const r = await duty({ leaseRole: "leader", leaseFailing: true, leaseFailOpen: true }, { multiSeller: false });
    expect(r.text).toBe("Multi-seller mode is OFF — this machine cannot serve the sellers");
    expect(r.dot).toBe("dot bad");
  });

  it("a lease failure is shown BEFORE the role, and says what the machine is actually doing", async () => {
    const lone = await duty({ leaseRole: "leader", leaseFailing: true, leaseLone: true, leaseWorking: true });
    expect(lone.text).toBe("Lease not reachable — lone leader, still working");
    expect((await duty({ leaseRole: "leader", leaseFailing: true, leaseLone: false, leaseWorking: true })).text)
      .toBe("Lease not reachable — still working (pauses 60 s after the last answer)");
    const paused = await duty({ leaseRole: "leader", leaseFailing: true, leaseLone: false, leaseWorking: false });
    expect(paused.text).toBe("Lease not reachable — PAUSED (another machine was seen) until the lease answers or 3 min of failure");
    expect(paused.dot).toBe("dot bad");
    expect((await duty({ leaseRole: "standby", leaseFailing: true, leaseLeaderLabel: "Mac" })).text).toBe("Lease not reachable — staying STANDBY (works after 3 min of failure)");
    expect((await duty({ leaseRole: null, leaseFailing: true })).text).toBe("Lease not reachable — working (no answer since start)");
    const open = await duty({ leaseRole: "standby", leaseFailing: true, leaseFailOpen: true });
    expect(open.text).toBe("Lease unreachable 3+ min — working (may double-check)");
    expect(open.dot).toBe("dot warn");
  });

  it("never says LEADER while no work is done", async () => {
    const r = await duty({ leaseRole: "leader", leaseFailing: true, leaseLone: false, leaseWorking: false });
    expect(r.text).not.toMatch(/LEADER|keeping/);
  });

  it("then the role: leader (+ DEGRADED), standby with the leader's label", async () => {
    expect((await duty({ leaseRole: "leader", workerLabel: "Mac" })).text).toBe("On duty (LEADER) · this: Mac");
    expect((await duty({ leaseRole: "leader", degraded: true })).text).toBe("On duty (LEADER) — DEGRADED (7-11 tab missing 1+ min / dead 2+ min)");
    const sb = await duty({ leaseRole: "standby", leaseLeaderLabel: "Windows laptop", leaseLeaderAgeS: 12 });
    expect(sb.text).toBe("STANDBY — leader: Windows laptop, seen 12s ago");
    expect(sb.dot).toBe("dot warn");
  });

  it("a hostile label stays text (never HTML)", async () => {
    await duty({ leaseRole: "standby", leaseLeaderLabel: "<img src=x onerror=alert(1)>" });
    expect(document.getElementById("pcRole")!.querySelector("img")).toBeNull();
  });
});
