// Automatic Pickup Status check — the app half: the 30-minute per-account throttle and
// the three triggers (app open, return to the app, entering Pickup Status).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { AUTO_CHECK_THROTTLE_MS, autoCheckDue, requestAutoCheck } from "../parcelTracking";

const T = 1_800_000_000_000;
const mem = new Map<string, string>();
const store = { getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null), setItem: (k: string, v: string) => { mem.set(k, String(v)); }, removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear(), key: () => null, get length() { return mem.size; } };
beforeEach(() => { mem.clear(); vi.stubGlobal("localStorage", store); });

describe("autoCheckDue / requestAutoCheck (30-minute throttle)", () => {
  it("first ask is due; again inside 30 min is not; at 30 min it is", () => {
    expect(AUTO_CHECK_THROTTLE_MS).toBe(30 * 60 * 1000);
    expect(autoCheckDue(null, T)).toBe(true);
    expect(autoCheckDue(T, T + AUTO_CHECK_THROTTLE_MS - 1)).toBe(false);
    expect(autoCheckDue(T, T + AUTO_CHECK_THROTTLE_MS)).toBe(true);
    expect(autoCheckDue(T, T - 1)).toBe(true); // clock set back never blocks
  });

  it("calls the RPC once per 30 min per account; the DB answer is passed through", async () => {
    const rpc = vi.fn(async () => ({ data: { ok: true, reason: "queued" }, error: null }));
    expect(await requestAutoCheck("U1", T, rpc)).toBe("queued");
    expect(await requestAutoCheck("U1", T + 60_000, rpc)).toBe("throttled");
    expect(await requestAutoCheck("U2", T + 60_000, rpc)).toBe("queued");        // another account
    expect(await requestAutoCheck("U1", T + AUTO_CHECK_THROTTLE_MS, rpc)).toBe("queued");
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc).toHaveBeenCalledWith("parcel_tracking_auto_check");
  });

  it("never throws: an error or throw counts toward the throttle (written before the call)", async () => {
    const bad = vi.fn(async () => { throw new Error("net"); });
    expect(await requestAutoCheck("U1", T, bad)).toBe("error");
    expect(await requestAutoCheck("U1", T + 1000, bad)).toBe("throttled");
    expect(await requestAutoCheck("U3", T, vi.fn(async () => ({ data: null, error: { code: "x" } })))).toBe("error");
    expect(await requestAutoCheck(null, T, bad)).toBe("error");
  });

  it("works without localStorage (memory fallback)", async () => {
    const blocked = () => { throw new Error("blocked"); };
    vi.stubGlobal("localStorage", { getItem: blocked, setItem: blocked });
    const rpc = vi.fn(async () => ({ data: { reason: "cooldown" }, error: null }));
    expect(await requestAutoCheck("M1", T, rpc)).toBe("cooldown");
    expect(await requestAutoCheck("M1", T + 1000, rpc)).toBe("throttled");
    expect(mem.size).toBe(0);
  });
});

describe("triggers", () => {
  it("app open asks once; returning to the foreground asks again, throttled to 30 min", async () => {
    const rpc = vi.fn(async () => ({ data: { reason: "nothing_due" }, error: null }));
    vi.doMock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { rpc } }));
    vi.resetModules();
    const mod = await import("../parcelTracking");
    const now = vi.spyOn(Date, "now").mockReturnValue(T);
    const Probe = ({ on, uid }: { on: boolean; uid: string | null }) => { mod.useAutoPickupCheck(on, uid); return null; };
    const v = render(<Probe on uid="A1" />);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    const show = (state: "visible" | "hidden") => {
      Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    };
    now.mockReturnValue(T + 10 * 60_000); show("visible");               // within 30 min → no call
    now.mockReturnValue(T + 31 * 60_000); show("hidden");                // hidden → no call
    await new Promise((r) => setTimeout(r, 0));
    expect(rpc).toHaveBeenCalledTimes(1);
    show("visible");                                                      // back after 31 min → call
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    v.unmount();
    now.mockReturnValue(T + 90 * 60_000); show("visible");               // unmounted → no listener
    await new Promise((r) => setTimeout(r, 0));
    expect(rpc).toHaveBeenCalledTimes(2);
    render(<Probe on={false} uid="A2" />);                                // not allowed → nothing
    await new Promise((r) => setTimeout(r, 0));
    expect(rpc).toHaveBeenCalledTimes(2);
    now.mockRestore();
    vi.doUnmock("../../../supabase");
  });

  it("RedesignApp wires it to signed-in, allowed accounts and passes the user to Pickup Status", () => {
    const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(src).toContain("useAutoPickupCheck(authed && parcelTrackingAllowed, authUserId);");
    expect(src).toContain("<ParcelTracking userId={authUserId} />");
  });
});
