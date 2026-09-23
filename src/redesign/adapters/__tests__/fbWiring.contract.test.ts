// F-P3 SOURCE CONTRACT — the full authed RedesignApp/Dashboard are impractical to mount
// (jsdom baseline; same idiom as sessionV2.wiring / iosGates / liveSourceSession). Pins
// the money-path-adjacent FB wiring against the source:
//   • byte-identical activation gate for non-allowlisted (gate strings retained; the
//     real picker is behind fbConnectEnabled);
//   • CARRY-FORWARD #1 — FB comments with initial:true route through the SAME
//     platform-generic display-only branch (no platform filter excludes Facebook);
//   • CARRY-FORWARD #2 — server-anchored platform switch BOTH directions;
//   • FB connect funnels through commitLiveConnect → runSessionAware (no 4th startSession).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const app = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
const dash = readFileSync("src/redesign/screens/Dashboard.tsx", "utf8");
const feed = readFileSync("src/redesign/adapters/useLiveFeed.ts", "utf8");

describe("Dashboard — FB dropdown: byte-identical gate off, real picker on", () => {
  it("the activation-required HONEST GATE strings are RETAINED (non-allowlisted unchanged)", () => {
    expect(dash).toContain("t.rd_dash_fb_activation");
    expect(dash).toContain("t.rd_dash_fb_contact");
    expect(dash).toContain("TELEGRAM_URL"); // the real Telegram anchor stays
  });
  it("the real page picker + Connect is gated behind fbConnectEnabled", () => {
    expect(dash).toMatch(/\{fbConnectEnabled \?/);      // ternary: on → picker, off → gate
    expect(dash).toContain("onPickFB");
    expect(dash).toContain("onConnectFB");
    expect(dash).toContain("onManageFB");
    expect(dash).toContain("connLabel(fbConnected, fbConnecting)"); // real Connect button
  });
  it("fbConnectEnabled defaults OFF (non-allowlisted sellers get the gate)", () => {
    expect(dash).toMatch(/fbConnectEnabled = false/);
  });
});

describe("RedesignApp — FB visibility gate = flag OR owner preview", () => {
  it("fbEnabled = fbFlag || fbPreview (mirror shopeeEnabled); preview from FB_PREVIEW_EMAILS", () => {
    expect(app).toMatch(/const fbEnabled = fbFlag \|\| fbPreview;/);
    expect(app).toMatch(/const fbPreview = fbPreviewEnabled\(auth\.profile\?\.email\);/);
  });
  it("the FB dropdown's fbConnectEnabled is wired to fbEnabled", () => {
    expect(app).toMatch(/fbConnectEnabled=\{fbEnabled\}/);
  });
  it("Facebook selection scopes to the PAGE key ONLY when fbEnabled (else unchanged)", () => {
    expect(app).toMatch(/Facebook: fbEnabled \? fbScopeKey : \(fbAccounts\[fbIdx\] \|\| ""\)/);
    expect(app).toMatch(/const fbScopeKey = selectedPage \? \(selectedPage\.username \|\| selectedPage\.pageId\) : "";/);
  });
  it("parseFbReturn is handled on load (?fb=connected|error) → toast + reload", () => {
    expect(app).toContain("parseFbReturn(window.location.search)");
    expect(app).toContain("reloadFbPages");
  });
});

describe("CARRY-FORWARD #2 — server-anchored platform switch, BOTH directions", () => {
  it("FB connect funnels through commitLiveConnect (→ runSessionAware's generic switch guard)", () => {
    expect(app).toMatch(/commitLiveConnect\(\{ platform: "Facebook", pageId: selectedPage\.pageId, scopeKey: fbScopeKey \}\)/);
  });
  it("runSessionAware anchors the switch generically on target.platform (FB while TikTok runs → confirm)", () => {
    expect(app).toContain("isServerPlatformSwitch(status.platform, target.platform)");
  });
  it("doConnect's TikTok guard anchors on status.platform (TikTok while FB runs → confirm)", () => {
    expect(app).toContain('isServerPlatformSwitch(status.platform, "TikTok")');
  });
  it("confirmSwitch force-mints stamped with the target platform (Facebook included)", () => {
    expect(app).toContain("sessionInstance.startSession(days, target.platform, true)");
  });
  it("runTargetConnect + connectPending route a Facebook/fb target to doFbConnect", () => {
    expect(app).toMatch(/target\.platform === "Facebook"\) void doFbConnect\(target\.pageId\)/);
    expect(app).toMatch(/p\.kind === "fb"\) void doFbConnect\(p\.pageId\)/);
  });
});

describe("session-safety — no 4th startSession site (FB reuses the funnel)", () => {
  it("EXACTLY 3 sessionInstance.startSession(...) call sites remain", () => {
    const n = (app.match(/sessionInstance\.startSession\(/g) || []).length;
    expect(n).toBe(3);
  });
  it("doFbConnect never calls startSession (it POSTs /fb/connect only)", () => {
    const start = app.indexOf("const doFbConnect");
    const end = app.indexOf("const runTargetConnect");
    const body = app.slice(start, end > start ? end : start + 1200);
    expect(body).not.toContain("startSession(");
    expect(body).toContain("fbConnect(pageId)");
    expect(body).toContain("liveFeed.ensureJoined()");
  });
});

describe("CARRY-FORWARD #1 — FB initial:true rides the platform-generic display-only lane", () => {
  it("the initial branch fires on `initial === true` with NO platform gate before it", () => {
    // The display-only branch keys on the flag alone, so Facebook (a 3rd platform) routes
    // through it exactly like TikTok/Shopee — before the Auto-Mode seam (onCommentRef).
    const idx = feed.indexOf(".initial === true");
    expect(idx).toBeGreaterThan(-1);
    // the Auto-Mode seam (onCommentRef) comes AFTER the initial branch's early return.
    const seam = feed.indexOf("onCommentRef.current?.(c)");
    expect(seam).toBeGreaterThan(idx);
    // the branch is not restricted to a platform (no `c.platform === "TikTok"` guard on it).
    const branch = feed.slice(idx - 200, idx + 60);
    expect(branch).not.toMatch(/platform === "TikTok"[\s\S]*initial === true/);
  });
  it("the comment coercion RETAINS Facebook (not coerced away to TikTok)", () => {
    expect(feed).toContain('d.platform === "Facebook" ? "Facebook"');
  });
});
