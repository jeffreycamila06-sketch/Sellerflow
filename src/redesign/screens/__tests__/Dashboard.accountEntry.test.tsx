// Live-screen account-management entry points (2026-07-23).
// (a) TikTok "Manage / add accounts" row renders + navigates (onManageTT).
// (c) FB dropdown no longer exposes a Connect that calls a connect handler.
// (d) FB "Contact us" is a real <a> (iOS-safe) → TELEGRAM_URL, target _blank,
//     rel noreferrer+noopener, and closes the dropdown on click.
// (b) back-target wiring is a RedesignApp source contract (the origin-aware
//     onBack is impractical to mount — full authed app — so it's pinned the same
//     way this repo pins other wiring, e.g. iosGates / buyerLine contracts).
// (e) the three new i18n keys exist in all 7 languages (belt-and-suspenders on
//     top of the global i18n.test.tsx no-blank sweep).
import { describe, it, expect, vi, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent, within } from "@testing-library/react";
import Dashboard from "../Dashboard";
import { TProvider, buildT } from "../../i18n";
import { TELEGRAM_URL } from "../../../lib/telegram";

beforeAll(() => { (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}; });

const noop = () => {};
const base = {
  comments: [], cur: "NT$",
  ttOpen: false, fbOpen: false, ttIdx: 0, fbIdx: 0,
  onToggleTT: noop, onToggleFB: noop, onPickTT: noop,
  ttConnected: false, fbConnected: false, ttConnecting: false, fbConnecting: false,
  onConnectTT: noop, onRefreshTT: noop,
  ttAccounts: ["maria_shops"], fbAccounts: [] as string[],
  sessionDays: 1, sessionOpen: false, onToggleSession: noop, onPickSession: noop,
  printed: {}, entId: null, entPrice: "", onOneClick: noop, onOpenEnt: noop, onEntPrice: noop, onEntKey: noop,
};
const renderDash = (over: Record<string, unknown> = {}) =>
  render(<TProvider lang="en"><Dashboard {...base} {...over} /></TProvider>);

describe("(a) TikTok manage/add-accounts row", () => {
  it("renders inside the open TikTok dropdown and fires onManageTT (navigate)", () => {
    const onManageTT = vi.fn();
    renderDash({ ttOpen: true, onManageTT });
    const row = screen.getByText("Manage / add accounts");
    expect(row).toBeTruthy();
    fireEvent.click(row);
    expect(onManageTT).toHaveBeenCalledTimes(1);
  });
  it("is shown even with accounts already present (always-visible, plan-agnostic)", () => {
    renderDash({ ttOpen: true, ttAccounts: ["a", "b", "c"] });
    expect(screen.getByText("Manage / add accounts")).toBeTruthy();
  });
  it("does NOT appear when the TikTok dropdown is closed", () => {
    renderDash({ ttOpen: false });
    expect(screen.queryByText("Manage / add accounts")).toBeNull();
  });
});

describe("(c/d) Facebook honest gate — no green-able Connect, real Telegram anchor", () => {
  it("shows the activation-required notice + Contact us, and NO Connect/Refresh in the FB dropdown", () => {
    renderDash({ fbOpen: true });
    expect(screen.getByText("Advanced feature — activation required")).toBeTruthy();
    expect(screen.getByText("Contact us")).toBeTruthy();
    // The dishonest connect path is gone: no Connect / Disconnect / Refresh /
    // "No pages yet" promise anywhere in the FB panel.
    expect(screen.queryByText("Connect")).toBeNull();
    expect(screen.queryByText("Disconnect")).toBeNull();
    expect(screen.queryByText("Refresh")).toBeNull();
    expect(screen.queryByText(/No pages yet/i)).toBeNull();
  });
  it("Contact us is a real <a> → TELEGRAM_URL, target=_blank, rel has noreferrer+noopener, closes dropdown", () => {
    const onToggleFB = vi.fn();
    renderDash({ fbOpen: true, onToggleFB });
    const link = screen.getByText("Contact us").closest("a") as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toBe(TELEGRAM_URL);
    expect(link.getAttribute("target")).toBe("_blank");
    const rel = link.getAttribute("rel") || "";
    expect(rel).toContain("noreferrer");
    expect(rel).toContain("noopener");
    fireEvent.click(link);
    expect(onToggleFB).toHaveBeenCalledTimes(1);   // dropdown closes as the tab opens
  });
  it("the FB dropdown does not render any element wired to a Facebook connect handler", () => {
    // Passing an onConnectFB spy as an EXCESS prop must have no effect — the gate
    // exposes no control bound to it (the prop was removed from the component API).
    const onConnectFB = vi.fn();
    renderDash({ fbOpen: true, onConnectFB });
    // Nothing to click that could call it; assert it stays uncalled after render.
    expect(onConnectFB).not.toHaveBeenCalled();
  });
});

describe("(b) back-target wiring — RedesignApp source contract (regression guard)", () => {
  const src = readFileSync(join(__dirname, "../../RedesignApp.tsx"), "utf-8");
  it("Live-originated manage → chanBack 'dashboard'; Settings-originated → 'settings'; onBack uses chanBack", () => {
    // From Live (the new TikTok row): sets chanBack("dashboard") then navigates.
    expect(src).toMatch(/onManageTT=\{\(\)\s*=>\s*\{[^}]*setChanBack\("dashboard"\)[^}]*setScreen\("ttchannels"\)/);
    // From Settings (SettingsHub): sets chanBack("settings").
    expect(src).toMatch(/onManageChannel=\{\(p\)\s*=>\s*\{\s*setChanBack\("settings"\)/);
    // ManageChannels Back returns to the recorded origin (NOT a hardcoded settings).
    // Scope the assertion to the ManageChannels render line so other screens'
    // legitimate onBack→settings don't false-match.
    const mcLine = src.split("\n").find((l) => l.includes("<ManageChannels")) || "";
    expect(mcLine).toMatch(/onBack=\{\(\)\s*=>\s*setScreen\(chanBack\)\}/);
    expect(mcLine).not.toMatch(/setScreen\("settings"\)/); // old hardcode gone from THIS line
    // Default origin is settings (so a stray entry can't dump the seller on Live).
    expect(src).toMatch(/useState<Screen>\("settings"\)/);
  });
});

describe("(f) no-account Connect → manage screen (Addendum 2 — doConnect source contract)", () => {
  const src = readFileSync(join(__dirname, "../../RedesignApp.tsx"), "utf-8");
  // Bound to the doConnect function body so setScreen counts are scoped.
  const start = src.indexOf("const doConnect = async");
  const body = src.slice(start, src.indexOf("\n  };", start) + 5); // doConnect fn body
  it("zero-account TikTok Connect navigates to ttchannels with back=dashboard (no popup)", () => {
    expect(body).toMatch(/if \(platform === "TikTok"\) \{ setTtOpen\(false\); setChanBack\("dashboard"\); setScreen\("ttchannels"\); return; \}/);
    // The old one-liner that opened the modal for ALL platforms is gone.
    expect(body).not.toMatch(/if \(!acct\) \{ setConnectOpen\(platform\); return; \}/);
  });
  it("the WITH-account path does NOT navigate — connect mechanics live in performConnect, which never navigates", () => {
    // doConnect navigates in exactly ONE branch (no-account TikTok). Sub-step 2
    // (session model) extracted the actual socket connect into performConnect —
    // that path (setConnecting → track → liveFeed.connect) is byte-unchanged and
    // still never navigates; doConnect now also runs the session gate.
    expect((body.match(/setScreen\(/g) || []).length).toBe(1);
    expect(body).toMatch(/sessionInstance\.checkStatus\(\)/);            // the new server-authoritative gate
    const pstart = src.indexOf("const performConnect = async");
    const pbody = src.slice(pstart, src.indexOf("\n  };", pstart) + 5);  // performConnect fn body
    expect(pbody).toMatch(/setConnecting\(true\);/);
    expect(pbody).toMatch(/track\("connect_attempt", \{ platform \}\);/);
    expect((pbody.match(/setScreen\(/g) || []).length).toBe(0);         // performConnect never navigates
  });
  it("the Facebook branch is KEPT (not deleted) but stays UI-unreachable", () => {
    expect(body).toMatch(/setConnectOpen\(platform\); return;/);       // FB fallthrough kept
    expect(src).not.toMatch(/doConnect\("Facebook"\)/);                // no caller anywhere
  });
});

describe("(e) new i18n keys resolve non-empty in all 7 languages", () => {
  const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id"] as const;
  for (const key of ["rd_dash_manage_accounts", "rd_dash_fb_activation", "rd_dash_fb_contact"]) {
    it(`${key} is filled in every language (via buildT)`, () => {
      for (const l of LANGS) {
        const t = buildT(l) as Record<string, string>;
        expect((t[key] || "").trim().length).toBeGreaterThan(0);
      }
    });
  }
});
