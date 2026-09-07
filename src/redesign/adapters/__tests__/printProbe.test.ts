import { describe, it, expect } from "vitest";
import { parseSizeMm, buildProbes, toBase64, type Probe } from "../printProbe";

// Decode probe bytes back to a latin1 string (bytesOf writes charCodeAt & 0xff).
const dec = (b: Uint8Array): string => String.fromCharCode(...Array.from(b));
const byId = (ps: Probe[], id: string): Probe => {
  const p = ps.find((x) => x.id === id);
  if (!p) throw new Error(`probe ${id} missing`);
  return p;
};

describe("parseSizeMm", () => {
  it("parses the descriptive form", () => {
    expect(parseSizeMm("100x60mm (Standard)")).toEqual({ w: 100, h: 60 });
  });
  it("parses the bare form and spacing variants", () => {
    expect(parseSizeMm("60x40")).toEqual({ w: 60, h: 40 });
    expect(parseSizeMm("80 x 50")).toEqual({ w: 80, h: 50 });
  });
  it("falls back to 100x60 on garbage/empty", () => {
    expect(parseSizeMm("")).toEqual({ w: 100, h: 60 });
    expect(parseSizeMm("nonsense")).toEqual({ w: 100, h: 60 });
  });
});

describe("buildProbes", () => {
  const probes = buildProbes("60x40");

  it("returns exactly the 11 expected probes in order", () => {
    expect(probes.map((p) => p.id)).toEqual([
      "min", "sweepM1", "sweepM2", "bitmap", "density4", "nodensity", "speed2", "selftest",
      "bmpTextA", "bmpTextB", "bmpTextC",
    ]);
    for (const p of probes) {
      expect(p.label).toBeTruthy();
      expect(p.note).toBeTruthy();
      expect(p.bytes).toBeInstanceOf(Uint8Array);
    }
  });

  it("BITMAP text triad: (a) full-width x=0, (b) x=16 aligned, (c) x=13 non-aligned — same glyph raster", () => {
    const a = dec(byId(probes, "bmpTextA").bytes);
    const b = dec(byId(probes, "bmpTextB").bytes);
    const c = dec(byId(probes, "bmpTextC").bytes);
    // (a) full label width at x=0: 60mm label → 480 dots → 60 bytes/row
    expect(a).toContain("BITMAP 0,70,60,");
    expect(a).toContain('"(a) x=0 full row"');
    // (b)/(c): SAME cropped band data, only the x origin differs
    expect(b).toContain("BITMAP 16,70,");
    expect(c).toContain("BITMAP 13,70,");
    const afterCmd = (s: string, cmd: string) => s.slice(s.indexOf(cmd) + s.slice(s.indexOf(cmd)).indexOf(",0,") + 3);
    expect(afterCmd(b, "BITMAP 16,70,")).toBe(afterCmd(c, "BITMAP 13,70,"));
    // real glyphs, not a solid box: the band contains BOTH ink and white bytes
    const bandOf = (s: string) => { const i = s.indexOf(",0,", s.indexOf("BITMAP ")) + 3; return s.slice(i, s.lastIndexOf("PRINT 1") - 2); };
    const band = bandOf(a);
    expect(/[^\xff]/.test(band)).toBe(true); // some ink (0-bits present)
    expect(band.includes("\xff")).toBe(true); // and some pure white
    // each triad probe ends with PRINT 1 and starts with the standard preamble
    for (const s of [a, b, c]) { expect(s.startsWith("SIZE ")).toBe(true); expect(s.trimEnd().endsWith("PRINT 1")).toBe(true); }
  });

  it("bakes the requested label size into the preamble", () => {
    expect(dec(byId(probes, "min").bytes)).toContain("SIZE 60 mm, 40 mm\r\n");
    expect(dec(buildProbes("100x60")[0].bytes)).toContain("SIZE 100 mm, 60 mm\r\n");
  });

  it("minimal probe = preamble + one TEXT + PRINT (default DENSITY 8)", () => {
    const s = dec(byId(probes, "min").bytes);
    expect(s).toContain("GAP 2 mm, 0\r\n");
    expect(s).toContain("DIRECTION 1\r\n");
    expect(s).toContain("REFERENCE 0,0\r\n");
    expect(s).toContain("DENSITY 8\r\n");
    expect(s).toContain("CLS\r\n");
    expect(s).toContain('TEXT 16,10,"3",0,1,1,"ABC 123"\r\n');
    expect(s.trimEnd().endsWith("PRINT 1")).toBe(true);
    // exactly one TEXT command in the minimal probe
    expect((s.match(/\bTEXT /g) || []).length).toBe(1);
  });

  it("font sweeps emit four self-identifying TEXT lines at the right magnification", () => {
    const m1 = dec(byId(probes, "sweepM1").bytes);
    const m2 = dec(byId(probes, "sweepM2").bytes);
    for (const f of ["1", "2", "3", "4"]) {
      expect(m1).toContain(`"${f}",0,1,1,"F${f} M1: ABC123 Ag8"`);
      expect(m2).toContain(`"${f}",0,2,2,"F${f} M2: ABC123 Ag8"`);
    }
    expect((m1.match(/\bTEXT /g) || []).length).toBe(4);
    expect((m2.match(/\bTEXT /g) || []).length).toBe(4);
  });

  it("BITMAP probe carries the BITMAP command with the full raster payload", () => {
    const p = byId(probes, "bitmap");
    const s = dec(p.bytes);
    expect(s).toContain("BITMAP 16,60,16,64,0,");
    // 16 width-bytes * 64 rows of raster present in the byte stream
    const idx = s.indexOf("BITMAP 16,60,16,64,0,");
    const rasterStart = idx + "BITMAP 16,60,16,64,0,".length;
    expect(p.bytes.length - rasterStart).toBeGreaterThanOrEqual(16 * 64);
    expect(s.trimEnd().endsWith("PRINT 1")).toBe(true);
  });

  it("DENSITY 4 variant sets DENSITY 4 and no DENSITY 8", () => {
    const s = dec(byId(probes, "density4").bytes);
    expect(s).toContain("DENSITY 4\r\n");
    expect(s).not.toContain("DENSITY 8\r\n");
    expect(s).toContain('"DEN4: ABC 123"');
  });

  it("no-density variant omits the DENSITY line entirely", () => {
    const s = dec(byId(probes, "nodensity").bytes);
    expect(s).not.toContain("DENSITY");
    expect(s).toContain('"NODEN: ABC 123"');
    // CLS still terminates the preamble
    expect(s).toContain("CLS\r\n");
  });

  it("speed variant adds SPEED 2 while keeping DENSITY", () => {
    const s = dec(byId(probes, "speed2").bytes);
    expect(s).toContain("SPEED 2\r\n");
    expect(s).toContain("DENSITY 8\r\n");
    expect(s).toContain('"SPD2: ABC 123"');
  });

  it("self-test is a bare SELFTEST command (no preamble/PRINT)", () => {
    const s = dec(byId(probes, "selftest").bytes);
    expect(s).toBe("SELFTEST\r\n");
  });
});

describe("toBase64", () => {
  it("round-trips ASCII bytes", () => {
    const b = new Uint8Array([65, 66, 67]); // ABC
    expect(atob(toBase64(b))).toBe("ABC");
  });
  it("round-trips non-ASCII raster bytes (0x00/0xff)", () => {
    const b = new Uint8Array([0x00, 0xff, 0x00, 0xff, 0x80]);
    const decoded = atob(toBase64(b));
    expect(Array.from(decoded, (c) => c.charCodeAt(0))).toEqual([0x00, 0xff, 0x00, 0xff, 0x80]);
  });
  it("survives a raster larger than the 0x8000 chunk without truncating", () => {
    const big = new Uint8Array(0x8000 + 500).fill(0xab);
    expect(atob(toBase64(big)).length).toBe(big.length);
  });
});
