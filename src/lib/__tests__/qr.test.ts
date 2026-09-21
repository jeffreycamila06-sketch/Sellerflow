// QR encoder wrapper — matrix shape + the finder-pattern invariant (proves it's a real
// QR, not garbage) + the blank/verbatim contract. The @username is the ONLY payload.
import { describe, it, expect } from "vitest";
import { qrMatrix } from "../qr";

// The three 7×7 finder patterns (top-left, top-right, bottom-left) are always present
// in a valid QR: a solid outer ring around a 3×3 core. Checking a couple of cells is
// enough to prove qrMatrix produced structure, not noise.
function isFinderCorner(m: boolean[][], r0: number, c0: number): boolean {
  return m[r0][c0] && m[r0 + 6][c0] && m[r0][c0 + 6] && m[r0 + 6][c0 + 6] // corners dark
    && !m[r0 + 1][c0 + 1] && m[r0 + 3][c0 + 3];                            // ring gap + solid center
}

describe("qrMatrix", () => {
  it("returns a square n×n matrix (n≥21) for a handle", () => {
    const m = qrMatrix("Ashley102031(IG)");
    expect(m).not.toBeNull();
    const n = m!.length;
    expect(n).toBeGreaterThanOrEqual(21);          // version 1 is 21×21
    expect(m!.every((row) => row.length === n)).toBe(true);
  });
  it("has the three QR finder patterns (valid, scannable structure)", () => {
    const m = qrMatrix("buyer.99_x")!;
    const n = m.length;
    expect(isFinderCorner(m, 0, 0)).toBe(true);          // top-left
    expect(isFinderCorner(m, 0, n - 7)).toBe(true);      // top-right
    expect(isFinderCorner(m, n - 7, 0)).toBe(true);      // bottom-left
  });
  it("blank / whitespace → null (no QR for a handle-less parcel)", () => {
    expect(qrMatrix("")).toBeNull();
    expect(qrMatrix("   ")).toBeNull();
    // @ts-expect-error non-string guard
    expect(qrMatrix(null)).toBeNull();
  });
  it("different handles → different matrices (payload is actually encoded)", () => {
    const a = JSON.stringify(qrMatrix("alice"));
    const b = JSON.stringify(qrMatrix("bob"));
    expect(a).not.toBe(b);
  });
});
