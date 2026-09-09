// In-app camera helpers for Parcel Scan (web getUserMedia inside the WebView).
// WEB-ONLY — no Capacitor plugin, no includePlugins touch. The app is a thin
// shell loaded from https://www.sellerflowlive.com (a secure context), so
// navigator.mediaDevices.getUserMedia is available on both shells:
//   • Android WebView (Chromium 84+) — Capacitor's WebChromeClient grants the
//     runtime CAMERA permission on onPermissionRequest.
//   • iOS WKWebView (16.4+) — the bridge's WKUIDelegate grants capture; needs
//     NSCameraUsageDescription in Info.plist.
// If unavailable (old engine, permission denied, no camera) the caller falls
// back to the original <input type=file> picker — nothing here throws on its
// own; the imperative stream lifecycle lives in the screen.
//
// Only the pure, side-effect-light helpers live here (unit-tested). The canvas
// capture + MediaStream attach/detach stay in the component (DOM-bound).

interface MediaDevicesLike { getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream> }
type NavWithMedia = Navigator & { mediaDevices?: MediaDevicesLike; vibrate?: (pattern: number | number[]) => boolean };

// Feature detect. False in jsdom / old WKWebView / http (non-secure) origins →
// the caller shows the file-picker fallback instead of the camera.
export function cameraSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  const md = (navigator as NavWithMedia).mediaDevices;
  return !!md && typeof md.getUserMedia === "function";
}

// Rear camera preferred (slips are laid flat and shot from above). `ideal` (not
// `exact`) so a front-only device still opens instead of throwing
// OverconstrainedError. High ideal resolution for legible handwriting; the scan
// adapter's fileToScanBase64 downscales to SCAN_MAX_EDGE afterwards.
export function captureConstraints(): MediaStreamConstraints {
  return {
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 2560 },
      height: { ideal: 1440 },
    },
    audio: false,
  };
}

// Optional shutter haptic — guarded (desktop / unsupported → silent no-op,
// never throws). navigator.vibrate is a no-op on iOS anyway.
export function triggerHaptic(ms = 25): void {
  try {
    const v = (navigator as NavWithMedia).vibrate;
    if (typeof v === "function") v.call(navigator, ms);
  } catch { /* ignore */ }
}

// Stop every track so the camera light goes off and the device is released
// (on preview, on save-return, on unmount, on tab switch). Idempotent.
export function stopStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  try { for (const track of stream.getTracks()) track.stop(); } catch { /* ignore */ }
}

// Normalize a getUserMedia rejection to a short stable code for the fallback
// message (never surfaced raw to the user).
export function getUserMediaErrorName(e: unknown): string {
  if (e && typeof e === "object" && "name" in e && typeof (e as { name: unknown }).name === "string") {
    return (e as { name: string }).name;
  }
  return "camera_error";
}
