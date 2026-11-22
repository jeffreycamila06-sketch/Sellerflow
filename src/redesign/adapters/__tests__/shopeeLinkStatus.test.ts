// The paste box's stop line: server reason → i18n key → the seller's words (8 languages), and the
// own-restart rule ("connected on another device" never for this device's own new connect).
import { describe, it, expect } from "vitest";
import { shopeeStopNoteKey, isOwnRestart, SHOPEE_STOP_KEY, OWN_RESTART_GRACE_MS } from "../shopeeLinkStatus";
import { buildT } from "../../i18n";

const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"] as const;
const NONE = { startedAt: null, endedAt: null };
const stop = (reason: string, at = 1_000_000) => ({ reason, at });

describe("reason → line", () => {
  it("the five reasons and Jeff's English words", () => {
    const en = buildT("en") as unknown as Record<string, string>;
    const want: Record<string, string> = {
      session_end: "Your Shopee live has ended.",
      unreachable: "Shopee stopped answering. Tap Connect to try again.",
      restart: "Shopee was connected on another device.",
      shutdown: "Connection was reset. Tap Connect to continue.",
      max_session: "Shopee live reached the time limit. Tap Connect to continue.",
    };
    for (const [reason, text] of Object.entries(want)) expect(en[shopeeStopNoteKey(stop(reason), NONE)!]).toBe(text);
    expect(Object.keys(SHOPEE_STOP_KEY).sort()).toEqual(Object.keys(want).sort());
  });
  it("every line exists in every app language, none blank, none left in English outside en", () => {
    const en = buildT("en") as unknown as Record<string, string>;
    for (const key of Object.values(SHOPEE_STOP_KEY).concat(["rd_sh_connected_btn"])) {
      for (const lang of LANGS) {
        const t = buildT(lang) as unknown as Record<string, string>;
        expect(t[key], `${key} ${lang}`).toBeTruthy();
        expect(t[key].trim().length).toBeGreaterThan(0);
        if (lang !== "en" && key !== "rd_sh_connected_btn") expect(t[key], `${key} ${lang}`).not.toBe(en[key]);
      }
    }
  });
  it("no line for an unknown reason, an empty reason, or no stop", () => {
    expect(shopeeStopNoteKey(stop("stopped"), NONE)).toBeNull();
    expect(shopeeStopNoteKey(stop(""), NONE)).toBeNull();
    expect(shopeeStopNoteKey(stop("toString"), NONE)).toBeNull();
    expect(shopeeStopNoteKey(null, NONE)).toBeNull();
  });
});

describe("own restart", () => {
  const own = { startedAt: 100_000, endedAt: 103_000 };
  it("a restart heard while our request runs or up to 15 s after its answer = our own → no line", () => {
    expect(shopeeStopNoteKey(stop("restart", 100_000), { startedAt: 100_000, endedAt: null })).toBeNull();
    expect(shopeeStopNoteKey(stop("restart", 101_500), own)).toBeNull();
    expect(shopeeStopNoteKey(stop("restart", 103_000 + OWN_RESTART_GRACE_MS), own)).toBeNull();
  });
  it("before our request, or more than 15 s after it → another device → the line", () => {
    expect(shopeeStopNoteKey(stop("restart", 99_999), own)).toBe("rd_sh_stop_other_device");
    expect(shopeeStopNoteKey(stop("restart", 103_001 + OWN_RESTART_GRACE_MS), own)).toBe("rd_sh_stop_other_device");
    expect(shopeeStopNoteKey(stop("restart", 5), NONE)).toBe("rd_sh_stop_other_device");
  });
  it("only 'restart' is skipped — an end during our own connect still shows", () => {
    expect(shopeeStopNoteKey(stop("session_end", 101_500), own)).toBe("rd_sh_stop_ended");
    expect(isOwnRestart(101_500, own)).toBe(true);
  });
});
