// 1.18.0 popup — the ONE frozen warm-up line (chrome-extension/popup.js, the REAL file in jsdom):
// hidden while warm-up is off; "Frozen warm-up: N checked · M left · last at HH:MM" while on;
// "Warm-up stopped: <reason>" (red) after the extension stopped itself. Set as TEXT, never HTML.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";

const storage: Record<string, unknown> = {};
let renderStatus: () => Promise<void>;

beforeAll(() => {
  vi.useFakeTimers();
  const html = readFileSync(`${process.env.SFL_EXT_DIR || "chrome-extension"}/popup.html`, "utf8");
  document.body.innerHTML = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? "").replace(/<script[\s\S]*?<\/script>/gi, "");
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local: {
      get: (k: string[], cb: (r: Record<string, unknown>) => void) => cb({ [k[0]]: storage[k[0]] }),
      set: (o: Record<string, unknown>, cb?: () => void) => { Object.assign(storage, o); cb?.(); },
    } },
    runtime: { sendMessage: () => {} },
  };
  (0, eval)(readFileSync(`${process.env.SFL_EXT_DIR || "chrome-extension"}/popup.js`, "utf8"));
  renderStatus = (globalThis as unknown as { pcRenderStatus: () => Promise<void> }).pcRenderStatus;
});
afterAll(() => { vi.useRealTimers(); });

const line = async (warm: unknown) => {
  storage.pc_status = { multi: "ok", multiQueueDepth: 0 }; storage.pc_config = { multiSeller: true };
  storage.pc_frozen_warmup = warm;
  await renderStatus();
  const el = document.getElementById("pcWarmRow")!;
  return { shown: el.style.display !== "none", text: el.textContent, color: el.style.color };
};
const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

describe("popup — frozen warm-up line", () => {
  it("absent / off → hidden", async () => {
    expect((await line(undefined)).shown).toBe(false);
    expect((await line({ on: false })).shown).toBe(false);
    // the worker's restart memory rides in the same key — it never shows a line by itself
    expect((await line({ on: false, mem: { stopped: true, stopReason: "HTTP 403", lastAt: 1, pauseUntil: Date.now() + 60_000 } })).shown).toBe(false);
  });
  it("on → 'Frozen warm-up: N checked · M left · last at HH:MM'", async () => {
    const t = Date.UTC(2026, 10, 8, 6, 5);
    const r = await line({ on: true, checked: 366, left: 4763, lastAt: t, pausedUntil: null, nothingDue: false, stopped: false, stopReason: "" });
    expect(r.shown).toBe(true);
    expect(r.text).toBe(`Frozen warm-up: 366 checked · 4763 left · last at ${hhmm(t)}`);
  });
  it("paused → adds 'paused until HH:MM'; nothing due → says so", async () => {
    const p = Date.now() + 20 * 60_000;
    expect((await line({ on: true, checked: 3, left: 10, lastAt: null, pausedUntil: p, nothingDue: false, stopped: false })).text)
      .toBe(`Frozen warm-up: 3 checked · 10 left · paused until ${hhmm(p)}`);
    expect((await line({ on: true, checked: 5130, left: 0, lastAt: null, nothingDue: true, stopped: false })).text)
      .toBe("Frozen warm-up: 5130 checked · nothing to check now");
  });
  it("stopped → red 'Warm-up stopped: <reason>', as text (no HTML)", async () => {
    const r = await line({ on: false, stopped: true, stopReason: "<b>/ecmap/byIDData.aspx returned HTTP 403</b>" });
    expect(r.shown).toBe(true);
    expect(r.text).toBe("Warm-up stopped: <b>/ecmap/byIDData.aspx returned HTTP 403</b>");
    expect(document.getElementById("pcWarmRow")!.querySelector("b")).toBeNull();
    expect(r.color).toBe("rgb(229, 72, 77)");
  });
});
