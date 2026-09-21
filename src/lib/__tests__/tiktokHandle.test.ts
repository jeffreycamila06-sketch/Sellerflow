// The sticker QR's handle <-> TikTok-URL round-trip. Encoder builds the URL; the SFL
// scanner extracts the handle back from BOTH the new URL stickers and old bare-handle
// stickers, and rejects arbitrary QRs. Also pins that a typical URL stays at QR v3 with M.
import { describe, it, expect } from "vitest";
import { stripHandle, tiktokProfileUrl, handleFromQrPayload } from "../tiktokHandle";
import { qrMatrix } from "../qr";

describe("stripHandle", () => {
  it("strips a single leading @ + surrounding whitespace, otherwise verbatim", () => {
    expect(stripHandle("  @annc ")).toBe("annc");
    expect(stripHandle("buyer.99_x")).toBe("buyer.99_x");
    expect(stripHandle("@@weird")).toBe("@weird"); // only ONE @ stripped
    expect(stripHandle("")).toBe("");
  });
});

describe("tiktokProfileUrl (encoder)", () => {
  it("builds the shortest no-www profile URL", () => {
    expect(tiktokProfileUrl("annc")).toBe("https://tiktok.com/@annc");
    expect(tiktokProfileUrl("@Zona.nyaman1933")).toBe("https://tiktok.com/@Zona.nyaman1933");
  });
  it("blank / whitespace → null (no QR)", () => {
    expect(tiktokProfileUrl("")).toBeNull();
    expect(tiktokProfileUrl("   ")).toBeNull();
    expect(tiktokProfileUrl("@")).toBeNull();
  });
});

describe("handleFromQrPayload (scanner — accepts both shapes)", () => {
  it("extracts the handle from every TikTok profile URL form", () => {
    for (const u of [
      "https://tiktok.com/@annc",
      "http://tiktok.com/@annc",
      "tiktok.com/@annc",
      "https://www.tiktok.com/@annc",
      "www.tiktok.com/@annc",
      "https://m.tiktok.com/@annc",
      "https://tiktok.com/@annc?lang=en",
      "https://tiktok.com/@annc/",
      "HTTPS://TikTok.com/@annc",
    ]) expect(handleFromQrPayload(u)).toBe("annc");
  });
  it("keeps handle chars (dot/underscore/digits) verbatim from a URL", () => {
    expect(handleFromQrPayload("https://tiktok.com/@Zona.nyaman1933")).toBe("Zona.nyaman1933");
  });
  it("accepts a bare username (old stickers), stripping one @", () => {
    expect(handleFromQrPayload("annc")).toBe("annc");
    expect(handleFromQrPayload("@buyer.99")).toBe("buyer.99");
  });
  it("rejects non-TikTok URLs and arbitrary QRs (no fill from a random QR)", () => {
    for (const bad of [
      "https://youtube.com/@annc",     // wrong site
      "https://tiktok.company.com/@x", // look-alike domain
      "WIFI:S:home;T:WPA;P:secret;;",  // wifi config
      "mailto:someone@example.com",
      "hello world this is text",      // has spaces
      "Ashley102031(IG)",              // platform tag → not a clean handle
      "",
    ]) expect(handleFromQrPayload(bad)).toBeNull();
  });
});

describe("QR size — ECC M keeps a typical URL at v3 (29 modules)", () => {
  it("≤17-char handle URL → QR version 3", () => {
    // 17-char handle → https://tiktok.com/@<17> = 37 bytes; ECC M v3 holds 53.
    const url = tiktokProfileUrl("seventeen_chars_x")!; // 17 chars
    expect(url.length).toBe(37);
    const m = qrMatrix(url, "M");
    expect(m).not.toBeNull();
    expect(m!.length).toBe(29); // v3 = 29×29
  });
  it("ECC Q would push the same URL to v4 (why we use M)", () => {
    const url = tiktokProfileUrl("seventeen_chars_x")!;
    expect(qrMatrix(url, "Q")!.length).toBe(33); // v4 = 33×33
  });
});
