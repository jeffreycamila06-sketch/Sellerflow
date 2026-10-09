// Build 10 follow-up — no seller ever sees a server code. For EVERY code (shared, templated,
// server-only, E0, unknown) and raw server sentences, every screen that reads a live-server
// answer renders only its own text: TikTok connect (toast + Connect modal), Shopee connect,
// Facebook/Instagram connect, Messenger receipt, Parcel Scan, admin broadcast translate.
// The real adapters run against a mocked fetch carrying exactly what the server would send.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { ERR_CODES, ERR_TEMPLATES, decodeErr, sellerSafeWord } from "../../../lib/errCodes.js";
import { SERVER_ONLY_CODES } from "../../../../server/errorCodes.js";
import { connectPlatform, connectFailText } from "../../adapters/connect";
import { shopeeConnect } from "../../adapters/shopee";
import { fbConnect, fbConnectFailText } from "../../adapters/fb";
import { igConnect, igConnectFailText } from "../../adapters/ig";
import { receiptFailText } from "../../adapters/fbReceipt";
import { scanParcel } from "../../adapters/parcelScan";
import { translateBroadcast } from "../../adapters/broadcastTranslate";
import ConnectModal from "../ConnectModal";
import { TProvider, buildT } from "../../i18n";
import type { AccountUser } from "../../../accountDb";

const CODE = /E\d+/;
const CODES = [
  "E0", "E999", "E41:7", "E42:2 hour(s)",
  ...Object.values(ERR_CODES), ...Object.keys(ERR_TEMPLATES), ...Object.values(SERVER_ONLY_CODES),
  "the request user is not online", "Server auth is not configured", "anthropic_http_500",
];
const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"];
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; cleanup(); });
const serve = (status: number, body: Record<string, unknown>) => {
  globalThis.fetch = vi.fn(async () => ({ ok: status >= 200 && status < 300, status, statusText: "", json: async () => body })) as unknown as typeof fetch;
};
const live = { ios: false, planName: "Pro", max: 3 };

describe("the shared rule", () => {
  it.each(CODES)("sellerSafeWord(%s) is never a code or a sentence", (c) => {
    const w = sellerSafeWord(decodeErr(c));
    expect(w).not.toMatch(CODE);
    expect(w).not.toMatch(/\s/);
  });
});

describe("TikTok connect toast (RedesignApp) and Connect modal", () => {
  it("every status × every code → only the app's own texts", async () => {
    for (const lang of LANGS) {
      const t = buildT(lang);
      const allowed = new Set([t.rd_cm_not_live, t.rd_cm_cant_reach, t.rd_cm_conn_try_again]);
      for (const status of [400, 401, 403, 409, 429, 500, 502]) {
        for (const c of CODES) {
          serve(status, { success: false, error: c, ...(status === 409 ? { notLive: true } : {}) });
          const r = await connectPlatform("TikTok", { username: "shop" }, "s@x.com");
          const text = connectFailText(r, t);
          expect(text).not.toMatch(CODE);
          expect(allowed.has(text)).toBe(true);
        }
      }
    }
  });
  it("the toast in RedesignApp never prints a server field", () => {
    const app = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(app).not.toMatch(/msg:\s*r\.(error|reason)\b/);
    expect(app).toContain("if (!r.ok) setToast({ msg: connectFailText(r, tApp), kind: \"err\" });");
  });

  const profile: AccountUser = {
    authUserId: "u1", email: "s@x.com",
    profile: { fullName: "S", storeName: "S", phone: "", tiktok: "", facebook: "", adminContactNote: "" },
    plan: "pro", planStatus: "active", planExpiry: "", connectedAccounts: [], role: "seller",
  } as AccountUser;
  it.each(CODES)("Connect modal, TikTok tab, server sends %s → no code on screen", async (c) => {
    serve(500, { success: false, error: c });
    render(<TProvider lang="en"><ConnectModal profile={profile} onClose={() => {}} onConnect={(p, d) => connectPlatform(p, d, "s@x.com")} /></TProvider>);
    fireEvent.change(document.querySelector("input") as HTMLInputElement, { target: { value: "shop" } });
    fireEvent.click(Array.from(document.querySelectorAll("button")).find((b) => /connect/i.test(b.textContent || "") && !/×/.test(b.textContent || ""))!);
    await waitFor(() => expect(screen.getByText(buildT("en").rd_cm_conn_try_again)).toBeTruthy());
    expect(document.querySelector("[style*='var(--danger)']")?.textContent || "").not.toMatch(CODE);
  });
  it.each(CODES)("Connect modal, Shopee tab, server sends %s → no code on screen", async (c) => {
    serve(c.length % 2 ? 500 : 200, { ok: false, error: c, reason: c });
    render(<TProvider lang="en"><ConnectModal profile={profile} initialTab="Shopee" onClose={() => {}} onConnect={async () => ({ ok: false, account: "" })}
      shopeeEnabled shopeeShops={[{ shopId: 1, shopName: "S" }]} shopeeSelectedId={1} onShopeeConnect={(id, s) => shopeeConnect(id, s)} /></TProvider>);
    const inputs = Array.from(document.querySelectorAll("input"));
    fireEvent.change(inputs[inputs.length - 1], { target: { value: "abc" } });
    const btns = Array.from(document.querySelectorAll("button")).filter((b) => !b.disabled && /connect/i.test(b.textContent || "") && !/×/.test(b.textContent || ""));
    fireEvent.click(btns[btns.length - 1]);
    await waitFor(() => expect(document.querySelector("[style*='var(--danger)']")).toBeTruthy());
    expect(document.querySelector("[style*='var(--danger)']")?.textContent || "").not.toMatch(CODE);
  });
});

describe("Facebook / Instagram connect, Messenger receipt", () => {
  it("every status × every code → no code in the toast (polish on and off)", async () => {
    const t = buildT("en");
    for (const status of [200, 401, 403, 404, 409, 429, 500, 502]) {
      for (const c of CODES) {
        serve(status, { ok: false, error: c, reason: c });
        const fb = await fbConnect("p1");
        expect(fbConnectFailText(fb, t, live)).not.toMatch(CODE);
        expect(fbConnectFailText(fb, t, live, true)).not.toMatch(CODE);
        const ig = await igConnect("i1");
        expect(igConnectFailText(ig, t, live)).not.toMatch(CODE);
      }
    }
    for (const fbCode of [undefined, "190/460", "10/2018278"]) {
      expect(receiptFailText({ fbCode }, t)).not.toMatch(CODE);
      expect(receiptFailText({ fbCode }, t, true)).not.toMatch(CODE);
    }
  });
});

describe("Parcel Scan and admin broadcast translate", () => {
  it("every status × every code → the error shown is never a code or a server sentence", async () => {
    for (const status of [400, 402, 409, 500, 502, 503]) {
      for (const c of CODES) {
        serve(status, { success: false, error: c });
        const s = await scanParcel("aGk=", "image/jpeg");
        expect(s.error).not.toMatch(CODE);
        expect(s.error).not.toMatch(/\s/);
        serve(status, { success: false, error: c });
        const b = await translateBroadcast("hi");
        expect(b.error || "").not.toMatch(CODE);
        expect(b.error || "").not.toMatch(/\s/);
      }
    }
  });
});
