// Option E — SESSION-SAFETY CONTRACT (reads RedesignApp.tsx source, like the SQL
// contract tests). Pins the invariants the unified connect flow must not break:
//   • EXACTLY 3 startSession call sites (picker, owner, platform-switch) — no 4th.
//   • The new modal orchestration (commitLiveConnect / runSessionAware) NEVER calls
//     startSession directly (it funnels through picker/owner).
//   • Shopee-first funnels through the session-aware path (connectPending branches shopee).
//   • The owner "Start 7-day session" branch is preserved (sessionV2 → setOwnerStart).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
// The body of a named arrow function `const NAME = ... => { ... }` up to the next
// top-level `const … = ` at the same 2-space indent (good enough for these guards).
function body(name: string): string {
  const start = src.indexOf(`const ${name} = `);
  if (start < 0) return "";
  const after = src.slice(start + name.length);
  const next = after.search(/\n {2}const [a-zA-Z]+ = /);
  return next < 0 ? after : after.slice(0, next);
}

describe("Session-safety contract — startSession sites", () => {
  it("EXACTLY 3 startSession call sites (invariant #7)", () => {
    const n = (src.match(/sessionInstance\.startSession\(/g) || []).length;
    expect(n).toBe(3);
  });
  it("the 3 sites live in onPickSessionLength, onOwnerStart, confirmSwitch", () => {
    expect(body("onPickSessionLength")).toContain("sessionInstance.startSession(");
    expect(body("onOwnerStart")).toContain("sessionInstance.startSession(");
    expect(body("confirmSwitch")).toContain("sessionInstance.startSession(");
  });
  it("the NEW modal orchestration never calls startSession directly", () => {
    expect(body("commitLiveConnect")).not.toContain("startSession(");
    expect(body("runSessionAware")).not.toContain("startSession(");
    expect(body("openLiveConnect")).not.toContain("startSession(");
    expect(body("connectPending")).not.toContain("startSession(");
  });
});

describe("Session-safety contract — routing", () => {
  it("runSessionAware is session-aware (ensureLoaded → checkStatus → running?connect:picker/owner)", () => {
    const b = body("runSessionAware");
    expect(b).toContain("ensureLoaded()");
    expect(b).toContain("checkStatus()");
    expect(b).toContain("status.running");
    expect(b).toContain("setOwnerStart");
    expect(b).toContain("setPickerConnect");
  });
  it("connectPending branches Shopee (session-aware Shopee) vs TikTok performConnect", () => {
    const b = body("connectPending");
    expect(b).toContain('kind === "shopee"');
    expect(b).toContain("doShopeeConnect(");
    expect(b).toContain("performConnect(");
  });
  it("owner branch preserved: fresh connect → owner Start modal (SESSION_V2_DAYS), not the picker", () => {
    expect(body("onOwnerStart")).toContain("SESSION_V2_DAYS");
    expect(src).toContain('if (sessionV2) { setOwnerStart({ kind: "tt"'); // doConnect owner branch
  });
  it("platform switch reuses the running window length + reset (born-ended-safe)", () => {
    const b = body("confirmSwitch");
    expect(b).toContain("sessionWindowDays ?? SESSION_V2_DAYS");
    expect(b).toContain("liveSession.reset()");
  });
  it("H4 — confirmSwitch is guarded so a same-tick double-tap fires ONE start_session", () => {
    const b = body("confirmSwitch");
    // the guard returns early on a re-entrant call, and the latch is set BEFORE the
    // awaited startSession — so two synchronous taps can never both reach it.
    expect(b).toContain("if (switchingRef.current) return;");
    const latchIdx = b.indexOf("switchingRef.current = true;");
    const startIdx = b.indexOf("sessionInstance.startSession(");
    expect(latchIdx).toBeGreaterThan(-1);
    expect(latchIdx).toBeLessThan(startIdx);          // latch precedes the mint
    expect(b).toContain("switchingRef.current = false;"); // released in finally
  });
});

// H1/H2 — session-RPC v2. Switch detection is SERVER-anchored (session_status platform),
// the 3 sites stamp the connecting platform, and only confirmSwitch forces a mint.
describe("Session-safety contract — H1/H2 platform anchor", () => {
  it("switch detection is SERVER-anchored (connectIsSwitch on status.platform; flags only when it is NULL)", () => {
    // runSessionAware (new flow) decides via the server platform + routes a switch to the confirm.
    const rsa = body("runSessionAware");
    expect(rsa).toContain("connectIsSwitch(status.platform, target.platform, { ttEff, shopeeEff })");
    expect(rsa).toContain("setSwitchConfirm(");
    // doConnect (active old-dropdown path) applies the same server anchor for TikTok.
    expect(src).toContain('connectIsSwitch(status.platform, "TikTok", { ttEff, shopeeEff })');
    // commitLiveConnect no longer uses the in-memory client-flag anchor.
    const clc = body("commitLiveConnect");
    expect(clc).not.toContain("livePlatformOf");
    expect(clc).not.toContain("isPlatformSwitch");
  });
  it("the 3 startSession sites stamp the connecting platform; only confirmSwitch forces a mint", () => {
    expect(body("onPickSessionLength")).toContain("platformOfPending(pending)");
    expect(body("onOwnerStart")).toContain("platformOfPending(pending)");
    // confirmSwitch mints with the target platform + force=true.
    expect(body("confirmSwitch")).toContain("startSession(days, target.platform, true)");
    // first-connect sites pass force=false (reuse-if-running); never true.
    expect(body("onPickSessionLength")).toContain(", false)");
    expect(body("onOwnerStart")).toContain(", false)");
  });
});

// sql/86 — a first-connect start_session can answer "switch needed" (another device started a
// session on another platform). Both first-connect sites route it to the switch confirm BEFORE
// the generic failure toast; the switch site never gets it (force=true never raises).
describe("Session-safety contract — sql/86 switch needed", () => {
  for (const site of ["onPickSessionLength", "onOwnerStart"]) {
    it(`${site}: SESSION_SWITCH_NEEDED → setSwitchConfirm(targetOfPending(pending)), checked before !sid`, () => {
      const b = body(site);
      const sw = b.indexOf("if (sid === SESSION_SWITCH_NEEDED) { setSwitchConfirm(targetOfPending(pending)); return; }");
      expect(sw).toBeGreaterThan(-1);
      expect(sw).toBeLessThan(b.indexOf("if (!sid)"));
      expect(sw).toBeLessThan(b.indexOf("liveSession.reset()"));
    });
  }
  it("confirmSwitch is unchanged (force mint; no switch-needed branch)", () => {
    expect(body("confirmSwitch")).not.toContain("SESSION_SWITCH_NEEDED");
  });
  it("targetOfPending maps every pending kind back to its connect target", () => {
    const t = src.slice(src.indexOf("const targetOfPending"), src.indexOf("\n", src.indexOf("const targetOfPending")));
    expect(t).toContain('{ platform: "Shopee", shopId: p.shopId, sessionId: p.sessionId }');
    expect(t).toContain('{ platform: "Facebook", pageId: p.pageId, scopeKey: p.scopeKey }');
    expect(t).toContain('{ platform: "TikTok", username: p.acct, register: p.register }');
  });
});
