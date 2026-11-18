// Admin → 7-11 Login: the "Who is checking" card INSIDE the real panel (fetch is faked).
//   · where it sits in every state of the panel (as in the approved pictures)
//   · logged out + the server on duty: the "checks are paused" sentence is hidden (it is not true then)
//   · the Telegram alerts card names the take-over and hand-back alerts too
//   · it is asked when the panel opens, every 30 s in front, never hidden, never in the login steps
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import Pc711Panel from "../Pc711Panel";
import { TProvider } from "../../i18n";

vi.mock("../../../supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } } }));

const NOW = Date.parse("2026-11-18T06:08:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const duty = (over: Record<string, unknown> = {}) => ({
  backup: "on", onDuty: false, loggedOut: false, reason: null, since: null, answered: null, answeredMore: false,
  checker: { label: "Lenovo", lastCallAt: iso(NOW - 4000) }, last: null, now: iso(NOW), ...over,
});
const ON_DUTY = { onDuty: true, reason: "silent", since: iso(NOW - 22 * 60_000), answered: 37 };
const CONNECTED = { state: "connected", since: "2026-11-16T17:21:07Z", lastOkAt: "2026-11-18T05:58:26Z", autoLogins: 1, phoneTail: "678" };
const LOGGED_OUT = { state: "needs_login", since: "2026-11-16T09:30:00Z", lastOkAt: "2026-11-18T05:40:40Z", autoLogins: 1, phoneTail: "678", lastProblem: "cart_logged_out",
  loggedOutSince: "2026-11-18T05:46:12Z", passive: { lastAt: "2026-11-18T06:06:12Z", nextAt: "2026-11-18T06:16:12Z", kind: "logged_out" } };
const PAUSED = "Store and phone checks are paused. Nothing is sent to 7‑11 until the server is logged in again.";

type Resp = { ok?: boolean; status?: number; body: unknown };
let answers: Record<string, Resp> = {};
let calls: { path: string; method: string }[] = [];
let vis: "visible" | "hidden" = "visible";
const count = (path: string) => calls.filter((c) => c.path === path).length;
const settle = () => act(async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); });
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const open = async (status: Record<string, unknown>, dutyAnswer: Resp | null) => {
  answers["/status"] = { body: status };
  if (dutyAnswer) answers["/duty"] = dutyAnswer;
  const r = render(<TProvider lang="en"><Pc711Panel /></TProvider>);
  await settle();
  return r;
};
/** a comes before b on the page */
const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  answers = {}; calls = []; vis = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => vis });
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string, init: { method?: string }) => {
    const path = new URL(url, "http://x").pathname.replace("/admin/pc711", "");
    calls.push({ path, method: init?.method || "GET" });
    const r = answers[path] || { body: {} };
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.body };
  });
});
afterEach(() => {
  vi.useRealTimers();
  delete (document as unknown as { visibilityState?: unknown }).visibilityState;
});

describe("where the card sits", () => {
  it("connected: under the Connected card and its two buttons, above Telegram alerts", async () => {
    await open(CONNECTED, { body: duty() });
    const card = screen.getByTestId("pc711-duty-wrap");
    expect(screen.getByTestId("pc711-duty").getAttribute("data-state")).toBe("normal");
    expect(before(screen.getByTestId("pc711-test"), card)).toBe(true);
    expect(before(screen.getByTestId("pc711-disconnect"), card)).toBe(true);
    expect(before(card, screen.getByTestId("pc711-alert"))).toBe(true);
    expect(before(screen.getByTestId("pc711-alert"), screen.getByTestId("pc711-shadow"))).toBe(true);
    // it is the element right after the row of the two buttons
    expect(screen.getByTestId("pc711-test").parentElement!.nextElementSibling).toBe(card);
    expect(card.nextElementSibling).toBe(screen.getByTestId("pc711-alert"));
    expect(screen.getAllByTestId("pc711-duty")).toHaveLength(1);
  });
  it("logged out: under the Log in button (so \"Log in above\" is true), above Telegram alerts", async () => {
    await open(LOGGED_OUT, { body: duty({ ...ON_DUTY, loggedOut: true }) });
    const card = screen.getByTestId("pc711-duty-wrap");
    expect(screen.getByTestId("pc711-duty").getAttribute("data-state")).toBe("duty_out");
    expect(screen.getByTestId("pc711-duty-out").textContent).toBe("The server is logged out. Log in above.");
    expect(screen.getByTestId("pc711-begin").nextElementSibling).toBe(card);
    expect(before(screen.getByTestId("pc711-logged-out"), card)).toBe(true);
    expect(card.nextElementSibling).toBe(screen.getByTestId("pc711-alert"));
  });
  it("not connected: under the Connect button", async () => {
    await open({ state: "not_connected" }, { body: duty({ backup: "off" }) });
    const card = screen.getByTestId("pc711-duty-wrap");
    expect(screen.getByTestId("pc711-duty").textContent).toBe("Who is checkingBackup: offLast call from the Lenovo4 s ago");
    expect(screen.getByTestId("pc711-begin").nextElementSibling).toBe(card);
    expect(card.nextElementSibling).toBe(screen.getByTestId("pc711-alert"));
  });
  it("no session key on the server: under the key sentence", async () => {
    await open({ state: "key_missing" }, { body: duty({ backup: "off" }) });
    expect(screen.getByTestId("pc711-key-missing").nextElementSibling).toBe(screen.getByTestId("pc711-duty-wrap"));
    expect(screen.getByTestId("pc711-duty").getAttribute("data-state")).toBe("off");
  });
  it("all four states of the card show inside the panel", async () => {
    const cases: [Record<string, unknown>, Record<string, unknown>, string, string][] = [
      [CONNECTED, duty(), "normal", "The Lenovo is checking · Server: standby"],
      [CONNECTED, duty(ON_DUTY), "duty", "The server is checking now"],
      [LOGGED_OUT, duty({ ...ON_DUTY, loggedOut: true }), "duty_out", "The server is checking now"],
      [CONNECTED, duty({ backup: "off" }), "off", "Backup: off"],
    ];
    for (const [status, d, state, line] of cases) {
      const r = await open(status, { body: d });
      expect([screen.getByTestId("pc711-duty").getAttribute("data-state"), screen.getByTestId("pc711-duty-line").textContent]).toEqual([state, line]);
      r.unmount();
    }
  });
  it("the route does not answer (an older server, an error) → the card says it could not read; the panel is otherwise the same", async () => {
    for (const bad of [{ ok: false, status: 404, body: {} }, { ok: false, status: 500, body: { error: "failed" } }, { body: {} }] as Resp[]) {
      const r = await open(CONNECTED, bad);
      expect(screen.getByTestId("pc711-duty").textContent).toBe("Who is checkingCouldn't read who is checking.");
      expect(screen.getByTestId("pc711-test")).toBeTruthy();
      expect(screen.getByTestId("pc711-alert")).toBeTruthy();
      r.unmount();
    }
  });
});

describe("logged out: the \"checks are paused\" sentence", () => {
  it("hidden while the server is on duty (it is not true then)", async () => {
    await open(LOGGED_OUT, { body: duty({ ...ON_DUTY, loggedOut: true }) });
    expect(screen.queryByTestId("pc711-lo-paused")).toBeNull();
    expect(screen.getByTestId("pc711-logged-out").textContent).not.toContain("paused");
    // the rest of the red card is unchanged
    for (const id of ["pc711-lo-title", "pc711-lo-since", "pc711-lo-auto", "pc711-lo-last", "pc711-lo-next"]) expect(screen.getByTestId(id), id).toBeTruthy();
  });
  it("shown as before in every other case: the Lenovo is checking, backup off, the read failed, not read yet", async () => {
    for (const d of [{ body: duty({ loggedOut: true }) }, { body: duty({ backup: "off", loggedOut: true }) }, { body: duty({ backup: "off", ...ON_DUTY, loggedOut: true }) }, { ok: false, status: 500, body: {} }] as Resp[]) {
      const r = await open(LOGGED_OUT, d);
      expect(screen.getByTestId("pc711-lo-paused").textContent).toBe(PAUSED);
      r.unmount();
    }
    // not read yet: the sentence is there from the first draw
    answers["/status"] = { body: LOGGED_OUT };
    let release = () => {};
    const held = new Promise<void>((res) => { release = res; });
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string) => {
      const path = new URL(url, "http://x").pathname.replace("/admin/pc711", "");
      if (path === "/duty") { await held; return { ok: true, status: 200, json: async () => duty({ ...ON_DUTY, loggedOut: true }) }; }
      return { ok: true, status: 200, json: async () => (path === "/status" ? LOGGED_OUT : {}) };
    });
    render(<TProvider lang="en"><Pc711Panel /></TProvider>);
    await settle();
    expect(screen.getByTestId("pc711-duty").getAttribute("data-state")).toBe("loading");
    expect(screen.getByTestId("pc711-lo-paused").textContent).toBe(PAUSED);
    release();
    await settle();
    expect(screen.queryByTestId("pc711-lo-paused")).toBeNull();           // … and goes once the answer says "on duty"
  });
  it("it comes back when the Lenovo is back (the next refresh)", async () => {
    await open(LOGGED_OUT, { body: duty({ ...ON_DUTY, loggedOut: true }) });
    expect(screen.queryByTestId("pc711-lo-paused")).toBeNull();
    answers["/duty"] = { body: duty({ loggedOut: true }) };
    await tick(30_000);
    expect(screen.getByTestId("pc711-lo-paused").textContent).toBe(PAUSED);
    expect(screen.getByTestId("pc711-duty").getAttribute("data-state")).toBe("normal");
  });
});

describe("Telegram alerts card", () => {
  it("its text names the take-over and hand-back alerts too — in every state of the panel", async () => {
    const TEXT = "You get a Telegram message when the server is logged out of 7‑11 and when it is logged in again. You also get one when the server takes over the checks because the Lenovo stopped, and when the Lenovo is back.";
    for (const s of [CONNECTED, LOGGED_OUT, { state: "not_connected" }]) {
      const r = await open(s, { body: duty() });
      expect(screen.getByTestId("pc711-alert").textContent).toBe(`Telegram alerts${TEXT}Send test alert`);
      r.unmount();
    }
  });
  it("the same sentence in all 8 languages (like the rest of this panel)", () => {
    const src = readFileSync("src/redesign/i18n/index.tsx", "utf8");
    const line = src.split("\n").find((l) => l.trimStart().startsWith("rd_pc711_al_sub:"))!;
    expect(line.match(/You also get one when the server takes over the checks because the Lenovo stopped, and when the Lenovo is back\./g)).toHaveLength(8);
    expect(line).not.toContain("7-11, and when it is logged in again.");
    expect(line).not.toContain("7-11");                                  // "7‑11" is written so that it never breaks over two lines
  });
});

describe("when the card asks the server", () => {
  it("once when the panel opens, then every 30 seconds — and the panel's own status is still read once", async () => {
    await open(CONNECTED, { body: duty() });
    expect([count("/duty"), count("/status")]).toEqual([1, 1]);
    await tick(29_999);
    expect(count("/duty")).toBe(1);
    await tick(1);
    expect(count("/duty")).toBe(2);
    await tick(90_000);
    expect([count("/duty"), count("/status")]).toEqual([5, 1]);
    expect(calls.filter((c) => c.path === "/duty").every((c) => c.method === "GET")).toBe(true);
    // nothing else is asked again either (the panel still never polls its other blocks)
    expect([count("/shadow"), count("/evidence/totals")]).toEqual([1, 1]);
  });
  it("NO refresh while the page is hidden; back in front it is asked at once", async () => {
    await open(CONNECTED, { body: duty() });
    vis = "hidden"; act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await tick(30 * 60_000);
    expect(count("/duty")).toBe(1);
    answers["/duty"] = { body: duty(ON_DUTY) };
    vis = "visible"; act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await tick(0);
    expect(count("/duty")).toBe(2);
    expect(screen.getByTestId("pc711-duty").getAttribute("data-state")).toBe("duty");
  });
  it("not inside the login steps: no card there, and nothing is asked while the form is open", async () => {
    await open({ state: "not_connected" }, { body: duty() });
    expect(count("/duty")).toBe(1);
    answers["/login/start"] = { body: { flowId: "f1", captcha: "data:image/gif;base64,AAAA" } };
    fireEvent.click(screen.getByTestId("pc711-begin"));
    await settle();
    expect(screen.getByTestId("pc711-step1")).toBeTruthy();
    expect(screen.queryByTestId("pc711-duty")).toBeNull();
    await tick(5 * 60_000);
    expect(count("/duty")).toBe(1);
  });
  it("when the panel closes nothing is left asking", async () => {
    const r = await open(CONNECTED, { body: duty() });
    r.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await tick(10 * 60_000);
    expect(count("/duty")).toBe(1);
  });
});
