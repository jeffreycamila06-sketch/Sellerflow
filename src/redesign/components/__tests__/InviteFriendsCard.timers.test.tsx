// Invite friends card — its two notes ("Link copied" 2 s, "couldn't copy" 3 s) hide themselves, and
// their timers stop when the card is gone (the same fix as Pickup Status, CI run 1843).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import InviteFriendsCard from "../InviteFriendsCard";
import { TProvider } from "../../i18n";
import { expectNothingLate, tick, until } from "../../adapters/__tests__/pageGone";

const view = () => render(<TProvider lang="en"><InviteFriendsCard /></TProvider>);
const clipboard = (ok: boolean) => {
  const writeText = ok ? vi.fn().mockResolvedValue(undefined) : vi.fn().mockRejectedValue(new Error("blocked"));
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true, writable: true });
  return writeText;
};
const realExec = document.execCommand;

beforeEach(() => {
  vi.useFakeTimers();   // the clock moves only when a test moves it
  delete (navigator as unknown as { share?: unknown }).share;
  document.execCommand = (() => false) as typeof document.execCommand;   // the old copy way fails too
});
afterEach(() => { vi.useRealTimers(); document.execCommand = realExec; });

describe("the card is closed right after a note is shown", () => {
  it("'Link copied': no timer is left and nothing updates late", async () => {
    clipboard(true);
    const r = view();
    fireEvent.click(r.getByTestId("invite-card"));
    await until(() => r.queryByText("Link copied"));
    expect(vi.getTimerCount()).toBe(1);
    r.unmount();
    expectNothingLate();
  });
  it("'couldn't copy': the same", async () => {
    clipboard(false);
    const r = view();
    const before = r.getByTestId("invite-card").textContent;
    fireEvent.click(r.getByTestId("invite-card"));
    await until(() => r.getByTestId("invite-card").textContent !== before);   // the note is shown
    expect(r.queryByText("Link copied")).toBeNull();
    expect(vi.getTimerCount()).toBe(1);
    r.unmount();
    expectNothingLate();
  });
  it("the card is closed while the copy is still on its way: no timer is started afterwards", async () => {
    let done: (() => void) | null = null;
    const writeText = vi.fn(() => new Promise<void>((res) => { done = () => res(); }));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true, writable: true });
    const r = view();
    fireEvent.click(r.getByTestId("invite-card"));
    await until(() => writeText.mock.calls.length === 1);
    r.unmount();
    done!();
    await tick(0);
    expectNothingLate();
  });
});

describe("while the card is open nothing changed", () => {
  it("'Link copied' stays 2 seconds, then the arrow is back", async () => {
    clipboard(true);
    const r = view();
    fireEvent.click(r.getByTestId("invite-card"));
    await until(() => r.queryByText("Link copied"));
    await tick(1999);
    expect(r.queryByText("Link copied")).not.toBeNull();
    await tick(1);
    expect(r.queryByText("Link copied")).toBeNull();
  });
  it("the 'couldn't copy' note stays 3 seconds", async () => {
    clipboard(false);
    const r = view();
    const before = r.getByTestId("invite-card").textContent;
    fireEvent.click(r.getByTestId("invite-card"));
    await until(() => r.getByTestId("invite-card").textContent !== before);
    const shown = r.getByTestId("invite-card").textContent;
    await tick(2999);
    expect(r.getByTestId("invite-card").textContent).toBe(shown);
    await tick(1);
    expect(r.getByTestId("invite-card").textContent).toBe(before);
  });
});
