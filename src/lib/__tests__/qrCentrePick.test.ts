// The native scanner's centre pick: the web rule + the shared examples + the Swift / Java mirrors.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pickCentreQr, stepPick, PICK_MARGIN, PICK_FRAMES, type PickVerdict, type PickStreak } from "../qrCentrePick";
import { generated, SWIFT_OUT, JAVA_OUT } from "../../../scripts/gen-qr-pick-cases.mjs";

const root = resolve(__dirname, "../../..");
const ex = JSON.parse(readFileSync(resolve(__dirname, "fixtures/qrCentrePick.examples.json"), "utf8"));
const verdictWord = (v: PickVerdict) => (v.kind === "one" ? `one:${v.text}` : v.kind);
const parse = (s: string): PickVerdict => (s.startsWith("one:") ? { kind: "one", text: s.slice(4) } : s === "tie" ? { kind: "tie" } : { kind: "none" });

describe("pickCentreQr — the shared examples", () => {
  for (const c of ex.pick) {
    it(c.id, () => {
      expect(verdictWord(pickCentreQr(c.hits, c.frame))).toBe(c.expect);
    });
  }
  it("the examples use the rule's constants", () => {
    expect(ex.margin).toBe(PICK_MARGIN);
    expect(ex.frames).toBe(PICK_FRAMES);
  });
});

describe("stepPick — the shared streak examples", () => {
  for (const c of ex.streak) {
    it(c.id, () => {
      let streak: PickStreak | null = null;
      const got: string[] = [];
      for (const s of c.steps) {
        const step = stepPick(streak, parse(s));
        streak = step.streak;
        got.push(step.read ?? (step.tie ? "tie" : "-"));
      }
      expect(got).toEqual(c.expect);
    });
  }
});

describe("pickCentreQr — bad input never throws", () => {
  it("odd hits and frames give none", () => {
    expect(pickCentreQr(null as never, { cx: 0, cy: 0, side: 10 })).toEqual({ kind: "none" });
    expect(pickCentreQr([{ text: "A", cx: NaN, cy: 0 }], { cx: 0, cy: 0, side: 10 })).toEqual({ kind: "none" });
    expect(pickCentreQr([{ text: "A", cx: 0, cy: 0 }], { cx: 0, cy: 0, side: -5 })).toEqual({ kind: "none" });
    expect(pickCentreQr([{ text: 5 as never, cx: 0, cy: 0 }], { cx: 0, cy: 0, side: 10 })).toEqual({ kind: "none" });
  });
});

describe("the Swift and Java mirrors", () => {
  it("the generated test cases are up to date (run: node scripts/gen-qr-pick-cases.mjs)", () => {
    const g = generated();
    expect(readFileSync(SWIFT_OUT, "utf8")).toBe(g.swift);
    expect(readFileSync(JAVA_OUT, "utf8")).toBe(g.java);
  });
  it("Swift and Java use the same margin and frame count", () => {
    const swift = readFileSync(resolve(root, "mobile/ios/App/App/SellerFlowScannerPlugin.swift"), "utf8");
    const java = readFileSync(resolve(root, "mobile/android/app/src/main/java/com/sellerflow/live/QrCentrePick.java"), "utf8");
    expect(swift).toMatch(/static let margin: Double = 0\.15\b/);
    expect(swift).toMatch(/static let frames: Int = 2\b/);
    expect(java).toMatch(/static final double MARGIN = 0\.15;/);
    expect(java).toMatch(/static final int FRAMES = 2;/);
  });
  it("both native tests walk every generated case", () => {
    const swiftTest = readFileSync(resolve(root, "mobile/ios/App/AppTests/QrCentrePickTests.swift"), "utf8");
    const javaTest = readFileSync(resolve(root, "mobile/android/app/src/test/java/com/sellerflow/live/QrCentrePickTest.java"), "utf8");
    expect(swiftTest).toMatch(/for c in QrCentrePickCases\.pick/);
    expect(swiftTest).toMatch(/for c in QrCentrePickCases\.streak/);
    expect(javaTest).toMatch(/for \(QrCentrePickCases\.PickCase c : QrCentrePickCases\.PICK\)/);
    expect(javaTest).toMatch(/for \(QrCentrePickCases\.StreakCase c : QrCentrePickCases\.STREAK\)/);
  });
});
