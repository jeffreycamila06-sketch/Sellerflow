// Admin → 7-11 Login → "Telegram alerts" card: the "Send test alert" button (Jeff 2026-11-18). fetch is mocked.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Pc711Panel from "../Pc711Panel";
import { TProvider } from "../../i18n";
import { toPc711AlertTest, alertTestLineKind } from "../../adapters/pc711Login";

vi.mock("../../../supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } } }));

type Resp = { ok?: boolean; status?: number; body: Record<string, unknown>; hold?: Promise<void> };
const queue: Record<string, Resp[]> = {};
const calls: { path: string; method: string; body: string }[] = [];
const push = (path: string, r: Resp) => { (queue[path] ||= []).push(r); };
afterEach(() => { for (const k of Object.keys(queue)) delete queue[k]; calls.length = 0; vi.restoreAllMocks(); });
beforeEach(() => {
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string, init: { method?: string; body?: string }) => {
    const path = new URL(url, "http://x").pathname.replace("/admin/pc711", "");
    calls.push({ path, method: init?.method || "GET", body: String(init?.body ?? "") });
    const r = (queue[path] || []).shift() || { body: {} };
    if (r.hold) await r.hold;
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.body };
  });
});
const CONNECTED = { state: "connected", since: "2026-11-17T01:21:07Z", lastOkAt: "2026-11-18T03:09:26Z", autoLogins: 1, phoneTail: "678" };
const open = async (status: Record<string, unknown>) => {
  push("/status", { body: status });
  render(<TProvider lang="en"><Pc711Panel /></TProvider>);
  await waitFor(() => expect(screen.getByTestId("pc711-alert")).toBeTruthy());
};
const tap = () => fireEvent.click(screen.getByTestId("pc711-alert-test"));
const alertCalls = () => calls.filter((c) => c.path === "/alert-test");

describe("Send test alert", () => {
  it("the card is in every state of the panel: connected, logged out, not connected", async () => {
    for (const s of [CONNECTED, { state: "needs_login" }, { state: "not_connected" }]) {
      push("/status", { body: s });
      const r = render(<TProvider lang="en"><Pc711Panel /></TProvider>);
      await waitFor(() => expect(screen.getByTestId("pc711-alert")).toBeTruthy());
      expect(screen.getByTestId("pc711-alert-test").textContent).toBe("Send test alert");
      expect(screen.getByTestId("pc711-alert").textContent).toContain("Telegram alerts");
      expect(screen.queryByTestId("pc711-alert-result")).toBeNull(); // nothing said before a tap
      r.unmount();
    }
  });
  it("a tap sends ONE POST to the Admin route and says Sent", async () => {
    await open(CONNECTED);
    push("/alert-test", { body: { sent: true } });
    tap();
    await waitFor(() => expect(screen.getByTestId("pc711-alert-result").textContent).toBe("Sent. Check Telegram."));
    expect(screen.getByTestId("pc711-alert-result").getAttribute("data-sent")).toBe("1");
    expect(alertCalls()).toEqual([{ path: "/alert-test", method: "POST", body: "{}" }]);
  });
  it("alerts not set up on the server → the 'not set up' line (never the server's word)", async () => {
    await open(CONNECTED);
    push("/alert-test", { body: { sent: false, reason: "off" } });
    tap();
    await waitFor(() => expect(screen.getByTestId("pc711-alert-result").textContent).toBe("Not sent. Telegram alerts are not set up on the server yet."));
    expect(screen.getByTestId("pc711-alert-result").getAttribute("data-sent")).toBe("0");
  });
  it("Telegram did not answer / an error / an old server → 'did not answer'; too many taps → 'wait'", async () => {
    await open(CONNECTED);
    for (const [resp, text] of [
      [{ body: { sent: false, reason: "timeout" } }, "Not sent. Telegram did not answer. Try again."],
      [{ body: { sent: false, reason: "http_401" } }, "Not sent. Telegram did not answer. Try again."],
      [{ ok: false, status: 404, body: {} }, "Not sent. Telegram did not answer. Try again."],
      [{ ok: false, status: 429, body: { sent: false, reason: "rate_limited" } }, "Not sent. Too many tries. Wait a few minutes."],
    ] as [Resp, string][]) {
      push("/alert-test", resp);
      tap();
      await waitFor(() => expect(screen.getByTestId("pc711-alert-result").textContent).toBe(text));
      await waitFor(() => expect((screen.getByTestId("pc711-alert-test") as HTMLButtonElement).disabled).toBe(false));
    }
  });
  it("while sending: the button says Sending…, is off, and a second tap sends nothing more", async () => {
    await open(CONNECTED);
    let release = () => {};
    push("/alert-test", { body: { sent: true }, hold: new Promise<void>((r) => { release = r; }) });
    tap();
    await waitFor(() => expect(screen.getByTestId("pc711-alert-test").textContent).toBe("Sending…"));
    expect((screen.getByTestId("pc711-alert-test") as HTMLButtonElement).disabled).toBe(true);
    tap(); tap();
    release();
    await waitFor(() => expect(screen.getByTestId("pc711-alert-result").textContent).toBe("Sent. Check Telegram."));
    expect(alertCalls().length).toBe(1);
  });
  it("the button is a 44 px touch target as wide as its card (the panel's ghost button)", async () => {
    await open(CONNECTED);
    const b = screen.getByTestId("pc711-alert-test") as HTMLButtonElement;
    expect(b.style.minHeight).toBe("44px");
    expect(b.style.width).toBe("100%");
  });
  it("answer → sent / one safe word; word → which line", () => {
    expect(toPc711AlertTest({ ok: true, status: 200, data: { sent: true } })).toEqual({ sent: true, reason: "" });
    expect(toPc711AlertTest({ ok: true, status: 200, data: { sent: false, reason: "http_502" } })).toEqual({ sent: false, reason: "http_502" });
    expect(toPc711AlertTest({ ok: true, status: 200, data: { sent: false, reason: "<b>0912345678</b> x" } }).reason).toBe("b0912345678bx");
    expect(toPc711AlertTest({ ok: false, status: 0, data: { error: "unreachable" } })).toEqual({ sent: false, reason: "unreachable" });
    expect(toPc711AlertTest({ ok: false, status: 429, data: {} })).toEqual({ sent: false, reason: "rate_limited" });
    expect(toPc711AlertTest({ ok: false, status: 200, data: { sent: true } }).sent).toBe(false);
    expect(["off", "bad_token_format", "bad_chat_format"].map(alertTestLineKind)).toEqual(["off", "off", "off"]);
    expect(["rate_limited", "timeout", "network", "http_401", "failed", ""].map(alertTestLineKind)).toEqual(["limit", "failed", "failed", "failed", "failed", "failed"]);
  });
});
