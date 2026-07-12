// OFF-LATCH FIX contract (Jeff live-repro, 2026-07-12) — deterministic
// permanent-gray bug: Disconnect (local ttOff latch) → switch account →
// Connect ok → pill NEVER greens, because ttConnected never TRANSITIONS
// (the local Disconnect has no server unbind, so the platform stays
// connected:true throughout) and the latch's only other clear is the
// ttConnected-change effect.
//
// The fix is two setState calls placed inside RedesignApp's TWO connect
// entry points — not reachable by a unit render (full-app harness), so this
// suite pins the SOURCE CONTRACT (same pattern as the iosGates RedesignApp-
// level gates): both doors clear the latch ON SUCCESS ONLY, and the
// transition-effect clear still exists for the fresh-status path.
//   door 1: doConnect (picker Connect button)
//   door 2: handleConnect (ConnectModal — doConnect early-returns here when
//           no account is registered; without this clear the bug returns
//           through the add-account flow)
// FAILED connects must NOT clear (attempt-time clear = mislabeled green under
// the newly selected account while the OLD account's connection is alive).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../RedesignApp.tsx"), "utf8");

// Slice a top-level function body by name (brace-balanced from its arrow).
const sliceFn = (name: string): string => {
  const start = src.indexOf(`const ${name} = async (`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  let depth = 0, i = src.indexOf("{", start);
  const open = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(open, i + 1);
};

describe("off-latch contract — every connect door voids the local Disconnect on SUCCESS", () => {
  it("door 1 (doConnect): success-gated setOff(false) present", () => {
    const body = sliceFn("doConnect");
    expect(body).toMatch(/if \(r\.ok\) setOff\(false\);/);
    // and the Disconnect gesture itself still exists (the latch being cleared)
    expect(body).toMatch(/setOff\(true\)/);
  });

  it("door 2 (handleConnect / ConnectModal): success-gated platform-scoped clear present", () => {
    const body = sliceFn("handleConnect");
    expect(body).toMatch(/if \(r\.ok\) \(platform === "TikTok" \? setTtOff : setFbOff\)\(false\);/);
  });

  it("failure never clears: no unconditional setOff(false)/setTtOff(false) outside an r.ok gate in either door", () => {
    for (const name of ["doConnect", "handleConnect"]) {
      const body = sliceFn(name);
      const clears = body.match(/set(?:Off|TtOff|FbOff)[^\n]*\(false\)|\? setTtOff : setFbOff\)\(false\)/g) || [];
      for (const c of clears) {
        // every latch clear in the connect doors must sit on an `if (r.ok)` line
        const line = body.split("\n").find((l) => l.includes(c.slice(0, 20)));
        expect(line, `unguarded latch clear in ${name}: ${c}`).toMatch(/if \(r\.ok\)/);
      }
    }
  });

  it("the transition-effect clear (fresh open path) is still in place", () => {
    expect(src).toMatch(/useEffect\(\(\) => \{ setTtOff\(false\); \}, \[ttConnected\]\);/);
    expect(src).toMatch(/useEffect\(\(\) => \{ setFbOff\(false\); \}, \[fbConnected\]\);/);
  });
});
