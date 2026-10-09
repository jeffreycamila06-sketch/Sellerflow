// Where the robot points — read from the repo itself, never typed in by hand:
//   app    = the production web address the phone apps load (mobile/capacitor.config.ts server.url)
//   server = the live server the app talks to (src/redesign/adapters/serverIdentity.ts)
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const REPO = join(__dirname, "..", "..", "..");

function pick(file: string, rx: RegExp, what: string): string {
  const m = rx.exec(readFileSync(join(REPO, file), "utf8"));
  if (!m) throw new Error(`Smoke robot: could not find the ${what} in ${file}`);
  return m[1];
}

// https://www.sellerflowlive.com (the origin of server.url, without the ?apk tag)
// ROBOT_APP_URL = a local dry run only (never set in the workflow).
export const APP_URL = process.env.ROBOT_APP_URL || new URL(pick("mobile/capacitor.config.ts", /url:\s*"(https:\/\/[^"]+)"/, "production app address")).origin;
// https://sellerflow-live-server.onrender.com (the address every non-local build uses)
// ROBOT_SERVER_URL = a local dry run only (never set in the workflow).
export const SERVER_URL = process.env.ROBOT_SERVER_URL || pick("src/redesign/adapters/serverIdentity.ts", /"(https:\/\/[a-z0-9-]+\.onrender\.com)"/, "live server address");

// Run-only files (saved login, console log, "already connected once" marker). Never uploaded.
export const RUN_DIR = join(__dirname, "..", ".run");
export const AUTH_FILE = join(RUN_DIR, "auth.json");
export const CONSOLE_FILE = join(RUN_DIR, "console.jsonl");
export const CONNECT_MARK = join(RUN_DIR, "tiktok-connect-attempted");
export const CREATED_FILE = join(RUN_DIR, "created.jsonl");

// The two secrets (GitHub Actions: E2E_EMAIL, E2E_PASSWORD). Never printed.
export function secrets(): { email: string; password: string } {
  const email = String(process.env.E2E_EMAIL || "").trim();
  const password = String(process.env.E2E_PASSWORD || "");
  if (!email || !password) throw new Error("Smoke robot: the E2E_EMAIL / E2E_PASSWORD secrets are missing — nothing was run.");
  return { email, password };
}

// A short id for this run, used in names the robot creates (so leftovers are easy to spot).
export const RUN_ID = (process.env.GITHUB_RUN_ID || String(Date.now())).slice(-6);
