// Session V2 wiring (source contract) — the full authed RedesignApp is impractical to
// mount (same idiom as iosGates / printerSetupFlow), so the owner-gated branches are
// pinned against the source: owner → OwnerSessionModal + Start/End; non-owner → the
// unchanged SessionPickerModal path. Plus the Dashboard End-button visibility gate.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const app = readFileSync(join(__dirname, "../../RedesignApp.tsx"), "utf-8");
const dash = readFileSync(join(__dirname, "../Dashboard.tsx"), "utf-8");

describe("RedesignApp — Session V2 owner gating (source contract)", () => {
  it("connect flow: owner → OwnerSessionModal (setOwnerStart), NON-owner → the unchanged picker", () => {
    // owner short-circuits BEFORE setPickerConnect, and returns.
    expect(app).toMatch(/if \(sessionV2\) \{ setOwnerStart\(\{ kind: "tt", platform, acct \}\); return; \}\s*\n\s*setPickerConnect\(\{ kind: "tt", platform, acct \}\);/);
  });
  it("owner Start calls start_session(SESSION_V2_DAYS=7) then reset + connect", () => {
    expect(app).toMatch(/sessionInstance\.startSession\(SESSION_V2_DAYS\)/);
    const h = app.slice(app.indexOf("const onOwnerStart"), app.indexOf("const doEndSession"));
    expect(h).toMatch(/liveSession\.reset\(\)/);
    expect(h).toMatch(/connectPending\(pending\)/);
  });
  it("End button opens the CONFIRM dialog; only doEndSession() actually ends + clears board", () => {
    // the Dashboard End handler opens the confirm, it does NOT end directly.
    expect(app).toMatch(/onEndSession=\{sessionV2 \? \(\) => setEndConfirm\(true\) : undefined\}/);
    const h = app.slice(app.indexOf("const doEndSession"), app.indexOf("const doEndSession") + 400);
    expect(h).toMatch(/setEndConfirm\(false\)/);
    expect(h).toMatch(/await sessionInstance\.endSession\(\)/);
    expect(h).toMatch(/liveSession\.reset\(\)/);
  });
  it("EndSessionConfirm renders on endConfirm; Confirm → doEndSession", () => {
    expect(app).toMatch(/\{endConfirm && \(\s*\n\s*<EndSessionConfirm onConfirm=\{\(\) => void doEndSession\(\)\} onCancel=\{\(\) => setEndConfirm\(false\)\}/);
  });
  it("Dashboard receives the owner flag only for the owner", () => {
    expect(app).toMatch(/sessionV2Owner=\{sessionV2\}/);
  });
  it("OwnerSessionModal renders on ownerStart, alongside (not replacing) the picker", () => {
    expect(app).toMatch(/\{pickerConnect && \(\s*\n\s*<SessionPickerModal/); // picker path untouched
    expect(app).toMatch(/\{ownerStart && \(\s*\n\s*<OwnerSessionModal/);
  });
});

describe("Dashboard — owner End button REPLACES the session-ends pill (source contract)", () => {
  it("owner: red pulsing End button; non-owner: unchanged session-ends/continues pill", () => {
    // one indicator branch: owner → red End button, else → the existing pill.
    expect(dash).toMatch(/sessionV2Owner && onEndSession \? \(/);
    expect(dash).toMatch(/data-testid="session-end-btn"/);
    expect(dash).toMatch(/className="sfl-anim-endpulse"/);      // gentle glow
    expect(dash).toMatch(/background: "#D64545"/);              // red
    // the non-owner branches still exist unchanged.
    expect(dash).toMatch(/data-testid="session-continues"/);
    expect(dash).toMatch(/data-testid="session-ends"/);
  });
  it("both new props default off → non-owner Dashboard is unchanged", () => {
    expect(dash).toMatch(/sessionV2Owner = false, onEndSession,/);
  });
});
