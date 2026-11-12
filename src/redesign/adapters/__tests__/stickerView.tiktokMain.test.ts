// TikTok / Facebook view — PROOF, part 1: the TikTok view prints exactly what main printed.
// Printer Test in the TikTok view = today's sample buyer through printOneStickerTest. The fingerprints
// below were taken by running THIS file on main (8253c004, before the view existed); the same bytes
// must reach the printer on every path. (Fingerprint = sha256 of the bridge argument; on a laptop, of
// the picture the page is made of.)
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { appendFileSync } from "node:fs";

vi.mock("../oneStickerPrint", async (orig) => {
  const m = await orig<typeof import("../oneStickerPrint")>();
  const G = globalThis as unknown as { __sflDrawn?: { path: string; input: unknown; picture: string }[] };
  return { ...m, renderOneStickerFor: async (...a: Parameters<typeof m.renderOneStickerFor>) => {
    const r = await m.renderOneStickerFor(...a);
    (G.__sflDrawn ??= []).push({ path: a[0], input: a[2], picture: `${r.w}x${r.h}/${r.rowBytes}:${Buffer.from(r.buf).toString("base64")}` });
    return r;
  } };
});

import { printOneStickerTest } from "../printing";
import { sampleBuyer } from "../oneStickerPrint";
import { installNodeFallbackDrawer, installSans } from "./oneSticker.harness";
import { AT, SHOP, VIEW_PATHS, MAIN_TIKTOK, cfgFor, draftFor, resetAll, sentOn, sha } from "./stickerView.harness";


beforeAll(() => { installSans(); installNodeFallbackDrawer(); });
afterEach(() => resetAll());

describe("TikTok view = main, on every print path", () => {
  it.each(VIEW_PATHS)("%s: Printer Test hands the printer the same bytes as on main", async (path) => {
    resetAll();
    const out = await sentOn(path, () => printOneStickerTest(draftFor(path), sampleBuyer(undefined, AT), "NT$", SHOP, cfgFor(path)));
    if (process.env.SFL_PRINT_GOLDEN) appendFileSync(process.env.SFL_PRINT_GOLDEN, `${path}: "${sha(out.handed)}",\n`); // (how the fingerprints were taken)
    else expect(sha(out.handed)).toBe(MAIN_TIKTOK[path]);
    expect(out.input).toMatchObject({ buyerNum: 128, name: "Maria Santos", handle: "maria_live", platform: "TikTok" });
  }, 60000);
});
