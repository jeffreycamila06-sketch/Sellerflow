// Native "Scan sticker QR" (phone app builds with the SellerFlowScanner plugin — iOS build 15+,
// Android versionCode 11+). A full-screen live camera reads the sticker QR by itself; the seller's
// screen then gets the QR text VERBATIM and runs today's parser on it (Parcel Scan, FamilyMart,
// Blacklist, Orders). "Take a photo instead" in the scanner opens the phone's own Take Photo /
// Photo Library choice natively and hands the picture back; the web reads it with the SAME
// readQrFromFile as today's photo flow (same "2 stickers" / "No QR found" messages).
//
// Off = today's photo flow, byte for byte: a laptop, an older app build (no plugin), or the kill
// switch app_settings.native_qr_scanner_enabled not exactly 'true' (sql/208). The switch is set
// once per sign-in by RedesignApp (setNativeQrScannerOn) — the screens only ask nativeQrScanner()
// at tap time, so nothing about a screen changes while it is off.
//
// The native side picks the QR nearest the frame's centre (src/lib/qrCentrePick.ts, mirrored in
// Swift and Java) and never guesses between two close ones. Never throws.
import { readQrFromFile, type QrOutcome } from "./qrDecode";
import { track } from "../analytics";

/** The texts the native scanner shows, in the seller's app language (passed on every call). */
export interface ScannerTexts {
  title: string; hint: string; one: string; photo: string; close: string; lightOn: string; lightOff: string;
  camOff: string; openSettings: string; fullScreen: string; camBusy: string; takePhoto: string; library: string; cancel: string;
}
export const SCANNER_TEXT_KEYS: Record<keyof ScannerTexts, string> = {
  title: "rd_qrs_title", hint: "rd_qrs_hint", one: "rd_qrs_one", photo: "rd_qrs_photo", close: "rd_qrs_close",
  lightOn: "rd_qrs_light_on", lightOff: "rd_qrs_light_off", camOff: "rd_qrs_cam_off", openSettings: "rd_qrs_open_settings",
  fullScreen: "rd_qrs_full_screen", camBusy: "rd_qrs_cam_busy", takePhoto: "rd_qrs_take", library: "rd_qrs_library", cancel: "rd_qrs_cancel",
};
export function scannerTexts(t: Record<string, string>): ScannerTexts {
  const out = {} as ScannerTexts;
  for (const [k, key] of Object.entries(SCANNER_TEXT_KEYS) as [keyof ScannerTexts, string][]) out[k] = String(t?.[key] ?? "");
  return out;
}

type ScanFn = (o: { texts: ScannerTexts }) => Promise<unknown>;

let switchOn = false;
/** RedesignApp: the kill switch (featureSw.nativeQrScanner). Anything but true = off. */
export function setNativeQrScannerOn(on: boolean): void { switchOn = on === true; }

// The app build's scanner plugin, whatever the switch says. null on a laptop / an older app build.
function pluginScan(): ScanFn | null {
  if (typeof window === "undefined") return null;
  try {
    const p = (window as unknown as { Capacitor?: { Plugins?: { SellerFlowScanner?: { scanStickerQr?: unknown } } } }).Capacitor?.Plugins?.SellerFlowScanner;
    const fn = p?.scanStickerQr;
    return typeof fn === "function" ? (o) => (fn as ScanFn).call(p, o) : null;
  } catch {
    return null;
  }
}

/** The native scanner, or null → use today's photo flow (laptop, older app build, switch off). */
export function nativeQrScanner(): ScanFn | null {
  return switchOn ? pluginScan() : null;
}

/** For a screen that shows a Scan button ONLY with the live scanner (Orders): the app build has the
 *  scanner AND the switch (featureSw.nativeQrScanner, passed in so a render sees it at once) is on. */
export function nativeScannerAvailable(switchOnNow: boolean): boolean {
  return switchOnNow === true && pluginScan() !== null;
}

export type StickerScanOutcome = QrOutcome | { kind: "cancelled" } | { kind: "failed" };

const MAX_PHOTO_BYTES = 30 * 1024 * 1024;

/** base64 picture from the native photo choice → a File for readQrFromFile. null = unusable. */
export function photoFile(data: unknown, mime: unknown): File | null {
  if (typeof data !== "string" || !data) return null;
  try {
    const b64 = data.includes(",") && data.startsWith("data:") ? data.slice(data.indexOf(",") + 1) : data;
    if (b64.length > (MAX_PHOTO_BYTES * 4) / 3 + 4) return null;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const type = typeof mime === "string" && /^image\/[a-z0-9.+-]+$/i.test(mime) ? mime.toLowerCase() : "image/jpeg";
    return new File([bytes], type === "image/png" ? "sticker.png" : "sticker.jpg", { type });
  } catch {
    return null;
  }
}

/** Open the native scanner and turn its answer into the outcome the screens already handle. */
export async function runStickerScan(scan: ScanFn, texts: ScannerTexts): Promise<StickerScanOutcome> {
  const t0 = Date.now();
  const done = (result: string, out: StickerScanOutcome): StickerScanOutcome => {
    try { track("qr_native", { result, ms: Date.now() - t0 }); } catch { /* analytics never breaks a scan */ }
    return out;
  };
  let answer: unknown;
  try {
    answer = await scan({ texts });
  } catch {
    return done("failed", { kind: "failed" });
  }
  const a = (answer && typeof answer === "object" ? answer : {}) as Record<string, unknown>;
  if (a.status === "read") {
    return typeof a.text === "string" && a.text !== "" ? done("read", { kind: "one", text: a.text }) : done("failed", { kind: "failed" });
  }
  // A picture that can't be opened (iPhone: an iCloud-only photo while offline; Android: an unreadable
  // file) = today's photo flow on an unreadable picture: "No QR found".
  const unreadable = (): StickerScanOutcome => done("photo_unreadable", { kind: "none", reason: "image_unreadable" });
  if (a.status === "error" && a.code === "photo_unreadable") return unreadable();
  if (a.status === "photo") {
    const file = photoFile(a.data, a.mime);
    if (!file) return unreadable();
    try {
      const read = await readQrFromFile(file);
      return done(`photo_${read.kind}`, read);
    } catch {
      return done("photo_none", { kind: "none", reason: "image_unreadable" });
    }
  }
  if (a.status === "cancelled" || a.status === "busy") return done(String(a.status), { kind: "cancelled" });
  return done("failed", { kind: "failed" });
}
