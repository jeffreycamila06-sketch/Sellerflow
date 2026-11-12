// server/fmCaptchaImage.js — the FamilyMart (全家) captcha picture made readable for OCR.
// The two GIFs below were written by a real GIF encoder (Pillow) from a picture drawn to look like
// the captcha (light tilted digits "043180" on grey with dots) — they are NOT real captchas.
// The grey values are compared, pixel for pixel (sha-256), with what Pillow read back.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  decodeGif, otsu, inkMask, maskToBmp, captchaToBmp, imageSettingsFrom, FM_CAPTCHA_IMAGE,
  FM_CAPTCHA_MAX_BYTES, FM_CAPTCHA_MAX_WIDTH, FM_CAPTCHA_MAX_HEIGHT,
} from "../../../../server/fmCaptchaImage.js";

const GIF = {
  plain: { b64: "R0lGODdhggAoAIIAAOvr676+vqqqqoCAgFpaWkZGRgAAAAAAACwAAAAAggAoAAAI/wAJDBg4QCDBgwgTDiiQkIAAhQcDEJTIEKFBhBIhatzIUWPFjhwzLgQ5UKBIhScPXrRIEiTFhB9bDnyocKVMjjRJ2rRJMGbOmwgFxARaE+JQjARt5jSYkmjHAEclNh0wVWVMgUc5fsx4sWpIpwUrGuQp8yLZm2SzBj34E+1Ar0TVeix5sy1JuWwh2j37lmRGuxXhgi0KlC/YhzTtDl6McuRgwyDlMlTMOCHllZiTAqVcWapEyAkBDODM+aBc0QAACE7o9WFT0WBBR+SYujZsui8J2r69cXfqmRptt/TN2zLD37xprl6rmzht38+J/0YoHaT02qGvVx5wHTvDlM5pN/8XTj189OrZzU+UXR77QPJr1ZOEP373UZu767eHnd/ofOE02XaWehLRZFBb/TX3nnu90eegd9wlqJFhEkY4XXsCwEeAQKDRt99ABXD2oHsVSvgXTgvWJkBGBXhoIVW2ZZTSR9NVaBp9G4LY3lsSepgge/XBJpaL5LmYHnQNXhhcd7Bl6KONSOVFQIkapljQlAwq5CR6Syp5pHZBfklXSBdRmaWVKRaHUEVQjvZhl/LNZKaawz15JnweegXlSlUGyRuRMR6E4012pibQQyMaeWRH8A1FXkb0SWSjooyeaWFxJHan4JsqLWrZpZy66VtOlGqVn6TkkcqkbQF6meBplqb/+ad7iWGZZamVXribXavuhx2SfQUrK4MBIGmjrUpG6tFUmiq0a5phgbgqbHpy6WebvXZEobWEQetsdTaJ1CuLlwILnKDymQUUhBMp5KiX39aGV7mUGmQunPBOuNlhbD0UmLAs2ZvvbJU1SdWaB39a2Hb7QrTaVPMyZxrBCOtoMUpnnXVSAE19BJhjRJUG1HJj5tVRxO4uxhfJDJfcU0MgA6xXy3SF69/JUbZLUGLbATnXgSyVNO/KMTPGMsMoSyyTyIN95HNLsqXVWMI0V72sSwpbrZnW53Y9MdZch+2USElrGRlHkOVEMntMsyVX29v9K7ZMUZkMEtMOLWcYXEcnBSVVRwEBADs=", sha: "b6df6b46b6d2d7fddd7d150e34f2957b981f383bdbdaac4e203c1b2bf3b01f19" },
  interlaced: { b64: "R0lGODdhggAoAIIAAOvr676+vqqqqoCAgFpaWkZGRgAAAAAAACwAAAAAggAoAEAI/wAHBBggYIDBAQUOHhyo0CBDgg0bEohIsaLFiwMIEHiIUeHDhBULdhxJsmRGkgkHThwp0iTIhi8rrvTo0mBCADhxNswJwKZCngaBdhQ6EijIl0ILElUogGdPhwOWmowq1ClGp0QFJGz5kyiBAlhzXl0qlapYszp9TpU5c61FrlDdRoQbt2RMuQbb4sV4d69dg3RJcqQYeGjYsxfD7jyMuGJap18V3mT8lnFawV0bo30a9HLntIMPcsba9yCBshERW83sebPfgwVmhmZ6kG7pxrMtok4t8LXkvQNfFgbsG3bL0iSHV0S+3GKBhMx/Y9R7snlt09WLT6VeE2HE3Aojw/+W2Xs6cq1/V95lGF37dcdJLyLlLFH0buL2d3NdHWBmQbhWhcadbqtNtBtli6WW04AK4lTQTKttRl9vWLFGHkUrQbaYZxGiNp9idY0XIUSfWTZhgfnR95ByaG2omokTjlVWAAMtBdJDI7aYIkcVUnTXgy5axdVWDcbIWo5BInlkjiIhyKBcIBUUWnuw3QhlSExRWR+L+L3n3kIWcdQSlw3RBV6IF+lFJkwY0dWWlgLB2dGT4ZGo5V10lhSAcHN911FMeZIU6FrgMQfXmb4N+qVJ6Fnn6KKQOopopCWtOdJA4LVEJ5C+Teqnj2lS+lNFnqK0EqLQtdYQR3JiFxWpeFn/ZlFbPdZmopk2IZikVP5JeF9JFU5mZIpelfiUkl2WmJ2xzMJHlGZQDUZXjgeK9auFdU1bllUZQttsinnRNKuELjaI7XgL1brsex5ahZqBAYJLW1FS1QpUt6oCVuNhdRZpmJPfGjvsvOcSe6S8JCEbMEVZ6ahskGGe53CEmMLY2nDUHitWdGTV+6K3f5ZH2cBL9qSXg2CpK7C3LVnMML+cDdQouu0pXCZQGPM7rq+ulkyywZFa2qd7pbVaQH8rYuhccS+Vep2aJE7H6F9TR4lXcGtxxZ6obKLpHWFgU+S0WnMuauh4b9rE4KRrFjY2ukOH7NeTeTI30ZMs3h1RSl8qB6oo11OdGRAAOw==", sha: "9996f2f7340147080df9444e39a83f8727f2b7cfbbcfe7481c6db45f3a1453f0" },
};
const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));
const sha = (a: Uint8Array) => createHash("sha256").update(a).digest("hex");

describe("decodeGif", () => {
  it("a plain GIF: size and every grey value are right", () => {
    const img = decodeGif(bytes(GIF.plain.b64));
    expect([img.width, img.height]).toEqual([130, 40]);
    expect(sha(img.gray)).toBe(GIF.plain.sha);
  });
  it("an interlaced GIF: the rows are put back in order", () => {
    const b = bytes(GIF.interlaced.b64);
    const at = b.indexOf(0x2c, 13 + 3 * (1 << ((b[10] & 7) + 1)));
    expect(b[at + 9] & 0x40).toBe(0x40); // really interlaced
    const img = decodeGif(b);
    expect(sha(img.gray)).toBe(GIF.interlaced.sha);
  });
  it("anything that is not a readable GIF throws a code (the caller then gives OCR the bytes as they are)", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(() => decodeGif(png)).toThrow(/not_gif/);
    expect(() => decodeGif(new Uint8Array(0))).toThrow(/not_gif/);
    expect(() => decodeGif(null)).toThrow(/not_gif/);
    const huge = bytes(GIF.plain.b64); huge[6] = 0xff; huge[7] = 0xff;
    expect(() => decodeGif(huge)).toThrow(/gif_bad_size/);
    // a cut-off file is never read as a blank picture
    for (const cut of [20, 60, 200, 600]) expect(() => decodeGif(bytes(GIF.plain.b64).subarray(0, cut))).toThrow(/gif_/);
  });
});

describe("a captcha is a small picture", () => {
  it("limits: 200 KB, 400 × 200 px", () => {
    expect([FM_CAPTCHA_MAX_BYTES, FM_CAPTCHA_MAX_WIDTH, FM_CAPTCHA_MAX_HEIGHT]).toEqual([200 * 1024, 400, 200]);
  });
  it("a picture wider or taller than a captcha is refused on its header — before anything is decoded", () => {
    const wide = bytes(GIF.plain.b64); wide[6] = 0x91; wide[7] = 0x01;   // 401 px wide
    const tall = bytes(GIF.plain.b64); tall[8] = 0xc9; tall[9] = 0x00;   // 201 px tall
    expect(() => captchaToBmp(wide)).toThrow(/gif_too_big/);
    expect(() => captchaToBmp(tall)).toThrow(/gif_too_big/);
    const edge = bytes(GIF.plain.b64); edge[6] = 0x90; edge[7] = 0x01;   // exactly 400 wide passes the size check
    expect(() => captchaToBmp(edge)).not.toThrow(/gif_too_big/);
    expect(() => decodeGif(wide)).not.toThrow(/gif_too_big/);            // the limit belongs to the captcha, not to the GIF reader
  });
  it("more than 200 KB is refused without being read", () => {
    const big = new Uint8Array(FM_CAPTCHA_MAX_BYTES + 1);
    big.set(bytes(GIF.plain.b64));
    expect(() => captchaToBmp(big)).toThrow(/captcha_too_large/);
  });
});

describe("cleaning", () => {
  const img = decodeGif(bytes(GIF.plain.b64));
  it("the digits become ink, the grey background and its dots do not", () => {
    const ink = inkMask(img.gray, img.width, img.height);
    const n = ink.reduce((a: number, b: number) => a + b, 0);
    expect(n).toBeGreaterThan(400);                         // six digits
    expect(n).toBeLessThan(img.width * img.height * 0.35);   // not the background
    const rows = (from: number, to: number) => { let s = 0; for (let y = from; y < to; y++) for (let x = 0; x < img.width; x++) s += ink[y * img.width + x]; return s; };
    expect(rows(0, 2) + rows(38, 40)).toBe(0);               // the dotted margin is clean
  });
  it("without the dot removal the dots stay — the setting does the work", () => {
    const withDots = inkMask(img.gray, img.width, img.height, { ...FM_CAPTCHA_IMAGE, despeckle: 0 });
    const clean = inkMask(img.gray, img.width, img.height);
    const count = (m: Uint8Array) => m.reduce((a: number, b: number) => a + b, 0);
    expect(count(withDots)).toBeGreaterThan(count(clean));
  });
  it("invert off reads the picture the other way round (dark digits on light)", () => {
    const flipped = Uint8Array.from(img.gray, (v) => 255 - v);
    expect(Array.from(inkMask(flipped, img.width, img.height, { ...FM_CAPTCHA_IMAGE, invert: false })))
      .toEqual(Array.from(inkMask(img.gray, img.width, img.height)));
  });
  it("a fixed threshold is used as given; 'auto' picks one between the two groups", () => {
    const two = new Uint8Array(100).fill(40); two.fill(200, 50);
    expect(otsu(two)).toBeGreaterThan(40);
    expect(otsu(two)).toBeLessThanOrEqual(200);
    const mask = inkMask(two, 10, 10, { invert: false, threshold: 100, despeckle: 0, scale: 1, border: 0 });
    expect(Array.from(mask.slice(0, 50)).every((v) => v === 1)).toBe(true);
    expect(Array.from(mask.slice(50)).every((v) => v === 0)).toBe(true);
  });
  it("the result is a 24-bit BMP: enlarged, with a white margin, black ink where the mask says", () => {
    const out = captchaToBmp(bytes(GIF.plain.b64));
    expect([out.width, out.height]).toEqual([130 * 3 + 24, 40 * 3 + 24]);
    const dv = new DataView(out.bmp.buffer);
    expect(String.fromCharCode(out.bmp[0], out.bmp[1])).toBe("BM");
    expect(dv.getUint32(2, true)).toBe(out.bmp.length);
    expect([dv.getInt32(18, true), dv.getInt32(22, true), dv.getUint16(28, true)]).toEqual([414, 144, 24]);
    // one ink pixel at (1,0) of a 2×1 mask, scale 2, border 1 → a 2×2 black square at x 3–4, y 1–2
    const small = maskToBmp(new Uint8Array([0, 1]), 2, 1, { ...FM_CAPTCHA_IMAGE, scale: 2, border: 1 });
    expect([small.width, small.height]).toEqual([6, 4]);
    const rowBytes = (6 * 3 + 3) & ~3;
    const px = (x: number, y: number) => small.bmp[54 + (small.height - 1 - y) * rowBytes + x * 3];
    const black: string[] = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) if (px(x, y) === 0) black.push(`${x},${y}`);
    expect(black).toEqual(["3,1", "4,1", "3,2", "4,2"]);
  });
});

describe("imageSettingsFrom — settings without a deploy (app_settings fm_check_captcha)", () => {
  it("missing or unreadable → the constants", () => {
    for (const raw of [undefined, null, "", "not json", "[1]", 5]) expect(imageSettingsFrom(raw)).toEqual({ ...FM_CAPTCHA_IMAGE });
  });
  it("valid fields replace the constants; anything out of range keeps the constant", () => {
    expect(imageSettingsFrom('{"threshold":140,"invert":false,"scale":4,"despeckle":0,"border":20}'))
      .toEqual({ invert: false, threshold: 140, despeckle: 0, scale: 4, border: 20 });
    expect(imageSettingsFrom({ threshold: 999, invert: "yes", scale: 0, despeckle: 2.5, border: -1 })).toEqual({ ...FM_CAPTCHA_IMAGE });
    expect(imageSettingsFrom({ threshold: "auto" }).threshold).toBe("auto");
  });
  it("the constants are the documented starting values", () => {
    expect(FM_CAPTCHA_IMAGE).toEqual({ invert: true, threshold: "auto", despeckle: 2, scale: 3, border: 12 });
  });
});
