// GBK encoder for the TSPL parity tests. Node ships an ICU `TextDecoder("gbk")`
// (decode-only) but no GBK *encoder*, so we invert the decoder once into a
// char->bytes table. GBK is effectively a bijection over its assigned
// double-byte code points, so this reproduces the bytes Java
// `String.getBytes("GBK")` emits for BMP CJK — which is exactly what the
// Android golden fixtures (and the iOS GBK_95 path) use.
//
// This lives under __tests__ so it is test-only (never shipped in the app
// bundle); the iOS plugin does its own GBK via CoreFoundation.

export function buildGbkEncoder(): (s: string) => number[] {
  const decoder = new TextDecoder("gbk", { fatal: false });
  const charToBytes = new Map<string, [number, number]>();
  for (let lead = 0x81; lead <= 0xfe; lead++) {
    for (let trail = 0x40; trail <= 0xfe; trail++) {
      if (trail === 0x7f) continue; // 0x7f is not a valid GBK trail byte
      const ch = decoder.decode(new Uint8Array([lead, trail]));
      if (ch.length === 1 && ch.charCodeAt(0) !== 0xfffd && !charToBytes.has(ch)) {
        charToBytes.set(ch, [lead, trail]);
      }
    }
  }
  return (s: string): number[] => {
    const out: number[] = [];
    for (const ch of s) {
      const code = ch.codePointAt(0) ?? 0;
      if (code <= 0x7f) {
        out.push(code);
        continue;
      }
      const bytes = charToBytes.get(ch);
      if (bytes) {
        out.push(bytes[0], bytes[1]);
      } else {
        out.push(0x3f); // unmappable -> '?', matching lossy fallback
      }
    }
    return out;
  };
}
