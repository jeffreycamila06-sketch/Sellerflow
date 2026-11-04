// Buyer contact (docs/plans/buyer-contact.md) — the pure core: normalise / validate per
// platform, the Pickup Status link table (incl. & # emoji CJK encoding), the copy-only cases,
// the ready message (Customer Details name only; masked / missing → no-name greeting), the
// phone-shaped rule, the lookup keys and the gate matrix (v2 item 8).
import { describe, it, expect } from "vitest";
import { BUYER_CONTACT_PLATFORMS, DEFAULT_CONTACT_PLATFORM, CONTACT_MAX_LEN, RAW_INPUT_MAX, isContactPlatform, platformOf, buyerContactVisible, whatsappDigits, facebookStoredValue, normalizeContact, contactError, lineHint, contactLink, pickupMessage, contactKey, lookupContact, FB_RESERVED, contactTruncated, isFacebookLink, parseFacebookLink, fbReserved, FB_USERNAME, FB_WEBSITE } from "../buyerContact";

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

describe("Facebook links — ALLOWLIST (anything else is refused on save)", () => {
  const BLOCKED = [
    "https://www.facebook.com/photo/?fbid=100012345678901&set=a.1",
    "https://www.facebook.com/sharer.php?u=https%3A%2F%2Fx.com",
    "https://www.facebook.com/share.php?u=https%3A%2F%2Fx.com",
    "https://www.facebook.com/share/p/1AbCdEfGh/",
    "https://www.facebook.com/share/r/1AbCdEfGh/",
    "https://www.facebook.com/share/v/1AbCdEfGh/",
    "https://www.facebook.com/share/1AbCdEfGh/extra",
    "https://www.facebook.com/share/a!b",
    "https://www.facebook.com/share/abc12",
    "https://www.facebook.com/share/" + "a".repeat(21),
    "https://fb.com/share/19tvMLYXPi/",
    "https://m.me/share/19tvMLYXPi",
    "https://www.facebook.com/media/set/?set=a.123",
    "https://www.facebook.com/gaming/juan",
    "https://www.facebook.com",
    "facebook.com/",
    "fb.me/x",
    "https://fb.me/juan.delacruz.7",
    "https://l.facebook.com/l.php?u=https%3A%2F%2Fx.com",
    "https://www.facebook.com/profile.php",
    "https://www.facebook.com/people/Juan-Dela-Cruz/",
    "https://www.facebook.com/p/Juan-Shop/",
    "https://www.facebook.com/juan/videos/123",
    "https://www.facebook.com/juan.delacruz.7/video",
    "https://www.facebook.com/juan.delacruz.7/donate",
    "https://www.facebook.com/juan.delacruz.7/messenger",
    "https://www.facebook.com/juan.delacruz.7/posts",
    "https://www.facebook.com/profile.php?id=100012345abc",
    "https://www.facebook.com/profile.php?id=100012345abc&ref=x",
    "https://www.facebook.com/login.php?next=x",
    "https://www.facebook.com/live/",
    "https://m.me/share",
    "https://m.me/juan.delacruz.7/about",
  ];
  const ALLOWED: [string, string][] = [
    ["https://www.facebook.com/p/Juan-Shop-100063123456789/", "fb:100063123456789"],
    ["https://www.facebook.com/100012345678901", "fb:100012345678901"],
    ["https://m.me/juan.delacruz.7", "juan.delacruz.7"],
    ["https://www.facebook.com/profile.php?id=100012345678901", "fb:100012345678901"],
    ["https://m.facebook.com/profile.php?mibextid=abc&id=100012345678901&ref=x", "fb:100012345678901"],
    ["https://www.facebook.com/people/Juan-Dela-Cruz/100012345678901/", "fb:100012345678901"],
    ["https://www.facebook.com/messages/t/100012345678901", "fb:100012345678901"],
    ["https://www.facebook.com/juan.delacruz.7?mibextid=abc", "juan.delacruz.7"],
    ["https://www.facebook.com/juan.delacruz.7/", "juan.delacruz.7"],
    ["https://www.facebook.com/Juan.DelaCruz.7", "Juan.DelaCruz.7"],
    ["http://facebook.com/juan.delacruz.7", "juan.delacruz.7"],
    ["facebook.com/juan.delacruz.7", "juan.delacruz.7"],
    ["web.facebook.com/juan.delacruz.7", "juan.delacruz.7"],
    ["https://www.facebook.com/juan.delacruz.7/about", "juan.delacruz.7"],
    ["fb.com/joy.reyes.90?mibextid=abc", "joy.reyes.90"],
    ["https://M.FACEBOOK.COM/juan.delacruz.7#x", "juan.delacruz.7"],
    ["https://www.facebook.com/juan.delacruz.7/photos", "juan.delacruz.7"],
    ["https://www.facebook.com/juan.delacruz.7/Followers", "juan.delacruz.7"],
    ["https://www.facebook.com/share/19tvMLYXPi/?mibextid=wwXIfr", "fbshare:19tvMLYXPi"],
    ["https://www.facebook.com/share/19tvMLYXPi", "fbshare:19tvMLYXPi"],
    ["https://www.facebook.com/share/19tvMLYXPi/", "fbshare:19tvMLYXPi"],
    ["m.facebook.com/share/19tvMLYXPi/", "fbshare:19tvMLYXPi"],
    ["https://web.facebook.com/share/1AbCdEfGh/?x=1#y", "fbshare:1AbCdEfGh"],
  ];
  it("blocked links → contactError 'facebook' (Save blocked), stored value is never a reserved word; plain text passes as before", () => {
    for (const l of BLOCKED) {
      expect(isFacebookLink(l), l).toBe(true);
      expect(parseFacebookLink(l), l).toBe("");
      expect(contactError("facebook", l), l).toBe("facebook");
      expect(fbReserved(facebookStoredValue(l)), l).toBe(false); // what WOULD be stored is the cut raw link, not "photo" / "share"
    }
    expect(facebookStoredValue("https://www.facebook.com/share/p/1AbCdEfGh/")).not.toBe("share");
    for (const txt of ["Juan Dela Cruz", "share", "photo", "juan.delacruz.7", "100012345678901", ""]) {
      expect(parseFacebookLink(txt)).toBeNull();
      expect(contactError("facebook", txt)).toBe("");
    }
    expect(normalizeContact("facebook", "Juan Dela Cruz")).toBe("Juan Dela Cruz");
    expect(contactError("whatsapp", "12345")).toBe("whatsapp"); // unchanged
  });
  it("allowed shapes → fb:<id> / username, with ?mibextid, trailing slash, uppercase, http, no scheme, web., /about", () => {
    for (const [l, want] of ALLOWED) {
      expect(parseFacebookLink(l), l).toBe(want);
      expect(facebookStoredValue(l), l).toBe(want);
      expect(normalizeContact("facebook", l), l).toBe(want);
      expect(contactError("facebook", l), l).toBe("");
    }
  });
  it("contactLink: m.me only for a real username; fb:<id> → profile URL; reserved / .php / a cut link (old rows) → copy only", () => {
    for (const w of [...FB_RESERVED, "photo.php", "story.php", "Share"]) {
      const a = contactLink("facebook", w, "msg");
      expect(a, w).toEqual({ kind: "copy", text: "msg", contact: w });
    }
    expect(contactLink("facebook", "https://www.facebook.com/share/p/1AbCdEfGh/", "msg")?.kind).toBe("copy");
    expect(contactLink("facebook", "fbshare:19tvMLYXPi", "msg")).toEqual({ kind: "open", url: "https://www.facebook.com/share/19tvMLYXPi/", copy: "msg" });
    expect(contactLink("facebook", "https://www.facebook.com/share/19tvMLYXPi/?mibextid=wwXIfr", "msg")).toEqual({ kind: "open", url: "https://www.facebook.com/share/19tvMLYXPi/", copy: "msg" });
    for (const bad of ["fbshare:", "fbshare:abc12", "fbshare:a!bcdef", "FBSHARE:19tvMLYXPi", "fbshare:" + "a".repeat(21)]) expect(contactLink("facebook", bad, "msg"), bad).toEqual({ kind: "copy", text: "msg", contact: bad });
    for (const digits of ["0912345678", "12345", "886912345678", "100012345678901"]) expect(contactLink("facebook", digits, "msg"), digits).toEqual({ kind: "copy", text: "msg", contact: digits }); // a phone typed into the FB field never opens m.me
    expect(contactTruncated("facebook", "https://www.facebook.com/share/19tvMLYXPi/?mibextid=wwXIfr&" + "x".repeat(60))).toBe(false); // stored as fbshare:<code>
    expect(JSON.stringify(contactLink("facebook", "https://www.facebook.com/photo/?fbid=1", "msg"))).not.toContain("m.me");
    expect(contactLink("facebook", "https://m.me/juan.delacruz.7", "msg")).toEqual({ kind: "open", url: "https://m.me/juan.delacruz.7", copy: "msg" }); // the Messenger button
    expect(contactLink("facebook", "juan.delacruz.7", "msg")).toEqual({ kind: "open", url: "https://m.me/juan.delacruz.7", copy: "msg" });
    expect(contactLink("facebook", "https://www.facebook.com/p/Juan-Shop-100063123456789/", "msg")).toEqual({ kind: "open", url: "https://www.facebook.com/profile.php?id=100063123456789", copy: "msg" });
    expect(contactLink("facebook", "fb:100012345678901", "msg")).toEqual({ kind: "open", url: "https://www.facebook.com/profile.php?id=100012345678901", copy: "msg" });
  });
});

describe("contactTruncated — the 'max 50' hint", () => {
  it("true when the saved value would be cut; never for a Facebook LINK or a valid WhatsApp number", () => {
    const long = "x".repeat(51);
    expect(contactTruncated("other", long)).toBe(true);
    expect(contactTruncated("instagram", `@${long}`)).toBe(true);
    expect(contactTruncated("tiktok", "x".repeat(50))).toBe(false);
    expect(contactTruncated("tiktok", `@${"x".repeat(50)}`)).toBe(true); // TikTok keeps the "@" → 51 saved → cut
    expect(contactTruncated("other", `@${"x".repeat(50)}`)).toBe(true);
    expect(contactTruncated("line", `@${"x".repeat(50)}`)).toBe(false); // LINE drops the "@" → exactly 50, nothing cut
    expect(contactTruncated("instagram", `@${"x".repeat(50)}`)).toBe(false);
    expect(contactTruncated("whatsapp", "+886 912 345 678 ".repeat(4))).toBe(true); // invalid (too many digits) AND long
    expect(contactTruncated("facebook", long)).toBe(true); // a typed 51-char name IS cut
    expect(contactTruncated("facebook", "https://www.facebook.com/profile.php?id=100012345678901")).toBe(false); // link → fb:<id>
    expect(contactTruncated("facebook", "https://www.facebook.com/people/Juan-Dela-Cruz-Santos-Reyes-Of-Manila/100012345678901/")).toBe(false);
    expect(contactTruncated("whatsapp", "+886 912 345 678")).toBe(false);
    expect(contactTruncated("whatsapp", "1".repeat(51))).toBe(true); // invalid AND long
  });
});

describe("input vs saved limits", () => {
  it("the picker input takes 300 raw chars (a long Facebook link must arrive whole); the saved value is still ≤ 50", () => {
    expect(RAW_INPUT_MAX).toBe(300);
    expect(CONTACT_MAX_LEN).toBe(50);
    const link = "https://www.facebook.com/profile.php?id=100012345678901"; // 55 chars — longer than col J
    expect(link).toHaveLength(55);
    expect(normalizeContact("facebook", link)).toBe("fb:100012345678901");
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
    expect(contactLink("line", "0912345678", MSG)).toEqual({ kind: "copy", text: MSG, contact: "0912345678" }); // all digits = a phone number: never a line.me link
    expect(contactLink("line", "@12345678", MSG)).toMatchObject({ kind: "copy" });
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

describe("Facebook parsing — audit leftovers (polish)", () => {
  it("a. more reserved first segments", () => {
    for (const w of ["about", "terms", "policy", "policies", "careers", "legal", "directory", "mobile", "games", "campaign", "security", "safety", "community", "support", "hacked", "adsmanager", "insights", "commerce", "shops", "weather", "fundraiser", "tools", "developers"]) {
      expect(fbReserved(w), w).toBe(true);
      expect(parseFacebookLink(`https://www.facebook.com/${w}`), w).toBe("");
      expect(contactLink("facebook", w, "msg"), w).toEqual({ kind: "copy", text: "msg", contact: w });
    }
  });
  it("b. FB_USERNAME starts and ends with a letter/digit, 5–50 long", () => {
    for (const bad of ["....", ".....", "juan.", "..juan", ".juan.", "juan"]) {
      expect(FB_USERNAME.test(bad), bad).toBe(false);
      expect(parseFacebookLink(`https://www.facebook.com/${bad}`), bad).toBe("");
      expect(contactLink("facebook", bad, "msg")?.kind, bad).toBe("copy");
    }
    expect(FB_USERNAME.test("a".repeat(51))).toBe(false);
    expect(parseFacebookLink(`https://www.facebook.com/${"a".repeat(51)}`)).toBe("");
    for (const ok of ["juan.delacruz.7", "a.b.c", "12345", "a".repeat(50)]) expect(FB_USERNAME.test(ok), ok).toBe(true);
  });
  it("c. a TYPED value that looks like a website (.com/.net/.org/.com.tw/.com.ph) → copy only; a username from a real link, and old stored .tw/.ph/.me/.co values, open m.me", () => {
    for (const w of ["shop.com", "mypage.net", "ngo.org", "store.com.tw", "tindahan.com.ph", "SHOP.COM"]) {
      expect(FB_WEBSITE.test(w), w).toBe(true);
      expect(contactLink("facebook", w, "msg"), w).toEqual({ kind: "copy", text: "msg", contact: w });
    }
    for (const w of ["anne.tw", "rose.ph", "its.me", "maria.co", "app.io", "brand.co", "joy.reyes.90", "shop.company"]) {
      expect(FB_WEBSITE.test(w), w).toBe(false);
      expect(contactLink("facebook", w, "msg"), w).toEqual({ kind: "open", url: `https://m.me/${w}`, copy: "msg" }); // same as main
    }
    // the same ending coming out of a real Facebook / m.me / messenger.com link keeps its Messenger button
    for (const l of ["https://www.facebook.com/shop.com", "https://m.me/store.com.tw", "https://www.messenger.com/t/mypage.net", "facebook.com/anne.tw", "m.me/maria.co"]) {
      const a = contactLink("facebook", l, "msg");
      expect(a?.kind, l).toBe("open");
      expect((a as { url: string }).url, l).toMatch(/^https:\/\/m\.me\//);
    }
  });
  it("d. ids are at most 20 digits everywhere", () => {
    const id20 = "1".repeat(20); const id21 = "1".repeat(21);
    expect(parseFacebookLink(`https://www.facebook.com/profile.php?id=${id20}`)).toBe(`fb:${id20}`);
    expect(parseFacebookLink(`https://www.facebook.com/profile.php?id=${id21}`)).toBe("");
    expect(parseFacebookLink(`https://www.facebook.com/people/Juan/${id21}/`)).toBe("");
    expect(parseFacebookLink(`https://www.facebook.com/messages/t/${id21}`)).toBe("");
    expect(parseFacebookLink(`https://www.facebook.com/p/Juan-Shop-${id21}/`)).toBe("");
    expect(parseFacebookLink(`https://www.facebook.com/${id21}`)).toBe("");
    expect(parseFacebookLink(`https://m.me/${id21}`)).toBe("");
    expect(contactLink("facebook", `fb:${id20}`, "msg")?.kind).toBe("open");
    expect(contactLink("facebook", `fb:${id21}`, "msg")).toEqual({ kind: "copy", text: "msg", contact: `fb:${id21}` });
  });
  it("e. the #fragment is dropped before the query is read", () => {
    expect(parseFacebookLink("https://www.facebook.com/profile.php?id=123#about")).toBe("fb:123");
    expect(parseFacebookLink("https://www.facebook.com/profile.php#?id=1")).toBe("");
    expect(parseFacebookLink("https://www.facebook.com/juan.delacruz.7#about")).toBe("juan.delacruz.7");
    expect(parseFacebookLink("https://www.facebook.com/share/19tvMLYXPi/#x")).toBe("fbshare:19tvMLYXPi");
  });
  it("f. m.me/<digits> and messenger.com/t/<digits> → fb:<id>; fb.watch links are refused", () => {
    expect(parseFacebookLink("https://m.me/100012345678901")).toBe("fb:100012345678901");
    expect(parseFacebookLink("https://www.messenger.com/t/100012345678901")).toBe("fb:100012345678901");
    expect(parseFacebookLink("messenger.com/t/100012345678901/")).toBe("fb:100012345678901");
    expect(parseFacebookLink("https://www.messenger.com/t/juan.delacruz.7")).toBe("juan.delacruz.7"); // messenger.com/t/<username>
    expect(parseFacebookLink("https://www.messenger.com/e2ee/t/100012345678901")).toBe("fb:100012345678901"); // e2ee chat link
    expect(parseFacebookLink("https://www.messenger.com/e2ee/t/juan.delacruz.7")).toBe(""); // e2ee takes an id only
    expect(parseFacebookLink("https://www.messenger.com/t/share")).toBe(""); // reserved stays refused
    expect(parseFacebookLink("https://www.messenger.com/t/" + "1".repeat(21))).toBe("");
    expect(parseFacebookLink("https://www.messenger.com/juan.delacruz.7")).toBe("");
    expect(contactLink("facebook", "https://www.messenger.com/t/juan.delacruz.7", "msg")).toEqual({ kind: "open", url: "https://m.me/juan.delacruz.7", copy: "msg" });
    expect(isFacebookLink("https://fb.watch/abc123/")).toBe(true);
    expect(parseFacebookLink("https://fb.watch/abc123/")).toBe("");
    expect(contactError("facebook", "https://fb.watch/abc123/")).toBe("facebook");
    expect(contactError("facebook", "https://m.me/100012345678901")).toBe("");
    expect(normalizeContact("facebook", "https://www.messenger.com/t/100012345678901")).toBe("fb:100012345678901");
  });
});
