// Help bot contracts: no personal name in seller-facing text, every help-chat string in all 8
// languages, the guide's format, and the /support/ask wiring in server.js (no runtime harness).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildT } from "../../i18n";

const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"] as const;
const i18nSrc = readFileSync("src/redesign/i18n/index.tsx", "utf8");
const keys = [...i18nSrc.matchAll(/^ {2}(rd_h[bc]_\w+|rd_adm_ctrl_helpchat):/gm)].map((m) => m[1]);
const guide = readFileSync("docs/support/sfl-guide.md", "utf8");
const server = readFileSync("server.js", "utf8");
const route = server.slice(server.indexOf('app.post("/support/ask"'), server.indexOf("async function supportGuideRecheck"));

describe("naming rule", () => {
  it("help-chat strings never say Jeff, in any language", () => {
    expect(keys.length).toBeGreaterThan(40);
    for (const l of LANGS) {
      const t = buildT(l) as unknown as Record<string, string>;
      for (const k of keys) expect(t[k], `${l}.${k}`).not.toMatch(/jeff/i);
    }
  });
  it("the guide never says Jeff", () => {
    expect(guide).not.toMatch(/jeff/i);
  });
  it("the bot's own text and prompt never say Jeff", () => {
    const bot = readFileSync("server/helpBot.js", "utf8").split("\n").filter((l) => !l.trim().startsWith("//") && !l.includes("/\\bJeff\\b/gi"));
    expect(bot.join("\n")).not.toMatch(/jeff/i);
  });
});

describe("i18n", () => {
  it("every help-chat key is filled in all 8 languages", () => {
    for (const l of LANGS) {
      const t = buildT(l) as unknown as Record<string, string>;
      for (const k of keys) expect(String(t[k] || "").trim(), `${l}.${k}`).not.toBe("");
    }
  });
});

describe("guide", () => {
  it("every section has an id heading, a Last checked date and keywords", () => {
    const sections = guide.split(/^## /m).slice(1);
    expect(sections.length).toBeGreaterThan(20);
    for (const s of sections) {
      expect(s.split("\n")[0]).toMatch(/^[a-z0-9-]+ — .+/);
      expect(s).toMatch(/^Last checked: \d{4}-\d{2}-\d{2}$/m);
      expect(s).toMatch(/^Keywords: .+$/m);
    }
  });
  it("no UNSURE: lines left, no prices, free plan = 20 with no reset", () => {
    expect(guide).not.toMatch(/UNSURE:/);
    expect(guide).not.toMatch(/NT\$\s?\d|\bWise\b|100 (free )?orders/i);
    expect(guide).toContain("20 orders in total");
  });
  it("no secrets, switch names or server details", () => {
    expect(guide).not.toMatch(/support_ai|_enabled|app_settings|supabase|service[_ ]role|ANTHROPIC|Render|honeypot|eyJ/i);
  });
});

describe("/support/ask wiring (server.js)", () => {
  it("requires auth, takes the user from the JWT, checks switch + preview before anything", () => {
    expect(route).toMatch(/app\.post\("\/support\/ask", requireAuth, async/);
    expect(route.indexOf("helpBotAllowed(req)")).toBeLessThan(route.indexOf("answerQuestion("));
    expect(route).toContain('status(403).json({ success: false, error: "not_available" })');
    expect(route).toContain("userId: req.authUserId");
    expect(route).not.toMatch(/req\.body[^\n]*user_?id/i);
    const allowed = server.slice(server.indexOf("async function helpBotAllowed"), server.indexOf('app.post("/support/ask"'));
    expect(allowed).toContain('readSetting("support_ai_enabled")) !== "true"');
    expect(allowed).toContain('"support_ai_preview"');
  });
  it("the reply carries only id, source, answer, saved, contact — never model or cost", () => {
    const replies = [...route.matchAll(/res\.json\(\{([^}]*)\}\)/g)].map((m) => m[1]);
    const ok = replies.find((r) => r.includes("success: true"));
    expect(ok?.replace(/\s/g, "")).toBe("success:true,id:r.id,source:r.source,answer:r.answer,saved:r.saved,contact:r.contact");
    for (const r of replies) expect(r).not.toMatch(/model|cost|tokens|review/);
  });
  it("logs codes only — never the question, answer, email or token", () => {
    const logs = [...route.matchAll(/console\.log\(([^\n]*)\)/g)].map((m) => m[1]);
    for (const l of logs) expect(l).not.toMatch(/question|answer|email|token|body/i);
  });
  it("is outside the coded-error routes (plain error words for the app)", () => {
    expect(readFileSync("server/errorCodes.js", "utf8")).not.toContain('"/support"');
  });
});
