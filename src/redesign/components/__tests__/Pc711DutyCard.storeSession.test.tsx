// The "Store session: ready / opening / not ready" line of the "Who is checking" card (Jeff 2026-11-20): the server's
// kept E-Map session, words only. Shown while the backup is on; never when it is off or the server did not say.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import Pc711DutyCard from "../Pc711DutyCard";
import { TProvider } from "../../i18n";
import { toPc711Duty, type Pc711Duty } from "../../adapters/pc711Duty";

const NOW = Date.parse("2026-11-20T04:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const answer = (over: Record<string, unknown> = {}) => ({
  backup: "on", onDuty: false, loggedOut: false, reason: null, since: null, answered: null, answeredMore: false,
  checker: { label: "Lenovo", lastCallAt: iso(NOW - 4000) }, last: null, now: iso(NOW), ...over,
});
const show = (d: Pc711Duty | null) => render(<TProvider lang="en"><Pc711DutyCard duty={d} /></TProvider>);
afterEach(() => cleanup());

describe("Store session line", () => {
  it("ready / opening / not ready, each with its colour, in the Lenovo-checking state", () => {
    const colour = { ready: "var(--ok)", opening: "var(--warn)", not_ready: "var(--danger)" } as const;
    for (const [word, text] of [["ready", "ready"], ["opening", "opening"], ["not_ready", "not ready"]] as const) {
      const r = show(toPc711Duty(answer({ storeSession: word }), NOW));
      const el = r.getByTestId("pc711-duty-store");
      expect(el.textContent).toBe(text);
      expect(el.getAttribute("data-session")).toBe(word);
      expect(el.style.color).toBe(colour[word]);
      expect(r.getByText("Store session")).toBeTruthy();
      cleanup();
    }
  });
  it("also while the server is on duty, and on duty logged out", () => {
    let r = show(toPc711Duty(answer({ onDuty: true, since: iso(NOW - 60_000), reason: "silent", answered: 3, storeSession: "ready" }), NOW));
    expect(r.getByTestId("pc711-duty-store").textContent).toBe("ready");
    cleanup();
    r = show(toPc711Duty(answer({ onDuty: true, loggedOut: true, since: iso(NOW - 60_000), reason: "silent", answered: 3, storeSession: "not_ready" }), NOW));
    expect(r.getByTestId("pc711-duty-store").textContent).toBe("not ready");
  });
  it("the card's own rule: no line with the backup off, even when it is handed a word", () => {
    const d = { ...(toPc711Duty(answer({ backup: "off" }), NOW) as Pc711Duty), storeSession: "ready" as const };
    const r = show(d);
    expect(r.getByTestId("pc711-duty").getAttribute("data-state")).toBe("off");
    expect(r.queryByTestId("pc711-duty-store")).toBeNull();
  });
  it("no line when the backup is off, when the server did not say (older server), or said something else", () => {
    for (const over of [{ backup: "off", storeSession: "ready" }, {}, { storeSession: "weird" }, { storeSession: "0912345678" }]) {
      const r = show(toPc711Duty(answer(over), NOW));
      expect(r.queryByTestId("pc711-duty-store")).toBeNull();
      expect(r.queryByText("Store session")).toBeNull();
      cleanup();
    }
  });
});
