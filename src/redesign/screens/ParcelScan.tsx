// Parcel Scan (Phase A1, ADMIN-ONLY dogfood) — scan handwritten parcel slips.
// Owner photographs slips with the normal camera app, multi-picks them here,
// each photo is downscaled + sent (one at a time) to the admin-guarded
// /admin/parcel-scan vision endpoint, the extracted fields are confirmed/edited
// per parcel, and confirmed rows insert into parcel_scans. Per-parcel 7-11
// encoding + the status queue come in Phase A2 — this screen is scan → confirm
// → save plus a simple read-on-open list of saved rows (ZERO poll).
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { headerBar, headerTitle, card, mono } from "../ui";
import { useT, tpl } from "../i18n";
import {
  fileToScanBase64, scanParcel, saveParcelScan, loadParcelScans, formErrors, amountWarns, MIN_PARCEL_AMOUNT, MAX_PENDING_PARCELS,
  checkEmapStore, saveStoreCheck, scanToXlsRow, splitScansForExport, markScansExported, unmarkScansExported,
  deleteParcelScan, deleteExportedParcels, updateParcelScan, getCreditBalance,
  type ScanFields, type ScanConfidence, type ParcelScanRow, type ScanFormState, type StoreCheckStatus, type ExportReason,
} from "../adapters/parcelScan";
import { fetchShipTemplate, buildXlsmFromTemplate, deliverXlsm, exportFilename } from "../adapters/shippingExport";
import { loadGlobalShippingFee } from "../adapters/shippingSettings";
import { SHIP_DEFAULT_FEE } from "../adapters/shipping";
import { TELEGRAM_URL } from "../../lib/telegram";
import { cameraSupported, captureConstraints, triggerHaptic, stopStream, getUserMediaErrorName } from "../adapters/camera";
import { useWakeLock } from "../adapters/useWakeLock";

const input: CSSProperties = { width: "100%", padding: "10px 12px", border: "1px solid var(--border-strong)", borderRadius: 10, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600, outline: "none", boxSizing: "border-box" };
const lbl: CSSProperties = { fontSize: 11, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 4 };
const errTxt: CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "var(--danger)", marginTop: 3 };
const warnTxt: CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "var(--warn, #b45309)", marginTop: 3 };
const lowConfBorder = "1.5px solid var(--warn, #f59e0b)";

type Phase = "idle" | "scanning" | "confirm" | "error";

type FormState = ScanFormState;
const emptyForm: FormState = { name: "", phone: "", store: "", amount: "", notes: "" };

// E-Map verdict → row badge. valid/null are quiet (no badge). not_found is the
// actionable one (red); unknown + checking are grey/informational.
type BadgeKey = "rd_ps2_store_bad" | "rd_ps2_store_unknown" | "rd_ps2_store_checking";
function storeBadge(status: string | null): { icon: string; color: string; key: BadgeKey } | null {
  if (status === "not_found") return { icon: "❌", color: "var(--danger)", key: "rd_ps2_store_bad" };
  if (status === "unknown") return { icon: "⚠️", color: "var(--text-dim)", key: "rd_ps2_store_unknown" };
  if (status === "checking") return { icon: "⏳", color: "var(--text-dim)", key: "rd_ps2_store_checking" };
  return null; // valid | null → quiet
}

const fieldsToForm = (f: ScanFields): FormState => ({
  name: f.name ?? "",
  phone: f.phone ?? "",
  store: f.store_id ?? "",
  amount: f.amount === null ? "" : String(f.amount),
  notes: f.notes ?? "",
});
const formToFields = (f: FormState): ScanFields => ({
  name: f.name.trim() || null,
  phone: f.phone.trim() || null,
  store_id: f.store.trim() || null,
  amount: f.amount.trim() === "" ? null : Number(f.amount),
  notes: f.notes.trim() || null,
});

// Export attention reason → i18n key.
type ReasonKey = "rd_ps2_x_wrong_store" | "rd_ps2_x_bad_name" | "rd_ps2_x_bad_phone" | "rd_ps2_x_bad_store" | "rd_ps2_x_bad_amount";
const reasonKey = (r: ExportReason): ReasonKey =>
  r === "wrong_store" ? "rd_ps2_x_wrong_store"
    : r === "bad_name" ? "rd_ps2_x_bad_name"
      : r === "bad_phone" ? "rd_ps2_x_bad_phone"
        : r === "bad_store" ? "rd_ps2_x_bad_store"
          : "rd_ps2_x_bad_amount";

// manualOnly = a paying (non-admin) seller: hide the camera / AI-scan / credits
// surface entirely (not just disable) and show manual encode + an "AI … coming
// soon" line. Admins (manualOnly=false) get the full scan surface, no soon line.
export default function ParcelScan({ cur = "NT$", storeName = "", manualOnly = false }: { cur?: string; storeName?: string; manualOnly?: boolean }) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Batch cursor — files are scanned strictly one at a time.
  const [files, setFiles] = useState<File[]>([]);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [scanErr, setScanErr] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [confid, setConfid] = useState<Record<keyof ScanFields, ScanConfidence> | null>(null);
  const [rawExtraction, setRawExtraction] = useState<{ fields: ScanFields; confidence?: Record<keyof ScanFields, ScanConfidence> } | null>(null);
  const [saveErr, setSaveErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  // Scan Credits (1 credit = 1 scan). Read on open; the scan response returns the
  // fresh balance after each debit/refund so we update without a re-fetch.
  const [credits, setCredits] = useState<number | null>(null);

  // 賣貨便 export: default fee (one settings read on open) + busy + last summary.
  const [fee, setFee] = useState(SHIP_DEFAULT_FEE);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportErr, setExportErr] = useState("");
  const [exportSummary, setExportSummary] = useState<{ exported: number; attention: { name: string; reason: ExportReason }[] } | null>(null);

  // Saved list — ONE read on screen open; saves append locally (no refetch).
  const [rows, setRows] = useState<ParcelScanRow[]>([]);
  const [listLoaded, setListLoaded] = useState(false);
  // Saved-list tab (Change 2): "all" (default) | "wrong" (not_found only).
  const [tab, setTab] = useState<"all" | "wrong">("all");
  // Delete (Change 3): a pending confirmation + await/error state. Never fires
  // a delete without the confirm; a failed delete surfaces inline, no silent no-op.
  const [confirm, setConfirm] = useState<{ kind: "row"; id: string } | { kind: "exported" } | { kind: "export" } | { kind: "undo" } | null>(null);
  // FIX 5 — the most recent export run (batch id + the row ids it exported), so
  // an accidental export can be undone (rows → 'confirmed', back in the ready
  // list). Session-only: cleared on undo or another export; not restored across
  // reload (an "oops" affordance, not history). Pre-column exported rows have a
  // NULL batch id and are not covered — by design.
  const [lastExportBatch, setLastExportBatch] = useState<{ id: string; ids: string[] } | null>(null);
  const [undoErr, setUndoErr] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState("");
  // Feature 3: per-row EDIT — reuses the confirm form, pre-filled, updates the
  // existing row (no new scan, no credit charged). Only not-yet-exported rows.
  const [editing, setEditing] = useState<{ id: string } | null>(null);

  // In-app camera (web getUserMedia). Default ON where supported; a live video
  // element (videoRef) streams the rear camera while idle, a shutter captures a
  // still to `snapshot` for Use/Retake, and Use feeds the SAME onPick pipeline
  // (a File → fileToScanBase64 downscale → scan). No new native plugin.
  //  - cameraOn: seller intent (kept on; the "use photo library" link turns it off)
  //  - cameraErr: a getUserMedia failure/denial → fall back to the file picker
  //  - snapshot: a captured still awaiting Use/Retake (camera released while shown)
  //  - scanCount: parcels saved this screen session (a simple counter)
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(true);
  const [cameraErr, setCameraErr] = useState("");
  const [snapshot, setSnapshot] = useState<{ url: string; file: File } | null>(null);
  const [scanCount, setScanCount] = useState(0);
  // Manual encode — opens the SAME confirm form blank, no camera + no AI scan.
  // Continuous mode: Save keeps the form open (blank) for the next parcel;
  // manualCount tracks how many were manually saved this screen session
  // (separate from scanCount — a manual entry is NOT a scan).
  const [manual, setManual] = useState(false);
  const [manualCount, setManualCount] = useState(0);
  // Camera runs only while the tab/app is foregrounded (privacy + battery); a
  // visibilitychange effect drives this, and it re-acquires on return. retryTick
  // re-runs the acquire effect when the OS ends a track (e.g. a phone call).
  const [pageVisible, setPageVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  const [retryTick, setRetryTick] = useState(0);
  // FIX 1 — synchronous single-flight guard on the scan pipeline (mirrors
  // RedesignApp's entSubmittedRef): set at the top of beginScan BEFORE any
  // state/async, cleared when scanOne leaves the "scanning" phase (finally, so
  // confirm/error/insufficient/cancel all release it). Blocks a same-tick
  // double-tap of "Use" (or a rapid re-pick) from firing two charged scans.
  const scanInFlightRef = useRef(false);

  // Alive across the whole screen — guards fire-and-forget store-check verdicts
  // (runStoreCheck) that can land after unmount, not just the initial load.
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);
  useEffect(() => {
    loadParcelScans().then((r) => { if (aliveRef.current) { if (r.ok) setRows(r.rows); setListLoaded(true); } });
  }, []);
  // One read on open → the GLOBAL 運費 fee for the export col G (admin-owned,
  // app_settings). Fail-safe to SHIP_DEFAULT_FEE (38) on any read failure, never 0.
  useEffect(() => {
    loadGlobalShippingFee().then((f) => { if (aliveRef.current) setFee(f); });
  }, []);
  // One wallet read on open → the Scan Credits balance.
  useEffect(() => {
    if (manualOnly) return; // seller manual surface has no credits — don't fetch
    getCreditBalance().then((c) => { if (aliveRef.current && c.ok) setCredits(c.balance); });
  }, [manualOnly]);

  // FIX 2/3 — release the camera when the tab/app is backgrounded, re-acquire on
  // return, and clear a prior denial so a grant-in-Settings-then-return recovers
  // WITHOUT relaunching the app. Own listener (independent of useWakeLock's own
  // visibilitychange listener — multiple listeners coexist fine).
  useEffect(() => {
    const onVis = () => {
      const visible = document.visibilityState !== "hidden";
      setPageVisible(visible);
      if (visible) setCameraErr(""); // returning to the app → retry the camera (denial may now be granted)
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // In-app camera stream lifecycle. Runs ONLY while the camera UI is on screen:
  // idle (not scanning/confirming/erroring), not editing, not previewing a
  // still, camera intent on + supported + no prior error, credits remain
  // (credits === null = still loading → allowed; 0 = blocked), AND the page is
  // foregrounded. Any flip to false stops the tracks (camera light off) and
  // detaches the video. retryTick re-runs it after an OS-ended track.
  // Batch limit — pending = every row not yet exported (confirmed + wrong-code
  // alike). At the cap, NEW entries are blocked (camera/shutter/manual/picker/
  // new-row Save); EDIT + DELETE stay open. An export clears the queue → gates
  // reopen. exported rows never count.
  const pendingCount = rows.filter((r) => r.status !== "exported").length;
  const batchFull = pendingCount >= MAX_PENDING_PARCELS;
  const camActive = !manualOnly && cameraOn && cameraSupported() && !cameraErr && !editing && !manual && !snapshot && phase === "idle" && credits !== 0 && pageVisible && !batchFull;
  useEffect(() => {
    if (!camActive) return;
    let cancelled = false;
    const videoEl = videoRef.current; // committed before this effect runs; stable node for cleanup
    let track: MediaStreamTrack | null = null;
    // OS ended the track (phone call, another app grabbed the camera) → drop the
    // dead stream and, if still foregrounded, bump retryTick to re-acquire so the
    // video never sits frozen/black.
    const onEnded = () => {
      stopStream(streamRef.current); streamRef.current = null;
      if (!cancelled && typeof document !== "undefined" && document.visibilityState !== "hidden") setRetryTick((n) => n + 1);
    };
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(captureConstraints());
        if (cancelled) { stopStream(stream); return; }
        streamRef.current = stream;
        track = stream.getVideoTracks?.()[0] ?? null;
        if (track) track.addEventListener("ended", onEnded);
        if (videoEl) {
          videoEl.srcObject = stream;
          const p = videoEl.play();
          if (p && typeof p.then === "function") p.catch(() => {}); // autoplay-block / jsdom safe
        }
      } catch (e) {
        // Denied / no camera / old engine → record the code and fall back to the
        // file picker (the block below renders it when cameraErr is set).
        if (!cancelled) setCameraErr(getUserMediaErrorName(e));
      }
    })();
    return () => {
      cancelled = true;
      if (track) track.removeEventListener("ended", onEnded);
      stopStream(streamRef.current);
      streamRef.current = null;
      if (videoEl) videoEl.srcObject = null;
    };
  }, [camActive, retryTick]);

  // Keep the screen awake while actively scanning (camera open OR previewing a
  // still) — capture is client-side, a sleeping phone loses the session.
  // Graceful no-op where Wake Lock is unsupported (reuses the live-screen hook).
  useWakeLock(camActive || !!snapshot);

  // Free the preview object URL when it changes / on unmount (Use & Retake also
  // revoke eagerly; a second revoke is a harmless no-op).
  useEffect(() => () => { if (snapshot) URL.revokeObjectURL(snapshot.url); }, [snapshot]);

  const scanOne = async (list: File[], i: number) => {
    try {
      // Out of credits — don't spend a request that will 402; the blocked banner
      // (credits === 0) tells the owner to top up. Reset the batch.
      if (credits === 0) { setFiles([]); setIdx(0); setPhase("idle"); return; }
      setPhase("scanning"); setScanErr(""); setSaveErr("");
      try {
        const { base64, mediaType } = await fileToScanBase64(list[i]);
        const r = await scanParcel(base64, mediaType);
        // The server returns the fresh wallet balance on success, on a charged
        // (bad-photo) failure, and on 402 — reflect it whenever present.
        if (typeof r.balance === "number") setCredits(r.balance);
        if (r.insufficient) {
          // Out of Scan Credits — no scan happened. Stop the batch; the blocked
          // banner surfaces the top-up path (no Retry card, which would 402 again).
          setFiles([]); setIdx(0); setPhase("idle");
          return;
        }
        if (!r.ok || !r.fields) { setScanErr(r.error || "scan_failed"); setPhase("error"); return; }
        setForm(fieldsToForm(r.fields));
        setConfid(r.confidence ?? null);
        setRawExtraction({ fields: r.fields, confidence: r.confidence });
        setPhase("confirm");
      } catch {
        setScanErr("image_decode_failed"); setPhase("error");
      }
    } finally {
      // Leaving the "scanning" phase (confirm / error / insufficient / credits=0
      // / throw) → release the single-flight guard so the next parcel can scan.
      scanInFlightRef.current = false;
    }
  };

  // Shared entry into the scan pipeline (used by the file picker AND the in-app
  // camera). One File → fileToScanBase64 downscale → scan. ZERO adapter change.
  const beginScan = (list: File[]) => {
    if (!list.length) return;
    if (batchFull) return; // batch cap — export first (belt-and-suspenders; the entry buttons are already disabled)
    if (scanInFlightRef.current) return; // synchronous double-entry guard (double-tap Use / rapid re-pick)
    scanInFlightRef.current = true;
    setFiles(list); setIdx(0);
    void scanOne(list, 0);
  };

  const onPick = (picked: FileList | null) => {
    const list = Array.from(picked ?? []);
    if (fileRef.current) fileRef.current.value = ""; // re-picking the same files works
    beginScan(list);
  };

  // ── In-app camera ─────────────────────────────────────────────────────────
  // Shutter: full-resolution frame → JPEG File → preview (Use/Retake). Capture
  // large for legible handwriting; the scan adapter downscales to SCAN_MAX_EDGE.
  const shutter = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || !v.videoHeight) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    triggerHaptic(30); // optional shutter buzz (guarded no-op where unsupported)
    canvas.toBlob((blob) => {
      if (!blob || !aliveRef.current) return;
      const file = new File([blob], `parcel-${Date.now()}.jpg`, { type: "image/jpeg" });
      setSnapshot({ url: URL.createObjectURL(blob), file });
    }, "image/jpeg", 0.92);
  };
  // Use → run the SAME pipeline as the picker (charges one credit on scan).
  const usePhoto = () => {
    if (!snapshot) return;
    const file = snapshot.file;
    URL.revokeObjectURL(snapshot.url);
    setSnapshot(null);
    beginScan([file]);
  };
  // Retake → discard the still (FREE, no scan/credit); the effect restarts the stream.
  const retake = () => {
    if (snapshot) URL.revokeObjectURL(snapshot.url);
    setSnapshot(null);
  };

  const advance = () => {
    const next = idx + 1;
    setForm(emptyForm); setConfid(null); setRawExtraction(null); setSaveErr("");
    if (next < files.length) { setIdx(next); void scanOne(files, next); }
    else { setFiles([]); setIdx(0); setPhase("idle"); }
  };

  // Fire-and-forget E-Map store-code check for one saved row. Sets the local
  // row to "checking", asks the server, persists + reflects the verdict. Never
  // blocks the scan flow; any failure lands as "unknown" (grey badge).
  const runStoreCheck = (rowId: string, storeId: string) => {
    if (!/^\d{6}$/.test(storeId)) return;
    setRows((prev) => prev.map((x) => (x.id === rowId ? { ...x, storeCheckStatus: "checking" } : x)));
    void (async () => {
      const res = await checkEmapStore(storeId);
      const status: StoreCheckStatus = res.status;
      void saveStoreCheck(rowId, status); // best-effort persist
      // Unmount guard (mirrors the load effect's `alive`): a late verdict must
      // not setRows on an unmounted screen.
      if (aliveRef.current) setRows((prev) => prev.map((x) => (x.id === rowId ? { ...x, storeCheckStatus: status } : x)));
    })();
  };

  // Insert a NEW parcel row — shared by the scanned Save AND manual encode.
  // ⚠️ ZERO CREDIT: this only calls saveParcelScan (a direct parcel_scans
  // INSERT). It NEVER hits /admin/parcel-scan and NEVER touches
  // check_and_debit_credit — only scanParcel (the vision call) debits. Appends
  // the row locally + fires the same E-Map store-code check as a scan. Returns
  // ok. `rawExtraction` is null for manual entries (nullable column).
  const commitNewParcel = async (fields: ScanFields): Promise<boolean> => {
    const r = await saveParcelScan(fields, rawExtraction);
    if (!r.ok) { setSaveErr(r.error || "save_failed"); return false; }
    const rowId = r.id || `local-${Date.now()}`;
    const storeId = fields.store_id ?? "";
    setRows((prev) => [{
      id: rowId,
      customerName: fields.name ?? "",
      phone: fields.phone ?? "",
      storeId,
      amount: fields.amount,
      notes: fields.notes ?? "",
      status: "confirmed",
      storeCheckStatus: /^\d{6}$/.test(storeId) ? "checking" : null,
      createdAt: new Date().toISOString(),
    }, ...prev]);
    setToast(t.rd_ps2_saved_toast);
    setTimeout(() => setToast(""), 2500);
    // Only when we got a real DB id back can the async verdict be persisted +
    // matched to the row; skip the check on the local-id fallback.
    if (r.id) runStoreCheck(r.id, storeId);
    return true;
  };

  const onSave = async () => {
    if (saving) return;
    setSaving(true); setSaveErr("");
    const ok = await commitNewParcel(formToFields(form));
    setSaving(false);
    if (!ok) return;
    setScanCount((c) => c + 1); // this-session saved counter (camera + picker)
    advance(); // batch of 1 (camera) → idle → the camera effect reopens the stream
  };

  // Manual encode — SAME confirm form, blank, opened WITHOUT a camera capture or
  // AI scan. Zero credit (commitNewParcel = direct INSERT). Not counted as a
  // "scan". Continuous (camera-loop style): on success STAY in manual mode with
  // a fresh blank form for the next parcel; the seller exits via Done/Cancel.
  const onManualSave = async () => {
    if (saving) return;
    setSaving(true); setSaveErr("");
    const ok = await commitNewParcel(formToFields(form));
    setSaving(false);
    if (!ok) return;
    setManualCount((c) => c + 1);
    setForm(emptyForm); setConfid(null); setRawExtraction(null); setSaveErr(""); // blank for the next; stay in manual
  };

  // ── 賣貨便 訂單匯入 Excel export — gate, build via the EXISTING builder, deliver.
  // No quota RPC (admin-only). Marks exported READY rows done so re-exports skip.
  // CHANGE 1: the button count is the READY count (passes validators AND
  // store_check_status != 'not_found'), NOT all non-exported rows — a wrong-code
  // parcel is never counted and never lands in the .xlsm. unknown/null store
  // checks stay READY (soft-warned). Same split the build below uses.
  const readyCount = splitScansForExport(rows, fee).ready.length;
  const runExport = async () => {
    if (exportBusy) return;
    setExportBusy(true); setExportErr(""); setExportSummary(null);
    try {
      const { ready, attention } = splitScansForExport(rows, fee);
      const attnList = attention.map((a) => ({ name: a.row.customerName || a.row.storeId || "—", reason: a.reason }));
      if (ready.length === 0) {
        setExportSummary({ exported: 0, attention: attnList });
        return;
      }
      const bytes = await buildXlsmFromTemplate(await fetchShipTemplate(), ready.map((r) => scanToXlsRow(r, { storeName, fee })));
      const d = await deliverXlsm(bytes, exportFilename(Date.now()));
      if (!d.ok) { setExportErr(d.error || "export_failed"); return; }
      const ids = ready.map((r) => r.id);
      const marked = await markScansExported(ids); // stamps status + a batch id
      if (aliveRef.current) {
        setRows((prev) => prev.map((r) => (ids.includes(r.id) ? { ...r, status: "exported" } : r)));
        setExportSummary({ exported: ready.length, attention: attnList });
        // Enable "Undo last export" only when the batch was actually stamped.
        setLastExportBatch(marked.ok && marked.batchId ? { id: marked.batchId, ids } : null);
        setUndoErr("");
      }
    } catch (e) {
      setExportErr(e instanceof Error ? e.message : String(e));
    } finally {
      setExportBusy(false);
    }
  };

  // ── Deletes (Change 3) — awaited, confirmed, prune only on success ──────────
  const exportedCount = rows.filter((r) => r.status === "exported").length;
  const doDelete = async () => {
    if (!confirm || deleting) return;
    setDeleting(true); setDeleteErr("");
    if (confirm.kind === "row") {
      const id = confirm.id;
      const r = await deleteParcelScan(id);
      setDeleting(false);
      if (!r.ok) { setDeleteErr(r.error || "delete_failed"); return; }
      if (aliveRef.current) { setRows((prev) => prev.filter((x) => x.id !== id)); setConfirm(null); }
    } else {
      const r = await deleteExportedParcels();
      setDeleting(false);
      if (!r.ok) { setDeleteErr(r.error || "delete_failed"); return; }
      if (aliveRef.current) { setRows((prev) => prev.filter((x) => x.status !== "exported")); setConfirm(null); }
    }
  };
  const askDelete = (c: { kind: "row"; id: string } | { kind: "exported" }) => { setDeleteErr(""); setConfirm(c); };
  // FIX 4 — confirm before exporting (an accidental export marks rows 'exported'
  // and drops them from the next file). Reuses the SAME portal confirm dialog as
  // delete/clear-exported.
  const askExport = () => { setDeleteErr(""); setConfirm({ kind: "export" }); };

  // FIX 5 — undo the last export run: revert its rows to 'confirmed' (DB +
  // local), returning them to the ready list. Confirmed via the same dialog.
  const askUndo = () => { setUndoErr(""); setDeleteErr(""); setConfirm({ kind: "undo" }); };
  const doUndo = async () => {
    if (!lastExportBatch) { setConfirm(null); return; }
    const batch = lastExportBatch;
    setConfirm(null);
    const r = await unmarkScansExported(batch.id);
    if (!r.ok) { setUndoErr(r.error || "undo_failed"); return; }
    if (aliveRef.current) {
      setRows((prev) => prev.map((x) => (batch.ids.includes(x.id) ? { ...x, status: "confirmed" } : x)));
      setLastExportBatch(null);
      setExportSummary(null); // the "exported N" summary is now stale
    }
  };

  // ── Manual encode — open the shared confirm form BLANK, no camera/scan ──────
  const openManual = () => {
    if (busy || editing || batchFull) return; // batch cap blocks a NEW manual entry (button also disabled)
    setSaveErr(""); setForm(emptyForm); setConfid(null); setRawExtraction(null);
    setManual(true);
  };
  const cancelManual = () => { setManual(false); setForm(emptyForm); setSaveErr(""); };

  // ── Edit (Feature 3) — reuse the confirm form, pre-filled; update-in-place ──
  // Only reachable when idle (not mid-scan-batch) and only for non-exported rows.
  const openEdit = (r: ParcelScanRow) => {
    if (busy || r.status === "exported") return;
    setSaveErr("");
    setForm({ name: r.customerName, phone: r.phone, store: r.storeId, amount: r.amount == null ? "" : String(r.amount), notes: r.notes });
    setConfid(null); // no low-confidence highlights on a manual edit
    setEditing({ id: r.id });
  };
  const cancelEdit = () => { setEditing(null); setForm(emptyForm); setSaveErr(""); };
  const onEditSave = async () => {
    if (!editing || saving) return;
    setSaving(true); setSaveErr("");
    const id = editing.id;
    const fields = formToFields(form);
    const r = await updateParcelScan(id, fields);        // own-scoped UPDATE, NO credit
    setSaving(false);
    if (!r.ok) { setSaveErr(r.error || "save_failed"); return; } // surfaced inline, no optimistic write
    const newStore = fields.store_id ?? "";
    const prev = rows.find((x) => x.id === id);
    const storeChanged = (prev?.storeId ?? "") !== newStore;
    if (aliveRef.current) {
      setRows((list) => list.map((x) => (x.id === id ? {
        ...x,
        customerName: fields.name ?? "",
        phone: fields.phone ?? "",
        storeId: newStore,
        amount: fields.amount,
        notes: fields.notes ?? "",
        // Store code changed → clear the stale ❌/verdict now; re-check below if valid.
        storeCheckStatus: storeChanged ? null : x.storeCheckStatus,
      } : x)));
    }
    setEditing(null); setForm(emptyForm);
    setToast(t.rd_ps2_saved_toast); setTimeout(() => setToast(""), 2500);
    // Re-run the E-Map check ONLY when the store code changed (reuse runStoreCheck).
    if (storeChanged && /^\d{6}$/.test(newStore) && !id.startsWith("local-")) runStoreCheck(id, newStore);
  };

  const errs = formErrors(form);
  // A NEW-row Save (scan/manual) is blocked at the batch cap; an EDIT of an
  // existing row is NEVER blocked by the cap (fix wrong codes/prices when full).
  const saveBlocked = saving || errs.empty || errs.name || errs.phone || errs.store || errs.amount || (batchFull && !editing);
  const low = (f: keyof ScanFields): boolean => confid?.[f] === "low";
  const F = (patch: Partial<FormState>) => setForm((s) => ({ ...s, ...patch }));
  const busy = phase === "scanning" || phase === "confirm" || phase === "error";
  const outOfCredits = credits === 0; // known-zero (not just unloaded) → blocked
  // Show the in-app camera when supported + intended + not errored + has credits;
  // otherwise the original file-picker fallback renders (and it also shows the
  // disabled button when out of credits).
  const useCameraUI = !manualOnly && cameraOn && cameraSupported() && !cameraErr && !outOfCredits;
  const flaggedCount = rows.filter((r) => r.storeCheckStatus === "not_found").length;
  // Change 2: the saved list re-renders by active tab (in-memory filter of the
  // already-loaded rows — zero-poll, no refetch/timers).
  const shown = tab === "wrong" ? rows.filter((r) => r.storeCheckStatus === "not_found") : rows;
  const progress = files.length > 1 ? { i: String(idx + 1), n: String(files.length) } : { i: "1", n: "1" };

  const timeOf = (iso: string): string => {
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? d.toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  };

  return (
    <div>
      <div style={headerBar}>
        <div className="sfl-anim-beat" style={headerTitle}>{t.rd_ps2_title}</div>
        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 1 }}>{t.rd_ps2_sub}</div>
      </div>
      <div style={{ padding: "16px 14px calc(28px + env(safe-area-inset-bottom))", display: "grid", gap: 12 }}>
        {toast && <div style={{ ...card, padding: 10, textAlign: "center", fontSize: 12.5, fontWeight: 700, color: "var(--ok, #16a34a)" }} data-testid="ps-toast">{toast}</div>}

        {/* Compact stats row — Scan Credits + this-session counter + the batch
            counter (N / MAX) as small pills (same visual language as the All/Wrong
            segmented tabs below). The batch pill shows for BOTH admin and the
            manual-only seller (they need to see the cap); credits/session stay
            admin-only. */}
        {(listLoaded || credits !== null || scanCount > 0) && (
          <div style={{ display: "flex", gap: 6 }} data-testid="ps-stats">
            {!manualOnly && credits !== null && (
              <div style={{ flex: 1, padding: "7px 10px", borderRadius: 9, border: "1px solid var(--border-strong)", background: "var(--surface-2)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, minWidth: 0 }} data-testid="ps-credits">
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.rd_ps2_credits}</span>
                <span style={{ fontSize: 13, fontWeight: 900, color: outOfCredits ? "var(--danger)" : "var(--text)", fontFamily: mono, flexShrink: 0 }} data-testid="ps-credits-n">{credits}</span>
              </div>
            )}
            {!manualOnly && scanCount > 0 && (
              <div style={{ flex: 1, padding: "7px 10px", borderRadius: 9, border: "1px solid var(--border-strong)", background: "var(--surface-2)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, minWidth: 0 }} data-testid="ps-scancount">
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.rd_ps2_session}</span>
                <span style={{ fontSize: 13, fontWeight: 900, color: "var(--text)", fontFamily: mono, flexShrink: 0 }} data-testid="ps-scancount-n">{scanCount}</span>
              </div>
            )}
            {/* Batch counter — pending / MAX; turns danger at the cap. */}
            <div style={{ flex: 1, padding: "7px 10px", borderRadius: 9, border: `1px solid ${batchFull ? "var(--danger)" : "var(--border-strong)"}`, background: "var(--surface-2)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, minWidth: 0 }} data-testid="ps-batch">
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.rd_ps2_batch}</span>
              <span style={{ fontSize: 13, fontWeight: 900, color: batchFull ? "var(--danger)" : "var(--text)", fontFamily: mono, flexShrink: 0 }} data-testid="ps-batch-n">{pendingCount} / {MAX_PENDING_PARCELS}</span>
            </div>
          </div>
        )}

        {/* Batch full → clear "export first" banner (does NOT hide the camera;
            the entry buttons below are disabled so it's obvious why). Edit +
            delete of existing rows stay open. */}
        {batchFull && (
          <div style={{ ...card, borderColor: "var(--danger)", background: "var(--danger-soft, rgba(220,38,38,.08))" }} data-testid="ps-batch-full">
            <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--danger)" }}>{tpl(t.rd_ps2_batch_full, { max: String(MAX_PENDING_PARCELS) })}</div>
          </div>
        )}

        {/* Out of credits → blocked, with the Telegram top-up path (real anchor per the iOS rule). */}
        {!manualOnly && outOfCredits && (
          <div style={{ ...card, borderColor: "var(--danger)", background: "var(--danger-soft, rgba(220,38,38,.08))" }} data-testid="ps-credits-out">
            <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--danger)" }}>{t.rd_ps2_credits_out}</div>
            <a href={TELEGRAM_URL} target="_blank" rel="noreferrer noopener" style={{ display: "inline-block", marginTop: 10, padding: "9px 14px", borderRadius: 10, background: "var(--accent)", color: "#fff", fontWeight: 800, fontSize: 13, textDecoration: "none" }} data-testid="ps-credits-topup">{t.rd_ps2_credits_topup}</a>
          </div>
        )}

        {/* IN-APP CAMERA — live preview + shutter, shown while idle (not editing,
            not previewing a still). Capture → Use/Retake below. Falls back to the
            file picker when the camera is unsupported/denied. */}
        {!busy && !editing && !manual && !snapshot && useCameraUI && (
          <div style={card} data-testid="ps-camera">
            {/* Height-capped (FIX 2) so the preview + shutter fit one iPhone screen
                without scrolling; objectFit:cover keeps the slip usable to align. */}
            <div style={{ position: "relative", width: "100%", height: "min(46vh, 380px)", background: "#000", borderRadius: 12, overflow: "hidden" }}>
              <video ref={videoRef} muted playsInline autoPlay data-testid="ps-video" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            </div>
            <button
              onClick={shutter}
              disabled={batchFull}
              style={{ width: "100%", padding: "14px", borderRadius: 12, border: "none", background: batchFull ? "var(--border-strong)" : "var(--accent)", color: "#fff", fontWeight: 800, fontSize: 15, cursor: batchFull ? "default" : "pointer", marginTop: 10 }}
              data-testid="ps-shutter"
            >📸 {t.rd_ps2_shutter}</button>
            <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 8, lineHeight: 1.5 }}>{t.rd_ps2_cam_hint}</div>
            <button onClick={() => setCameraOn(false)} style={{ marginTop: 8, background: "none", border: "none", color: "var(--text-dim)", fontSize: 11.5, fontWeight: 700, textDecoration: "underline", cursor: "pointer", padding: 0 }} data-testid="ps-use-library">{t.rd_ps2_use_library}</button>
          </div>
        )}

        {/* CAPTURE PREVIEW — Use (→ scan) or Retake (→ free, back to camera). */}
        {!busy && !editing && !manual && snapshot && (
          <div style={card} data-testid="ps-preview">
            <div style={{ width: "100%", height: "min(46vh, 380px)", background: "#000", borderRadius: 12, overflow: "hidden" }}>
              <img src={snapshot.url} alt="" data-testid="ps-preview-img" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={usePhoto} style={{ flex: 2, padding: "13px 12px", borderRadius: 12, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer" }} data-testid="ps-use">✓ {t.rd_ps2_use}</button>
              <button onClick={retake} style={{ flex: 1, padding: "13px 12px", borderRadius: 12, border: "1px solid var(--border-strong)", background: "var(--surface-2)", color: "var(--text)", fontWeight: 700, fontSize: 14, cursor: "pointer" }} data-testid="ps-retake">↺ {t.rd_ps2_retake}</button>
            </div>
          </div>
        )}

        {/* FILE-PICKER FALLBACK — safety net: camera unsupported/denied, out of
            credits, or the seller chose the photo library. Original flow, kept. */}
        {!manualOnly && !busy && !editing && !manual && !snapshot && !useCameraUI && (
          <div style={card}>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={outOfCredits || batchFull}
              style={{ width: "100%", padding: "13px 14px", borderRadius: 12, border: "none", background: (outOfCredits || batchFull) ? "var(--border-strong)" : "var(--accent)", color: "#fff", fontWeight: 800, fontSize: 14, cursor: (outOfCredits || batchFull) ? "default" : "pointer" }}
              data-testid="ps-pick"
            >📷 {t.rd_ps2_pick}</button>
            <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 8, lineHeight: 1.5 }}>{t.rd_ps2_pick_hint}</div>
            {cameraErr && <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 6 }} data-testid="ps-cam-fallback-note">{t.rd_ps2_cam_unavailable}</div>}
            {/* After a denial (cameraErr) → explicit retry that clears the error and
                re-opens the camera, so the user never has to relaunch the app (the
                visibilitychange handler also auto-clears on return-to-foreground). */}
            {cameraErr && cameraSupported() && (
              <button onClick={() => { setCameraErr(""); setCameraOn(true); }} style={{ marginTop: 8, background: "none", border: "none", color: "var(--text-dim)", fontSize: 11.5, fontWeight: 700, textDecoration: "underline", cursor: "pointer", padding: 0 }} data-testid="ps-cam-retry">{t.rd_ps2_cam_retry}</button>
            )}
            {!cameraErr && !cameraOn && cameraSupported() && (
              <button onClick={() => setCameraOn(true)} style={{ marginTop: 8, background: "none", border: "none", color: "var(--text-dim)", fontSize: 11.5, fontWeight: 700, textDecoration: "underline", cursor: "pointer", padding: 0 }} data-testid="ps-use-camera">{t.rd_ps2_use_camera}</button>
            )}
            <input ref={fileRef} type="file" accept="image/*" multiple hidden data-testid="ps-file" onChange={(e) => onPick(e.target.files)} />
          </div>
        )}

        {/* MANUAL ENCODE — add a parcel with NO camera + NO AI scan (ZERO credit).
            Opens the shared confirm form blank; saves straight into parcel_scans.
            Shown in idle (under the camera or the picker), not while a form/preview
            is open. */}
        {!busy && !editing && !manual && !snapshot && (
          <button onClick={openManual} disabled={batchFull} style={{ justifySelf: "center", background: "none", border: "none", color: batchFull ? "var(--text-muted)" : "var(--text-dim)", fontSize: 12, fontWeight: 700, textDecoration: "underline", cursor: batchFull ? "default" : "pointer", opacity: batchFull ? 0.55 : 1, padding: "2px 4px" }} data-testid="ps-manual">✏️ {t.rd_ps2_manual}</button>
        )}
        {/* Seller (manual-only) surface: a small muted note where the camera would
            be — the AI scan is admin-only for now. Admins see the real camera and
            NOT this line. */}
        {manualOnly && !busy && !editing && !manual && !snapshot && (
          <div style={{ fontSize: 11, color: "var(--text-dim)", textAlign: "center" }} data-testid="ps-ai-soon">{t.rd_ps2_ai_soon}</div>
        )}

        {phase === "scanning" && (
          <div style={{ ...card, textAlign: "center", padding: 24 }} data-testid="ps-scanning">
            <div style={{ fontSize: 26, marginBottom: 6 }}>🔍</div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{tpl(t.rd_ps2_scanning, progress)}</div>
          </div>
        )}

        {phase === "error" && (
          <div style={{ ...card, borderColor: "var(--danger)" }} data-testid="ps-error">
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)" }}>{t.rd_ps2_err_scan}</div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 3, fontFamily: mono }}>{scanErr}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={() => void scanOne(files, idx)} style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 800, cursor: "pointer" }} data-testid="ps-retry">{t.rd_ps2_retry}</button>
              <button onClick={advance} style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "var(--surface-2)", color: "var(--text)", fontWeight: 700, cursor: "pointer" }} data-testid="ps-skip-err">{t.rd_ps2_skip}</button>
            </div>
          </div>
        )}

        {(phase === "confirm" || editing || manual) && (
          <div style={card} data-testid="ps-confirm" data-editing={editing ? "1" : undefined} data-manual={manual ? "1" : undefined}>
            <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 10 }}>{editing ? t.rd_ps2_edit_title : manual ? t.rd_ps2_manual_title : tpl(t.rd_ps2_confirm, progress)}</div>
            {manual && manualCount > 0 && (
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ok, #16a34a)", marginBottom: 10 }} data-testid="ps-manual-count">{tpl(t.rd_ps2_manual_count, { n: String(manualCount) })}</div>
            )}
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <label style={lbl}>{t.rd_ps2_name}{low("name") && <span style={{ color: "var(--warn, #b45309)" }}> · {t.rd_ps2_low_conf}</span>}</label>
                <input value={form.name} onChange={(e) => F({ name: e.target.value })} style={{ ...input, ...(low("name") ? { border: lowConfBorder } : {}) }} data-testid="ps-name" />
                {errs.name && <div style={errTxt}>{t.rd_ps2_err_name}</div>}
              </div>
              <div style={{ display: "flex", gap: 9 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label style={lbl}>{t.rd_ps2_phone}{low("phone") && <span style={{ color: "var(--warn, #b45309)" }}> · {t.rd_ps2_low_conf}</span>}</label>
                  <input value={form.phone} onChange={(e) => F({ phone: e.target.value.replace(/[^\d]/g, "").slice(0, 10) })} inputMode="numeric" placeholder="09xxxxxxxx" style={{ ...input, fontFamily: mono, ...(low("phone") ? { border: lowConfBorder } : {}) }} data-testid="ps-phone" />
                  {errs.phone && <div style={errTxt}>{t.rd_ps2_err_phone}</div>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label style={lbl}>{t.rd_ps2_store}{low("store_id") && <span style={{ color: "var(--warn, #b45309)" }}> · {t.rd_ps2_low_conf}</span>}</label>
                  <input value={form.store} onChange={(e) => F({ store: e.target.value.replace(/[^\d]/g, "").slice(0, 6) })} inputMode="numeric" placeholder="123456" style={{ ...input, fontFamily: mono, ...(low("store_id") ? { border: lowConfBorder } : {}) }} data-testid="ps-store" />
                  {errs.store && <div style={errTxt}>{t.rd_ps2_err_store}</div>}
                </div>
              </div>
              <div>
                <label style={lbl}>{t.rd_ps2_amount} ({cur}){low("amount") && <span style={{ color: "var(--warn, #b45309)" }}> · {t.rd_ps2_low_conf}</span>}</label>
                <input value={form.amount} onChange={(e) => F({ amount: e.target.value.replace(/[^\d.]/g, "") })} inputMode="numeric" style={{ ...input, fontFamily: mono, ...(low("amount") ? { border: lowConfBorder } : {}) }} data-testid="ps-amount" />
                {errs.amount
                  ? <div style={errTxt} data-testid="ps-amount-err">{tpl(t.rd_ps2_err_amount, { amt: `${cur}${MIN_PARCEL_AMOUNT}` })}</div>
                  : amountWarns(form.amount) && <div style={warnTxt} data-testid="ps-amount-warn">{t.rd_ps2_amount_warn}</div>}
              </div>
              {/* Notes field hidden (Jeff — shorter form). The DB column + any
                  existing notes are preserved: form.notes is still round-tripped
                  through formToFields, so editing an old parcel rewrites its
                  original notes unchanged; new entries just leave it blank. Not
                  used by the 賣貨便 export (cols I/J are blank), E-Map, or admin. */}
              {saveErr && <div style={errTxt} data-testid="ps-save-err">{t.rd_ps2_err_save} <span style={{ fontFamily: mono }}>{saveErr}</span></div>}
              <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
                <button onClick={() => void (editing ? onEditSave() : manual ? onManualSave() : onSave())} disabled={saveBlocked} style={{ flex: 2, padding: "11px 12px", borderRadius: 10, border: "none", background: saveBlocked ? "var(--border-strong)" : "var(--accent)", color: "#fff", fontWeight: 800, fontSize: 13.5, cursor: saveBlocked ? "default" : "pointer" }} data-testid="ps-save">{t.rd_ps2_save}</button>
                {editing
                  ? <button onClick={cancelEdit} style={{ flex: 1, padding: "11px 12px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "var(--surface-2)", color: "var(--text)", fontWeight: 700, cursor: "pointer" }} data-testid="ps-edit-cancel">{t.rd_ps2_cancel}</button>
                  : manual
                    ? <button onClick={cancelManual} style={{ flex: 1, padding: "11px 12px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "var(--surface-2)", color: "var(--text)", fontWeight: 700, cursor: "pointer" }} data-testid="ps-manual-cancel">{manualCount > 0 ? t.rd_ps2_done : t.rd_ps2_cancel}</button>
                    : <button onClick={advance} style={{ flex: 1, padding: "11px 12px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "var(--surface-2)", color: "var(--text)", fontWeight: 700, cursor: "pointer" }} data-testid="ps-skip">{t.rd_ps2_skip}</button>}
              </div>
            </div>
          </div>
        )}

        {/* Summary — subtle, shows before the owner sits at the laptop. */}
        {flaggedCount > 0 && (
          <div style={{ ...card, padding: 10, borderColor: "var(--danger)", background: "var(--danger-soft, rgba(220,38,38,.08))", fontSize: 12, fontWeight: 700, color: "var(--danger)" }} data-testid="ps-attention">
            {tpl(t.rd_ps2_attention, { n: String(flaggedCount) })}
          </div>
        )}

        {/* 賣貨便 訂單匯入 Excel export — one file for the whole batch. */}
        <div style={card} data-testid="ps-export-card">
          <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 6 }}>{t.rd_ps2_x_title}</div>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 9, lineHeight: 1.5 }}>{t.rd_ps2_x_hint}</div>
          <button
            onClick={askExport}
            disabled={exportBusy || readyCount === 0}
            style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: "none", background: exportBusy || readyCount === 0 ? "var(--border-strong)" : "var(--accent)", color: "#fff", fontWeight: 800, fontSize: 14, cursor: exportBusy || readyCount === 0 ? "default" : "pointer" }}
            data-testid="ps-export-btn"
          >📄 {exportBusy ? t.rd_ps2_x_exporting : tpl(t.rd_ps2_x_button, { n: String(readyCount) })}</button>
          {exportErr && <div style={{ ...errTxt, marginTop: 8 }} data-testid="ps-export-err">{t.rd_ps2_x_failed} <span style={{ fontFamily: mono }}>{exportErr}</span></div>}
          {/* Undo last export (FIX 5) — reverts the run just exported so an
              accidental export is recoverable. */}
          {lastExportBatch && (
            <button onClick={askUndo} style={{ width: "100%", marginTop: 8, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "var(--surface-2)", color: "var(--text)", fontWeight: 700, fontSize: 13, cursor: "pointer" }} data-testid="ps-undo-btn">↩ {tpl(t.rd_ps2_undo_btn, { n: String(lastExportBatch.ids.length) })}</button>
          )}
          {undoErr && <div style={{ ...errTxt, marginTop: 8 }} data-testid="ps-undo-err">{t.rd_ps2_undo_failed} <span style={{ fontFamily: mono }}>{undoErr}</span></div>}
          {exportSummary && (
            <div style={{ marginTop: 10 }} data-testid="ps-export-summary">
              <div style={{ fontSize: 12, fontWeight: 800, color: exportSummary.exported > 0 ? "var(--ok, #16a34a)" : "var(--text-dim)" }}>
                {tpl(t.rd_ps2_x_result, { x: String(exportSummary.exported), y: String(exportSummary.attention.length) })}
              </div>
              {exportSummary.attention.length > 0 && (
                <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
                  {exportSummary.attention.map((a, i) => (
                    <div key={i} style={{ fontSize: 11, color: "var(--danger)", display: "flex", justifyContent: "space-between", gap: 8 }} data-testid="ps-export-attn-row">
                      <span style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                      <span style={{ flexShrink: 0 }}>{t[reasonKey(a.reason)]}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Saved list — read-on-open snapshot + local appends. Full queue = A2. */}
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800 }}>{t.rd_ps2_saved} {rows.length > 0 && <span style={{ color: "var(--text-dim)", fontWeight: 700 }}>· {rows.length}</span>}</div>
            {exportedCount > 0 && (
              <button onClick={() => askDelete({ kind: "exported" })} style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--surface-2)", color: "var(--text-dim)", fontSize: 10.5, fontWeight: 700, cursor: "pointer", flexShrink: 0 }} data-testid="ps-clear-exported">🗑 {t.rd_ps2_clear_exported}</button>
            )}
          </div>

          {/* Two-tab segmented toggle (Change 2). */}
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }} data-testid="ps-tabs">
            {([["all", `${t.rd_ps2_tab_all} · ${rows.length}`], ["wrong", `${t.rd_ps2_tab_wrong} · ${flaggedCount}`]] as const).map(([key, label]) => {
              const on = tab === key;
              return (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  style={{ flex: 1, padding: "7px 8px", borderRadius: 9, border: on ? "1px solid var(--accent)" : "1px solid var(--border-strong)", background: on ? "var(--accent)" : "var(--surface-2)", color: on ? "#fff" : "var(--text-dim)", fontSize: 11.5, fontWeight: 800, cursor: "pointer" }}
                  data-testid={`ps-tab-${key}`}
                  aria-pressed={on}
                >{label}</button>
              );
            })}
          </div>

          {listLoaded && rows.length === 0 && <div style={{ fontSize: 12, color: "var(--text-dim)" }} data-testid="ps-empty">{t.rd_ps2_empty}</div>}
          {listLoaded && tab === "wrong" && rows.length > 0 && flaggedCount === 0 && <div style={{ fontSize: 12, color: "var(--text-dim)" }} data-testid="ps-wrong-empty">{t.rd_ps2_wrong_empty}</div>}
          {shown.map((r) => {
            const badge = storeBadge(r.storeCheckStatus);
            const canRecheck = !r.id.startsWith("local-") && /^\d{6}$/.test(r.storeId) && (r.storeCheckStatus === "not_found" || r.storeCheckStatus === "unknown");
            return (
              <div key={r.id} style={{ padding: "9px 2px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }} data-testid="ps-row">
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.customerName || "—"}
                    {r.status === "exported" && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 800, color: "var(--ok, #16a34a)", border: "1px solid var(--ok, #16a34a)", borderRadius: 6, padding: "0 5px", verticalAlign: "middle" }} data-testid="ps-exported-tag">{t.rd_ps2_x_tag}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: mono }}>{[r.phone, r.storeId].filter(Boolean).join(" · ") || "—"}</div>
                  {badge && (
                    <div style={{ fontSize: 10.5, fontWeight: 700, marginTop: 3, color: badge.color }} data-testid="ps-store-badge" data-status={r.storeCheckStatus || ""}>
                      {badge.icon} {t[badge.key]}
                      {canRecheck && <button onClick={() => runStoreCheck(r.id, r.storeId)} style={{ marginLeft: 8, padding: "1px 7px", borderRadius: 7, border: "1px solid var(--border-strong)", background: "var(--surface-2)", color: "var(--text)", fontSize: 10, fontWeight: 700, cursor: "pointer" }} data-testid="ps-recheck">{t.rd_ps2_recheck}</button>}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, fontFamily: mono }}>{r.amount !== null ? `${cur}${r.amount.toLocaleString()}` : "—"}</div>
                    <div style={{ fontSize: 10.5, color: "var(--text-dim)" }}>{timeOf(r.createdAt)}</div>
                  </div>
                  {r.status !== "exported" && <button onClick={() => openEdit(r)} aria-label={t.rd_ps2_edit_aria} style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text-dim)", fontSize: 13, cursor: "pointer", lineHeight: 1 }} data-testid="ps-row-edit">✏️</button>}
                  <button onClick={() => askDelete({ kind: "row", id: r.id })} aria-label={t.rd_ps2_delete_aria} style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text-dim)", fontSize: 13, cursor: "pointer", lineHeight: 1 }} data-testid="ps-row-delete">🗑</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Delete confirmation (Change 3) — PORTALED to the [data-redesign] root so
          position:fixed is viewport-relative, escaping the .sfl-scroll / .sfl-anim-screen
          stacking + containing-block trap that cut the sheet off below the fold on iPhone.
          MUST portal INTO [data-redesign] (not document.body): the design tokens
          (--surface/--danger/--text/--border-strong/--text-dim) + theme/accent are defined
          ON that root, so a document.body portal leaves every var() unresolved → a
          transparent, unstyled card (the RaffleWheel token-trap). .sfl-stage has no
          transform/filter, so it is NOT a fixed-containing block → fixed stays viewport-
          relative. CENTERED, max-height + inner scroll, safe-area padding so the actions
          clear the home indicator and the bottom nav (zIndex 1300 > nav zIndex 3). Card
          surface + Cancel(neutral)/Delete(danger) mirror PrinterModal/ExpiryModal. */}
      {confirm && createPortal(
        <div style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: "calc(16px + env(safe-area-inset-top)) 16px calc(16px + env(safe-area-inset-bottom))", boxSizing: "border-box" }} data-testid="ps-confirm-overlay" onClick={() => { if (!deleting) setConfirm(null); }}>
          <div style={{ width: "100%", maxWidth: 440, maxHeight: "100%", overflowY: "auto", background: "var(--surface)", borderRadius: 18, padding: "22px 20px 20px", boxShadow: "0 20px 60px rgba(0,0,0,.4)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 800, lineHeight: 1.5, color: "var(--text)" }} data-testid="ps-confirm-msg">
              {confirm.kind === "export"
                ? tpl(t.rd_ps2_x_confirm_q, { n: String(readyCount) })
                : confirm.kind === "undo"
                  ? tpl(t.rd_ps2_undo_q, { n: String(lastExportBatch?.ids.length ?? 0) })
                  : confirm.kind === "exported"
                    ? tpl(t.rd_ps2_clear_exported_q, { n: String(exportedCount) })
                    : t.rd_ps2_delete_row_q}
            </div>
            {deleteErr && <div style={{ ...errTxt, marginTop: 10 }} data-testid="ps-delete-err">{t.rd_ps2_delete_err} <span style={{ fontFamily: mono }}>{deleteErr}</span></div>}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={() => setConfirm(null)} disabled={deleting} style={{ flex: 1, padding: "11px 12px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "transparent", color: "var(--text-dim)", fontWeight: 700, fontSize: 13.5, cursor: deleting ? "default" : "pointer" }} data-testid="ps-confirm-cancel">{t.rd_ps2_cancel}</button>
              {confirm.kind === "export"
                ? <button onClick={() => { setConfirm(null); void runExport(); }} style={{ flex: 1, padding: "11px 12px", borderRadius: 10, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 800, fontSize: 13.5, cursor: "pointer" }} data-testid="ps-confirm-export">📄 {t.rd_ps2_x_confirm_go}</button>
                : confirm.kind === "undo"
                  ? <button onClick={() => void doUndo()} style={{ flex: 1, padding: "11px 12px", borderRadius: 10, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 800, fontSize: 13.5, cursor: "pointer" }} data-testid="ps-confirm-undo">↩ {t.rd_ps2_undo_go}</button>
                  : <button onClick={() => void doDelete()} disabled={deleting} style={{ flex: 1, padding: "11px 12px", borderRadius: 10, border: "none", background: "var(--danger)", color: "#fff", fontWeight: 800, fontSize: 13.5, cursor: deleting ? "default" : "pointer", opacity: deleting ? 0.7 : 1 }} data-testid="ps-confirm-delete">{t.rd_ps2_delete}</button>}
            </div>
          </div>
        </div>,
        (typeof document !== "undefined" && document.querySelector("[data-redesign]")) || document.body,
      )}
    </div>
  );
}
