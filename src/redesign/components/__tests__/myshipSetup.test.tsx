// MANDATORY 賣貨便 SETUP before Parcel Scan (2026-10-01 — replaces the H4
// dismissible banner). A parcel-check seller with NO config ("missing") gets a
// blocking modal BEFORE Parcel Scan opens: no ×, no tap-outside, no Escape;
// the only exits are a save (verified or unverified → Parcel Scan opens) and
// Back (Parcel Scan NOT opened). loading/error FAIL OPEN. Plus M6: an
// 'invalid' GM is never saved.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { useState } from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { MyshipConfigCard, MyshipConfigForm, MyshipSetupModal } from "../MyshipSetup";
import { useMyshipStatus, mustSetupBeforeScan } from "../../adapters/myshipStatus";

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

// Mirrors RedesignApp's wiring exactly (pinned below): the tile calls
// openParcelScan; the modal's onSaved opens the screen, Back just closes it.
function App({ checkOn }: { checkOn: boolean }) {
  const status = useMyshipStatus(checkOn, "u1");
  const [where, setWhere] = useState<"menu" | "parcelscan">("menu");
  const [open, setOpen] = useState(false);
  const openParcelScan = () => {
    if (mustSetupBeforeScan(checkOn, status)) setOpen(true);
    else setWhere("parcelscan");
  };
  return (
    <div>
      <div data-testid="where">{where}</div>
      <button data-testid="tile" onClick={openParcelScan}>tile</button>
      {where === "parcelscan" && <div data-testid="scan" data-checkon={String(checkOn && status !== "missing")} />}
      {open && <MyshipSetupModal t={T} onSaved={() => { setOpen(false); setWhere("parcelscan"); }} onBack={() => setOpen(false)} />}
    </div>
  );
}
const where = () => screen.getByTestId("where").textContent;
const probed = () => waitFor(() => expect(mocks.probe).toHaveBeenCalled()).then(() => act(async () => { await Promise.resolve(); }));
const fillAndSave = () => {
  fireEvent.change(screen.getByTestId("mc-gm"), { target: { value: "GM2609096099718" } });
  fireEvent.click(screen.getByText("rd_mc_save"));
};

describe("mandatory setup modal before Parcel Scan", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.load.mockResolvedValue(null); mocks.save.mockResolvedValue({ ok: true }); });

  it("missing → tile opens the MODAL (title + body + form), NOT Parcel Scan", async () => {
    mocks.probe.mockResolvedValue("missing");
    render(<App checkOn />);
    await probed();
    fireEvent.click(screen.getByTestId("tile"));
    expect(screen.getByTestId("mc-gate")).toBeTruthy();
    expect(screen.getByText("rd_mc_gate_title")).toBeTruthy();
    expect(screen.getByText("rd_mc_gate_body")).toBeTruthy();
    expect(screen.getByTestId("mc-gm")).toBeTruthy();
    expect(where()).toBe("menu");
    expect(screen.queryByTestId("scan")).toBeNull();
  });

  it("cannot be dismissed: no ×/close control, overlay tap and Escape do nothing", async () => {
    mocks.probe.mockResolvedValue("missing");
    render(<App checkOn />);
    await probed();
    fireEvent.click(screen.getByTestId("tile"));
    const gate = screen.getByTestId("mc-gate");
    expect(screen.queryByText("×")).toBeNull();
    expect(screen.queryByText("✕")).toBeNull();
    expect(screen.queryByTestId("mc-banner-close")).toBeNull();
    // only two buttons: Save + Back
    expect(gate.querySelectorAll("button").length).toBe(2);
    fireEvent.click(gate);
    fireEvent.pointerDown(gate);
    fireEvent.keyDown(gate, { key: "Escape" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByTestId("mc-gate")).toBeTruthy();
    expect(where()).toBe("menu");
  });

  it("Back → modal closes, Parcel Scan NOT opened; tapping the tile again re-shows it", async () => {
    mocks.probe.mockResolvedValue("missing");
    render(<App checkOn />);
    await probed();
    fireEvent.click(screen.getByTestId("tile"));
    fireEvent.click(screen.getByTestId("mc-gate-back"));
    expect(screen.queryByTestId("mc-gate")).toBeNull();
    expect(where()).toBe("menu");
    expect(screen.queryByTestId("scan")).toBeNull();
    fireEvent.click(screen.getByTestId("tile"));
    expect(screen.getByTestId("mc-gate")).toBeTruthy();
  });

  it("verified save → modal closes and Parcel Scan opens with checks ON; next tap goes straight in", async () => {
    mocks.probe.mockResolvedValue("missing");
    mocks.validate.mockResolvedValue({ ok: true, shopName: "ukaydaily" });
    render(<App checkOn />);
    await probed();
    fireEvent.click(screen.getByTestId("tile"));
    fillAndSave();
    await waitFor(() => expect(where()).toBe("parcelscan"));
    expect(screen.queryByTestId("mc-gate")).toBeNull();
    expect(screen.getByTestId("scan").getAttribute("data-checkon")).toBe("true");
  });

  it("unverified save (Render unreachable) counts as configured → Parcel Scan opens", async () => {
    mocks.probe.mockResolvedValue("missing");
    mocks.validate.mockResolvedValue({ ok: false, unreachable: true });
    render(<App checkOn />);
    await probed();
    fireEvent.click(screen.getByTestId("tile"));
    fillAndSave();
    await waitFor(() => expect(where()).toBe("parcelscan"));
    expect(mocks.save).toHaveBeenCalledWith("GM2609096099718", null); // cleared shop_name (MEDIUM-3)
    expect(screen.getByTestId("scan").getAttribute("data-checkon")).toBe("true");
  });

  it("an INVALID GM is not saved and the modal stays (still no way into Parcel Scan)", async () => {
    mocks.probe.mockResolvedValue("missing");
    mocks.validate.mockResolvedValue({ ok: false, invalid: true });
    render(<App checkOn />);
    await probed();
    fireEvent.click(screen.getByTestId("tile"));
    fillAndSave();
    await waitFor(() => expect(screen.getByText("rd_mc_invalid")).toBeTruthy());
    expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.getByTestId("mc-gate")).toBeTruthy();
    expect(where()).toBe("menu");
  });

  it("FAIL-OPEN: probe 'error' (and a rejected probe) → no modal, Parcel Scan opens", async () => {
    mocks.probe.mockResolvedValueOnce("error");
    const a = render(<App checkOn />);
    await probed();
    fireEvent.click(screen.getByTestId("tile"));
    expect(screen.queryByTestId("mc-gate")).toBeNull();
    expect(where()).toBe("parcelscan");
    a.unmount();
    mocks.probe.mockRejectedValueOnce(new Error("db down"));
    render(<App checkOn />);
    await waitFor(() => expect(mocks.probe).toHaveBeenCalledTimes(2));
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByTestId("tile"));
    expect(screen.queryByTestId("mc-gate")).toBeNull();
    expect(where()).toBe("parcelscan");
  });

  it("FAIL-OPEN: still loading at tap time → no modal, Parcel Scan opens", () => {
    mocks.probe.mockReturnValue(new Promise(() => {}));
    render(<App checkOn />);
    fireEvent.click(screen.getByTestId("tile"));
    expect(screen.queryByTestId("mc-gate")).toBeNull();
    expect(where()).toBe("parcelscan");
  });

  it("configured → straight into Parcel Scan, checks ON", async () => {
    mocks.probe.mockResolvedValue("configured");
    render(<App checkOn />);
    await probed();
    fireEvent.click(screen.getByTestId("tile"));
    expect(screen.queryByTestId("mc-gate")).toBeNull();
    expect(screen.getByTestId("scan").getAttribute("data-checkon")).toBe("true");
  });

  it("NON-allowlisted (checkOn=false) → unchanged: config never probed, no modal, Parcel Scan opens, checks off", () => {
    render(<App checkOn={false} />);
    fireEvent.click(screen.getByTestId("tile"));
    expect(mocks.probe).not.toHaveBeenCalled();
    expect(screen.queryByTestId("mc-gate")).toBeNull();
    expect(screen.getByTestId("scan").getAttribute("data-checkon")).toBe("false");
  });

  it("a GM saved elsewhere (Settings card form) unblocks the next tap without a re-probe", async () => {
    mocks.probe.mockResolvedValue("missing");
    mocks.validate.mockResolvedValue({ ok: true, shopName: "ukaydaily" });
    render(<><App checkOn /><MyshipConfigForm t={T} /></>);
    await probed();
    await waitFor(() => expect(mocks.load).toHaveBeenCalled());
    fillAndSave();
    await waitFor(() => expect(screen.getByTestId("mc-verified")).toBeTruthy());
    fireEvent.click(screen.getByTestId("tile"));
    expect(screen.queryByTestId("mc-gate")).toBeNull();
    expect(where()).toBe("parcelscan");
    expect(mocks.probe).toHaveBeenCalledTimes(1);
  });

  it("pure decision: only a definite 'missing' with checks on blocks", () => {
    expect(mustSetupBeforeScan(true, "missing")).toBe(true);
    for (const s of ["loading", "configured", "error"] as const) expect(mustSetupBeforeScan(true, s)).toBe(false);
    expect(mustSetupBeforeScan(false, "missing")).toBe(false);
  });
});

describe("RedesignApp wiring (the modal rule covers EVERY entry into Parcel Scan)", () => {
  const app = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
  it("openParcelScan is the ONLY way to set the parcelscan screen besides the modal's onSaved", () => {
    const sets = app.match(/setScreen\("parcelscan"\)/g) ?? [];
    expect(sets.length).toBe(2);
    expect(app).toContain('if (mustSetupBeforeScan(parcelCheckOn, myshipStatus)) setMyshipSetupOpen(true);\n    else setScreen("parcelscan");');
    expect(app).toContain('onSaved={() => { setMyshipSetupOpen(false); setScreen("parcelscan"); }}');
    expect(app).toContain("onBack={() => setMyshipSetupOpen(false)}");
    expect(app).toContain("onParcelScan={parcelAllowed ? openParcelScan : undefined}");
  });
  it("status hook is enabled by the same allowlist+market flag; checkOn derives from it; the old banner is gone", () => {
    expect(app).toContain("useMyshipStatus(parcelCheckOn, auth.profile?.authUserId)");
    expect(app).toContain('checkOn={parcelCheckOn && myshipStatus !== "missing"}');
    expect(app).not.toContain("MyshipScanGate");
    expect(app).not.toContain("banner={banner}");
    const shared = readFileSync("src/redesign/components/MyshipSetup.tsx", "utf8");
    expect(shared).not.toContain("mc-banner");
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
