// 7-11 login walk (server/pcLoginWalk.js) — diagnostic only, GET only.
// ⚠️ Fake fetch only. The pages below are made up; NO real request to 7-11 / uniOPEN was made.
import { describe, it, expect, vi } from "vitest";
import {
  runPcLoginWalk, readPage, scriptPathsOf, isAllowedWalkHost, PC_WALK_PARSE_MS,
  PC_WALK_START_URL, PC_WALK_MAX_SCRIPTS_FETCHED, PC_WALK_MAX_REQUESTS,
} from "../../../../server/pcLoginWalk.js";
import { PC_PROBE_BODY_MAX } from "../../../../server/pcServerProbe.js";

const ON = { PC_SERVER_PROBE: "1", PC_PROBE_MYSHIP_COOKIE: "auth=MARKENVCOOKIE" };
// none of these may ever show up in a log line
const MARKS = ["MARKVALUE", "MARKCOOKIE", "MARKQUERY", "MARKFRAG", "MARKENVCOOKIE", "MARKHIDDEN"];

type Reply = { status?: number; ct?: string; body?: string; location?: string; cookies?: string[] };
type Call = { url: string; host: string; path: string; init: { method?: string; body?: unknown; headers?: Record<string, string> } };
const reply = (r: Reply) => ({
  status: r.status ?? 200,
  headers: {
    get: (k: string) => (k.toLowerCase() === "content-type" ? r.ct ?? "text/html; charset=utf-8" : k.toLowerCase() === "location" ? r.location ?? null : null),
    getSetCookie: () => r.cookies ?? [],
  },
  text: async () => r.body ?? "",
});
function site(routes: Record<string, Reply>) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string, init: Call["init"]) => {
    const u = new URL(url);
    calls.push({ url, host: u.hostname, path: u.pathname, init });
    const r = routes[`${u.hostname}${u.pathname}`];
    return reply(r ?? { status: 404, body: "nf" });
  });
  return { calls, fetchImpl };
}
const run = (fetchImpl: unknown, env: Record<string, string> = ON) => {
  const logs: string[] = [];
  return runPcLoginWalk({ env, fetchImpl: fetchImpl as never, log: (l: string) => logs.push(l) }).then((out) => ({ out, logs }));
};

const LOGIN_PAGE = `<html><head>
<script src="/js/app.js?v=MARKQUERY"></script><script src="https://cdn.other.com/x.js"></script>
<script src="https://www.google.com/recaptcha/api.js"></script></head><body>
<form id="loginForm" method="post" action="/Account/Login?ReturnUrl=MARKQUERY#MARKFRAG">
  <input type="hidden" name="__RequestVerificationToken" value="MARKVALUE">
  <input type="text" name="Account" value="MARKVALUE">
  <input type="password" name="Password" value="MARKVALUE">
  <input type="text" name="bad name&lt;" value="MARKHIDDEN">
  <img src="/Captcha/Image?id=MARKQUERY">
  <input name="ValidateCode">
  <button type="submit">登入</button>
</form>
<p>請輸入驗證碼 或 快速登入</p></body></html>`;

describe("pcLoginWalk", () => {
  it("off = no request, nothing logged", async () => {
    const { fetchImpl } = site({});
    const { out, logs } = await run(fetchImpl, { PC_SERVER_PROBE: "0" });
    expect(out.skipped).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logs).toEqual([]);
  });

  it("follows redirects by hand, GET only, never a body, logs names and words only", async () => {
    const { calls, fetchImpl } = site({
      "myship.7-11.com.tw/Member/Login/": { status: 302, location: "https://member.uniopen.com/login/start?client=MARKQUERY#MARKFRAG", cookies: ["ms=MARKCOOKIE1; path=/"] },
      "member.uniopen.com/login/start": { status: 302, location: "/Account/Login?x=MARKQUERY", cookies: ["u1=MARKCOOKIE2; path=/"] },
      "member.uniopen.com/Account/Login": { body: LOGIN_PAGE },
    });
    const { logs } = await run(fetchImpl);
    expect(calls[0].url).toBe(PC_WALK_START_URL);
    for (const c of calls) {
      expect(c.init.method).toBe("GET");
      expect(c.init.body).toBeUndefined();
      expect(String(c.init.headers?.cookie ?? "")).not.toContain("MARKENVCOOKIE");
    }
    // a cookie goes back only to the host that set it
    expect(calls[1].init.headers?.cookie).toBeUndefined();
    expect(calls[2].init.headers?.cookie).toBe("u1=MARKCOOKIE2");
    const all = logs.join("\n");
    for (const m of MARKS) expect(all).not.toContain(m);
    expect(logs[0]).toBe("[PC_LOGIN_WALK] hop=1 host=myship.7-11.com.tw path=/Member/Login/ http=302 bytes=0 ct=text/html");
    expect(logs[1]).toContain("hop=2 host=member.uniopen.com path=/login/start http=302");
    expect(logs[2]).toContain("hop=3 host=member.uniopen.com path=/Account/Login http=200");
    expect(all).toContain("form i=1 id=loginForm method=POST action=member.uniopen.com/Account/Login fields=__RequestVerificationToken:hidden,Account:text,Password:password,?:text,ValidateCode:text,-:submit");
    expect(all).toContain("captcha_img=yes path=/Captcha/Image");
    expect(all).toContain("flags recaptcha=yes hcaptcha=no turnstile=no 驗證碼=yes OTP=no 簡訊=no 快速登入=yes");
    expect(all).toContain("scripts=/js/app.js");
    // a page with fields is not a JS app: no script is fetched
    expect(calls).toHaveLength(3);
  });

  it("a host outside the list stops the walk with refused host=…", async () => {
    const { calls, fetchImpl } = site({
      "myship.7-11.com.tw/Member/Login/": { status: 302, location: "https://evil.example.com/steal?MARKQUERY" },
    });
    const { logs } = await run(fetchImpl);
    expect(calls).toHaveLength(1);
    expect(logs).toContain("[PC_LOGIN_WALK] refused host=evil.example.com");
    expect(logs.join("\n")).not.toContain("MARKQUERY");
    expect(isAllowedWalkHost("uniopen.com.tw")).toBe(true);
    expect(isAllowedWalkHost("a.openpoint.com.tw")).toBe(true);
    expect(isAllowedWalkHost("evil-uniopen.com")).toBe(false);
    expect(isAllowedWalkHost("uniopen.com.evil.com")).toBe(false);
  });

  it("JS app: at most 3 first-party scripts fetched, 1 MB cap, paths only", async () => {
    const big = "x".repeat(PC_PROBE_BODY_MAX + 1);
    const js = `fetch("/api/Member/OtpSend?x=MARKQUERY"); const a='https://member.uniopen.com/auth/device/check'; var b="/static/logo.png"; var c="/oauth/token"; var d="MARKVALUE";`;
    const app = `<html><body><div id="root"></div>${[1, 2, 3, 4, 5].map((n) => `<script src="/s${n}.js"></script>`).join("")}</body></html>`;
    const { calls, fetchImpl } = site({
      "myship.7-11.com.tw/Member/Login/": { status: 302, location: "https://login.openpoint.com.tw/" },
      "login.openpoint.com.tw/": { body: app },
      "login.openpoint.com.tw/s1.js": { body: js, ct: "application/javascript" },
      "login.openpoint.com.tw/s2.js": { body: big, ct: "application/javascript" },
      "login.openpoint.com.tw/s3.js": { body: js, ct: "application/javascript" },
    });
    const { logs } = await run(fetchImpl);
    const scriptCalls = calls.filter((c) => c.path.endsWith(".js"));
    expect(scriptCalls.map((c) => c.path)).toEqual(["/s1.js", "/s2.js", "/s3.js"]);
    expect(PC_WALK_MAX_SCRIPTS_FETCHED).toBe(3);
    expect(calls.length).toBeLessThanOrEqual(PC_WALK_MAX_REQUESTS);
    const all = logs.join("\n");
    expect(all).toContain("script=/s2.js http=200 bytes=too_big found=0");
    expect(all).toContain("script_paths=/api/Member/OtpSend,/auth/device/check,/oauth/token");
    for (const m of MARKS) expect(all).not.toContain(m);
  });

  it("readPage and scriptPathsOf keep only safe names and paths", () => {
    const p = readPage(LOGIN_PAGE, "https://member.uniopen.com/Account/Login?q=MARKQUERY");
    expect(JSON.stringify({ ...p, scriptUrls: [] })).not.toMatch(/MARK/);
    expect(scriptPathsOf(`"/a/login" "/b/<script>/auth" "/plain/path" 'https://x.com/verify/sms?MARKQUERY'`)).toEqual(["/a/login", "/verify/sms"]);
  });

  describe("hostile 1 MB pages: linear time + clock guard", () => {
    const MB = 1024 * 1024;
    const fill = (unit: string) => unit.repeat(Math.ceil(MB / unit.length)).slice(0, MB);
    const fastest = (fn: () => void) => {
      let best = Infinity;
      for (let r = 0; r < 3; r++) { const t = performance.now(); fn(); best = Math.min(best, performance.now() - t); }
      return best;
    };
    const SHAPES: Record<string, string> = {
      "<input with no >": fill("<input "),
      "<script a ×N": fill("<script a"),
      "<img src=x ×N": fill("<img src=x "),
    };
    for (const [label, page] of Object.entries(SHAPES)) {
      it(`readPage: ${label} (1 MB) under 300 ms`, () => {
        const ms = fastest(() => readPage(page, "https://member.uniopen.com/login"));
        console.log(`[timing] readPage ${label}: ${ms.toFixed(1)} ms`);
        expect(ms).toBeLessThan(300);
      });
    }
    it("scriptPathsOf: 1 MB of unclosed quotes under 300 ms", () => {
      const ms = fastest(() => scriptPathsOf(fill('"' + "a".repeat(299))));
      console.log(`[timing] scriptPathsOf unclosed quotes: ${ms.toFixed(1)} ms`);
      expect(ms).toBeLessThan(300);
    });
    it("past the budget: what was read so far, slow = true", () => {
      const p = readPage(fill("<input name=a>"), "https://member.uniopen.com/login", { budgetMs: -1 });
      expect(p.slow).toBe(true);
      expect(readPage(LOGIN_PAGE, "https://member.uniopen.com/login").slow).toBe(false);
      expect(scriptPathsOf(fill('"/login/a" '), { budgetMs: -1 }).slow).toBe(true);
      expect(PC_WALK_PARSE_MS).toBe(250);
    });
    it("a tag with no > stops the read; a tag over 4000 chars is skipped", () => {
      const p = readPage(`<form id="f"><input name="a"><input name="b" ${"x".repeat(5000)}><input name="c"><input name="d"`, "https://member.uniopen.com/login");
      expect(p.forms[0].fields).toEqual(["a:text", "c:text"]);
    });
  });
});
