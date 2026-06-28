// Printer picker status — real BT (saved/bonded) + real LAN (reachability ping),
// with web/preview (no bridge) degrading to "disconnected" (never a fake connected).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const H = vi.hoisted(() => ({
  hasBt: false, hasNative: false,
  bt: vi.fn(), lan: vi.fn(),
}));
vi.mock("../printerBridge", () => ({
  hasBtBridge: () => H.hasBt,
  hasNativePrinter: () => H.hasNative,
  btCall: (...a: unknown[]) => H.bt(...a),
  callMobilePrinterBridge: (...a: unknown[]) => H.lan(...a),
}));

import { usePrinterStatus, btStatusFrom, lanStatusFrom } from "../usePrinterStatus";

beforeEach(() => {
  vi.clearAllMocks();
  H.hasBt = false; H.hasNative = false;
  H.bt.mockResolvedValue(null);
  H.lan.mockResolvedValue({ ok: false });
});

describe("pure status helpers", () => {
  it("btStatusFrom: connected only when bridge + saved printer", () => {
    expect(btStatusFrom(true, { address: "x" })).toBe("connected");
    expect(btStatusFrom(true, null)).toBe("disconnected");
    expect(btStatusFrom(false, { address: "x" })).toBe("disconnected"); // no bridge
  });
  it("lanStatusFrom: connected only when bridge + host + ping ok", () => {
    expect(lanStatusFrom(true, "192.168.1.5", true)).toBe("connected");
    expect(lanStatusFrom(true, "192.168.1.5", false)).toBe("disconnected"); // ping failed
    expect(lanStatusFrom(true, "", true)).toBe("disconnected");            // no host
    expect(lanStatusFrom(false, "192.168.1.5", true)).toBe("disconnected"); // no bridge
  });
});

describe("usePrinterStatus — read-on-open", () => {
  it("web/preview (no bridge) → both disconnected, no bridge calls", async () => {
    const { result } = renderHook(() => usePrinterStatus(true));
    await waitFor(() => {
      expect(result.current.bt).toBe("disconnected");
      expect(result.current.lan).toBe("disconnected");
    });
    expect(H.bt).not.toHaveBeenCalled();
    expect(H.lan).not.toHaveBeenCalled();
  });

  it("BT saved/bonded → connected", async () => {
    H.hasBt = true;
    H.bt.mockResolvedValue({ savedPrinter: { address: "AA:BB", name: "AIMO D520BT" } });
    const { result } = renderHook(() => usePrinterStatus(true));
    await waitFor(() => expect(result.current.bt).toBe("connected"));
  });

  it("BT bridge but no saved printer → disconnected", async () => {
    H.hasBt = true;
    H.bt.mockResolvedValue({ savedPrinter: null });
    const { result } = renderHook(() => usePrinterStatus(true));
    await waitFor(() => expect(result.current.bt).toBe("disconnected"));
  });

  it("LAN saved host + reachable ping → connected", async () => {
    H.hasNative = true;
    H.lan.mockImplementation((action: string) => {
      if (action === "getPrinter") return Promise.resolve({ host: "192.168.1.42", port: 9100 });
      if (action === "testConnection") return Promise.resolve({ ok: true });
      return Promise.resolve({ ok: false });
    });
    const { result } = renderHook(() => usePrinterStatus(true));
    await waitFor(() => expect(result.current.lan).toBe("connected"));
  });

  it("LAN saved host but ping fails (printer off) → disconnected", async () => {
    H.hasNative = true;
    H.lan.mockImplementation((action: string) => {
      if (action === "getPrinter") return Promise.resolve({ host: "192.168.1.42" });
      if (action === "testConnection") return Promise.resolve({ ok: false });
      return Promise.resolve({ ok: false });
    });
    const { result } = renderHook(() => usePrinterStatus(true));
    await waitFor(() => expect(result.current.lan).toBe("disconnected"));
  });

  it("LAN no saved host → disconnected, no ping attempted", async () => {
    H.hasNative = true;
    H.lan.mockResolvedValue({}); // getPrinter returns nothing
    const { result } = renderHook(() => usePrinterStatus(true));
    await waitFor(() => expect(result.current.lan).toBe("disconnected"));
    expect(H.lan).not.toHaveBeenCalledWith("testConnection", expect.anything());
  });

  it("disabled (picker closed) → no checks run", () => {
    H.hasBt = true; H.hasNative = true;
    renderHook(() => usePrinterStatus(false));
    expect(H.bt).not.toHaveBeenCalled();
    expect(H.lan).not.toHaveBeenCalled();
  });
});
