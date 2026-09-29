// PARCEL SCAN HARD GATE (2026-09-27) — behavioral matrix. No config = cannot
// encode: the modal blocks the screen until the seller saves a 賣貨便 config;
// non-covered sellers get a byte-unchanged screen (config never even loaded).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MyshipScanGate, MyshipConfigCard } from "../MyshipSetup";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  validate: vi.fn(),
}));
vi.mock("../../adapters/parcelCheck", async (orig) => ({
  ...(await orig() as object),
  loadMyshipConfig: mocks.load,
  saveMyshipConfig: mocks.save,
  validateGm: mocks.validate,
}));

const T = new Proxy({}, { get: (_o, k) => String(k) }) as never; // key-echo t

describe("MyshipScanGate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("enabled=false (non-allowlisted / non-TW): pass-through, config NEVER loaded, no gate", () => {
    mocks.load.mockResolvedValue(null);
    render(<MyshipScanGate t={T} enabled={false} onExit={() => {}}><div data-testid="scan" /></MyshipScanGate>);
    expect(screen.getByTestId("scan")).toBeTruthy();
    expect(screen.queryByTestId("mc-gate")).toBeNull();
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("enabled + NO config row → blocking modal with the setup form; the screen stays mounted behind it", async () => {
    mocks.load.mockResolvedValue(null);
    render(<MyshipScanGate t={T} enabled onExit={() => {}}><div data-testid="scan" /></MyshipScanGate>);
    await waitFor(() => expect(screen.getByTestId("mc-gm")).toBeTruthy());
    expect(screen.getByTestId("mc-gate")).toBeTruthy();
    expect(screen.getByTestId("scan")).toBeTruthy();
  });

  it("enabled + configured seller → no modal, ever", async () => {
    mocks.load.mockResolvedValue({ gmId: "GM2609096099718", ordMobile: "0917827508", shopName: "shop", verifiedAt: "x" });
    render(<MyshipScanGate t={T} enabled onExit={() => {}}><div data-testid="scan" /></MyshipScanGate>);
    await waitFor(() => expect(screen.queryByTestId("mc-gate")).toBeNull());
    expect(screen.getByTestId("scan")).toBeTruthy();
  });

  it("HARD GATE while loading AND on load failure: the blocking overlay is up before the config read resolves, and a failed read fails CLOSED (modal)", async () => {
    let rej: (e: Error) => void = () => {};
    // Only the GATE's config read fails. Once the gate shows the setup modal, the form
    // inside it does its own read — give that one a normal (empty) answer instead of
    // re-handing it the same rejected promise, which the form doesn't expect.
    mocks.load.mockReturnValueOnce(new Promise((_res, reject) => { rej = reject; })).mockResolvedValue(null);
    render(<MyshipScanGate t={T} enabled onExit={() => {}}><div data-testid="scan" /></MyshipScanGate>);
    expect(screen.getByTestId("mc-gate")).toBeTruthy(); // blocking from the first frame
    rej(new Error("db down"));
    await waitFor(() => expect(screen.getByTestId("mc-gm")).toBeTruthy()); // fail-closed → setup modal
  });

  it("saving the config closes the modal (verified path) — Parcel Scan usable from then on", async () => {
    mocks.load.mockResolvedValue(null);
    mocks.save.mockResolvedValue({ ok: true });
    mocks.validate.mockResolvedValue({ ok: true, shopName: "ukaydaily" });
    render(<MyshipScanGate t={T} enabled onExit={() => {}}><div data-testid="scan" /></MyshipScanGate>);
    await waitFor(() => expect(screen.getByTestId("mc-gm")).toBeTruthy());
    fireEvent.change(screen.getByTestId("mc-gm"), { target: { value: "GM2609096099718" } });
    fireEvent.click(screen.getByText("rd_mc_save"));
    await waitFor(() => expect(screen.queryByTestId("mc-gate")).toBeNull());
  });

  it("unverified save (Render unreachable) STILL opens the gate — config exists; verify-optional never blocks", async () => {
    mocks.load.mockResolvedValue(null);
    mocks.save.mockResolvedValue({ ok: true });
    mocks.validate.mockResolvedValue({ ok: false, unreachable: true });
    render(<MyshipScanGate t={T} enabled onExit={() => {}}><div data-testid="scan" /></MyshipScanGate>);
    await waitFor(() => expect(screen.getByTestId("mc-gm")).toBeTruthy());
    fireEvent.change(screen.getByTestId("mc-gm"), { target: { value: "GM2609096099718" } });
    fireEvent.click(screen.getByText("rd_mc_save"));
    await waitFor(() => expect(screen.queryByTestId("mc-gate")).toBeNull());
  });

  it("an INVALID GM save keeps the gate closed (error shown, encode still blocked)", async () => {
    mocks.load.mockResolvedValue(null);
    mocks.save.mockResolvedValue({ ok: true });
    mocks.validate.mockResolvedValue({ ok: false, invalid: true });
    render(<MyshipScanGate t={T} enabled onExit={() => {}}><div data-testid="scan" /></MyshipScanGate>);
    await waitFor(() => expect(screen.getByTestId("mc-gm")).toBeTruthy());
    fireEvent.change(screen.getByTestId("mc-gm"), { target: { value: "GM2609096099718" } });
    fireEvent.click(screen.getByText("rd_mc_save"));
    await waitFor(() => expect(screen.getByText("rd_mc_invalid")).toBeTruthy());
    expect(screen.getByTestId("mc-gate")).toBeTruthy();
  });

  it("'Not now' backs out via onExit", async () => {
    mocks.load.mockResolvedValue(null);
    const onExit = vi.fn();
    render(<MyshipScanGate t={T} enabled onExit={onExit}><div /></MyshipScanGate>);
    await waitFor(() => expect(screen.getByTestId("mc-gate-back")).toBeTruthy());
    fireEvent.click(screen.getByTestId("mc-gate-back"));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

// SETTINGS-ONLY collapse (MyshipConfigCard): saved GM → compact line, full form
// hidden until Change; no GM → full form as today. Parcel Scan gate untouched.
describe("MyshipConfigCard (Settings)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("with a saved config → compact line (masked GM + ✓ set), the form is HIDDEN until Change", async () => {
    mocks.load.mockResolvedValue({ gmId: "GM2609096099718", ordMobile: "", shopName: "ukaydaily", verifiedAt: "x" });
    render(<MyshipConfigCard t={T} />);
    await waitFor(() => expect(screen.getByTestId("mc-compact")).toBeTruthy());
    expect(screen.getByTestId("mc-compact").textContent).toContain("GM260909…"); // first 8 + …
    expect(screen.getByLabelText("rd_mc_set")).toBeTruthy();                       // the ✓ "set" label
    expect(screen.queryByTestId("mc-gm")).toBeNull();                              // form hidden
    fireEvent.click(screen.getByTestId("mc-change"));                              // Change → expand
    await waitFor(() => expect(screen.getByTestId("mc-gm")).toBeTruthy());
    expect((screen.getByTestId("mc-gm") as HTMLInputElement).value).toBe("GM2609096099718"); // prefilled
  });

  it("with NO config → the full form shows immediately (no compact line)", async () => {
    mocks.load.mockResolvedValue(null);
    render(<MyshipConfigCard t={T} />);
    await waitFor(() => expect(screen.getByTestId("mc-gm")).toBeTruthy());
    expect(screen.queryByTestId("mc-compact")).toBeNull();
  });
});
