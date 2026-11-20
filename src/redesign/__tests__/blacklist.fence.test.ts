// BLACKLIST — the fence: the new code reads nothing from and writes nothing to the order, printing,
// buyer-number or Taiwan Buyer Alert code. (The live-row behaviour — 1-Click / Type price get the same
// calls with or without the list — is in screens/__tests__/Dashboard.blacklist.test.tsx.)
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// plain .mjs list shared with the CI printing gate
import { isPrintingFile } from "../../../scripts/printing-paths.mjs";

const root = join(__dirname, "..", "..", "..");
const NEW_FILES = [
  "src/redesign/adapters/blacklist.ts",
  "src/redesign/screens/Blacklist.tsx",
  "src/redesign/components/BlacklistSheet.tsx",
];
const read = (p: string) => readFileSync(join(root, p), "utf8");
const importsOf = (src: string) => [...src.matchAll(/^\s*import[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
const FORBIDDEN = /printing|sticker|printer|escpos|cpcl|receipt|useOrders|orderLogic|\/db"?$|useLiveSession|buyerAlert|buyerTag|reprint|pinToPrint/i;

describe("the blacklist code stays out of orders, printing, buyer numbers and Buyer Alert", () => {
  it("none of the new files is a printing file", () => {
    for (const f of NEW_FILES) expect(isPrintingFile(f), f).toBe(false);
  });
  it("the new files import nothing from those parts of the app", () => {
    for (const f of NEW_FILES) {
      const bad = importsOf(read(f)).filter((s) => FORBIDDEN.test(s));
      expect(bad, f).toEqual([]);
    }
  });
  it("the database calls are only the blacklist's own (one table, two functions)", () => {
    const src = read("src/redesign/adapters/blacklist.ts");
    expect([...src.matchAll(/\.from\("([^"]+)"\)/g)].map((m) => m[1])).toEqual(["buyer_blacklist", "buyer_blacklist"]);
    expect([...src.matchAll(/\.rpc\("([^"]+)"/g)].map((m) => m[1]).sort()).toEqual(["blacklist_add", "blacklist_remove"]);
    expect(src).not.toMatch(/setInterval|setTimeout/); // no timer: read at live start / screen open / after a change
  });
  it("RedesignApp only hands the list to the live rows, the tile and the screen (no order / print call)", () => {
    const app = read("src/redesign/RedesignApp.tsx");
    const lines = app.split("\n").filter((l) => /blacklist|Blacklist/.test(l));
    for (const l of lines) expect(l, l).not.toMatch(/createOrder|printSlip|onOneClick|applyOrder|buyerNumber|bNum/);
  });
});
