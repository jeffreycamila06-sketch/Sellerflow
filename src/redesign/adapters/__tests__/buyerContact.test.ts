// Buyer contact (docs/plans/buyer-contact.md) — the pure core: normalise / validate per
// platform, the Pickup Status link table (incl. & # emoji CJK encoding), the copy-only cases,
// the ready message (Customer Details name only; masked / missing → no-name greeting), the
// phone-shaped rule, the lookup keys and the gate matrix (v2 item 8).
import { describe, it, expect } from "vitest";
import {
  BUYER_CONTACT_PLATFORMS, DEFAULT_CONTACT_PLATFORM, CONTACT_MAX_LEN, isContactPlatform, platformOf,
  buyerContactVisible, whatsappDigits, facebookStoredValue, normalizeContact, contactError, lineHint,
  looksLikePhone, contactLink, pickupMessage, contactKey, lookupContact,
} from "../buyerContact";

const T = { rd_pt_msg_tpl: "Hi {name}! Your parcel is at {carrier} {store} ({amount}). Please pick it up by {deadline}. Thank you!", rd_pt_msg_tpl_noname: "Hi! Your parcel is at {carrier} {store} ({amount}). Please pick it up by {deadline}. Thank you!", rd_pt_carrier_711: "7-11", rd_pt_carrier_fm: "FamilyMart" };
const MSG = "Hi Maria! Your parcel is at 7-11 松山門市 (NT$380). Please pick it up by 2026-11-05. Thank you! & # 🎉";

describe("platforms", () => {
  it("six platforms, TikTok default; NULL / unknown stored values read as TikTok", () => {
    expect(BUYER_CONTACT_PLATFORMS).toEqual(["tiktok", "line", "whatsapp", "facebook", "instagram", "other"]);
    expect(DEFAULT_CONTACT_PLATFORM).toBe("tiktok");
    expect(isContactPlatform("line")).toBe(true);
    expect(isContactPlatform("telegram")).toBe(false);
    expect(platformOf(null)).toBe("tiktok");
    expect(platformOf("whatsapp")).toBe("whatsapp");
    expect(platformOf("TIKTOK")).toBe("tiktok");
  });
});

describe("gate matrix — buyerContactVisible (v2 item 8)", () => {
  it("admin always; preview key always; switch on + Plus/Pro/Master; basic/free never; off-market never", () => {
    expect(buyerContactVisible({ role: "admin", plan: "free" })).toBe(true);
    expect(buyerContactVisible({ role: "seller", plan: "basic", previewKey: true })).toBe(true);
    for (const plan of ["plus", "pro", "master", "Plus", " PRO "]) expect(buyerContactVisible({ role: "seller", plan, switchOn: true })).toBe(true);
    for (const plan of ["plus", "pro", "master"]) expect(buyerContactVisible({ role: "seller", plan, switchOn: false })).toBe(false);
    for (const plan of ["basic", "free", "trial", "", null, undefined]) {
      expect(buyerContactVisible({ role: "seller", plan, switchOn: true })).toBe(false);          // the parcel_check list does NOT help a basic/free seller
      expect(buyerContactVisible({ role: "seller", plan, switchOn: false })).toBe(false);
    }
    expect(buyerContactVisible({ role: "admin", plan: "pro", marketHidden: true })).toBe(false);  // market wins
    expect(buyerContactVisible({ role: "seller", plan: "pro", switchOn: true, previewKey: true, marketHidden: true })).toBe(false);
    expect(buyerContactVisible(null)).toBe(false);
  });
});

describe("WhatsApp numbers", () => {
  it("TW 09… → 886, PH 09… (11 digits) → 63, 00 stripped, 8–15 digits else null", () => {
    expect(whatsappDigits("0912 345 678")).toBe("886912345678");
    expect(whatsappDigits("+886 912 345 678")).toBe("886912345678");
    expect(whatsappDigits("09171234567")).toBe("639171234567");
    expect(whatsappDigits("0063 917 123 4567")).toBe("639171234567");
    expect(whatsappDigits("+1 (415) 555-0123")).toBe("14155550123");
    expect(whatsappDigits("12345")).toBeNull();
    expect(whatsappDigits("1234567890123456")).toBeNull();
    expect(whatsappDigits("abc")).toBeNull();
    expect(whatsappDigits("")).toBeNull();
  });
  it("normalizeContact stores +digits; contactError blocks only an invalid WhatsApp number", () => {
    expect(normalizeContact("whatsapp", "0912 345 678")).toBe("+886912345678");
    expect(normalizeContact("whatsapp", "12345")).toBe("12345");               // kept as typed (Save is blocked)
    expect(contactError("whatsapp", "12345")).toBe("whatsapp");
    expect(contactError("whatsapp", "")).toBe("");
    expect(contactError("whatsapp", "0912345678")).toBe("");
    for (const p of ["tiktok", "line", "facebook", "instagram", "other"] as const) expect(contactError(p, "12345")).toBe("");
  });
});

describe("normalise per platform (the col J value, never > 50 chars)", () => {
  it("tiktok verbatim; line lower + no @; instagram no @; other trimmed; facebook link → username / fb:id", () => {
    expect(normalizeContact("tiktok", "@Maria_Shops ")).toBe("@Maria_Shops ");
    expect(normalizeContact("line", " @Yating.Line ")).toBe("yating.line");
    expect(normalizeContact("instagram", "@ana.cruz_ig")).toBe("ana.cruz_ig");
    expect(normalizeContact("other", "  Telegram @meiling ")).toBe("Telegram @meiling");
    expect(normalizeContact("facebook", "https://www.facebook.com/joy.reyes.90/")).toBe("joy.reyes.90");
    expect(normalizeContact("facebook", "https://m.facebook.com/profile.php?id=100012345678901&ref=x")).toBe("fb:100012345678901");
    expect(normalizeContact("facebook", "fb.com/joy.reyes.90?mibextid=abc")).toBe("joy.reyes.90");
    expect(normalizeContact("facebook", "Joy Reyes")).toBe("Joy Reyes");
    expect(facebookStoredValue("https://www.facebook.com/" + "a".repeat(80))).toHaveLength(50);
    for (const p of BUYER_CONTACT_PLATFORMS) expect(normalizeContact(p, "x".repeat(120)).length).toBeLessThanOrEqual(CONTACT_MAX_LEN);
    expect(lineHint("0912345678")).toBe(true);
    expect(lineHint("yating.line")).toBe(false);
  });
});

describe("looksLikePhone (v2 item 2) — never a TikTok Open for a phone-shaped value", () => {
  it("8–15 digits with an optional +", () => {
    for (const v of ["+886912345678", "0912345678", "12345678", "+1 "]) expect(looksLikePhone(v.trim() === "+1" ? "+123456789012345" : v)).toBe(true);
    for (const v of ["maria_shops", "1234567", "+1234567890123456", "", null, undefined, "0912-345-678"]) expect(looksLikePhone(v)).toBe(false);
  });
});

describe("contactLink — the Pickup Status action per platform", () => {
  it("WhatsApp: wa.me with the message encoded (& # emoji CJK survive)", () => {
    const a = contactLink("whatsapp", "+886922333444", MSG);
    expect(a).toEqual({ kind: "open", url: `https://wa.me/886922333444?text=${encodeURIComponent(MSG)}`, copy: null });
    expect(decodeURIComponent(new URL(a!.kind === "open" ? a.url : "").searchParams.get("text")!)).toBe(MSG);
    expect(a!.kind === "open" && a.url).not.toContain("#");
    expect(contactLink("whatsapp", "0912345678", MSG)).toMatchObject({ kind: "open", url: expect.stringMatching(/^https:\/\/wa\.me\/886912345678\?text=/) });
    expect(contactLink("whatsapp", "12345", MSG)).toEqual({ kind: "copy", text: MSG, contact: "12345" });
  });
  it("LINE: line.me add-friend + the message copied; a bad id → copy", () => {
    expect(contactLink("line", "@Yating.Line", MSG)).toEqual({ kind: "open", url: "https://line.me/R/ti/p/~yating.line", copy: MSG });
    expect(contactLink("line", "ab", MSG)).toEqual({ kind: "copy", text: MSG, contact: "ab" });
    expect(contactLink("line", "has space", MSG)).toMatchObject({ kind: "copy" });
  });
  it("Facebook: username → m.me; fb:id → profile URL; a name / 15+ digits → copy only", () => {
    expect(contactLink("facebook", "joy.reyes.90", MSG)).toEqual({ kind: "open", url: "https://m.me/joy.reyes.90", copy: MSG });
    expect(contactLink("facebook", "https://www.facebook.com/joy.reyes.90", MSG)).toMatchObject({ kind: "open", url: "https://m.me/joy.reyes.90" });
    expect(contactLink("facebook", "fb:100012345678901", MSG)).toEqual({ kind: "open", url: "https://www.facebook.com/profile.php?id=100012345678901", copy: MSG });
    expect(contactLink("facebook", "Joy Reyes", MSG)).toEqual({ kind: "copy", text: MSG, contact: "Joy Reyes" });
    expect(contactLink("facebook", "100012345678901", MSG)).toEqual({ kind: "copy", text: MSG, contact: "100012345678901" });
    expect(contactLink("facebook", "abc", MSG)).toMatchObject({ kind: "copy" });                  // < 5 chars is not a username
  });
  it("Instagram: ig.me/m; Other: copy message + contact; TikTok: null (the screen keeps today's chase); blank → null", () => {
    expect(contactLink("instagram", "@ana.cruz_ig", MSG)).toEqual({ kind: "open", url: "https://ig.me/m/ana.cruz_ig", copy: MSG });
    expect(contactLink("instagram", "bad name!", MSG)).toMatchObject({ kind: "copy" });
    expect(contactLink("other", "Telegram @meiling", MSG)).toEqual({ kind: "copy", text: MSG, contact: "Telegram @meiling" });
    expect(contactLink("tiktok", "maria_shops", MSG)).toBeNull();
    expect(contactLink("whatsapp", "   ", MSG)).toBeNull();
  });
  it("URL encoding: a message with & # emoji CJK never breaks the link", () => {
    const m = "Hi 王小美! 到了 #1 & \"quotes\" 🎉";
    const a = contactLink("whatsapp", "0912345678", m);
    expect(a!.kind).toBe("open");
    const u = new URL((a as { url: string }).url);
    expect(u.hostname).toBe("wa.me");
    expect(u.pathname).toBe("/886912345678");
    expect(u.searchParams.get("text")).toBe(m);
    expect(u.hash).toBe("");
  });
});

describe("pickupMessage (v2 item 4)", () => {
  const base = { carrier: "711" as const, store: "松山門市", amount: "NT$380", deadline: "2026-11-05" };
  it("Customer Details name → the named greeting; masked (J*f*r*y) or missing → the no-name greeting; carrier words", () => {
    expect(pickupMessage(T, { ...base, name: "Maria" })).toBe("Hi Maria! Your parcel is at 7-11 松山門市 (NT$380). Please pick it up by 2026-11-05. Thank you!");
    expect(pickupMessage(T, { ...base, name: "J*f*r*y" })).toBe("Hi! Your parcel is at 7-11 松山門市 (NT$380). Please pick it up by 2026-11-05. Thank you!");
    expect(pickupMessage(T, { ...base, name: "" })).toMatch(/^Hi! /);
    expect(pickupMessage(T, { ...base, name: null })).toMatch(/^Hi! /);
    expect(pickupMessage(T, { ...base, carrier: "fm", name: "Ana" })).toContain("at FamilyMart 松山門市");
    expect(pickupMessage(T, { carrier: "711", store: "", amount: "", deadline: "", name: "Ana" })).toBe("Hi Ana! Your parcel is at 7-11 — (—). Please pick it up by —. Thank you!");
  });
});

describe("lookup keys (v2 item 3)", () => {
  it("handle + store first, then handle only", () => {
    const m = new Map([[contactKey("maria", "266402"), "whatsapp" as const], ["maria", "line" as const], ["ana", "instagram" as const]]);
    expect(lookupContact(m, "maria", "266402")).toBe("whatsapp");
    expect(lookupContact(m, "maria", "999999")).toBe("line");
    expect(lookupContact(m, "maria", null)).toBe("line");
    expect(lookupContact(m, "ana", "1")).toBe("instagram");
    expect(lookupContact(m, "nobody", "1")).toBeNull();
    expect(lookupContact(m, "", "1")).toBeNull();
    expect(contactKey("maria")).toBe("maria");
  });
});
