// Product-picture cleanup (sql/95 bucket "product-images", path "{auth.uid()}/{local_id}.jpg").
// Deletes picture files that no products.image_path points to any more — left behind by the
// purge-stale-products cron, an account delete (admin-delete-user never touches Storage), a
// delete made while product_images_enabled was off, or a failed removal from the phone.
//
// Safety rules:
//  - a file is deleted only when NO products row references its exact path AND it was last
//    written more than 24 h ago (an upload lands before image_path is saved, so a fresh file
//    can briefly be unreferenced); a file with no readable timestamp is kept;
//  - if the referenced-paths read fails, nothing is deleted (never delete on an unknown);
//  - at most MAX_DELETES per run; logs counts only, never names.
//
// Triggered by cron-job.org (daily), see server.js POST /admin/product-images-sweep:
//   POST https://sellerflow-live-server.onrender.com/admin/product-images-sweep
//   header X-Poll-Token: <PRODUCT_IMAGES_SWEEP_TOKEN>   (Render env only, never in the repo)
//   schedule: daily 03:30 Asia/Taipei. On/off: app_settings.product_images_sweep_enabled
//   (seeded 'false' by sql/98; anything but the exact string 'true' = off → 204, no work).

export const SWEEP_BUCKET = "product-images";
export const SWEEP_GRACE_MS = 24 * 60 * 60 * 1000;
export const SWEEP_MAX_DELETES = 1000;

// Last write time of a listed file (ms), or NaN when unknown.
export function lastWriteMs(file) {
  const ts = [file?.updated_at, file?.created_at].map((v) => Date.parse(String(v ?? ""))).filter((n) => Number.isFinite(n));
  return ts.length ? Math.max(...ts) : NaN;
}

// PURE: which paths of one folder may go. files = Storage list entries of that folder.
export function orphanPaths(folder, files, referenced, nowMs, graceMs = SWEEP_GRACE_MS) {
  const out = [];
  for (const f of files || []) {
    if (!f || !f.id || !f.name) continue;              // sub-folders / placeholders have no id
    const path = `${folder}/${f.name}`;
    if (referenced.has(path)) continue;
    const t = lastWriteMs(f);
    if (!Number.isFinite(t) || nowMs - t <= graceMs) continue;
    out.push(path);
  }
  return out;
}

// store: { referencedPaths(): Promise<Set<string>|null>, listFolders(): Promise<string[]|null>,
//          listFiles(folder): Promise<object[]|null>, remove(paths): Promise<boolean> }
export async function sweepProductImages({ store, now = () => Date.now(), graceMs = SWEEP_GRACE_MS, maxDeletes = SWEEP_MAX_DELETES, log = (_msg) => {} }) {
  const res = { ok: false, folders: 0, files: 0, orphans: 0, deleted: 0, failedFolders: 0 };
  let referenced = null;
  try { referenced = await store.referencedPaths(); } catch { referenced = null; }
  if (!(referenced instanceof Set)) { log(`[PRODUCT-IMG-SWEEP] referenced paths unreadable — nothing deleted`); return res; }
  let folders = null;
  try { folders = await store.listFolders(); } catch { folders = null; }
  if (!Array.isArray(folders)) { log(`[PRODUCT-IMG-SWEEP] bucket list failed — nothing deleted`); return res; }
  const t = now();
  for (const folder of folders) {
    if (res.deleted >= maxDeletes) break;
    res.folders += 1;
    let files = null;
    try { files = await store.listFiles(folder); } catch { files = null; }
    if (!Array.isArray(files)) { res.failedFolders += 1; continue; }
    res.files += files.filter((f) => f && f.id).length;
    const gone = orphanPaths(folder, files, referenced, t, graceMs).slice(0, maxDeletes - res.deleted);
    res.orphans += gone.length;
    if (!gone.length) continue;
    let ok = false;
    try { ok = await store.remove(gone); } catch { ok = false; }
    if (ok) res.deleted += gone.length; else res.failedFolders += 1;
  }
  res.ok = true;
  log(`[PRODUCT-IMG-SWEEP] folders=${res.folders} files=${res.files} orphans=${res.orphans} deleted=${res.deleted} failedFolders=${res.failedFolders}`);
  return res;
}

// The real store over a service-role Supabase client.
export function makeSweepStore(sb, { pageSize = 1000 } = {}) {
  const bucket = () => sb.storage.from(SWEEP_BUCKET);
  const listAll = async (prefix) => {
    const out = [];
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await bucket().list(prefix, { limit: pageSize, offset, sortBy: { column: "name", order: "asc" } });
      if (error || !Array.isArray(data)) return null;
      out.push(...data);
      if (data.length < pageSize) return out;
    }
  };
  return {
    async referencedPaths() {
      const set = new Set();
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await sb.from("products").select("user_id,local_id,image_path").not("image_path", "is", null)
          .order("user_id", { ascending: true }).order("local_id", { ascending: true }).range(from, from + pageSize - 1);
        if (error || !Array.isArray(data)) return null;
        for (const r of data) if (r.image_path) set.add(String(r.image_path));
        if (data.length < pageSize) return set;
      }
    },
    async listFolders() {
      const top = await listAll("");
      return top ? top.filter((e) => e && !e.id && e.name).map((e) => String(e.name)) : null;
    },
    async listFiles(folder) { return listAll(folder); },
    async remove(paths) {
      const { error } = await bucket().remove(paths);
      return !error;
    },
  };
}

export async function readSweepSwitch(sb) {
  try {
    const { data, error } = await sb.from("app_settings").select("value").eq("key", "product_images_sweep_enabled").maybeSingle();
    return !error && !!data && data.value === "true";
  } catch { return false; }
}
