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
    expect(app).toMatch(/if \(sessionV2\) \{ setOwnerStart\(\{ platform, acct \}\); return; \}\s*\n\s*setPickerConnect\(\{ platform, acct \}\);/);
  });
  it("owner Start calls start_session(5) via SESSION_V2_DAYS then reset + connect", () => {
    expect(app).toMatch(/sessionInstance\.startSession\(SESSION_V2_DAYS\)/);
    const h = app.slice(app.indexOf("const onOwnerStart"), app.indexOf("const onEndSession"));
    expect(h).toMatch(/liveSession\.reset\(\)/);
    expect(h).toMatch(/performConnect\(pending\.platform, pending\.acct\)/);
  });
  it("owner End calls endSession() then clears the board", () => {
    const h = app.slice(app.indexOf("const onEndSession"), app.indexOf("const onEndSession") + 400);
    expect(h).toMatch(/await sessionInstance\.endSession\(\)/);
    expect(h).toMatch(/liveSession\.reset\(\)/);
  });
  it("Dashboard receives the owner flag + End handler only for the owner", () => {
    expect(app).toMatch(/sessionV2Owner=\{sessionV2\}/);
    expect(app).toMatch(/onEndSession=\{sessionV2 \? \(\) => void onEndSession\(\) : undefined\}/);
  });
  it("OwnerSessionModal renders on ownerStart, alongside (not replacing) the picker", () => {
    expect(app).toMatch(/\{pickerConnect && \(\s*\n\s*<SessionPickerModal/); // picker path untouched
    expect(app).toMatch(/\{ownerStart && \(\s*\n\s*<OwnerSessionModal/);
  });
});

describe("Dashboard — End Session button visibility (source contract)", () => {
  it("renders only when sessionV2Owner AND a session is running AND a handler exists", () => {
    expect(dash).toMatch(/\{sessionV2Owner && sessionEndsAt && onEndSession && \(/);
    expect(dash).toMatch(/data-testid="session-end-btn"/);
  });
  it("both new props default off → non-owner Dashboard is unchanged", () => {
    expect(dash).toMatch(/sessionV2Owner = false, onEndSession,/);
  });
});
