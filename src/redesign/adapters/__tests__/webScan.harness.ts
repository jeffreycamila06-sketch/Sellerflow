// A fake phone for the in-page QR scanner tests: the Android app shell, a camera (getUserMedia + a
// video picture), the phone's own QR reader (BarcodeDetector), sound and vibration. Nothing here is
// shipped. `restore()` puts everything back.
import { vi, type Mock } from "vitest";

type W = { Capacitor?: unknown };
export const installApp = (platform: string | null, plugins: Record<string, unknown> = {}) => {
  (window as unknown as W).Capacitor = platform === null ? { Plugins: plugins } : { getPlatform: () => platform, Plugins: plugins };
};
export const removeApp = () => { delete (window as unknown as W).Capacitor; };

export interface FakeTrack {
  kind: "video";
  stop: Mock;
  applyConstraints: Mock;
  getCapabilities: () => Record<string, unknown>;
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: (type: string, fn: () => void) => void;
  fire: (type: string) => void;
}
export function fakeTrack(caps: Record<string, unknown> = {}): FakeTrack {
  const listeners = new Map<string, Set<() => void>>();
  return {
    kind: "video",
    stop: vi.fn(),
    applyConstraints: vi.fn(async () => undefined),
    getCapabilities: () => caps,
    addEventListener: (type, fn) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(fn); },
    removeEventListener: (type, fn) => { listeners.get(type)?.delete(fn); },
    fire: (type) => { for (const fn of [...(listeners.get(type) ?? [])]) fn(); },
  };
}
export const fakeStream = (tracks: FakeTrack[]): MediaStream =>
  ({ getTracks: () => tracks, getVideoTracks: () => tracks } as unknown as MediaStream);

/** One QR the fake reader "sees": its text and where its centre is, counted from the frame's centre
 *  in read pixels (0,0 = dead centre). */
export interface SeenQr { text: string; dx?: number; dy?: number }

export interface FakePhone {
  tracks: FakeTrack[];                 // every camera track ever handed out
  getUserMedia: Mock;
  seen: { current: SeenQr[] };         // what the phone's reader answers for each frame
  detect: Mock;
  vibrate: Mock;
  beeps: { hz: number; start: number; stop: number }[];
  closedAudio: { count: number };
  canvasContext: { current: unknown }; // null → the phone has no drawing surface
  picture: { current: { w: number; h: number } }; // the camera picture's size; 0 × 0 = the camera gives no picture (yet)
  restore: () => void;
}
export interface FakePhoneOptions {
  camera?: "ok" | { reject: string } | "pending";  // what getUserMedia does (default ok)
  caps?: Record<string, unknown>;                  // the camera track's capabilities (torch …)
  detector?: "qr" | "no_qr_format" | "none" | "throws" | "never_answers"; // the phone's own reader (default qr); never_answers = it never says which codes it reads
  video?: { w: number; h: number };
}

export function installFakePhone(o: FakePhoneOptions = {}): FakePhone & { resolveCamera: () => void; rejectCamera: (name: string) => void } {
  const tracks: FakeTrack[] = [];
  const seen = { current: [] as SeenQr[] };
  const canvasContext = { current: undefined as unknown };
  const pending: { res: (s: MediaStream) => void; rej: (e: unknown) => void }[] = [];
  const newStream = () => { const t = fakeTrack(o.caps ?? {}); tracks.push(t); return fakeStream([t]); };
  const err = (name: string) => Object.assign(new Error(name), { name });
  const getUserMedia = vi.fn((_c: MediaStreamConstraints) => {
    if (o.camera === "pending") return new Promise<MediaStream>((res, rej) => pending.push({ res, rej }));
    if (o.camera && typeof o.camera === "object") return Promise.reject(err(o.camera.reject));
    return Promise.resolve(newStream());
  });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });

  const vibrate = vi.fn(() => true);
  Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });

  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => undefined);
  const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const vw = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, "videoWidth");
  const vh = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, "videoHeight");
  const picture = { current: o.video ?? { w: 1080, h: 1920 } };
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, get: () => picture.current.w });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, get: () => picture.current.h });

  const ctx = {
    drawImage: vi.fn(),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(4) }),
  };
  canvasContext.current = ctx;
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => canvasContext.current) as never);

  const detect = vi.fn(async (canvas: HTMLCanvasElement) => {
    if (o.detector === "throws") throw new Error("reader not available");
    const cx = canvas.width / 2, cy = canvas.height / 2;
    return seen.current.map((q) => ({ rawValue: q.text, boundingBox: { x: cx + (q.dx ?? 0) - 10, y: cy + (q.dy ?? 0) - 10, width: 20, height: 20 } }));
  });
  const g = globalThis as { BarcodeDetector?: unknown };
  const hadDetector = "BarcodeDetector" in g, oldDetector = g.BarcodeDetector;
  if (o.detector === "none") delete g.BarcodeDetector;
  else {
    g.BarcodeDetector = class {
      static getSupportedFormats = (): Promise<string[]> => (o.detector === "never_answers" ? new Promise<string[]>(() => undefined) : Promise.resolve(o.detector === "no_qr_format" ? ["ean_13"] : ["qr_code", "ean_13"]));
      detect(c: HTMLCanvasElement) { return detect(c); }
    };
  }

  const beeps: FakePhone["beeps"] = [];
  const closedAudio = { count: 0 };
  const w = window as unknown as { AudioContext?: unknown };
  const hadAudio = "AudioContext" in w, oldAudio = w.AudioContext;
  w.AudioContext = class {
    currentTime = 0;
    destination = {};
    resume() { return Promise.resolve(); }
    close() { closedAudio.count++; return Promise.resolve(); }
    createGain() { return { gain: { setValueAtTime() { /* fake */ }, linearRampToValueAtTime() { /* fake */ } }, connect() { /* fake */ } }; }
    createOscillator() {
      const beep = { hz: 0, start: -1, stop: -1 };
      beeps.push(beep);
      return {
        type: "sine", onended: null as null | (() => void),
        frequency: { set value(v: number) { beep.hz = v; } },
        connect() { /* fake */ },
        start(t: number) { beep.start = t; },
        stop(t: number) { beep.stop = t; },
      };
    }
  };

  return {
    tracks, getUserMedia, seen, detect, vibrate, beeps, closedAudio, canvasContext, picture,
    resolveCamera: () => { const p = pending.shift(); p?.res(newStream()); },
    rejectCamera: (name: string) => { const p = pending.shift(); p?.rej(err(name)); },
    restore: () => {
      delete (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
      delete (navigator as unknown as { vibrate?: unknown }).vibrate;
      play.mockRestore(); pause.mockRestore(); getContext.mockRestore();
      if (vw) Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", vw);
      if (vh) Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", vh);
      if (hadDetector) g.BarcodeDetector = oldDetector; else delete g.BarcodeDetector;
      if (hadAudio) w.AudioContext = oldAudio; else delete w.AudioContext;
      document.querySelectorAll('[data-testid="wqs"]').forEach((n) => n.remove());
    },
  };
}

/** Is the seller's tap still counted by the browser? (undefined = the phone has no such API) */
export function setTapCounts(active: boolean | undefined): void {
  if (active === undefined) { delete (navigator as unknown as { userActivation?: unknown }).userActivation; return; }
  Object.defineProperty(navigator, "userActivation", { configurable: true, value: { isActive: active } });
}

export const scannerOnScreen = (): HTMLElement | null => document.querySelector('[data-testid="wqs"]');
export const part = (id: string): HTMLElement => {
  const n = document.querySelector(`[data-testid="${id}"]`);
  if (!n) throw new Error(`no ${id} on the page`);
  return n as HTMLElement;
};
/** Wait (real time) until `ok()` is true. */
export async function until(ok: () => boolean, ms = 1500): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("waited too long");
    await new Promise((r) => setTimeout(r, 2));
  }
}
export const settle = async (ms = 25): Promise<void> => { await new Promise((r) => setTimeout(r, ms)); };
