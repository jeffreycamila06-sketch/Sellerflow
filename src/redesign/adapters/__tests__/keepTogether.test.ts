// keepTogetherPieces — where a right-hand Pickup Status line may wrap (2026-11-19, fix round 1).
// Before: "請在 11月26日 前寄 ⏎ 件" (one character alone) and dates cut in two ("Nov ⏎ 26").
// The real wrapping on screen is measured by docs/design/fm-pickup-accuracy-2/harness/wrap-check.cjs;
// here: the pieces the screen draws.
import { describe, it, expect, vi, afterEach } from "vitest";
import { keepTogetherPieces, keepTogetherBalanced, graphemeCount, SHORT_CHUNK, NO_SPACE_LANGS } from "../keepTogether";
import { buildT, tpl } from "../../i18n";

const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"] as const;
const DATES: Record<string, string> = { en: "Nov 26", fil: "Nob 26", zh: "11月26日", "zh-TW": "11月26日", vi: "26 thg 11", th: "26 พ.ย.", id: "26 Nov", bg: "26.11" };
const KEYS = [["rd_pt_fm_drop_by", true], ["rd_pt_fm_leaves_on", true], ["rd_pt_fm_leaves_next", false]] as const;
const kept = (s: ReturnType<typeof keepTogetherPieces>) => s.filter((p) => p.keep).map((p) => p.text);

afterEach(() => { vi.unstubAllGlobals(); });

describe("the pieces are exactly the label (nothing added or lost), every language", () => {
  for (const lang of LANGS) {
    it(lang, () => {
      const t = buildT(lang) as unknown as Record<string, string>;
      for (const [key, withDate] of KEYS) {
        const date = withDate ? DATES[lang] : null;
        const pieces = keepTogetherPieces(t[key], date, lang);
        expect(pieces.map((p) => p.text).join(""), `${lang} ${key}`).toBe(tpl(t[key], { date: date ?? "" }));
        const dates = pieces.filter((p) => p.date);
        expect(dates, `${lang} ${key}`).toEqual(withDate ? [{ text: DATES[lang], keep: true, date: true }] : []);
      }
    });
  }
});

describe("Traditional Chinese — the case that was reported", () => {
  const t = buildT("zh-TW") as unknown as Record<string, string>;
  it("請在 {date} 前寄件 → three whole pieces, breaks only at the two spaces", () => {
    expect(keepTogetherPieces(t.rd_pt_fm_drop_by, "11月26日", "zh-TW")).toEqual([
      { text: "請在", keep: true }, { text: " ", keep: false }, { text: "11月26日", keep: true, date: true },
      { text: " ", keep: false }, { text: "前寄件", keep: true },
    ]);
  });
  it("{date} 移出清單 → the date and 移出清單, each whole", () => {
    expect(kept(keepTogetherPieces(t.rd_pt_fm_leaves_on, "11月27日", "zh-TW"))).toEqual(["11月27日", "移出清單"]);
  });
  it("下次檢查時移出清單 (no space) → words of two or more characters (時 joined to 檢查)", () => {
    expect(kept(keepTogetherPieces(t.rd_pt_fm_leaves_next, null, "zh-TW"))).toEqual(["下次", "檢查時", "移出", "清單"]);
  });
});

describe("no piece of one character in the languages written without spaces", () => {
  for (const lang of NO_SPACE_LANGS) {
    it(lang, () => {
      const t = buildT(lang) as unknown as Record<string, string>;
      for (const [key, withDate] of KEYS) {
        for (const p of keepTogetherPieces(t[key], withDate ? DATES[lang] : null, lang).filter((x) => x.keep)) {
          expect(graphemeCount(p.text), `${lang} ${key} "${p.text}"`).toBeGreaterThan(1);
        }
      }
    });
  }
  it("a one-character first word is joined to the next one", () => {
    expect(kept(keepTogetherPieces("前寄件移出清單我們", null, "zh-TW")).every((w) => graphemeCount(w) > 1)).toBe(true);
  });
});

describe("the other rules", () => {
  it("a date with a space inside stays one piece (English, Thai, Vietnamese, Indonesian)", () => {
    expect(keepTogetherPieces("Drop off before {date}", "Nov 26", "en")).toEqual([
      { text: "Drop", keep: true }, { text: " ", keep: false }, { text: "off", keep: true }, { text: " ", keep: false },
      { text: "before", keep: true }, { text: " ", keep: false }, { text: "Nov 26", keep: true, date: true },
    ]);
    expect(kept(keepTogetherPieces("Gửi trước {date}", "26 thg 11", "vi"))).toContain("26 thg 11");
  });
  it(`a run of at most ${SHORT_CHUNK} characters is one piece; a longer one is split into words`, () => {
    expect(SHORT_CHUNK).toBe(6);
    expect(kept(keepTogetherPieces("前寄件移出清", null, "zh-TW"))).toEqual(["前寄件移出清"]);
    expect(kept(keepTogetherPieces("下次檢查時移出清單", null, "zh-TW")).length).toBeGreaterThan(1);
  });
  it("no Intl.Segmenter (old phone browser): a long run is left to the browser; dates and short runs still whole", () => {
    vi.stubGlobal("Intl", { ...Intl, Segmenter: undefined });
    const p = keepTogetherPieces("請在 {date} 前寄件 下次檢查時移出清單", "11月26日", "zh-TW");
    expect(p.map((x) => x.text).join("")).toBe("請在 11月26日 前寄件 下次檢查時移出清單");
    expect(p.find((x) => x.text === "下次檢查時移出清單")).toEqual({ text: "下次檢查時移出清單", keep: false });
    expect(kept(p)).toEqual(["請在", "11月26日", "前寄件"]);
  });
  it("lines are evened out only for Chinese, Traditional Chinese and Thai", () => {
    expect(LANGS.filter(keepTogetherBalanced)).toEqual(["zh", "zh-TW", "th"]);
  });
});
