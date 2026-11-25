// Live "Scan sticker QR" INSIDE THE WEB PAGE — for the Android app WITHOUT the built-in scanner
// (app builds that have no SellerFlowScanner plugin). Same screen and same rule as the phone app's own
// scanner (adapters/nativeQrScanner): a full-screen live camera, a square frame, the QR nearest the
// frame's centre is read by itself (src/lib/qrCentrePick.ts — two frames in a row, never a guess
// between two close ones). The seller's screen gets the QR text VERBATIM and runs today's parser.
//
// WHO GETS IT — only when ALL are true (webQrScanner / webScannerAvailable):
//   • the Android app (Capacitor.getPlatform() === "android");
//   • the app build has NO SellerFlowScanner plugin (a build that has it keeps the native scanner);
//   • the kill switch app_settings.web_qr_scanner_enabled is exactly 'true' (sql/218; set once per
//     sign-in by RedesignApp through setWebQrScannerOn — not read / failed read / anything else = off);
//   • the page can ask for a camera (navigator.mediaDevices.getUserMedia).
// Otherwise nothing here runs: a laptop, an iPhone, a browser = today's photo flow, unchanged.
//
// Camera refused / not there / any error → the scanner closes and the screen opens today's photo flow
// with one short line. Every camera track is stopped on EVERY way out: a read, Close, "Take a photo
// instead", the phone's Back, the app going to the background, the screen being left. Never throws.
import { useCallback, useEffect, useRef } from "react";
import { pickCentreQr, stepPick, type PickStreak, type QrFrame, type QrHit } from "../../lib/qrCentrePick";
import { cameraSupported, stopStream, triggerHaptic } from "./camera";
import { isCapacitorAndroid } from "./platform";
import { nativeScannerAvailable, type ScannerTexts } from "./nativeQrScanner";
import { readQrHitsFromPixels } from "./qrDecode";
import { track } from "../analytics";

// ── Who gets it ───────────────────────────────────────────────────────────────────────────────
let switchOn = false;
/** RedesignApp: the kill switch (featureSw.webQrScanner). Anything but true = off. */
export function setWebQrScannerOn(on: boolean): void { switchOn = on === true; }

// Everything except the switch: the Android app, no built-in scanner in this build, a camera to ask for.
function canWebScan(): boolean {
  try { return isCapacitorAndroid() && !nativeScannerAvailable(true) && cameraSupported(); } catch { return false; }
}
/** Asked at tap time by the screens: true → open the in-page scanner; false → today's photo flow. */
export function webQrScanner(): boolean { return switchOn && canWebScan(); }
/** For a render (Orders shows its Scan button with it): the switch value is passed in so it is seen at once. */
export function webScannerAvailable(switchOnNow: boolean): boolean { return switchOnNow === true && canWebScan(); }

// ── What the screen gets back ─────────────────────────────────────────────────────────────────
export type WebScanFallback = "denied" | "unavailable";
export type WebScanResult =
  | { kind: "read"; text: string }                  // the QR text, verbatim
  | { kind: "photo" }                               // "Take a photo instead" → the screen opens today's photo flow
  | { kind: "cancelled" }                           // Close / Back / app to the background / screen left
  | { kind: "fallback"; reason: WebScanFallback };  // the camera can't be used → today's photo flow + one line
/** The one short line a screen shows when the camera could not be used. */
export function webScanFallbackText(reason: WebScanFallback, texts: ScannerTexts): string {
  return reason === "denied" ? texts.camOff : texts.camBusy;
}

// ── Geometry (pure) ───────────────────────────────────────────────────────────────────────────
// The frame = the phone app's: 68 % of the screen's short side, at most 320 px, in the middle.
export const FRAME_SHARE = 0.68;
export const FRAME_MAX_PX = 320;
export function frameSidePx(viewW: number, viewH: number): number {
  return Math.min(Math.min(viewW, viewH) * FRAME_SHARE, FRAME_MAX_PX);
}
export interface ScanGeometry {
  sx: number; sy: number; sw: number; sh: number; // the part of the camera picture that is read
  cw: number; ch: number;                         // the size it is read at
  frame: QrFrame;                                 // the on-screen frame, in those read pixels
}
/** The camera picture fills the screen (cover), so the frame sits at the picture's centre. Read: the
 *  frame plus half a frame around it (a QR whose centre is inside the frame reaches out of it). */
export function scanGeometry(videoW: number, videoH: number, viewW: number, viewH: number, maxEdge: number): ScanGeometry | null {
  if (!(videoW > 0 && videoH > 0 && viewW > 0 && viewH > 0 && maxEdge > 0)) return null;
  const scale = Math.max(viewW / videoW, viewH / videoH);
  const side = frameSidePx(viewW, viewH) / scale; // the frame's side in camera pixels
  if (!(side > 0) || !Number.isFinite(side)) return null;
  const cx = videoW / 2, cy = videoH / 2;
  const x0 = Math.max(0, Math.floor(cx - side)), y0 = Math.max(0, Math.floor(cy - side));
  const x1 = Math.min(videoW, Math.ceil(cx + side)), y1 = Math.min(videoH, Math.ceil(cy + side));
  const sw = x1 - x0, sh = y1 - y0;
  if (sw <= 0 || sh <= 0) return null;
  const k = Math.min(1, maxEdge / Math.max(sw, sh));
  const cw = Math.max(1, Math.round(sw * k)), ch = Math.max(1, Math.round(sh * k));
  return { sx: x0, sy: y0, sw, sh, cw, ch, frame: { cx: (cx - x0) * (cw / sw), cy: (cy - y0) * (ch / sh), side: side * (cw / sw) } };
}

// ── The camera ────────────────────────────────────────────────────────────────────────────────
/** Back camera, about 1920×1080. `ideal`, never `exact`: a phone with one camera still opens. */
export function webScanConstraints(): MediaStreamConstraints {
  return { video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false };
}
type TorchCaps = { torch?: boolean; focusMode?: string[] };
type AdvancedSet = { torch?: boolean; focusMode?: string };
function capsOf(t: MediaStreamTrack | null): TorchCaps {
  try { return ((t as unknown as { getCapabilities?: () => TorchCaps })?.getCapabilities?.() ?? {}) as TorchCaps; } catch { return {}; }
}
function applyAdvanced(t: MediaStreamTrack | null, set: AdvancedSet): Promise<boolean> {
  try {
    const fn = t?.applyConstraints;
    if (typeof fn !== "function") return Promise.resolve(false);
    return Promise.resolve(fn.call(t, { advanced: [set] } as unknown as MediaTrackConstraints)).then(() => true, () => false);
  } catch { return Promise.resolve(false); }
}
/** Can this camera's light be switched? (asked on the running track) */
export function torchSupported(t: MediaStreamTrack | null): boolean { return capsOf(t).torch === true; }
const DENIED = new Set(["NotAllowedError", "PermissionDeniedError", "SecurityError"]);
function fallbackReason(e: unknown): WebScanFallback {
  const name = e && typeof e === "object" && "name" in e ? String((e as { name: unknown }).name) : "";
  return DENIED.has(name) ? "denied" : "unavailable";
}

// ── Reading one camera frame ──────────────────────────────────────────────────────────────────
type Detected = { rawValue?: string; boundingBox?: { x: number; y: number; width: number; height: number }; cornerPoints?: { x: number; y: number }[] };
type DetectorLike = { detect: (s: CanvasImageSource) => Promise<Detected[]> };
type DetectorCtor = { new (o?: { formats?: string[] }): DetectorLike; getSupportedFormats?: () => Promise<string[]> };
/** The phone's own reader's answer → text + centre (corner points when given, else the box). */
export function hitsFromDetected(codes: readonly Detected[] | null | undefined): QrHit[] {
  const out: QrHit[] = [];
  for (const c of codes || []) {
    const text = typeof c?.rawValue === "string" ? c.rawValue : "";
    if (!text) continue;
    const pts = Array.isArray(c.cornerPoints) ? c.cornerPoints.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)) : [];
    if (pts.length >= 3) { out.push({ text, cx: pts.reduce((s, p) => s + p.x, 0) / pts.length, cy: pts.reduce((s, p) => s + p.y, 0) / pts.length }); continue; }
    const b = c.boundingBox;
    if (b && Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.width) && Number.isFinite(b.height)) out.push({ text, cx: b.x + b.width / 2, cy: b.y + b.height / 2 });
  }
  return out;
}

export interface FrameGrabber {
  /** One frame: every QR in it + where the frame is. null = no picture yet / this frame could not be read. */
  grab: () => Promise<{ hits: QrHit[]; frame: QrFrame } | null>;
  /** true = no reader works on this phone (the scanner then gives way to the photo flow). */
  dead: () => boolean;
  reader: () => string;
  dispose: () => void;
}
const NATIVE_EDGE = 1280;      // the phone's own reader
const SOFT_EDGE = 960;         // the loaded reader (plain code): smaller keeps every frame quick
const NATIVE_FAIL_LIMIT = 3;   // the phone's reader failing 3 frames in a row → the loaded reader
const SOFT_FAIL_LIMIT = 3;     // the loaded reader not there 3 frames in a row → no reader
/** The real frame reader: the phone's own BarcodeDetector when it reads QR codes, else the reader the
 *  photo flow already uses (loaded only then). */
export function cameraGrabber(video: HTMLVideoElement, view: () => { w: number; h: number }): FrameGrabber {
  let mode: "native" | "loaded" | "dead" = "loaded";
  let detector: DetectorLike | null = null;
  let nativeFails = 0, softFails = 0;
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  const ready = (async () => {
    try {
      const BD = (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
      if (typeof BD !== "function") return;
      const formats = typeof BD.getSupportedFormats === "function" ? await BD.getSupportedFormats() : ["qr_code"];
      if (!Array.isArray(formats) || !formats.includes("qr_code")) return;
      detector = new BD({ formats: ["qr_code"] });
      mode = "native";
    } catch { /* the loaded reader */ }
  })();
  return {
    async grab() {
      await ready;
      if (mode === "dead") return null;
      const v = view();
      const g = scanGeometry(video.videoWidth, video.videoHeight, v.w, v.h, mode === "native" ? NATIVE_EDGE : SOFT_EDGE);
      if (!g) return null;
      try {
        if (!canvas) canvas = document.createElement("canvas");
        if (!ctx) ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) { mode = "dead"; return null; }
        if (canvas.width !== g.cw) canvas.width = g.cw;
        if (canvas.height !== g.ch) canvas.height = g.ch;
        ctx.drawImage(video, g.sx, g.sy, g.sw, g.sh, 0, 0, g.cw, g.ch);
      } catch { return null; }
      if (mode === "native" && detector) {
        try {
          const codes = await detector.detect(canvas);
          nativeFails = 0;
          return { hits: hitsFromDetected(codes), frame: g.frame };
        } catch {
          if (++nativeFails >= NATIVE_FAIL_LIMIT) mode = "loaded";
          return null;
        }
      }
      let hits: QrHit[] | null;
      try {
        const id = ctx.getImageData(0, 0, g.cw, g.ch);
        hits = await readQrHitsFromPixels({ width: id.width, height: id.height, data: id.data });
      } catch { hits = null; }
      if (hits === null) { if (++softFails >= SOFT_FAIL_LIMIT) mode = "dead"; return null; }
      softFails = 0;
      return { hits, frame: g.frame };
    },
    dead: () => mode === "dead",
    reader: () => mode,
    dispose() { try { if (canvas) { canvas.width = 0; canvas.height = 0; } } catch { /* ignore */ } canvas = null; ctx = null; detector = null; },
  };
}

// ── The beep (0.12 s, 2.6 kHz — the phone app's) ──────────────────────────────────────────────
type AudioCtor = new () => AudioContext;
export function playScanBeep(): void {
  try {
    const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
    const AC = w.AudioContext || w.webkitAudioContext;
    if (typeof AC !== "function") return;
    const ac = new AC();
    const close = () => { try { void Promise.resolve(ac.close()).catch(() => undefined); } catch { /* ignore */ } };
    try {
      try { void Promise.resolve(ac.resume()).catch(() => undefined); } catch { /* ignore */ }
      const osc = ac.createOscillator(), gain = ac.createGain();
      const t0 = ac.currentTime;
      osc.type = "sine";
      osc.frequency.value = 2600;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.5, t0 + 0.005);
      gain.gain.setValueAtTime(0.5, t0 + 0.115);
      gain.gain.linearRampToValueAtTime(0, t0 + 0.12);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.onended = close;
      osc.start(t0);
      osc.stop(t0 + 0.13);
      setTimeout(close, 600); // the sound card is always given back, also when "ended" never comes
    } catch { close(); }
  } catch { /* no sound on this phone */ }
}

// ── The screen ────────────────────────────────────────────────────────────────────────────────
const ICON_CLOSE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const BOLT = '<path d="M13.4 2 5 13.4h5.6L9.4 22 18.6 9.9h-5.9z" fill="currentColor"/>';
const ICON_LIGHT_ON = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">${BOLT}</svg>`;
const ICON_LIGHT_OFF = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">${BOLT}<path d="M4 3.5l16 17" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M5.3 2.2l16 17" stroke="#000" stroke-opacity=".45" stroke-width="1.4" stroke-linecap="round"/></svg>`;
const FRAME_CSS_SIDE = `min(${Math.round(FRAME_SHARE * 100)}vmin, ${FRAME_MAX_PX}px)`;
const ROUND_BTN = "position:absolute;width:46px;height:46px;border-radius:23px;border:none;padding:0;background:rgba(0,0,0,.45);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent;";
const TEXT_SHADOW = "text-shadow:0 1px 4px rgba(0,0,0,.9),0 0 2px rgba(0,0,0,.7);"; // readable over a white sticker too

interface ScannerUi {
  root: HTMLDivElement; video: HTMLVideoElement; close: HTMLButtonElement; light: HTMLButtonElement; photo: HTMLButtonElement;
  setHint: (text: string) => void; setLight: (shown: boolean, on: boolean) => void; showPanel: (text: string) => void;
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, testid: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.style.cssText = css;
  n.setAttribute("data-testid", testid);
  return n;
}
function buildUi(texts: ScannerTexts): ScannerUi {
  const font = (() => { // the app's own font (the screen is drawn outside the app's root)
    try { const app = document.querySelector("[data-redesign]"); const f = app ? getComputedStyle(app).fontFamily : ""; return f || "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"; } catch { return "system-ui, sans-serif"; }
  })();
  const root = el("div", `position:fixed;inset:0;z-index:2147483000;background:#000;color:#fff;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;font-family:${font};`, "wqs");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", texts.title);

  const video = el("video", "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000;", "wqs-video");
  video.muted = true;
  video.autoplay = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("muted", "");
  video.setAttribute("aria-hidden", "true");

  // The frame: a white rounded square; its huge shadow is the dark layer around it.
  const frame = el("div", `position:absolute;left:50%;top:50%;width:${FRAME_CSS_SIDE};height:${FRAME_CSS_SIDE};transform:translate(-50%,-50%);box-sizing:border-box;border:3px solid #fff;border-radius:22px;box-shadow:0 0 0 200vmax rgba(0,0,0,.55);pointer-events:none;`, "wqs-frame");

  const close = el("button", `${ROUND_BTN}left:calc(env(safe-area-inset-left, 0px) + 14px);top:calc(env(safe-area-inset-top, 0px) + 10px);`, "wqs-close");
  close.type = "button";
  close.setAttribute("aria-label", texts.close);
  close.innerHTML = ICON_CLOSE;

  const light = el("button", `${ROUND_BTN}right:calc(env(safe-area-inset-right, 0px) + 14px);top:calc(env(safe-area-inset-top, 0px) + 10px);display:none;`, "wqs-light");
  light.type = "button";

  const title = el("div", `position:absolute;left:24px;right:24px;top:calc(env(safe-area-inset-top, 0px) + 66px);text-align:center;font-size:19px;font-weight:700;line-height:1.25;pointer-events:none;${TEXT_SHADOW}`, "wqs-title");
  title.textContent = texts.title;

  const hint = el("div", `position:absolute;left:24px;right:24px;top:calc(50% + ${FRAME_CSS_SIDE} / 2 + 18px);text-align:center;font-size:15px;font-weight:600;line-height:1.3;pointer-events:none;${TEXT_SHADOW}`, "wqs-hint");
  hint.setAttribute("aria-live", "polite");
  hint.textContent = texts.hint;

  const panel = el("div", "position:absolute;left:28px;right:28px;top:50%;transform:translateY(-50%);text-align:center;font-size:17px;font-weight:700;line-height:1.4;display:none;", "wqs-panel");
  panel.setAttribute("role", "alert");

  const photo = el("button", "position:absolute;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom, 0px) + 18px);box-sizing:border-box;min-height:50px;max-width:calc(100% - 40px);padding:12px 18px;border-radius:14px;border:1px solid rgba(255,255,255,.55);background:rgba(255,255,255,.18);color:#fff;font:inherit;font-size:16px;font-weight:700;line-height:1.25;text-align:center;cursor:pointer;-webkit-tap-highlight-color:transparent;", "wqs-photo");
  photo.type = "button";
  photo.textContent = texts.photo;

  root.append(video, frame, title, hint, panel, close, light, photo);
  return {
    root, video, close, light, photo,
    setHint: (text) => { if (hint.textContent !== text) hint.textContent = text; },
    setLight: (shown, on) => {
      light.style.display = shown ? "flex" : "none";
      light.innerHTML = on ? ICON_LIGHT_ON : ICON_LIGHT_OFF;
      light.setAttribute("aria-label", on ? texts.lightOff : texts.lightOn);
      light.setAttribute("aria-pressed", on ? "true" : "false");
    },
    showPanel: (text) => { // the camera can't be used: no picture, no frame — the line and the two buttons
      panel.textContent = text;
      panel.style.display = "block";
      frame.style.display = "none";
      hint.style.display = "none";
      video.style.display = "none";
      light.style.display = "none";
    },
  };
}

// ── One scan ──────────────────────────────────────────────────────────────────────────────────
export interface WebScanDeps {
  grabber?: (video: HTMLVideoElement, view: () => { w: number; h: number }) => FrameGrabber; // tests
  frameMs?: number;   // the pause between two frames
  startMs?: number;   // no camera picture after this long → the camera isn't usable
}
export interface WebScanHandle { close: (silent?: boolean) => void }
const HISTORY_MARK = "sflWebQrScanner";
const FRAME_MS = 60;
const START_MS = 8000;
let active: WebScanHandle | null = null;

// May the photo picker be opened by the page right now? A picker only opens while the seller's tap
// still counts; after a long permission question it no longer does (the scanner then keeps its own
// "Take a photo instead" button on screen instead of closing). No such API on the phone = try.
function tapStillCounts(): boolean {
  try {
    const ua = (navigator as unknown as { userActivation?: { isActive?: boolean } }).userActivation;
    return ua && typeof ua.isActive === "boolean" ? ua.isActive : true;
  } catch { return true; }
}

/** Open the scanner. `onDone` is called ONCE, right inside the tap / camera answer that ended the scan
 *  (so the screen can open the photo picker from it). Never throws. */
export function openWebQrScanner(texts: ScannerTexts, onDone: (r: WebScanResult) => void, deps: WebScanDeps = {}): WebScanHandle {
  const t0 = Date.now();
  let finished = false;
  let stream: MediaStream | null = null;
  let camTrack: MediaStreamTrack | null = null;
  let grabber: FrameGrabber | null = null;
  let ui: ScannerUi | null = null;
  let streak: PickStreak | null = null;
  let torchOn = false, panel = false, gotFrame = false, pushed = false, popped = false;
  let frameTimer: ReturnType<typeof setTimeout> | undefined, torchTimer: ReturnType<typeof setTimeout> | undefined, startTimer: ReturnType<typeof setTimeout> | undefined;
  const opener = (() => { try { return document.activeElement as HTMLElement | null; } catch { return null; } })();

  const stopCamera = () => {
    clearTimeout(frameTimer); clearTimeout(torchTimer); clearTimeout(startTimer);
    frameTimer = torchTimer = startTimer = undefined;
    try { camTrack?.removeEventListener?.("ended", onTrackEnded); } catch { /* ignore */ }
    stopStream(stream);
    stream = null; camTrack = null; torchOn = false;
    try { if (ui) { ui.video.pause?.(); ui.video.srcObject = null; } } catch { /* ignore */ }
    try { grabber?.dispose(); } catch { /* ignore */ }
    grabber = null;
  };
  const finish = (r: WebScanResult, silent = false) => {
    if (finished) return;
    finished = true;
    stopCamera();
    try { window.removeEventListener("popstate", onPop); } catch { /* ignore */ }
    try { window.removeEventListener("pagehide", onHide); } catch { /* ignore */ }
    try { document.removeEventListener("visibilitychange", onVisibility); } catch { /* ignore */ }
    try { document.removeEventListener("keydown", onKey); } catch { /* ignore */ }
    try { ui?.root.remove(); } catch { /* ignore */ }
    // Closed any way but the phone's Back: take our history entry off again.
    if (pushed && !popped) {
      try { if ((window.history.state as Record<string, unknown> | null)?.[HISTORY_MARK]) window.history.back(); } catch { /* ignore */ }
    }
    try { if (opener && opener.isConnected) opener.focus({ preventScroll: true }); } catch { /* ignore */ }
    if (active === handle) active = null;
    try { track("qr_web", { result: r.kind, reason: r.kind === "fallback" ? r.reason : null, reader: readerName, ms: Date.now() - t0 }); } catch { /* analytics never breaks a scan */ }
    if (!silent) { try { onDone(r); } catch { /* the screen's own error never reaches the camera code */ } }
  };
  let readerName = "none";
  const handle: WebScanHandle = { close: (silent) => finish({ kind: "cancelled" }, silent === true) };

  // The camera can't be used. Photo picker allowed right now → close and hand over; else keep the
  // screen with the line and "Take a photo instead" (one tap opens the picker).
  const fail = (e: unknown) => {
    if (finished || panel) return;
    const reason = fallbackReason(e);
    if (tapStillCounts() || !ui) { finish({ kind: "fallback", reason }); return; }
    panel = true;
    stopCamera();
    ui.showPanel(webScanFallbackText(reason, texts));
  };
  function onTrackEnded() { fail(null); }
  function onPop(e: PopStateEvent) {
    // A pop that lands ON a scanner entry is an earlier scanner's own clean-up arriving late — not the
    // seller's Back. (Back from our entry lands on what was there before, which has no mark.)
    try { if ((e?.state as Record<string, unknown> | null)?.[HISTORY_MARK]) return; } catch { /* treat as Back */ }
    popped = true;
    finish({ kind: "cancelled" });
  }
  function onHide() { finish({ kind: "cancelled" }); }
  function onVisibility() {
    // In the background no camera stays on. While the phone is still asking for the camera permission
    // nothing is running yet — that case is settled when the camera answers (see start()).
    try { if (document.hidden && (stream || panel)) finish({ kind: "cancelled" }); } catch { /* ignore */ }
  }
  function onKey(e: KeyboardEvent) { if (e.key === "Escape" || e.key === "Esc") { e.preventDefault(); finish({ kind: "cancelled" }); } }

  const refreshLight = () => { try { if (ui && !finished && !panel) ui.setLight(torchSupported(camTrack), torchOn); } catch { /* ignore */ } };
  const toggleLight = () => {
    if (finished || !camTrack) return;
    const want = !torchOn;
    void applyAdvanced(camTrack, { torch: want }).then((ok) => {
      if (finished) return;
      if (ok) torchOn = want;
      try { ui?.setLight(ok || torchSupported(camTrack), torchOn); } catch { /* ignore */ }
    });
  };

  const tick = async () => {
    frameTimer = undefined;
    if (finished || panel || !grabber) return;
    let got: Awaited<ReturnType<FrameGrabber["grab"]>>;
    try { got = await grabber.grab(); } catch { got = null; }
    if (finished || panel || !grabber) return;
    readerName = grabber.reader();
    if (grabber.dead()) { fail(null); return; }
    if (got) {
      gotFrame = true;
      const step = stepPick(streak, pickCentreQr(got.hits, got.frame));
      streak = step.streak;
      try { ui?.setHint(step.tie ? texts.one : texts.hint); } catch { /* ignore */ }
      if (step.read !== null) {
        triggerHaptic(60);
        playScanBeep();
        finish({ kind: "read", text: step.read });
        return;
      }
    }
    frameTimer = setTimeout(() => { void tick(); }, deps.frameMs ?? FRAME_MS);
  };

  const start = (s: MediaStream) => {
    if (finished || panel) { stopStream(s); return; }
    if ((() => { try { return document.hidden; } catch { return false; } })()) { stopStream(s); finish({ kind: "cancelled" }); return; }
    stream = s;
    try { camTrack = s.getVideoTracks?.()[0] ?? null; } catch { camTrack = null; }
    try { camTrack?.addEventListener?.("ended", onTrackEnded); } catch { /* ignore */ }
    try {
      ui!.video.srcObject = s;
      const playing = ui!.video.play?.();
      if (playing && typeof (playing as Promise<void>).catch === "function") (playing as Promise<void>).catch(() => undefined);
    } catch { /* the reader below notices a picture that never comes */ }
    if (capsOf(camTrack).focusMode?.includes("continuous")) void applyAdvanced(camTrack, { focusMode: "continuous" });
    refreshLight();
    torchTimer = setTimeout(refreshLight, 700); // some phones only say "this camera has a light" a moment later
    const view = () => {
      const r = ui?.root;
      return { w: (r && r.clientWidth) || window.innerWidth || 0, h: (r && r.clientHeight) || window.innerHeight || 0 };
    };
    try { grabber = (deps.grabber ?? cameraGrabber)(ui!.video, view); } catch { fail(null); return; }
    startTimer = setTimeout(() => { if (!gotFrame) fail(null); }, deps.startMs ?? START_MS);
    void tick();
  };

  try {
    if (active) active.close(); // one scanner at a time
    active = handle;
    ui = buildUi(texts);
    ui.close.addEventListener("click", () => finish({ kind: "cancelled" }));
    ui.photo.addEventListener("click", () => finish({ kind: "photo" }));
    ui.light.addEventListener("click", toggleLight);
    document.body.appendChild(ui.root);
    try { window.history.pushState({ [HISTORY_MARK]: true }, ""); pushed = true; } catch { /* no history (rare) */ }
    window.addEventListener("popstate", onPop);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("keydown", onKey);
    try { ui.close.focus({ preventScroll: true }); } catch { /* ignore */ }
    const md = (navigator as unknown as { mediaDevices?: { getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream> } }).mediaDevices;
    if (!md || typeof md.getUserMedia !== "function") { fail(null); return handle; }
    Promise.resolve(md.getUserMedia(webScanConstraints())).then(start, fail);
  } catch {
    finish({ kind: "fallback", reason: "unavailable" }); // the screen could not even be drawn
  }
  return handle;
}

/** For a screen: `scan(texts, onDone)` opens the scanner; leaving the screen closes it (camera off). */
export function useWebQrScan(): (texts: ScannerTexts, onDone: (r: WebScanResult) => void) => void {
  const open = useRef<WebScanHandle | null>(null);
  useEffect(() => () => { open.current?.close(true); open.current = null; }, []);
  return useCallback((texts, onDone) => {
    open.current?.close(true);
    let done = false; // the scan can end before openWebQrScanner even returns (no camera API)
    const h = openWebQrScanner(texts, (r) => { done = true; open.current = null; onDone(r); });
    open.current = done ? null : h;
  }, []);
}
