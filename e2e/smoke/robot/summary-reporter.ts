// Writes one plain table to the GitHub run page (Summary tab): Test | Result | Why.
// PASS = it works. FAIL = something to look at. SKIPPED = not checked, with the reason.
// The account email never appears (it is replaced by [email] if it ever shows up).
import type { FullResult, Reporter, TestCase, TestError, TestResult } from "@playwright/test/reporter";
import { appendFileSync } from "node:fs";

const COLOR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"); // terminal color codes
const clean = (s: string): string => {
  let out = String(s || "").replace(COLOR, "").split("\n").find((l) => l.trim()) || "";
  const e = String(process.env.E2E_EMAIL || "").trim();
  if (e) out = out.split(e).join("[email]").split(e.toLowerCase()).join("[email]");
  return out.replace(/\|/g, "/").slice(0, 300);
};

class SummaryReporter implements Reporter {
  private rows = new Map<string, { title: string; result: string; why: string }>();

  private stopped = "";

  // A stop before any test (login failed, SAFETY STOP, time limit) lands here, not on a test.
  onError(error: TestError): void {
    if (!this.stopped) this.stopped = clean(error.message || error.value || "");
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    // Annotations added while the test runs live on the result; the declared ones on the test.
    const all = [...(test.annotations || []), ...(((result as unknown as { annotations?: TestCase["annotations"] }).annotations) || [])];
    const notes = [...new Set(all.filter((a) => a.type === "note").map((a) => a.description || ""))];
    let row: { title: string; result: string; why: string };
    if (result.status === "skipped") {
      const skip = [...all].reverse().find((a) => a.type === "skip");
      row = { title: test.title, result: "⏭️ SKIPPED", why: clean(skip?.description || "not run") };
    } else if (result.status === "passed") {
      row = { title: test.title, result: result.retry > 0 ? "✅ PASS (on the 2nd try)" : "✅ PASS", why: clean(notes.join(" · ")) };
    } else {
      row = { title: test.title, result: "❌ FAIL", why: clean(result.error?.message || result.status) };
    }
    // A failed try followed by a skipped try stays a FAIL (the skip must never hide it).
    const before = this.rows.get(test.id);
    if (before && before.result.startsWith("❌") && result.status === "skipped") return;
    this.rows.set(test.id, row);
  }

  onEnd(result: FullResult): void {
    if (!this.rows.size && result.status === "passed") return; // e.g. --list: nothing ran
    const lines = [
      `## Smoke robot — ${result.status === "passed" ? "✅ all good" : "❌ something needs a look"}`,
      "",
      "| Test | Result | Why / note |",
      "|---|---|---|",
      ...(this.stopped ? [`| (before the tests) | ❌ STOPPED | ${this.stopped} |`] : []),
      ...[...this.rows.values()].map((r) => `| ${r.title} | ${r.result} | ${r.why} |`),
      "",
    ];
    const file = process.env.GITHUB_STEP_SUMMARY;
    if (file) appendFileSync(file, lines.join("\n") + "\n");
    else console.log(lines.join("\n"));
  }
}

export default SummaryReporter;
