// Audit Oct 22 (2) — a pin is marked "seen" only once its order is created; while orders are
// paused (board (re)loading) the pin is HELD and replayed afterwards, like deferredAuto.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { renderHook, act } from "@testing-library/react";
import type { PinPayload } from "../pinToPrint";

const H = vi.hoisted(() => ({ sockets: [] as Array<{ on: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> }));
vi.mock("socket.io-client", () => ({ io: vi.fn(() => { const s = { on: vi.fn(), emit: vi.fn(), disconnect: vi.fn() }; H.sockets.push(s); return s; }) }));

import { useLiveFeed } from "../useLiveFeed";

const sock = () => H.sockets[0];
const handlerFor = (event: string) => sock().on.mock.calls.find((c) => c[0] === event)?.[1] as ((d: unknown) => void) | undefined;
const pin = (msgId: string): PinPayload => ({ pinned: true, platform: "TikTok", username: "shop_a", handle: "ann", name: "Ann", comment: "mine!", msgId, time: "", timestamp: "2026-10-22T01:00:00Z" } as PinPayload);

beforeEach(() => { vi.clearAllMocks(); H.sockets.length = 0; localStorage.clear(); });

describe("useLiveFeed platform_pin — seen only when the handler is done", () => {
  it("handler false (held / gate off) → the same pin reaches the handler again; handler true → never again", () => {
    const seen: string[] = [];
    let done = false;
    const onPinned = vi.fn((p: PinPayload) => { seen.push(String(p.msgId)); return done; });
    renderHook(() => useLiveFeed(true, "g@x.com", undefined, { TikTok: "shop_a", Facebook: "" }, onPinned));
    act(() => { handlerFor("platform_status")?.({ platform: "TikTok", connected: true, username: "shop_a" }); });
    act(() => { handlerFor("platform_pin")?.(pin("p1")); });
    act(() => { handlerFor("platform_pin")?.(pin("p1")); });
    expect(seen).toEqual(["p1", "p1"]);       // not seen yet → handled again
    done = true;
    act(() => { handlerFor("platform_pin")?.(pin("p1")); });
    act(() => { handlerFor("platform_pin")?.(pin("p1")); });
    expect(seen).toEqual(["p1", "p1", "p1"]); // the third call created the order → seen → the fourth never reaches the handler
  });
});

describe("RedesignApp wiring (source contracts)", () => {
  const app = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
  const i = app.indexOf("const handlePinned = (p: PinPayload): boolean =>");
  const block = app.slice(i, app.indexOf("useEffect(() => { pinHandlerRef.current = handlePinned; });", i));
  it("pins arriving while orders are paused are held (deferredPins) and the handler answers false", () => {
    expect(block).toContain('if (!liveSession.orderedLoaded || liveSession.state === "loading" || !liveSession.canOrder()) {');
    expect(block).toContain('deferredPins.push(String(p?.msgId || ""), p);');
    expect(block).toContain("return false;");
    expect(block.trimEnd().endsWith("return true;\n  };")).toBe(true); // an order created → done
  });
  it("held pins replay through the same handler once the board is ready, and are cleared on session resets", () => {
    expect(app).toContain("if (liveSession.orderedLoaded && deferredPins.size() > 0) {");
    expect(app).toContain("for (const p of pins) pinHandlerRef.current(p);");
    expect((app.match(/deferredPins\.clear\(\)/g) || []).length).toBe((app.match(/deferredAuto\.clear\(\)/g) || []).length);
    expect(app).toContain("(p) => pinHandlerRef.current(p)");
  });
});
