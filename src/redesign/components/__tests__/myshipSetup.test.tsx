// PARCEL SCAN SETUP BANNER (Oct 1 audit H4 — replaced the 2026-09-27 hard
// gate). Parcel Scan is ALWAYS usable: a seller without a 賣貨便 GM gets a
// dismissible banner and checkOn=false (their rows are never checked anyway —
// the pending RPC INNER JOINs seller_myship_config). A config READ ERROR fails
// OPEN: no banner, no block, checkOn on. Plus M6: an 'invalid' GM is never saved.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MyshipScanGate, MyshipConfigCard, MyshipConfigForm } from "../MyshipSetup";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  validate: vi.fn(),
  probe: vi.fn(),
}));
vi.mock("../../adapters/parcelCheck", async (orig) => ({
  ...(await orig() as object),
  loadMyshipConfig: mocks.load,
  saveMyshipConfig: mocks.save,
  validateGm: mocks.validate,
  probeMyshipConfig: mocks.probe,
}));

const T = new Proxy({}, { get: (_o, k) => String(k) }) as never; // key-echo t

// The screen stand-in: exposes what the gate hands it.
const Screen = (checkOn: boolean, banner: React.ReactNode) => (
  <div>
    {banner}
    <div data-testid="scan" data-checkon={String(checkOn)} />
    <button data-testid="encode">encode</button>
  </div>
);
const checkOnAttr = () => screen.getByTestId("scan").getAttribute("data-checkon");

describe("MyshipScanGate — setup banner (H4)", () => {
  beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); mocks.load.mockResolvedValue(null); });

  it("enabled=false: pass-through, config NEVER read, no banner, checkOn off", () => {
    render(<MyshipScanGate t={T} enabled={false}>{Screen}</MyshipScanGate>);
    expect(checkOnAttr()).toBe("false");
    expect(screen.queryByTestId("mc-banner")).toBeNull();
    expect(mocks.probe).not.toHaveBeenCalled();
  });

  it("NO GM → banner (text + Set up), NO blocking overlay, checks OFF, Parcel Scan fully usable", async () => {
    mocks.probe.mockResolvedValue("missing");
    render(<MyshipScanGate t={T} enabled>{Screen}</MyshipScanGate>);
    await waitFor(() => expect(screen.getByTestId("mc-banner")).toBeTruthy());
    expect(screen.getByText("rd_mc_banner")).toBeTruthy();
    expect(screen.getByTestId("mc-banner-setup")).toBeTruthy();
    expect(checkOnAttr()).toBe("false");
    expect(screen.queryByTestId("mc-gate")).toBeNull(); // the old blocking modal is gone
    // nothing fixed/overlaying the screen: the encode control is reachable
    expect(document.querySelector('[style*="position: fixed"]')).toBeNull();
    const encode = vi.fn();
    screen.getByTestId("encode").addEventListener("click", encode);
    fireEvent.click(screen.getByTestId("encode"));
    expect(encode).toHaveBeenCalledTimes(1);
  });

  it("configured → no banner, checks ON", async () => {
    mocks.probe.mockResolvedValue("configured");
    render(<MyshipScanGate t={T} enabled>{Screen}</MyshipScanGate>);
    await waitFor(() => expect(mocks.probe).toHaveBeenCalled());
    await waitFor(() => expect(checkOnAttr()).toBe("true"));
    expect(screen.queryByTestId("mc-banner")).toBeNull();
  });

  it("FAIL-OPEN: a config load error → no banner, no block, checks ON (both error shapes)", async () => {
    mocks.probe.mockResolvedValueOnce("error");
    const a = render(<MyshipScanGate t={T} enabled>{Screen}</MyshipScanGate>);
    await waitFor(() => expect(mocks.probe).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("mc-banner")).toBeNull();
    expect(checkOnAttr()).toBe("true");
    a.unmount();
    mocks.probe.mockRejectedValueOnce(new Error("db down"));
    render(<MyshipScanGate t={T} enabled>{Screen}</MyshipScanGate>);
    await waitFor(() => expect(mocks.probe).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(screen.queryByTestId("mc-banner")).toBeNull();
    expect(checkOnAttr()).toBe("true");
  });

  it("while loading: no banner, nothing blocking (the screen renders from the first frame)", () => {
    mocks.probe.mockReturnValue(new Promise(() => {}));
    render(<MyshipScanGate t={T} enabled>{Screen}</MyshipScanGate>);
    expect(screen.getByTestId("scan")).toBeTruthy();
    expect(screen.queryByTestId("mc-banner")).toBeNull();
  });

  it("dismiss (×) hides the banner for this session; a remount keeps it hidden; checks stay off", async () => {
    mocks.probe.mockResolvedValue("missing");
    const a = render(<MyshipScanGate t={T} enabled>{Screen}</MyshipScanGate>);
    await waitFor(() => expect(screen.getByTestId("mc-banner")).toBeTruthy());
    fireEvent.click(screen.getByTestId("mc-banner-close"));
    expect(screen.queryByTestId("mc-banner")).toBeNull();
    expect(checkOnAttr()).toBe("false");
    a.unmount();
    render(<MyshipScanGate t={T} enabled>{Screen}</MyshipScanGate>);
    await waitFor(() => expect(mocks.probe).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(screen.queryByTestId("mc-banner")).toBeNull();
  });

  it("Set up → inline form; a verified save removes the banner and turns checks ON", async () => {
    mocks.probe.mockResolvedValue("missing");
    mocks.save.mockResolvedValue({ ok: true });
    mocks.validate.mockResolvedValue({ ok: true, shopName: "ukaydaily" });
    render(<MyshipScanGate t={T} enabled>{Screen}</MyshipScanGate>);
    await waitFor(() => expect(screen.getByTestId("mc-banner-setup")).toBeTruthy());
    fireEvent.click(screen.getByTestId("mc-banner-setup"));
    await waitFor(() => expect(screen.getByTestId("mc-gm")).toBeTruthy());
    fireEvent.change(screen.getByTestId("mc-gm"), { target: { value: "GM2609096099718" } });
    fireEvent.click(screen.getByText("rd_mc_save"));
    await waitFor(() => expect(screen.queryByTestId("mc-banner")).toBeNull());
    expect(checkOnAttr()).toBe("true");
  });

  it("an unverified save (Render unreachable) also counts as configured — checks ON", async () => {
    mocks.probe.mockResolvedValue("missing");
    mocks.save.mockResolvedValue({ ok: true });
    mocks.validate.mockResolvedValue({ ok: false, unreachable: true });
    render(<MyshipScanGate t={T} enabled>{Screen}</MyshipScanGate>);
    await waitFor(() => expect(screen.getByTestId("mc-banner-setup")).toBeTruthy());
    fireEvent.click(screen.getByTestId("mc-banner-setup"));
    await waitFor(() => expect(screen.getByTestId("mc-gm")).toBeTruthy());
    fireEvent.change(screen.getByTestId("mc-gm"), { target: { value: "GM2609096099718" } });
    fireEvent.click(screen.getByText("rd_mc_save"));
    await waitFor(() => expect(checkOnAttr()).toBe("true"));
    expect(mocks.save).toHaveBeenCalledWith("GM2609096099718", null); // cleared shop_name (MEDIUM-3)
  });
});

describe("MyshipConfigForm — validate before save (M6)", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.load.mockResolvedValue(null); mocks.save.mockResolvedValue({ ok: true }); });
  const submit = async (gm = "GM2609096099718") => {
    await waitFor(() => expect(mocks.load).toHaveBeenCalled());
    fireEvent.change(screen.getByTestId("mc-gm"), { target: { value: gm } });
    fireEvent.click(screen.getByText("rd_mc_save"));
  };

  it("'invalid' → NOTHING is saved, error shown, onSaved not called", async () => {
    mocks.validate.mockResolvedValue({ ok: false, invalid: true });
    const onSaved = vi.fn();
    render(<MyshipConfigForm t={T} onSaved={onSaved} />);
    await submit();
    await waitFor(() => expect(screen.getByText("rd_mc_invalid")).toBeTruthy());
    expect(mocks.save).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("ok → ONE save stamping the shop name (validation runs first)", async () => {
    mocks.validate.mockResolvedValue({ ok: true, shopName: "ukaydaily" });
    render(<MyshipConfigForm t={T} />);
    await submit();
    await waitFor(() => expect(screen.getByTestId("mc-verified")).toBeTruthy());
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledWith("GM2609096099718", "ukaydaily");
    expect(mocks.validate.mock.invocationCallOrder[0]).toBeLessThan(mocks.save.mock.invocationCallOrder[0]);
  });

  it("unreachable → saved unverified with a CLEARED shop name", async () => {
    mocks.validate.mockResolvedValue({ ok: false, unreachable: true });
    render(<MyshipConfigForm t={T} />);
    await submit();
    await waitFor(() => expect(screen.getByText("rd_mc_unverified")).toBeTruthy());
    expect(mocks.save).toHaveBeenCalledWith("GM2609096099718", null);
  });
});

// SETTINGS-ONLY collapse (MyshipConfigCard): saved GM → compact line, full form
// hidden until Change; no GM → full form as today.
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
