// QR decode for Parcel Scan — read the buyer's @username off the printed SFL sticker
// (the handle lives on the label, not the free-tier DB). CLIENT-SIDE ONLY, no Capacitor
// plugin (thin-shell lock intact): BarcodeDetector where available (Android/Chrome/
// Android WebView), pure-JS jsQR fallback for iOS WKWebView/Safari. Works on a laptop
// too (upload the label photo). Large photos are downscaled to ~1000 px before decode
// (jsQR on a full-res frame is slow). The decoded string is used VERBATIM.
const MAX_EDGE = 1000;

// Downscale target: never upscale; cap the long edge at maxEdge.
export function fitDims(w: number, h: number, maxEdge = MAX_EDGE): { w: number; h: number } {
  const long = Math.max(w, h);
  if (long <= maxEdge || long === 0) return { w, h };
  const s = maxEdge / long;
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

// Decode from raw RGBA pixels via jsQR (dynamic import → out of the main bundle; only
// loads when a seller actually scans). Returns the decoded string or null.
export async function decodePixels(data: Uint8ClampedArray, width: number, height: number): Promise<string | null> {
  if (!width || !height) return null;
  try {
    const jsQR = (await import("jsqr")).default;
    const res = jsQR(data, width, height);
    return res && typeof res.data === "string" && res.data ? res.data : null;
  } catch { return null; }
}

// Try the native BarcodeDetector on a canvas first (fast, Android/Chrome); fall back to
// jsQR on the canvas pixels (iOS/anything without BarcodeDetector).
async function decodeCanvas(canvas: HTMLCanvasElement): Promise<string | null> {
  const BD = (globalThis as unknown as { BarcodeDetector?: new (o?: { formats?: string[] }) => { detect: (s: CanvasImageSource) => Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector;
  if (BD) {
    try {
      const codes = await new BD({ formats: ["qr_code"] }).detect(canvas);
      const v = codes && codes[0] && codes[0].rawValue;
      if (v) return v;
    } catch { /* fall through to jsQR */ }
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return decodePixels(img.data, img.width, img.height);
}

function drawDownscaled(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement | null {
  const { w: dw, h: dh } = fitDims(w, h);
  const canvas = document.createElement("canvas");
  canvas.width = dw; canvas.height = dh;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, dw, dh);
  return canvas;
}

// Decode a QR from an uploaded/captured photo File (laptop upload or the mobile camera).
export async function decodeQrFromFile(file: File): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(file);
    const canvas = drawDownscaled(bmp, bmp.width, bmp.height);
    try { bmp.close?.(); } catch { /* ignore */ }
    return canvas ? decodeCanvas(canvas) : null;
  } catch { return null; }
}

// Decode a QR from the live <video> preview (a frame grab — no file round-trip).
export async function decodeQrFromVideo(video: HTMLVideoElement): Promise<string | null> {
  if (!video.videoWidth || !video.videoHeight) return null;
  const canvas = drawDownscaled(video, video.videoWidth, video.videoHeight);
  return canvas ? decodeCanvas(canvas) : null;
}
