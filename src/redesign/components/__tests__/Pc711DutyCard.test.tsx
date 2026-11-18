// Admin → 7-11 Login → the "Who is checking" card (components/Pc711DutyCard.tsx), drawn from an
// answer of GET /admin/pc711/duty. The approved pictures are in docs/design/pc711-duty-card.
//   · the four states, word for word, with the colours of the pictures
//   · the history line under the card (nothing when there was no take-over)
//   · "… ago" counts up by itself; nothing is left running when the card goes away
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import Pc711DutyCard from "../Pc711DutyCard";
import { TProvider } from "../../i18n";
import { toPc711Duty, type Pc711Duty } from "../../adapters/pc711Duty";

const NOW = Date.parse("2026-11-18T06:08:00Z");                    // 14:08 Taipei
const iso = (ms: number) => new Date(ms).toISOString();
const answer = (over: Record<string, unknown> = {}) => ({
  backup: "on", onDuty: false, loggedOut: false, reason: null, since: null, answered: null, answeredMore: false,
  checker: { label: "Lenovo", lastCallAt: iso(NOW - 4000) }, last: null, now: iso(NOW), ...over,
});
const duty = (over: Record<string, unknown> = {}) => toPc711Duty(answer(over), NOW) as Pc711Duty;
const ON_DUTY = { onDuty: true, reason: "silent", since: iso(NOW - 22 * 60_000), answered: 37 };
const LAST = { start: "2026-11-16T19:12:00Z", end: "2026-11-16T19:58:00Z", reason: "silent" };   // 11/17 03:12 → 03:58 Taipei
const show = (d: Pc711Duty | null | undefined, lang = "en") => render(<TProvider lang={lang}><Pc711DutyCard duty={d} /></TProvider>);
const txt = (r: ReturnType<typeof show>, id: string) => r.queryByTestId(id)?.textContent ?? null;
const cardOf = (r: ReturnType<typeof show>) => r.getByTestId("pc711-duty");
/** draw one card, read one of its texts (id "" = the whole card), take the card away again */
const one = (d: Pc711Duty | null | undefined, id = "", lang = "en") => {
  const r = show(d, lang);
  const out = id ? txt(r, id) : cardOf(r).textContent;
  r.unmount();
  return out;
};
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
let vis: "visible" | "hidden" = "visible";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vis = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => vis });
});
afterEach(() => {
  vi.useRealTimers();
  delete (document as unknown as { visibilityState?: unknown }).visibilityState;
});

describe("the four states", () => {
  it("1 — normal, green: the Lenovo is checking, the server stands by, the Lenovo's last call", () => {
    const r = show(duty());
    const c = cardOf(r);
    expect(c.getAttribute("data-state")).toBe("normal");
    expect(c.textContent).toBe("Who is checkingThe Lenovo is checking · Server: standbyLast call from the Lenovo4 s ago");
    expect(txt(r, "pc711-duty-line")).toBe("The Lenovo is checking · Server: standby");
    expect(txt(r, "pc711-duty-last-call")).toBe("4 s ago");
    expect(r.getByTestId("pc711-duty-line").style.color).toBe("var(--ok)");
    expect(c.style.background).toBe("var(--surface-2)");
    expect(c.style.border).toBe("1px solid var(--border)");
    for (const id of ["pc711-duty-since", "pc711-duty-why", "pc711-duty-answered", "pc711-duty-out", "pc711-duty-history"]) expect(r.queryByTestId(id), id).toBeNull();
  });
  it("2 — the server is on duty, orange: since when, why, how many parcels", () => {
    const r = show(duty(ON_DUTY));
    const c = cardOf(r);
    expect(c.getAttribute("data-state")).toBe("duty");
    expect(txt(r, "pc711-duty-line")).toBe("The server is checking now");
    expect(txt(r, "pc711-duty-since")).toBe("11/18 13:46 (22 min)");
    expect(txt(r, "pc711-duty-why")).toBe("The Lenovo is silent");
    expect(txt(r, "pc711-duty-answered")).toBe("37 parcels");
    expect(c.textContent).toBe("Who is checkingThe server is checking nowSince11/18 13:46 (22 min)WhyThe Lenovo is silentAnswered in this duty37 parcels");
    expect(r.getByTestId("pc711-duty-line").style.color).toBe("var(--warn)");
    expect(c.style.background).toBe("var(--warn-soft)");
    expect(c.style.border).toBe("1.5px solid var(--warn)");
    for (const id of ["pc711-duty-last-call", "pc711-duty-out", "pc711-duty-standby"]) expect(r.queryByTestId(id), id).toBeNull();
  });
  it("2 — the other reason: the Lenovo's 7-11 tabs are dead", () => {
    const r = show(duty({ ...ON_DUTY, reason: "degraded" }));
    expect(txt(r, "pc711-duty-why")).toBe("The Lenovo's 7‑11 tabs are dead");     // "7‑11" never breaks over two lines
  });
  it("3 — on duty and logged out of 7-11, red: the same, plus \"Log in above\"", () => {
    const r = show(duty({ ...ON_DUTY, reason: "degraded", loggedOut: true }));
    const c = cardOf(r);
    expect(c.getAttribute("data-state")).toBe("duty_out");
    expect(txt(r, "pc711-duty-line")).toBe("The server is checking now");
    expect(txt(r, "pc711-duty-since")).toBe("11/18 13:46 (22 min)");
    expect(txt(r, "pc711-duty-why")).toBe("The Lenovo's 7‑11 tabs are dead");
    expect(txt(r, "pc711-duty-answered")).toBe("37 parcels");
    const out = r.getByTestId("pc711-duty-out");
    expect(out.textContent).toBe("The server is logged out. Log in above.");
    expect(out.getAttribute("role")).toBe("alert");
    expect(out.style.color).toBe("var(--danger)");
    expect(r.getByTestId("pc711-duty-line").style.color).toBe("var(--danger)");
    expect(c.style.background).toBe("var(--danger-soft)");
    expect(c.style.border).toBe("1.5px solid var(--danger)");
  });
  it("4 — backup off, grey: \"Backup: off\" and the Lenovo's last call", () => {
    const r = show(duty({ backup: "off" }));
    const c = cardOf(r);
    expect(c.getAttribute("data-state")).toBe("off");
    expect(c.textContent).toBe("Who is checkingBackup: offLast call from the Lenovo4 s ago");
    expect(r.getByTestId("pc711-duty-line").style.color).toBe("var(--text-dim)");
    expect(c.style.background).toBe("var(--surface-2)");
    for (const id of ["pc711-duty-since", "pc711-duty-why", "pc711-duty-answered", "pc711-duty-out", "pc711-duty-standby"]) expect(r.queryByTestId(id), id).toBeNull();
  });
  it("logged out while the Lenovo is checking stays green (the red state is only for \"the server is checking\")", () => {
    const r = show(duty({ loggedOut: true }));
    expect(cardOf(r).getAttribute("data-state")).toBe("normal");
    expect(r.queryByTestId("pc711-duty-out")).toBeNull();
  });
  it("the card has no button and no link", () => {
    for (const d of [duty(), duty(ON_DUTY), duty({ ...ON_DUTY, loggedOut: true }), duty({ backup: "off" }), null, undefined]) {
      const r = show(d);
      expect(r.container.querySelectorAll("button, a, input").length).toBe(0);
      r.unmount();
    }
  });
});

describe("the history line under the card", () => {
  it("the last take-over: start, end, how long, why", () => {
    const r = show(duty({ last: LAST }));
    expect(txt(r, "pc711-duty-history")).toBe("Last take-over: 11/17 03:12 → 03:58 (46 min). Why: the Lenovo was silent.");
    const line = r.getByTestId("pc711-duty-history");
    expect(cardOf(r).contains(line)).toBe(false);                               // UNDER the card, not in it
    expect(r.getByTestId("pc711-duty-wrap").lastElementChild).toBe(line);
  });
  it("the other reason, a take-over over midnight, and one whose reason is not known", () => {
    expect(one(duty({ last: { ...LAST, reason: "degraded" } }), "pc711-duty-history")).toBe("Last take-over: 11/17 03:12 → 03:58 (46 min). Why: the Lenovo's 7‑11 tabs were dead.");
    expect(one(duty({ last: { start: "2026-11-17T15:50:00Z", end: "2026-11-17T17:05:00Z", reason: "silent" } }), "pc711-duty-history")).toBe("Last take-over: 11/17 23:50 → 11/18 01:05 (1 h 15 min). Why: the Lenovo was silent.");
    expect(one(duty({ last: { ...LAST, reason: null } }), "pc711-duty-history")).toBe("Last take-over: 11/17 03:12 → 03:58 (46 min).");
  });
  it("nothing when there was none", () => {
    for (const d of [duty(), duty(ON_DUTY), duty({ backup: "off" })]) {
      const r = show(d);
      expect(r.queryByTestId("pc711-duty-history")).toBeNull();
      expect(r.container.textContent).not.toContain("take-over");
      r.unmount();
    }
  });
  it("it shows under every state", () => {
    for (const d of [duty({ last: LAST }), duty({ ...ON_DUTY, last: LAST }), duty({ ...ON_DUTY, loggedOut: true, last: LAST }), duty({ backup: "off", last: LAST })]) {
      const r = show(d);
      expect(txt(r, "pc711-duty-history")).toContain("Last take-over: 11/17 03:12 → 03:58 (46 min)");
      r.unmount();
    }
  });
});

describe("what is not known is a dash, never a guess", () => {
  it("no device label → \"the checker laptop\"", () => {
    const none = { label: "", lastCallAt: iso(NOW - 4000) };
    expect(one(duty({ checker: none }), "pc711-duty-line")).toBe("The checker laptop is checking · Server: standby");
    expect(one(duty({ backup: "off", checker: none }))).toContain("Last call from the checker laptop");
    expect(one(duty({ ...ON_DUTY, checker: none }), "pc711-duty-why")).toBe("The checker laptop is silent");
    expect(one(duty({ checker: none, last: LAST }), "pc711-duty-history")).toBe("Last take-over: 11/17 03:12 → 03:58 (46 min). Why: the checker laptop was silent.");
    expect(one(duty({ checker: { label: "Mac fe08", lastCallAt: iso(NOW - 4000) } }), "pc711-duty-line")).toBe("The Mac fe08 is checking · Server: standby");
  });
  it("the count: 0, 1, many, \"more than read so far\", unknown", () => {
    expect(one(duty({ ...ON_DUTY, answered: 0 }), "pc711-duty-answered")).toBe("0 parcels");
    expect(one(duty({ ...ON_DUTY, answered: 1 }), "pc711-duty-answered")).toBe("1 parcel");
    expect(one(duty({ ...ON_DUTY, answered: 5000, answeredMore: true }), "pc711-duty-answered")).toBe("5000+ parcels");
    expect(one(duty({ ...ON_DUTY, answered: 1, answeredMore: true }), "pc711-duty-answered")).toBe("1+ parcels");
    expect(one(duty({ ...ON_DUTY, answered: null }), "pc711-duty-answered")).toBe("—");
  });
  it("no start time, no reason, no last call → \"—\"", () => {
    const d = duty({ ...ON_DUTY, since: null, reason: null });
    expect([one(d, "pc711-duty-since"), one(d, "pc711-duty-why")]).toEqual(["—", "—"]);
    expect(one(duty({ checker: { label: "Lenovo", lastCallAt: null } }), "pc711-duty-last-call")).toBe("—");
  });
  it("not read yet → Loading…; the read failed → it says so (never \"Backup: off\")", () => {
    const a = show(undefined);
    expect([cardOf(a).getAttribute("data-state"), cardOf(a).textContent]).toEqual(["loading", "Who is checkingLoading…"]);
    a.unmount();
    const b = show(null);
    expect([cardOf(b).getAttribute("data-state"), cardOf(b).textContent]).toEqual(["failed", "Who is checkingCouldn't read who is checking."]);
    expect(b.container.textContent).not.toContain("Backup");
  });
  it("only the known fields are shown: nothing else an answer may carry reaches the screen", () => {
    const d = { ...duty({ ...ON_DUTY, last: LAST }), phone: "0912345678", buyer: "王小美", store: "151003", tracking: "F12345678" } as unknown as Pc711Duty;
    const r = show(d);
    for (const secret of ["0912345678", "王小美", "151003", "F12345678"]) expect(r.container.textContent).not.toContain(secret);
  });
  it("every language has every text of the card (no empty line, no unfilled {name})", () => {
    for (const lang of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"]) {
      for (const d of [duty({ last: LAST }), duty({ ...ON_DUTY, last: { ...LAST, reason: "degraded" } }), duty({ ...ON_DUTY, reason: "degraded", loggedOut: true }), duty({ backup: "off" }), null, undefined]) {
        const r = show(d, lang);
        const text = r.container.textContent || "";
        expect(text, lang).not.toMatch(/[{}]/);
        expect(text.startsWith("Who is checking"), lang).toBe(true);
        expect(r.container.querySelectorAll("span:empty:not([aria-hidden]), div:empty").length, lang).toBe(0);
        r.unmount();
      }
    }
  });
});

describe("\"… ago\" counts by itself", () => {
  it("the Lenovo's last call and the length of the duty move with the clock — no request is needed", async () => {
    const fetchSpy = vi.fn();
    (globalThis as unknown as { fetch: unknown }).fetch = fetchSpy;
    const r = show(duty());
    expect(txt(r, "pc711-duty-last-call")).toBe("4 s ago");
    await tick(5000);
    expect(txt(r, "pc711-duty-last-call")).toBe("9 s ago");
    await tick(60_000);
    expect(txt(r, "pc711-duty-last-call")).toBe("1 min ago");
    r.unmount();
    vi.setSystemTime(NOW);
    const d = show(duty(ON_DUTY));
    expect(txt(d, "pc711-duty-since")).toBe("11/18 13:46 (22 min)");
    await tick(60_000);
    expect(txt(d, "pc711-duty-since")).toBe("11/18 13:46 (23 min)");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("it uses the SERVER's clock: a phone whose clock is wrong shows the same number", () => {
    // the device is 10 minutes ahead; the answer says what time it is on the server
    vi.setSystemTime(NOW + 10 * 60_000);
    const d = toPc711Duty(answer(), NOW + 10 * 60_000) as Pc711Duty;
    expect(d.skewMs).toBe(-10 * 60_000);
    expect(one(d, "pc711-duty-last-call")).toBe("4 s ago");
  });
  it("a hidden page does not redraw; back in front it shows the true number at once", async () => {
    const r = show(duty());
    await tick(3000);
    expect(txt(r, "pc711-duty-last-call")).toBe("7 s ago");
    vis = "hidden";
    await tick(40_000);
    expect(txt(r, "pc711-duty-last-call")).toBe("7 s ago");
    vis = "visible";
    await tick(1000);
    expect(txt(r, "pc711-duty-last-call")).toBe("48 s ago");
  });
  it("when the card goes away nothing is left running, and nothing updates late", () => {
    const r = show(duty(ON_DUTY));
    expect(vi.getTimerCount()).toBe(1);
    r.unmount();
    expect(vi.getTimerCount()).toBe(0);
    const d = Object.getOwnPropertyDescriptor(globalThis, "window");
    expect(Reflect.deleteProperty(globalThis, "window")).toBe(true);           // the page is gone (CI run 1843)
    let thrown: unknown = null;
    try { vi.advanceTimersByTime(10 * 60_000); } catch (e) { thrown = e; } finally { if (d) Object.defineProperty(globalThis, "window", d); }
    expect(thrown).toBeNull();
  });
});
