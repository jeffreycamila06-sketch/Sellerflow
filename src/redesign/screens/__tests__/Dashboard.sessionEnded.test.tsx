// "Session ended" idle dashboard: the server says the session's window has passed AND
// the seller isn't connected → "Session ended" pill + an empty board with a Connect note.
// Ended while connected → today's "Session continues …". Running → "Session ends {date}".
// Display-only: no order is deleted or modified (the parent passes an empty session).
import { describe, it, expect, vi, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { TProvider } from "../../i18n";
import { sessionEndedIdle } from "../../adapters/sessionEnd";
import type { RebuiltSession } from "../../../lib/orderLogic";

vi.mock("../../adapters/useRaffleConfig", () => ({
  useRaffleConfig: () => ({ enabled: false, enabledAt: null, loading: false, toggle: vi.fn() }),
}));
beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });

import Dashboard from "../Dashboard";

const noop = () => {};
const baseProps = {
  comments: [], cur: "NT$", historyReady: true,
  ttOpen: false, fbOpen: false, ttIdx: 0, fbIdx: 0,
  onToggleTT: noop, onToggleFB: noop, onPickTT: noop, onPickFB: noop,
  ttConnected: false, fbConnected: false, ttConnecting: false, fbConnecting: false,
  onConnectTT: noop, onConnectFB: noop,
  printed: {} as Record<string, string>, entId: null, entPrice: "",
  onOneClick: noop, onOpenEnt: noop, onEntPrice: noop, onEntKey: noop,
};
const OLD: RebuiltSession = {
  buyers: [{ handle: "a", name: "A", platform: "TikTok", num: 1, orders: [], totalSpent: 700, totalOrders: 2 }],
  orders: [
    { orderNum: 1, item: "A350", qty: 1, price: 350, total: 350, time: "14:05", handle: "a", name: "A", bNum: 1, platform: "TikTok", status: "New", date: "2026-09-26" },
    { orderNum: 2, item: "A350", qty: 1, price: 350, total: 350, time: "14:06", handle: "a", name: "A", bNum: 1, platform: "TikTok", status: "New", date: "2026-09-26" },
  ],
} as unknown as RebuiltSession;
const EMPTY: RebuiltSession = { buyers: [], orders: [] };
const dash = (p: Record<string, unknown>) => render(<TProvider lang="en"><Dashboard {...baseProps} sessionEndsAt="Sep 26, 11:59 PM" {...p} /></TProvider>);

describe("sessionEndedIdle", () => {
  it("ended AND not live → true; otherwise false", () => {
    expect(sessionEndedIdle(true, false)).toBe(true);
    expect(sessionEndedIdle(true, true)).toBe(false);
    expect(sessionEndedIdle(false, false)).toBe(false);
    expect(sessionEndedIdle(false, true)).toBe(false);
  });
});

describe("Dashboard session pill + board", () => {
  it("ended + not connected → 'Session ended' pill, zero summary, the Connect note — no old session shown", () => {
    const v = dash({ sessionEnded: true, sessionEndedIdle: true, session: EMPTY, sessionState: "empty" });
    expect(v.getByTestId("session-ended").textContent).toBe("Session ended");
    expect(v.queryByTestId("session-ends")).toBeNull();
    expect(v.queryByTestId("session-continues")).toBeNull();
    const card = v.getByTestId("session-ended-empty");
    expect(card.textContent).toContain("0 buyers · 0 orders");
    expect(card.textContent).toContain("NT$0");
    expect(card.textContent).toContain("Session ended. Tap Connect to start a new one.");
    expect(v.container.textContent).not.toContain("700");
  });
  it("Filipino note is the requested wording", () => {
    const v = render(<TProvider lang="fil"><Dashboard {...baseProps} sessionEndsAt="x" sessionEnded sessionEndedIdle session={EMPTY} /></TProvider>);
    expect(v.getByTestId("session-ended-empty").textContent).toContain("Tapos na ang session. Tap Connect para magsimula ng bago.");
  });
  it("ended WHILE connected → unchanged: 'Session continues…' and the board stays", () => {
    const v = dash({ ttConnected: true, sessionEnded: true, sessionEndedIdle: false, session: OLD, sessionState: "live" });
    expect(v.getByTestId("session-continues")).toBeTruthy();
    expect(v.queryByTestId("session-ended")).toBeNull();
    expect(v.queryByTestId("session-ended-empty")).toBeNull();
    expect(v.container.textContent).toContain("NT$700");
  });
  it("running session → unchanged: 'Session ends {date}' and the board", () => {
    const v = dash({ sessionEnded: false, sessionEndedIdle: false, session: OLD, sessionState: "live" });
    expect(v.getByTestId("session-ends").textContent).toBe("Session ends Sep 26, 11:59 PM");
    expect(v.container.textContent).toContain("NT$700");
    expect(v.queryByTestId("session-ended-empty")).toBeNull();
  });
  it("Session V2 owner: an ended idle session shows 'Session ended' instead of the End Session button", () => {
    const v = dash({ sessionEnded: true, sessionEndedIdle: true, session: EMPTY, sessionV2Owner: true, onEndSession: noop });
    expect(v.getByTestId("session-ended")).toBeTruthy();
    expect(v.queryByTestId("session-end-btn")).toBeNull();
    const running = dash({ sessionEnded: false, sessionEndedIdle: false, session: OLD, sessionV2Owner: true, onEndSession: noop });
    expect(running.getByTestId("session-end-btn")).toBeTruthy(); // running V2: unchanged
  });
});

describe("RedesignApp wiring (display-only, no order writes)", () => {
  const app = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
  it("idle-ended = server ended flag AND no live connection; the dashboard gets an empty session", () => {
    expect(app).toContain("const sessionIdleEnded = sessionEndedIdle(sessionInstance.ended, ttEff || fbEff || shopeeEff || igEff);");
    expect(app).toContain("session={sessionIdleEnded ? ENDED_EMPTY_SESSION : liveSession.session}");
    expect(app).toContain("sessionEndedIdle={sessionIdleEnded}");
  });
  it("the loaded session itself is untouched (Orders tab still gets liveSession)", () => {
    expect(app).toMatch(/useLiveSession\(authed, \{ ready: sessionWindow\.loaded && sessionInstance\.loaded/);
    const sessionEnd = readFileSync("src/redesign/adapters/sessionEnd.ts", "utf8");
    expect(sessionEnd).not.toMatch(/supabase|\.from\(|\.rpc\(|delete|update/);
  });
});
