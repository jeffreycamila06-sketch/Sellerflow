// What is sent to Facebook and what is stored as the receipt picture: main's server/fbReceipt.js
// vs this branch's, same inputs. Run:  node send-same-as-main.mjs <folder holding main's server/>
// (e.g. `git archive origin/main server src/lib package.json | tar -x -C <folder>` + a node_modules link).
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const mainDir = process.argv[2];
if (!mainDir) { console.error("give the folder that holds main's server/"); process.exit(2); }
const here = dirname(fileURLToPath(import.meta.url));
const branchDir = join(here, "..", "..", "..", "..");
const load = async (root) => ({
  r: await import(pathToFileURL(join(root, "server", "fbReceipt.js")).href),
  t: await import(pathToFileURL(join(root, "server", "fbTokens.js")).href),
});
const CONFIG = { enabled: true, appId: "555000111", appSecret: "sekret", tokenKey: "tk" };
const U = "aaaaaaaa-1111-2222-3333-444444444444", S = "11111111-2222-3333-4444-555555555555";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(4096, 9)]);
const sha = (b) => createHash("sha256").update(b).digest("hex");

async function play(mod, graphAnswer) {
  const rows = [], uploads = [], posts = [];
  const store = {
    hasReceiptAccess: async () => true,
    listReceiptOrders: async () => [{ comment_msg_id: "701_1", platform_meta: { page_id: "P1", live_video_id: "LV1", commenter_id: "24681357902468" }, handle: "Buyer", created_at: "2026-11-24T12:00:00Z" }],
    listReceiptRows: async (ids) => rows.filter((x) => ids.includes(String(x.comment_id))),
    insertReceipt: async (row) => { const x = { ...row, id: 100 + rows.length }; rows.push(x); return { id: x.id }; },
    updateReceipt: async (id, patch) => { Object.assign(rows.find((x) => x.id === id), patch); return {}; },
    deleteReceipt: async (id) => { const i = rows.findIndex((x) => x.id === id); if (i >= 0) rows.splice(i, 1); return true; },
    uploadReceiptImage: async (path, bytes) => { uploads.push({ path, sha: sha(Buffer.from(bytes)), n: bytes.length }); return `https://cdn.test/storage/v1/object/public/fb-receipts/${path}`; },
    getPage: async () => ({ user_id: U, page_id: "P1", active: true, can_message: true, access_token: mod.t.encryptToken("PAGE-TOKEN", CONFIG.tokenKey) }),
    setActive: async () => {},
  };
  const fetchImpl = async (url, init) => {
    if (String(init?.method || "GET") === "POST") { posts.push({ url: String(url), headers: JSON.stringify(init.headers || {}), body: String(init.body) }); return graphAnswer; }
    return { status: 400, json: async () => ({ error: { code: 200 } }) }; // any read: refused
  };
  const api = mod.r.createFbReceipt({ config: CONFIG, store, fetchImpl, now: () => Date.parse("2026-11-24T13:30:00Z"), log: () => {}, randomHex: () => "f".repeat(64) });
  const answer = await api.send(U, { sessionId: S, buyerNumber: 3, imagePngBase64: PNG.toString("base64") });
  if (api._ownerReadDone) await api._ownerReadDone();
  const row = rows[0] ? { status: rows[0].status, error_code: rows[0].error_code ?? null, image_path: rows[0].image_path ?? null, message_id: rows[0].message_id ?? null, comment_id: rows[0].comment_id, page_id: rows[0].page_id } : null;
  return { answer, posts, uploads, row };
}
const CASES = {
  "sent": { status: 200, json: async () => ({ message_id: "m_1", recipient_id: "24681357902468" }) },
  "refused 10/2018300 (another app holds the chat)": { status: 400, json: async () => ({ error: { code: 10, error_subcode: 2018300, message: "(#10) another app is controlling this thread now", type: "OAuthException" } }) },
  "refused 100/1893060": { status: 400, json: async () => ({ error: { code: 100, error_subcode: 1893060, message: "x", type: "OAuthException" } }) },
  "refused 10903 (no private reply)": { status: 400, json: async () => ({ error: { code: 10903, error_subcode: 2018278, message: "x" } }) },
  "rate limit 613 (comment given back)": { status: 400, json: async () => ({ error: { code: 613, message: "x" } }) },
};
const main = await load(mainDir), branch = await load(branchDir);
let bad = 0;
for (const [name, graph] of Object.entries(CASES)) {
  const a = await play(main, graph), b = await play(branch, graph);
  const same = (k) => JSON.stringify(a[k]) === JSON.stringify(b[k]);
  const line = ["posts", "uploads", "answer", "row"].map((k) => `${k} ${same(k) ? "same" : "DIFFERENT"}`).join(" · ");
  if (!["posts", "uploads", "answer", "row"].every(same)) bad++;
  console.log(`${bad ? "" : ""}${name}: ${line}  (message requests: ${b.posts.length}, picture ${b.uploads[0]?.n ?? 0} bytes ${String(b.uploads[0]?.sha || "").slice(0, 12)})`);
}
console.log(bad ? `\n${bad} case(s) DIFFERENT` : "\nall 5 cases: the request to Facebook, the stored picture, the answer to the app and the saved row are the same as main");
process.exit(bad ? 1 : 0);
