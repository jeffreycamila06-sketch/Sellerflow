// Back button rule (Jeff 2026-11-11) — signed out. Legal opened from the landing page's Sign up (web) or
// from Sign up (app) used to have no Back and no bottom nav: the visitor was stuck. Now Back returns to
// where Legal was opened from. Landing and Login themselves have no Back.
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, act, screen, fireEvent } from "@testing-library/react";
import { buildT } from "../i18n";

beforeAll(() => { (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}; });
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };

vi.mock("../adapters/useAuthSession", async (orig) => ({
  ...(await orig() as object),
  useAuthSession: () => ({
    status: "anon", profile: null, configured: true,
    signIn: vi.fn(async () => ({ ok: false })), register: vi.fn(async () => ({ ok: false })), reloadProfile: vi.fn(async () => {}),
  }),
}));

import RedesignApp from "../RedesignApp";

const t = buildT("en");
const now = () => document.querySelector("[data-screen]")?.getAttribute("data-screen");
const clickText = async (label: string) => { fireEvent.click(screen.getAllByText(label).find((el) => el.tagName === "SPAN" || el.closest("button"))!); await flush(); };
const backBtns = () => screen.queryAllByTestId("back-btn");

afterEach(() => { delete (window as unknown as { Capacitor?: unknown }).Capacitor; });

describe("signed out: Legal is no longer a dead end", () => {
  it("web: Landing → Sign up → Legal → Back → Landing (Landing itself has no Back)", async () => {
    render(<RedesignApp />);
    await flush();
    expect(now()).toBe("landing");
    expect(backBtns()).toHaveLength(0);
    fireEvent.click(screen.getAllByText(t.rd_l2_nav_cta)[0].closest("button")!); await flush();
    await clickText(t.rd_terms);
    expect(now()).toBe("legal");
    expect(backBtns()).toHaveLength(1);
    expect((backBtns()[0] as HTMLButtonElement).style.minHeight).toBe("44px");
    fireEvent.click(backBtns()[0]); await flush();
    expect(now()).toBe("landing");
  });
  it("app: Login → Sign up → Legal → Back → Sign up → Back → Login (Login has no Back)", async () => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = {};
    render(<RedesignApp />);
    await flush();
    expect(now()).toBe("login");
    expect(backBtns()).toHaveLength(0);
    await clickText(t.rd_login_create_account);
    expect(now()).toBe("signup");
    expect((backBtns()[0] as HTMLButtonElement).style.minHeight).toBe("44px");
    await clickText(t.rd_terms);
    expect(now()).toBe("legal");
    fireEvent.click(backBtns()[0]); await flush();
    expect(now()).toBe("signup");
    fireEvent.click(backBtns()[0]); await flush();
    expect(now()).toBe("login");
  });
});
