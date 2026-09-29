// 1.14.3 — unattended E-Map re-mint: when the recovery ladder reaches 'dead' the
// worker asks the 賣貨便 tab parked on /cart/detail to click the REAL 選擇取貨門市
// button (page JS posts with its own live token — nothing stored), then adopts the
// guid-bearing E-Map tab that appears, closes the old dead one, and pins it. One
// attempt per dead episode; no /cart/detail tab or no tab within 20 s → red with
// the exact reason. Plus the myship content-script guard: the click target can
// NEVER be a submit / 送出結帳-style control.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { bootWorker, type EmapTab } from "./parcelCheckerHarness";

const MIN = 60 * 1000;
const DEAD_URL = "https://emap.unipcsc.com.tw/mobilemap/default.aspx";
const reopens = (calls: { update: unknown[] }) => calls.update.filter((u) => (u as { props: { url?: string } }).props.url).map((u) => (u as { id: number }).id);
const clicks = (calls: { sendMessage: { type: string; tabId: number }[] }) => calls.sendMessage.filter((m) => m.type === "PC_CLICK_PICK_STORE").map((m) => m.tabId);

// Drive a fresh worker whose only E-Map tab has no guid all the way to 'dead'.
async function driveToDead(opts: Parameters<typeof bootWorker>[0]) {
  let t = 1_000_000_000_000;
  const clock = { get: () => t, add: (ms: number) => { t += ms; } };
  const boot = bootWorker({ ...opts, now: () => t, rows: [], emapTabs: opts.emapTabs ?? [{ id: 7, url: DEAD_URL, guid: false }] });
  await boot.booted;
  await boot.sb.pcTick(); clock.add(5000); await boot.sb.pcTick(); clock.add(5000); await boot.sb.pcTick(); // 3 misses
  clock.add(2 * MIN); await boot.sb.pcTick();               // GET re-open #1
  clock.add(61 * 1000); await boot.sb.pcTick();             // GET re-open #2
  expect(reopens(boot.calls)).toEqual([7, 7]);
  return { ...boot, clock };
}

describe("1.14.3 · unattended re-mint via the parked 賣貨便 /cart/detail tab", () => {
  it("dead → the click is issued ONCE to the /cart/detail tab; a guid-bearing E-Map tab appears → adopted, old tab closed + pinned, keepalive verdict → green", async () => {
    const { sb, calls, status, clock, emapTabs } = await driveToDead({
      onPickStoreClick: (tabs: EmapTab[]) => { tabs.push({ id: 9, url: "https://emap.unipcsc.com.tw/mobilemap/default.aspx", guid: true }); return { clicked: true }; },
    });
    clock.add(61 * 1000); await sb.pcTick();                 // the tick where the ladder reaches 'dead' → re-mint fires
    expect(clicks(calls)).toEqual([2]);                      // exactly one click, to the myship /cart/detail tab
    expect(status().emap).toBe("reminting");
    expect(calls.logs.some((l) => /\[PC-EMAP\] re-mint: clicked 選擇取貨門市 .* on 賣貨便 tab 2; waiting ≤20s .*old tab 7/.test(l))).toBe(true);
    clock.add(5000); await sb.pcTick();                      // next tick: the new tab is picked → adopted
    expect(status().emapTabId).toBe(9);
    expect(calls.removed).toEqual([7]);                      // old dead tab closed
    expect(emapTabs.map((x) => x.id)).toEqual([9]);
    expect(calls.update.some((u) => (u as { id: number; props: { autoDiscardable?: boolean } }).id === 9 && (u as { props: { autoDiscardable?: boolean } }).props.autoDiscardable === false)).toBe(true);
    expect(calls.logs.some((l) => /\[PC-EMAP\] re-mint via 選擇取貨門市 → tab 9 https:\/\/emap\.unipcsc\.com\.tw\/mobilemap\/default\.aspx guid=true \(closed old tab 7\)/.test(l))).toBe(true);
    expect(status().emap).toBe("ok");                        // keepalive fired immediately on the adopted tab → verdict
    expect(clicks(calls)).toEqual([2]);                      // still one click
    // the episode is over: a later dead episode may re-mint again (tried reset by the verdict)
    clock.add(10 * MIN); await sb.pcTick();
    expect(clicks(calls)).toEqual([2]);
  });

  it("no /cart/detail tab → NO click, red immediately with the 'park myship on /cart/detail' reason; never loops", async () => {
    const { sb, calls, status, clock } = await driveToDead({ cartDetailTab: false });
    clock.add(61 * 1000); await sb.pcTick();
    expect(clicks(calls)).toEqual([]);
    expect(status().emap).toBe("dead");
    expect(status().emapDeadReason).toBe("no_cart_detail");
    expect(calls.logs.some((l) => /\[PC-EMAP\] re-mint skipped: no 賣貨便 tab parked on \/cart\/detail/.test(l))).toBe(true);
    for (let i = 0; i < 20; i++) { clock.add(30 * 1000); await sb.pcTick(); }
    expect(clicks(calls)).toEqual([]);
    expect(reopens(calls)).toEqual([7, 7]);
    expect(status().emap).toBe("dead");
  });

  it("click issued but no guid-bearing E-Map tab within 20 s → red with reason 'timeout'; ONE attempt per episode (no second click)", async () => {
    const { sb, calls, status, clock } = await driveToDead({ onPickStoreClick: () => ({ clicked: true }) }); // click "works" but nothing appears
    clock.add(61 * 1000); await sb.pcTick();
    expect(clicks(calls)).toEqual([2]);
    expect(status().emap).toBe("reminting");
    clock.add(10 * 1000); await sb.pcTick();
    expect(status().emap).toBe("reminting");
    clock.add(11 * 1000); await sb.pcTick();                 // 21 s → window closed
    expect(status().emap).toBe("dead");
    expect(status().emapDeadReason).toBe("timeout");
    for (let i = 0; i < 10; i++) { clock.add(MIN); await sb.pcTick(); }
    expect(clicks(calls)).toEqual([2]);                      // never a second click in the same episode
  });

  it("the myship tab refuses the click (wrong page / guard) → red with the refusal reason, no adoption wait", async () => {
    const { sb, calls, status, clock } = await driveToDead({ onPickStoreClick: () => ({ clicked: false, reason: "not on /cart/detail (on /seller/order)" }) });
    clock.add(61 * 1000); await sb.pcTick();
    expect(clicks(calls)).toEqual([2]);
    expect(status().emap).toBe("dead");
    expect(String(status().emapDeadReason)).toBe("click_refused: not on /cart/detail (on /seller/order)");
  });

  it("same-tab navigation: if the click turns the parked tab itself into the E-Map tab, it is adopted without closing anything", async () => {
    const { sb, calls, status, clock, emapTabs } = await driveToDead({
      onPickStoreClick: (tabs: EmapTab[]) => { tabs.splice(0, tabs.length); tabs.push({ id: 2, url: "https://emap.unipcsc.com.tw/mobilemap/default.aspx", guid: true }); return { clicked: true }; },
    });
    clock.add(61 * 1000); await sb.pcTick();
    clock.add(5000); await sb.pcTick();
    expect(status().emapTabId).toBe(2);
    expect(calls.removed).toEqual([7]);                      // the OLD dead emap tab (7) is closed; the adopted tab (2) never is
    expect(emapTabs.map((x) => x.id)).toEqual([2]);
    expect(status().emap).toBe("ok");
  });
});

// ── myship content script: the click target guard ──────────────────────────
type Handler = (m: { type: string }, s: unknown, send: (r: unknown) => void) => boolean;
function loadMyship(html: string, url: string) {
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  const win = dom.window as unknown as Window;
  const clicked: string[] = [];
  for (const el of Array.from(win.document.querySelectorAll("button,input,a"))) (el as HTMLElement).addEventListener("click", () => clicked.push(el.id || String(el.textContent || "").trim() || (el as HTMLInputElement).value));
  let handler: Handler | null = null;
  const sandbox: Record<string, unknown> = {
    window: win, document: win.document, location: win.location, setTimeout: win.setTimeout.bind(win), clearTimeout: win.clearTimeout.bind(win),
    fetch: vi.fn(), AbortController: (win as unknown as typeof globalThis).AbortController, URLSearchParams: (win as unknown as typeof globalThis).URLSearchParams, Promise, Date, Math, String, Number, Boolean, Object, Array, RegExp, Error, JSON, console: { log: () => {}, warn: () => {}, error: () => {} },
    chrome: { runtime: { onMessage: { addListener: (h: Handler) => { handler = h; } } } },
  };
  vm.createContext(sandbox);
  vm.runInNewContext(readFileSync("chrome-extension/myship-711.js", "utf8"), sandbox, { filename: "myship-711.js" });
  const send = (type: string) => new Promise<Record<string, unknown>>((resolve) => { handler!({ type }, {}, (r) => resolve(r as Record<string, unknown>)); });
  return { send, clicked };
}
const CART_DETAIL = (extra = "") => `<html><body><form id="checkout" method="post" action="/cart/checkout">
<input type="text" name="NAME" id="NAME" value="" /><input type="text" name="TELEPHONE" id="TELEPHONE" value="" />
<button type="button" class="btn btn-outline-primary btn-bg-pink" onclick="jsEmap('2');">選擇取貨門市</button>
<button type="button" id="choiceReturnStore" onclick="jsEmap('3');">選擇退貨門市</button>
<button type="submit" id="btnCheckout">送出結帳</button>
<input type="submit" id="btnSubmit" value="Submit Order" />
${extra}</form></body></html>`;

describe("1.14.3 · myship-711 PC_CLICK_PICK_STORE guard — the click target can never be the submit button", () => {
  it("on /cart/detail: clicks exactly the 選擇取貨門市 button (jsEmap onclick), nothing else; NAME/TELEPHONE untouched", async () => {
    const { send, clicked } = loadMyship(CART_DETAIL(), "https://myship.7-11.com.tw/cart/detail");
    const r = await send("PC_CLICK_PICK_STORE");
    expect(r.clicked).toBe(true);
    expect(clicked).toEqual(["選擇取貨門市"]);
  });

  it("refuses on any other myship page (parked tab must be /cart/detail)", async () => {
    const { send, clicked } = loadMyship(CART_DETAIL(), "https://myship.7-11.com.tw/seller/order");
    const r = await send("PC_CLICK_PICK_STORE");
    expect(r.clicked).toBe(false);
    expect(String(r.reason)).toMatch(/not on \/cart\/detail/);
    expect(clicked).toEqual([]);
  });

  it("HARD GUARD: a submit-typed / 送出結帳-worded control is never clicked even if it carries a jsEmap onclick and the pick-store text", async () => {
    const trap = `<html><body><form><button type="submit" onclick="jsEmap('2');">選擇取貨門市</button><button type="submit" id="btnCheckout">送出結帳</button></form></body></html>`;
    const a = loadMyship(trap, "https://myship.7-11.com.tw/cart/detail");
    expect((await a.send("PC_CLICK_PICK_STORE")).clicked).toBe(false);
    expect(a.clicked).toEqual([]);
    const trap2 = `<html><body><form><button type="button" id="btnCheckout" onclick="jsEmap('2');">選擇取貨門市 送出結帳</button></form></body></html>`;
    const b = loadMyship(trap2, "https://myship.7-11.com.tw/cart/detail");
    expect((await b.send("PC_CLICK_PICK_STORE")).clicked).toBe(false);
    expect(b.clicked).toEqual([]);
    const trap3 = `<html><body><form><input type="submit" onclick="jsEmap('2');" value="選擇取貨門市" /></form></body></html>`;
    const c = loadMyship(trap3, "https://myship.7-11.com.tw/cart/detail");
    expect((await c.send("PC_CLICK_PICK_STORE")).clicked).toBe(false);
    expect(c.clicked).toEqual([]);
    // and with NO pick button at all, nothing is clicked (the submit button is never a fallback)
    const none = loadMyship(`<html><body><form><button type="submit" id="btnCheckout">送出結帳</button></form></body></html>`, "https://myship.7-11.com.tw/cart/detail");
    expect((await none.send("PC_CLICK_PICK_STORE")).clicked).toBe(false);
    expect(none.clicked).toEqual([]);
  });

  it("source pins: the guard rejects explicit type=submit and the forbidden words; the finder requires a jsEmap( onclick", () => {
    const src = readFileSync("chrome-extension/myship-711.js", "utf8");
    expect(src).toContain('if (explicitType === "submit") return false;');
    expect(src).toContain("const FORBIDDEN_RE = /送出|結帳|submit|checkout|付款|購買|order|下一步|next/i;");
    expect(src).toContain("if (!/^jsEmap\\(/.test(onclick) || !PICK_TEXT_RE.test(text)) continue;");
    expect(src).toContain('if (!/^\\/cart\\/detail/i.test(String(pathname || "")))');
    expect(src).not.toMatch(/\.value\s*=/); // never writes a field
  });
});
