// BOOT SMOKE TEST for the parcel-checker service worker (chrome-extension/
// background.js). Would have caught 1.12.0: it evaluates the REAL worker source
// under a faithful chrome stub, then drives BOTH lanes directly (pcTick swallows
// per-lane errors, so calling pcPoll / pcPollMulti themselves is what detects a
// throw) and asserts the multi lane runs all the way to the verdict write.
// 1.14.0: boot also RESETS the status keys (stale-after-reload, D4).
import { describe, it, expect } from "vitest";
import { bootWorker } from "./parcelCheckerHarness";

describe("parcel-checker worker BOOT smoke (the test 1.12.0 was missing)", () => {
  it("background.js evaluates under the chrome stub without throwing (top-level boot) and registers its listeners", async () => {
    const { sb, calls, booted } = bootWorker();
    await booted;
    expect(typeof sb.pcTick).toBe("function");
    expect(typeof sb.pcPoll).toBe("function");
    expect(typeof sb.pcPollMulti).toBe("function");
    expect(calls.scheduled).toContain(0); // pcScheduleLoop(0) armed at load
    expect(calls.logs.some((l) => /\[PC-BOOT\] parcel-checker worker started/.test(l))).toBe(true);
  });

  it("BOOT RESET (1.14.0): a stale pre-reload status is wiped to 'starting' before the first tick — nothing old can be displayed", async () => {
    // what a previous worker life left in chrome.storage BEFORE this boot ran
    const { status, booted } = bootWorker({ initialStatus: { sfl: "expired", myship: "ok", emap: "ok", emapSession: "ok", lastError: "old", multiQueueDepth: 4 } });
    await booted;
    const st = status();
    expect(st.sfl).toBe("starting");
    expect(st.myship).toBe("starting");
    expect(st.emap).toBe("starting");
    expect(st.emapSession).toBe("starting");
    expect(st.lastError).toBe("");
    expect(st.multiQueueDepth).toBeNull();
    expect(typeof st.bootAt).toBe("number");
  });

  it("legacy lane pcPoll runs the full SFL handshake + health prelude without throwing (multi mode → returns before its row loop)", async () => {
    const { sb, status, booted } = bootWorker({ multiSeller: true });
    await booted;
    await expect(sb.pcPoll()).resolves.not.toThrow();
    expect(status().sfl).toBe("connected"); // the handshake reached 'connected' — the 1.12.0 popup never did
  });

  it("multi lane pcPollMulti runs to the ROW LOOP and writes a verdict (does not throw, reaches the verdict RPC)", async () => {
    const { sb, calls, booted } = bootWorker({ multiSeller: true });
    await booted;
    await sb.pcPickEmapTab(); // the lane reads the tick's emap pick
    await expect(sb.pcPollMulti()).resolves.not.toThrow();
    expect(calls.fetch.some((u) => /admin_parcel_checks_pending/.test(u))).toBe(true);
    expect(calls.sendMessage.some((m) => m.type === "PC_CHECK_PHONE")).toBe(true); // row loop reached
    expect(calls.sendMessage.some((m) => m.type === "PC_CHECK_STORE")).toBe(true);
    expect(calls.fetch.some((u) => /admin_parcel_check_verdict/.test(u))).toBe(true);   // verdict written
  });

  it("a full pcTick (both lanes) completes, earns GREEN on all three tabs from real verdicts, and re-arms the ~5s loop", async () => {
    const { sb, calls, status, booted } = bootWorker({ multiSeller: true });
    await booted;
    await expect(sb.pcTick()).resolves.not.toThrow();
    expect(calls.scheduled).toContain(5000);
    const st = status();
    expect(st.sfl).toBe("connected");
    expect(st.myship).toBe("ok");
    expect(st.emap).toBe("ok");
    expect(st.emapDomain).toBe("emap.unipcsc.com.tw");
    expect(st.emapTabId).toBe(3);
    expect(calls.logs.some((l) => /\[PC-TICK\] #1 /.test(l))).toBe(true); // heartbeat on the first tick
  });

  it("robustness: chrome.tabs.update (autoDiscardable) THROWING must not break the find/handshake", async () => {
    const boot = bootWorker({ multiSeller: true });
    await boot.booted;
    (boot.sb.chrome as unknown as { tabs: { update: () => void } }).tabs.update = () => { throw new Error("autoDiscardable unsupported"); };
    await expect(boot.sb.pcPoll()).resolves.not.toThrow();
    expect(boot.status().sfl).toBe("connected");
  });

  it("robustness: no emap tab at all → the tick still completes; emap reads no_tab, myship still earns green", async () => {
    const { sb, status, booted } = bootWorker({ multiSeller: true, emapTab: false, cartDetailTab: false, rows: [] });
    await booted;
    await expect(sb.pcTick()).resolves.not.toThrow();
    expect(status().emap).toBe("no_tab"); // nothing parked on /cart/detail → no re-mint (1.14.7)
    expect(status().sfl).toBe("connected");
  });

  it("robustness: a throwing pick / keepalive / status block never stops the loop (every 1.14.0 block is wrapped)", async () => {
    const { sb, calls, booted } = bootWorker({ multiSeller: true });
    await booted;
    (sb.chrome as unknown as { tabs: { query: () => void } }).tabs.query = () => { throw new Error("tabs API gone"); };
    await expect(sb.pcTick()).resolves.not.toThrow();
    expect(calls.scheduled).toContain(5000);
  });
});
