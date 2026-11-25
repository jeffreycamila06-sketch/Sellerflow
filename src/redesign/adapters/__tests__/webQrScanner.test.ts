// The in-page live QR scanner (adapters/webQrScanner): who gets it, what the camera is asked, the
// centre rule on live frames, and — on EVERY way out — that the camera is really switched off.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const track = vi.fn();
vi.mock("../../analytics", () => ({ track: (e: string, p: unknown) => track(e, p) }));
const pixelHits = vi.fn();
vi.mock("../qrDecode", () => ({ readQrFromFile: vi.fn(), readQrHitsFromPixels: (px: unknown) => pixelHits(px) }));

import {
  cameraGrabber, frameSidePx, hitsFromDetected, openWebQrScanner, scanGeometry, setWebQrScannerOn, torchSupported,
  webQrScanner, webScanConstraints, webScanFallbackText, webScannerAvailable, type FrameGrabber, type WebScanResult,
} from "../webQrScanner";
import { scannerTexts } from "../nativeQrScanner";
import { parseSwitches, SWITCHES_OFF, FEATURE_SWITCH_KEYS } from "../featureSwitches";
import { buildT } from "../../i18n";
import type { QrHit } from "../../../lib/qrCentrePick";
import { installApp, removeApp, installFakePhone, setTapCounts, scannerOnScreen, part, until, settle, type FakePhone } from "./webScan.harness";

const TEXTS = scannerTexts(buildT("en"));
const FRAME = { cx: 100, cy: 100, side: 100 };
const at = (text: string, dx = 0, dy = 0): QrHit => ({ text, cx: 100 + dx, cy: 100 + dy });

// A frame reader the test drives by hand: each `frame(hits)` answers the scanner's next look.
function byHand() {
  const waiting: ((v: { hits: QrHit[]; frame: typeof FRAME } | null) => void)[] = [];
  const state = { dead: false, disposed: 0, looks: 0 };
  const grabber: FrameGrabber = {
    grab: () => new Promise((res) => { state.looks++; waiting.push(res); }),
    dead: () => state.dead,
    reader: () => "test",
    dispose: () => { state.disposed++; },
  };
  const answer = async (v: { hits: QrHit[]; frame: typeof FRAME } | null) => {
    await until(() => waiting.length > 0);
    waiting.shift()!(v);
    await settle(8);
  };
  return { grabber, state, frame: (hits: QrHit[]) => answer({ hits, frame: FRAME }), noPicture: () => answer(null) };
}

let phone: FakePhone & { resolveCamera: () => void; rejectCamera: (name: string) => void };
const done = vi.fn<(r: WebScanResult) => void>();
// Every scanner a test opens is closed (quietly) after it, so no test inherits another one's scanner.
const opened: { close: (silent?: boolean) => void }[] = [];
const scan: typeof openWebQrScanner = (texts, onDone, deps) => { const h = openWebQrScanner(texts, onDone, deps); opened.push(h); return h; };
const open = (hand = byHand(), extra: Record<string, unknown> = {}) => {
  const handle = scan(TEXTS, done, { grabber: () => hand.grabber, frameMs: 0, ...extra });
  return { handle, hand };
};
const allStopped = () => phone.tracks.length > 0 && phone.tracks.every((t) => t.stop.mock.calls.length >= 1);

beforeEach(() => { track.mockReset(); pixelHits.mockReset(); done.mockReset(); setTapCounts(undefined); });
afterEach(() => {
  for (const h of opened.splice(0)) h.close(true);
  setWebQrScannerOn(false); removeApp(); phone?.restore(); setTapCounts(undefined); vi.restoreAllMocks();
});

// ── Who gets it ───────────────────────────────────────────────────────────────────────────────
describe("who gets the in-page scanner", () => {
  const withCamera = (yes: boolean) => {
    if (yes) Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn() } });
    else delete (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
  };
  afterEach(() => withCamera(false));

  it("every combination: ONLY the Android app + no built-in scanner + the switch exactly true + a camera to ask", () => {
    const platforms: (string | null | undefined)[] = ["android", "ios", "web", null, undefined]; // null = Capacitor without getPlatform; undefined = no Capacitor (laptop)
    const switches: unknown[] = [true, false, "true", 1, null, undefined];
    let yes = 0, total = 0;
    for (const platform of platforms) for (const plugin of [false, true]) for (const sw of switches) for (const cam of [true, false]) {
      removeApp();
      if (platform !== undefined) installApp(platform, plugin ? { SellerFlowScanner: { scanStickerQr: vi.fn() } } : {});
      withCamera(cam);
      setWebQrScannerOn(sw as never);
      const expected = platform === "android" && !plugin && sw === true && cam;
      expect(webQrScanner(), `tap: ${platform} plugin=${plugin} switch=${String(sw)} camera=${cam}`).toBe(expected);
      expect(webScannerAvailable(sw as never), `render: ${platform} plugin=${plugin} switch=${String(sw)} camera=${cam}`).toBe(expected);
      total++; if (expected) yes++;
    }
    expect(total).toBe(120);
    expect(yes).toBe(1);
  });
  it("the built-in scanner in the app build wins, whatever ITS switch says (the page never draws a second scanner)", () => {
    installApp("android", { SellerFlowScanner: { scanStickerQr: vi.fn() } });
    withCamera(true);
    setWebQrScannerOn(true);
    expect(webQrScanner()).toBe(false);
  });
  it("an app build with other plugins only (the printer) still counts as 'no built-in scanner'", () => {
    installApp("android", { SellerFlowPrinter: { printRawTspl: vi.fn() } });
    withCamera(true);
    setWebQrScannerOn(true);
    expect(webQrScanner()).toBe(true);
  });
  it("a Capacitor object that throws → off (never an error)", () => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = { getPlatform: () => { throw new Error("x"); }, Plugins: {} };
    withCamera(true);
    setWebQrScannerOn(true);
    expect(webQrScanner()).toBe(false);
  });
});

describe("the kill switch web_qr_scanner_enabled — fail closed", () => {
  it("is one of the switches read once per sign-in, off by default", () => {
    expect(FEATURE_SWITCH_KEYS.webQrScanner).toBe("web_qr_scanner_enabled");
    expect(SWITCHES_OFF.webQrScanner).toBe(false);
  });
  it("only the exact text 'true' turns it on", () => {
    expect(parseSwitches([{ key: "web_qr_scanner_enabled", value: "true" }]).webQrScanner).toBe(true);
    for (const v of ["false", "TRUE", "True", "true ", " true", "1", "yes", "", null, undefined, true, 1]) {
      expect(parseSwitches([{ key: "web_qr_scanner_enabled", value: v }]).webQrScanner, String(v)).toBe(false);
    }
  });
  it("no row / a failed read / rows of other switches → off", () => {
    expect(parseSwitches([]).webQrScanner).toBe(false);
    expect(parseSwitches(null).webQrScanner).toBe(false);
    expect(parseSwitches([{ key: "native_qr_scanner_enabled", value: "true" }]).webQrScanner).toBe(false);
  });
  it("the native scanner's switch and this one are separate rows", () => {
    const sw = parseSwitches([{ key: "web_qr_scanner_enabled", value: "true" }]);
    expect(sw.nativeQrScanner).toBe(false);
  });
});

// ── Pure parts ────────────────────────────────────────────────────────────────────────────────
describe("the frame and the part of the camera picture that is read", () => {
  it("the frame = the phone app's: 68 % of the short side, at most 320 px", () => {
    expect(frameSidePx(412, 915)).toBeCloseTo(280.16, 2);
    expect(frameSidePx(915, 412)).toBeCloseTo(280.16, 2);
    expect(frameSidePx(800, 1280)).toBe(320);
    expect(frameSidePx(360, 640)).toBeCloseTo(244.8, 2);
  });
  it("a 1080×1920 camera on a 412×915 screen: the frame sits in the middle of what is read", () => {
    const g = scanGeometry(1080, 1920, 412, 915, 1280)!;
    const scale = Math.max(412 / 1080, 915 / 1920);
    const side = frameSidePx(412, 915) / scale;
    expect(g.sx).toBe(0);                       // the read part is cut at the picture's edge…
    expect(g.sw).toBe(1080);
    expect(g.sy).toBe(Math.floor(960 - side));  // …and reaches one frame side above / below the centre
    expect(g.sh).toBe(Math.ceil(960 + side) - Math.floor(960 - side));
    expect(g.frame.cx).toBeCloseTo(g.cw / 2, 0);
    expect(g.frame.cy).toBeCloseTo(g.ch / 2, 0);
    expect(g.frame.side).toBeCloseTo(side * (g.cw / g.sw), 3);
    expect(Math.max(g.cw, g.ch)).toBeLessThanOrEqual(1280);
  });
  it("a landscape camera picture (1920×1080) on the same screen", () => {
    const g = scanGeometry(1920, 1080, 412, 915, 960)!;
    const side = frameSidePx(412, 915) / Math.max(412 / 1920, 915 / 1080); // the frame in camera pixels (≈ 331)
    expect([g.sx, g.sy]).toEqual([Math.floor(960 - side), Math.floor(540 - side)]);
    expect([g.sw, g.sh]).toEqual([Math.ceil(960 + side) - Math.floor(960 - side), Math.ceil(540 + side) - Math.floor(540 - side)]);
    expect(g.sx).toBeGreaterThan(0); expect(g.sy).toBeGreaterThan(0); // inside the picture on every side
    expect(g.frame.side).toBeCloseTo(side * (g.cw / g.sw), 3);
    expect(Math.max(g.cw, g.ch)).toBeLessThanOrEqual(960);
    expect(g.frame.cx).toBeCloseTo(g.cw / 2, 0);
    expect(g.frame.cy).toBeCloseTo(g.ch / 2, 0);
  });
  it("no picture yet / no screen size → nothing to read", () => {
    for (const a of [[0, 0, 412, 915], [1080, 1920, 0, 915], [1080, 1920, 412, 0], [NaN, 1920, 412, 915]]) {
      expect(scanGeometry(a[0], a[1], a[2], a[3], 1280)).toBeNull();
    }
    expect(scanGeometry(1080, 1920, 412, 915, 0)).toBeNull();
  });
  it("the phone reader's answer → text + centre (corner points, else the box); empty texts dropped", () => {
    expect(hitsFromDetected([
      { rawValue: "A", boundingBox: { x: 10, y: 20, width: 40, height: 60 } },
      { rawValue: "B", cornerPoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], boundingBox: { x: 500, y: 500, width: 2, height: 2 } },
      { rawValue: "" , boundingBox: { x: 1, y: 1, width: 1, height: 1 } },
      { boundingBox: { x: 1, y: 1, width: 1, height: 1 } },
      { rawValue: "no place" },
    ])).toEqual([{ text: "A", cx: 30, cy: 50 }, { text: "B", cx: 5, cy: 5 }]);
    expect(hitsFromDetected(null)).toEqual([]);
  });
  it("the camera is asked for the BACK camera at about 1920×1080, no microphone", () => {
    expect(webScanConstraints()).toEqual({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  });
  it("the one line when the camera can't be used", () => {
    expect(webScanFallbackText("denied", TEXTS)).toBe("Camera is off for SellerFlowLive");
    expect(webScanFallbackText("unavailable", TEXTS)).toBe("The camera isn't available right now");
  });
});

// ── The scanner screen ────────────────────────────────────────────────────────────────────────
describe("the scanner screen", () => {
  it("opens full screen with the phone app's texts and asks for the camera once", async () => {
    phone = installFakePhone();
    open();
    const root = scannerOnScreen()!;
    expect(root).toBeTruthy();
    expect(root.getAttribute("role")).toBe("dialog");
    expect(root.getAttribute("aria-label")).toBe("Scan sticker QR");
    expect(root.style.position).toBe("fixed");
    expect(part("wqs-title").textContent).toBe("Scan sticker QR");
    expect(part("wqs-hint").textContent).toBe("Point at the QR on the sticker");
    expect(part("wqs-photo").textContent).toBe("Take a photo instead");
    expect(part("wqs-close").getAttribute("aria-label")).toBe("Close");
    expect(phone.getUserMedia).toHaveBeenCalledTimes(1);
    expect(phone.getUserMedia.mock.calls[0][0]).toEqual(webScanConstraints());
    await until(() => (part("wqs-video") as HTMLVideoElement).srcObject != null);
    expect(done).not.toHaveBeenCalled();
  });

  it("a QR in the frame for TWO frames in a row is read — the text VERBATIM — beep + vibration, camera off", async () => {
    phone = installFakePhone();
    const { hand } = open();
    const text = " https://www.tiktok.com/@Buyer.One?lang=en  ";
    await hand.frame([at(text)]);
    expect(done).not.toHaveBeenCalled();       // one frame is not enough
    expect(scannerOnScreen()).toBeTruthy();
    await hand.frame([at(text)]);
    expect(done).toHaveBeenCalledTimes(1);
    expect(done.mock.calls[0][0]).toEqual({ kind: "read", text });
    expect(allStopped()).toBe(true);
    expect(scannerOnScreen()).toBeNull();
    expect(phone.vibrate).toHaveBeenCalledWith(60);
    expect(phone.beeps).toHaveLength(1);
    expect(phone.beeps[0].hz).toBe(2600);
    expect(phone.beeps[0].stop - phone.beeps[0].start).toBeCloseTo(0.13, 5);
    expect(hand.state.disposed).toBe(1);
  });

  it("a different QR in the second frame starts the count again (never a mix of two)", async () => {
    phone = installFakePhone();
    const { hand } = open();
    await hand.frame([at("A")]);
    await hand.frame([at("B")]);
    expect(done).not.toHaveBeenCalled();
    await hand.frame([]);               // nothing in view: the count starts again
    await hand.frame([at("B")]);
    expect(done).not.toHaveBeenCalled();
    await hand.frame([at("B")]);
    expect(done.mock.calls[0][0]).toEqual({ kind: "read", text: "B" });
  });

  it("two QRs too close to the centre → 'Point at one QR', nothing is read; one QR again → the normal hint, then the read", async () => {
    phone = installFakePhone();
    const { hand } = open();
    await hand.frame([at("A", -5), at("B", 5)]);
    expect(part("wqs-hint").textContent).toBe("Point at one QR");
    await hand.frame([at("A", -5), at("B", 5)]);
    expect(done).not.toHaveBeenCalled();
    await hand.frame([at("A")]);
    expect(part("wqs-hint").textContent).toBe("Point at the QR on the sticker");
    await hand.frame([at("A")]);
    expect(done.mock.calls[0][0]).toEqual({ kind: "read", text: "A" });
  });

  it("a QR whose centre is OUTSIDE the frame is never read; the nearer of two wins when clearly nearer", async () => {
    phone = installFakePhone();
    const { hand } = open();
    for (let i = 0; i < 3; i++) await hand.frame([at("OUT", 70, 0)]);
    expect(done).not.toHaveBeenCalled();
    await hand.frame([at("NEAR", 2), at("FAR", 40)]);
    await hand.frame([at("NEAR", 2), at("FAR", 40)]);
    expect(done.mock.calls[0][0]).toEqual({ kind: "read", text: "NEAR" });
  });

  it("a frame that could not be read does not break the count, and a reader error is not an error for the seller", async () => {
    phone = installFakePhone();
    const hand = byHand();
    let boom = true;
    const g: FrameGrabber = { ...hand.grabber, grab: () => { if (boom) { boom = false; return Promise.reject(new Error("x")); } return hand.grabber.grab(); } };
    scan(TEXTS, done, { grabber: () => g, frameMs: 0 });
    await hand.frame([at("A")]);
    await hand.noPicture();
    await hand.frame([at("A")]);
    expect(done.mock.calls[0][0]).toEqual({ kind: "read", text: "A" });
  });

  it("the event sent says how it ended — never the QR text", async () => {
    phone = installFakePhone();
    const { hand } = open();
    await hand.frame([at("@secret.buyer")]);
    await hand.frame([at("@secret.buyer")]);
    expect(track).toHaveBeenCalledTimes(1);
    const [name, props] = track.mock.calls[0];
    expect(name).toBe("qr_web");
    expect(props).toMatchObject({ result: "read", reason: null, reader: "test" });
    expect(JSON.stringify(track.mock.calls)).not.toContain("secret");
  });
});

// ── Every way out stops the camera ────────────────────────────────────────────────────────────
describe("every way out switches the camera off (all tracks stopped) and answers ONCE", () => {
  const started = async () => { await until(() => phone.tracks.length === 1 && (part("wqs-video") as HTMLVideoElement).srcObject != null); };

  it("Close", async () => {
    phone = installFakePhone();
    open(); await started();
    part("wqs-close").click();
    expect(done.mock.calls).toEqual([[{ kind: "cancelled" }]]);
    expect(allStopped()).toBe(true);
    expect(scannerOnScreen()).toBeNull();
  });
  it("'Take a photo instead' — answered INSIDE the tap (the screen opens the photo picker from it)", async () => {
    phone = installFakePhone();
    open(); await started();
    part("wqs-photo").click();
    expect(done.mock.calls).toEqual([[{ kind: "photo" }]]); // no waiting: already answered when click() returns
    expect(allStopped()).toBe(true);
    expect(scannerOnScreen()).toBeNull();
  });
  it("the phone's Back (a history entry is added while open; Back pops it)", async () => {
    phone = installFakePhone();
    const before = window.history.length;
    open(); await started();
    expect(window.history.length).toBe(before + 1);
    expect((window.history.state as Record<string, unknown>).sflWebQrScanner).toBe(true);
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    expect(done.mock.calls).toEqual([[{ kind: "cancelled" }]]);
    expect(allStopped()).toBe(true);
    expect(scannerOnScreen()).toBeNull();
  });
  it("closed another way → its history entry is taken off again (Back afterwards does what it did before)", async () => {
    phone = installFakePhone();
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    open(); await started();
    part("wqs-close").click();
    expect(back).toHaveBeenCalledTimes(1);
  });
  it("a late pop that lands on a scanner entry (an earlier scanner's own clean-up) is NOT the seller's Back", async () => {
    phone = installFakePhone();
    open(); await started();
    window.dispatchEvent(new PopStateEvent("popstate", { state: { sflWebQrScanner: true } }));
    expect(done).not.toHaveBeenCalled();
    expect(scannerOnScreen()).toBeTruthy();
    part("wqs-close").click();
  });
  it("the app goes to the background (visibilitychange → hidden)", async () => {
    phone = installFakePhone();
    open(); await started();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    hidden.mockRestore();
    expect(done.mock.calls).toEqual([[{ kind: "cancelled" }]]);
    expect(allStopped()).toBe(true);
    expect(scannerOnScreen()).toBeNull();
  });
  it("visibilitychange while still visible does nothing", async () => {
    phone = installFakePhone();
    open(); await started();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(done).not.toHaveBeenCalled();
    expect(scannerOnScreen()).toBeTruthy();
    part("wqs-close").click();
  });
  it("the page is left (pagehide)", async () => {
    phone = installFakePhone();
    open(); await started();
    window.dispatchEvent(new Event("pagehide"));
    expect(done.mock.calls).toEqual([[{ kind: "cancelled" }]]);
    expect(allStopped()).toBe(true);
  });
  it("Esc (a keyboard)", async () => {
    phone = installFakePhone();
    open(); await started();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(done.mock.calls).toEqual([[{ kind: "cancelled" }]]);
    expect(allStopped()).toBe(true);
  });
  it("the screen is left: close(true) stops the camera and does NOT call the screen back", async () => {
    phone = installFakePhone();
    const { handle } = open(); await started();
    handle.close(true);
    expect(done).not.toHaveBeenCalled();
    expect(allStopped()).toBe(true);
    expect(scannerOnScreen()).toBeNull();
  });
  it("the camera stops by itself (taken by another app) → the photo flow, 'not available'", async () => {
    phone = installFakePhone();
    open(); await started();
    phone.tracks[0].fire("ended");
    expect(done.mock.calls).toEqual([[{ kind: "fallback", reason: "unavailable" }]]);
    expect(allStopped()).toBe(true);
    expect(scannerOnScreen()).toBeNull();
  });
  it("after ANY way out nothing is listening any more: later events answer nothing, nothing runs twice", async () => {
    phone = installFakePhone();
    const { hand } = open(); await started();
    part("wqs-close").click();
    const looks = hand.state.looks;
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    window.dispatchEvent(new Event("pagehide"));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    phone.tracks[0].fire("ended");
    await settle(30);
    expect(done).toHaveBeenCalledTimes(1);
    expect(hand.state.looks).toBe(looks); // the reader is not asked again
    expect(track).toHaveBeenCalledTimes(1);
  });
  it("closed while the phone is still asking for the camera → the camera that arrives later is switched off at once", async () => {
    phone = installFakePhone({ camera: "pending" });
    open();
    part("wqs-close").click();
    expect(done.mock.calls).toEqual([[{ kind: "cancelled" }]]);
    phone.resolveCamera();
    await until(() => phone.tracks.length === 1);
    await settle(10);
    expect(allStopped()).toBe(true);
    expect(scannerOnScreen()).toBeNull();
    expect(done).toHaveBeenCalledTimes(1);
  });
  it("in the background while the phone still asks for the camera: nothing runs; the camera that then arrives is switched off", async () => {
    phone = installFakePhone({ camera: "pending" });
    open();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(done).not.toHaveBeenCalled(); // no camera is on yet — settled when it answers
    phone.resolveCamera();
    await until(() => done.mock.calls.length === 1);
    hidden.mockRestore();
    expect(done.mock.calls[0][0]).toEqual({ kind: "cancelled" });
    expect(allStopped()).toBe(true);
    expect(scannerOnScreen()).toBeNull();
  });
  it("one scanner at a time: opening again closes the first (its camera off)", async () => {
    phone = installFakePhone();
    open(); await started();
    const second = vi.fn();
    const h2 = scan(TEXTS, second, { grabber: () => byHand().grabber, frameMs: 0 });
    expect(done.mock.calls).toEqual([[{ kind: "cancelled" }]]);
    expect(phone.tracks[0].stop).toHaveBeenCalled();
    expect(document.querySelectorAll('[data-testid="wqs"]')).toHaveLength(1);
    h2.close();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

// ── The camera can't be used ──────────────────────────────────────────────────────────────────
describe("camera refused / not there / any error → today's photo flow with one line", () => {
  it("refused (NotAllowedError) → fallback 'denied', the scanner is gone", async () => {
    phone = installFakePhone({ camera: { reject: "NotAllowedError" } });
    open();
    await until(() => done.mock.calls.length === 1);
    expect(done.mock.calls[0][0]).toEqual({ kind: "fallback", reason: "denied" });
    expect(scannerOnScreen()).toBeNull();
    expect(track.mock.calls[0][1]).toMatchObject({ result: "fallback", reason: "denied" });
  });
  it.each(["NotFoundError", "NotReadableError", "OverconstrainedError", "AbortError", "TypeError", ""])("any other camera error (%s) → fallback 'unavailable'", async (name) => {
    phone = installFakePhone({ camera: { reject: name } });
    open();
    await until(() => done.mock.calls.length === 1);
    expect(done.mock.calls[0][0]).toEqual({ kind: "fallback", reason: "unavailable" });
  });
  it("no camera API at all → answered at once, inside the tap", () => {
    phone = installFakePhone();
    delete (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
    open();
    expect(done.mock.calls).toEqual([[{ kind: "fallback", reason: "unavailable" }]]);
    expect(scannerOnScreen()).toBeNull();
  });
  it("getUserMedia itself throws → fallback, never an error for the screen", () => {
    phone = installFakePhone();
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: () => { throw new Error("boom"); } } });
    expect(() => open()).not.toThrow();
    expect(done.mock.calls).toEqual([[{ kind: "fallback", reason: "unavailable" }]]);
    expect(scannerOnScreen()).toBeNull();
  });
  it("no camera picture ever arrives → fallback 'unavailable', camera off", async () => {
    phone = installFakePhone();
    const hand = byHand();
    scan(TEXTS, done, { grabber: () => hand.grabber, frameMs: 0, startMs: 30 });
    await until(() => done.mock.calls.length === 1);
    expect(done.mock.calls[0][0]).toEqual({ kind: "fallback", reason: "unavailable" });
    expect(allStopped()).toBe(true);
  });
  it("no QR reader works on this phone → fallback 'unavailable', camera off", async () => {
    phone = installFakePhone();
    const { hand } = open();
    hand.state.dead = true;
    await hand.noPicture();
    expect(done.mock.calls).toEqual([[{ kind: "fallback", reason: "unavailable" }]]);
    expect(allStopped()).toBe(true);
  });
  it("the tap no longer counts (a long permission question): the scanner STAYS with the line and its own 'Take a photo instead'", async () => {
    phone = installFakePhone({ camera: "pending" });
    open();
    setTapCounts(false);
    phone.rejectCamera("NotAllowedError");
    await until(() => part("wqs-panel").style.display === "block");
    expect(done).not.toHaveBeenCalled();
    expect(part("wqs-panel").textContent).toBe("Camera is off for SellerFlowLive");
    expect(part("wqs-frame").style.display).toBe("none");
    expect(part("wqs-hint").style.display).toBe("none");
    expect(part("wqs-light").style.display).toBe("none");
    part("wqs-photo").click();
    expect(done.mock.calls).toEqual([[{ kind: "photo" }]]);
    expect(scannerOnScreen()).toBeNull();
  });
  it("…and Close there = cancelled; going to the background there closes it too", async () => {
    phone = installFakePhone({ camera: "pending" });
    open();
    setTapCounts(false);
    phone.rejectCamera("NotFoundError");
    await until(() => part("wqs-panel").style.display === "block");
    expect(part("wqs-panel").textContent).toBe("The camera isn't available right now");
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    hidden.mockRestore();
    expect(done.mock.calls).toEqual([[{ kind: "cancelled" }]]);
  });
  it("the tap still counts → closed and handed over at once", async () => {
    phone = installFakePhone({ camera: "pending" });
    open();
    setTapCounts(true);
    phone.rejectCamera("NotAllowedError");
    await until(() => done.mock.calls.length === 1);
    expect(done.mock.calls[0][0]).toEqual({ kind: "fallback", reason: "denied" });
  });
});

// ── The light ─────────────────────────────────────────────────────────────────────────────────
describe("the flashlight button", () => {
  const started = async () => { await until(() => phone.tracks.length === 1); await settle(5); };
  it("is shown ONLY when the camera has a light", async () => {
    phone = installFakePhone({ caps: {} });
    open(); await started();
    expect(part("wqs-light").style.display).toBe("none");
    expect(torchSupported(phone.tracks[0] as unknown as MediaStreamTrack)).toBe(false);
    part("wqs-close").click();
    phone.restore();
    phone = installFakePhone({ caps: { torch: true } });
    open(); await started();
    expect(part("wqs-light").style.display).toBe("flex");
    expect(part("wqs-light").getAttribute("aria-label")).toBe("Turn on the light");
    expect(part("wqs-light").getAttribute("aria-pressed")).toBe("false");
  });
  it("switches the camera's light on and off (applyConstraints torch)", async () => {
    phone = installFakePhone({ caps: { torch: true } });
    open(); await started();
    const t = phone.tracks[0];
    part("wqs-light").click();
    await until(() => part("wqs-light").getAttribute("aria-pressed") === "true");
    expect(t.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ torch: true }] });
    expect(part("wqs-light").getAttribute("aria-label")).toBe("Turn off the light");
    part("wqs-light").click();
    await until(() => part("wqs-light").getAttribute("aria-pressed") === "false");
    expect(t.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ torch: false }] });
  });
  it("a light that refuses stays 'off' (no false 'on')", async () => {
    phone = installFakePhone({ caps: { torch: true } });
    open(); await started();
    phone.tracks[0].applyConstraints.mockRejectedValueOnce(new Error("no"));
    part("wqs-light").click();
    await settle(10);
    expect(part("wqs-light").getAttribute("aria-pressed")).toBe("false");
  });
  it("a camera that can focus by itself is asked to (continuous)", async () => {
    phone = installFakePhone({ caps: { focusMode: ["manual", "continuous"] } });
    open(); await started();
    expect(phone.tracks[0].applyConstraints).toHaveBeenCalledWith({ advanced: [{ focusMode: "continuous" }] });
  });
});

// ── Never throws ──────────────────────────────────────────────────────────────────────────────
describe("never throws", () => {
  it("a screen whose own code throws in the answer does not break the scanner", async () => {
    phone = installFakePhone();
    const hand = byHand();
    scan(TEXTS, () => { throw new Error("screen bug"); }, { grabber: () => hand.grabber, frameMs: 0 });
    await until(() => phone.tracks.length === 1);
    expect(() => part("wqs-close").click()).not.toThrow();
    expect(allStopped()).toBe(true);
  });
  it("a phone without sound and without vibration still reads", async () => {
    phone = installFakePhone();
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
    delete (navigator as unknown as { vibrate?: unknown }).vibrate;
    const { hand } = open();
    await hand.frame([at("A")]);
    await hand.frame([at("A")]);
    expect(done.mock.calls[0][0]).toEqual({ kind: "read", text: "A" });
  });
  it("the sound card is given back after the beep", async () => {
    phone = installFakePhone();
    const { hand } = open();
    await hand.frame([at("A")]);
    await hand.frame([at("A")]);
    await until(() => phone.closedAudio.count >= 1, 1500);
  });
});

// ── The real frame reader ─────────────────────────────────────────────────────────────────────
describe("reading a frame: the phone's own reader, else the loaded one", () => {
  const video = () => document.createElement("video");
  const view = () => ({ w: 412, h: 915 });
  it("the phone's reader gets the middle part of the picture; the frame is at its centre", async () => {
    phone = installFakePhone();
    phone.seen.current = [{ text: "https://tiktok.com/@a", dx: 3, dy: -4 }];
    const g = cameraGrabber(video(), view);
    const got = (await g.grab())!;
    const geo = scanGeometry(1080, 1920, 412, 915, 1280)!;
    expect(got.frame).toEqual(geo.frame);
    expect(got.hits).toEqual([{ text: "https://tiktok.com/@a", cx: geo.cw / 2 + 3, cy: geo.ch / 2 - 4 }]);
    const canvas = phone.detect.mock.calls[0][0] as HTMLCanvasElement;
    expect([canvas.width, canvas.height]).toEqual([geo.cw, geo.ch]);
    expect(g.reader()).toBe("native");
    expect(pixelHits).not.toHaveBeenCalled(); // the other reader is not even loaded
  });
  it.each(["none", "no_qr_format"] as const)("phone reader %s → the loaded reader is used", async (detector) => {
    phone = installFakePhone({ detector });
    pixelHits.mockResolvedValue([{ text: "X", cx: 1, cy: 2 }]);
    const g = cameraGrabber(video(), view);
    expect((await g.grab())!.hits).toEqual([{ text: "X", cx: 1, cy: 2 }]);
    expect(g.reader()).toBe("loaded");
    expect(phone.detect).not.toHaveBeenCalled();
    const px = pixelHits.mock.calls[0][0] as { width: number; height: number };
    const geo = scanGeometry(1080, 1920, 412, 915, 960)!;
    expect([px.width, px.height]).toEqual([geo.cw, geo.ch]); // read smaller than the phone's reader would
  });
  it("the phone's reader failing 3 frames in a row → the loaded reader takes over", async () => {
    phone = installFakePhone({ detector: "throws" });
    pixelHits.mockResolvedValue([]);
    const g = cameraGrabber(video(), view);
    for (let i = 0; i < 3; i++) expect(await g.grab()).toBeNull();
    expect(g.reader()).toBe("loaded");
    expect(await g.grab()).toEqual({ hits: [], frame: scanGeometry(1080, 1920, 412, 915, 960)!.frame });
    expect(g.dead()).toBe(false);
  });
  it("no reader can be loaded 3 frames in a row → dead (the scanner then gives way to the photo flow)", async () => {
    phone = installFakePhone({ detector: "none" });
    pixelHits.mockResolvedValue(null);
    const g = cameraGrabber(video(), view);
    for (let i = 0; i < 2; i++) { expect(await g.grab()).toBeNull(); expect(g.dead()).toBe(false); }
    expect(await g.grab()).toBeNull();
    expect(g.dead()).toBe(true);
  });
  it("no drawing surface → dead; no picture yet → just nothing this frame", async () => {
    phone = installFakePhone();
    phone.canvasContext.current = null;
    const g = cameraGrabber(video(), view);
    expect(await g.grab()).toBeNull();
    expect(g.dead()).toBe(true);
    phone.restore();
    phone = installFakePhone({ video: { w: 0, h: 0 } });
    const g2 = cameraGrabber(video(), view);
    expect(await g2.grab()).toBeNull();
    expect(g2.dead()).toBe(false);
  });
});
