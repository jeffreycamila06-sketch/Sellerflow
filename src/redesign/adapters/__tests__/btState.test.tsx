// Bluetooth readiness for the Printer settings screen (btState): what one bridge answer
// means (pure), and the hook's timing — check on open, re-check every 3 s while not ready,
// one silent 2 s retry on an unclear answer, foreground re-check, failures reported back.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { btProbeState, btBlocked, useBluetoothState, BT_RECHECK_MS, BT_RETRY_MS, type BtProbeOutcome } from "../btState";

const flush = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
const advance = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); for (let i = 0; i < 10; i++) await Promise.resolve(); });
afterEach(() => { vi.useRealTimers(); });

describe("btProbeState (pure) — every real native answer shape", () => {
  const off: BtProbeOutcome[] = [
    { ok: false, code: "BT_DISABLED", message: "Bluetooth is off. Turn it on in Android Settings then try again." }, // Android scan reject
    { ok: false, code: "BT_OFF", message: "Bluetooth is off" },                                                        // Android BLE / iOS print
    { ok: false, code: "", message: "Bluetooth is off. Turn it on in Control Center and try again." },                 // iOS scan resolves ok:false, no code
  ];
  const notAllowed: BtProbeOutcome[] = [
    { ok: false, code: "BT_PERMISSION", message: "Bluetooth permission needed. Allow it in the system prompt and tap Scan again." },
    { ok: false, code: "", message: "Bluetooth permission denied. Allow Bluetooth for SellerFlowLive in iPhone Settings." }, // iOS, no code
  ];
  it("off / not allowed / ready / unknown", () => {
    for (const o of off) expect(btProbeState(o), o.message).toBe("off");
    for (const o of notAllowed) expect(btProbeState(o), o.message).toBe("notAllowed");
    expect(btProbeState({ ok: true, code: "", message: "Found 2 printers." })).toBe("ready");
    expect(btProbeState({ ok: false, code: "BT_BUSY", message: "Bluetooth is busy with another printer task." })).toBe("ready"); // busy = Bluetooth works
    expect(btProbeState({ ok: false, code: "BT_UNAVAILABLE", message: "Bluetooth did not become ready." })).toBe("unknown");
    expect(btProbeState({ ok: false, code: "BT_NO_ADAPTER", message: "Bluetooth not supported on this device" })).toBe("unknown");
    expect(btProbeState({ ok: false, code: "", message: "" })).toBe("unknown");
  });
  it("blocked = off, not allowed, not ready", () => {
    expect(["off", "notAllowed", "notReady"].every((s) => btBlocked(s as "off"))).toBe(true);
    expect(btBlocked("ready")).toBe(false); expect(btBlocked("checking")).toBe(false);
  });
});

describe("useBluetoothState", () => {
  const OFF: BtProbeOutcome = { ok: false, code: "BT_DISABLED", message: "Bluetooth is off." };
  const PERM: BtProbeOutcome = { ok: false, code: "BT_PERMISSION", message: "Bluetooth permission needed." };
  const OK: BtProbeOutcome = { ok: true, code: "", message: "" };
  const UNKNOWN: BtProbeOutcome = { ok: false, code: "BT_UNAVAILABLE", message: "Bluetooth did not become ready." };

  it("checks the moment it is enabled (no tap), then re-checks every 3 s while off; ready stops the polling + marks recovered", async () => {
    vi.useFakeTimers();
    const probe = vi.fn(async () => OFF);
    const { result } = renderHook(() => useBluetoothState(true, probe));
    expect(result.current.state).toBe("checking");
    expect(probe).toHaveBeenCalledTimes(1); // on open, before any Scan
    await flush();
    expect(result.current.state).toBe("off");
    await advance(BT_RECHECK_MS - 1);
    expect(probe).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe("off");
    probe.mockResolvedValue(OK);
    await advance(BT_RECHECK_MS);
    expect(probe).toHaveBeenCalledTimes(3);
    expect(result.current.state).toBe("ready");
    expect(result.current.recovered).toBe(true);
    await advance(BT_RECHECK_MS * 5);
    expect(probe).toHaveBeenCalledTimes(3); // ready = no polling (a ready probe is a full scan)
  });

  it("not allowed → notAllowed, re-checked every 3 s", async () => {
    vi.useFakeTimers();
    const probe = vi.fn(async () => PERM);
    const { result } = renderHook(() => useBluetoothState(true, probe));
    await flush();
    expect(result.current.state).toBe("notAllowed");
    await advance(BT_RECHECK_MS);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("an unclear answer is retried ONCE after 2 s silently (state stays checking); still unclear → notReady, then the 3 s re-check", async () => {
    vi.useFakeTimers();
    const probe = vi.fn(async () => UNKNOWN);
    const { result } = renderHook(() => useBluetoothState(true, probe));
    await flush();
    expect(result.current.state).toBe("checking");
    expect(probe).toHaveBeenCalledTimes(1);
    await advance(BT_RETRY_MS);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe("notReady");
    await advance(BT_RECHECK_MS);
    expect(probe).toHaveBeenCalledTimes(3);
    expect(result.current.state).toBe("notReady"); // no second silent retry
    probe.mockResolvedValue(OK);
    await advance(BT_RECHECK_MS);
    expect(result.current.state).toBe("ready");
    expect(result.current.recovered).toBe(true);
  });

  it("ready at once → ready, not recovered (no green note on a healthy phone)", async () => {
    vi.useFakeTimers();
    const probe = vi.fn(async () => OK);
    const { result } = renderHook(() => useBluetoothState(true, probe));
    await flush();
    expect(result.current.state).toBe("ready");
    expect(result.current.recovered).toBe(false);
  });

  it("coming back to the foreground re-checks while not ready; a later failure reported → off + polling again", async () => {
    vi.useFakeTimers();
    const probe = vi.fn(async () => OFF);
    const { result } = renderHook(() => useBluetoothState(true, probe));
    await flush();
    expect(probe).toHaveBeenCalledTimes(1);
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); for (let i = 0; i < 10; i++) await Promise.resolve(); });
    expect(probe).toHaveBeenCalledTimes(2); // jsdom is "visible"
    probe.mockResolvedValue(OK);
    await advance(BT_RECHECK_MS);
    expect(result.current.state).toBe("ready");
    // a print failed with Bluetooth off → the card comes back and the re-check resumes
    let consumed = false;
    act(() => { consumed = result.current.report("BT_OFF", "Bluetooth is off"); });
    expect(consumed).toBe(true);
    expect(result.current.state).toBe("off");
    expect(result.current.recovered).toBe(false);
    await advance(BT_RECHECK_MS);
    expect(result.current.state).toBe("ready");
    // a failure that is NOT about Bluetooth is not consumed
    act(() => { consumed = result.current.report("BT_NOT_FOUND", "Printer not found."); });
    expect(consumed).toBe(false);
    expect(result.current.state).toBe("ready");
  });

  it("disabled → never probes; disabling clears the timer", async () => {
    vi.useFakeTimers();
    const probe = vi.fn(async () => OFF);
    const { result, rerender } = renderHook(({ on }: { on: boolean }) => useBluetoothState(on, probe), { initialProps: { on: false } });
    await flush();
    expect(probe).not.toHaveBeenCalled();
    expect(result.current.state).toBe("checking");
    rerender({ on: true });
    await flush();
    expect(probe).toHaveBeenCalledTimes(1);
    rerender({ on: false });
    await advance(BT_RECHECK_MS * 3);
    expect(probe).toHaveBeenCalledTimes(1);
  });
});
