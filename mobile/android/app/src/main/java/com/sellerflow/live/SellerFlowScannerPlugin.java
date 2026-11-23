package com.sellerflow.live;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;

/**
 * Native "Scan sticker QR" (app versionCode 11+). JS:
 *   window.Capacitor.Plugins.SellerFlowScanner.scanStickerQr({ texts })
 *   → { status: "read", text }                  a sticker QR, the text VERBATIM
 *   → { status: "photo", data: base64, mime }   "Take a photo instead" → the phone's own Take photo /
 *                                               Choose from photos; the web reads it with today's reader
 *   → { status: "cancelled" } | { status: "busy" } | { status: "error", code }
 *
 * The screen is QrScannerDialog (same look as the iPhone): a full-screen camera over the app's own
 * window — the WebView stays running under it (a live seller's comments, wake lock and timers keep
 * going). Reader = Google ML Kit barcode scanning, BUNDLED model (no Google Play services needed).
 * CAMERA is already in the manifest (the Parcel Scan camera); no other permission is added.
 *
 * Separate from SellerFlowPrinterPlugin (not touched). Registered with one line in MainActivity.
 */
@CapacitorPlugin(name = "SellerFlowScanner", permissions = { @Permission(strings = { Manifest.permission.CAMERA }, alias = "camera") })
public class SellerFlowScannerPlugin extends Plugin {
    private static final int MAX_EDGE = 4032;
    private PluginCall pending;
    private ScannerTexts texts = ScannerTexts.from(null);
    private QrScannerDialog dialog;
    private File cameraFile;

    @PluginMethod
    public void scanStickerQr(PluginCall call) {
        if (pending != null) {
            call.resolve(status("busy"));
            return;
        }
        pending = call;
        texts = ScannerTexts.from(call.getObject("texts"));
        getActivity().runOnUiThread(this::begin);
    }

    private void begin() {
        if (pending == null) return;
        PackageManager pm = getContext().getPackageManager();
        if (!pm.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)) { // no camera at all → the photo choice
            startPhoto(false);
            return;
        }
        if (getPermissionState("camera") == PermissionState.GRANTED) {
            openScanner(true);
        } else {
            requestPermissionForAlias("camera", pending, "cameraPermsCallback");
        }
    }

    @PermissionCallback
    private void cameraPermsCallback(PluginCall call) {
        openScanner(getPermissionState("camera") == PermissionState.GRANTED);
    }

    private void openScanner(boolean granted) {
        Activity activity = getActivity();
        if (activity == null || activity.isFinishing() || pending == null) {
            finish(error("no_view"));
            return;
        }
        dialog = new QrScannerDialog(activity, texts, granted, new QrScannerDialog.Listener() {
            @Override
            public void onRead(String text) {
                closeDialog();
                JSObject r = status("read");
                r.put("text", text);
                finish(r);
            }

            @Override
            public void onCancel() {
                closeDialog();
                finish(status("cancelled"));
            }

            @Override
            public void onPhoto(boolean cameraAllowed) {
                closeDialog();
                startPhoto(cameraAllowed);
            }

            @Override
            public void onOpenSettings() {
                try {
                    Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null));
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(i);
                } catch (Exception ignored) {}
            }

            @Override
            public void onNoCamera() {
                closeDialog();
                startPhoto(false);
            }
        });
        dialog.show();
    }

    // Back from the phone's Settings with the camera allowed → the scanner starts the camera.
    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (dialog != null) dialog.onPermissionMaybeChanged(getPermissionState("camera") == PermissionState.GRANTED);
    }

    private void closeDialog() {
        QrScannerDialog d = dialog;
        dialog = null;
        if (d != null) d.close();
    }

    // ── "Take a photo instead": the phone's own Take photo / Choose from photos ─────────────────
    private void startPhoto(boolean cameraAllowed) {
        Activity activity = getActivity();
        if (activity == null || pending == null) {
            finish(error("no_view"));
            return;
        }
        boolean canCamera = cameraAllowed && getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY);
        if (!canCamera) {
            openLibrary();
            return;
        }
        final boolean[] chosen = { false };
        AlertDialog sheet = new AlertDialog.Builder(activity)
            .setItems(new CharSequence[] { texts.takePhoto, texts.library }, (d, which) -> {
                chosen[0] = true;
                if (which == 0) openCamera();
                else openLibrary();
            })
            .setNegativeButton(texts.cancel, (d, w) -> {})
            .create();
        sheet.setOnDismissListener(d -> { if (!chosen[0]) finish(status("cancelled")); });
        sheet.show();
    }

    private void openCamera() {
        try {
            cameraFile = new File(getContext().getCacheDir(), "sfl-sticker-photo.jpg");
            if (cameraFile.exists()) cameraFile.delete();
            Uri out = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", cameraFile);
            Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            i.putExtra(MediaStore.EXTRA_OUTPUT, out);
            i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivityForResult(pending, i, "photoResult");
        } catch (Exception e) {
            openLibrary();
        }
    }

    private void openLibrary() {
        try {
            cameraFile = null;
            Intent i = new Intent(Intent.ACTION_GET_CONTENT);
            i.setType("image/*");
            i.addCategory(Intent.CATEGORY_OPENABLE);
            startActivityForResult(pending, i, "photoResult");
        } catch (Exception e) {
            finish(error("no_picker"));
        }
    }

    @ActivityCallback
    private void photoResult(PluginCall call, ActivityResult result) {
        if (result == null || result.getResultCode() != Activity.RESULT_OK) {
            finish(status("cancelled"));
            return;
        }
        Intent data = result.getData();
        Uri uri = data != null && data.getData() != null ? data.getData() : (cameraFile != null ? Uri.fromFile(cameraFile) : null);
        if (uri == null) { // "done" but no picture came back → the web shows today's "No QR found"
            finish(error("photo_unreadable"));
            return;
        }
        final Uri src = uri;
        new Thread(() -> {
            String b64 = jpegBase64(src);
            getActivity().runOnUiThread(() -> {
                if (b64 == null) { // the file can't be opened → the web shows today's "No QR found"
                    finish(error("photo_unreadable"));
                } else {
                    JSObject r = status("photo");
                    r.put("data", b64);
                    r.put("mime", "image/jpeg");
                    finish(r);
                }
            });
        }).start();
    }

    /** Long side ≤ 4032 px, JPEG 90. A QR reads the same at any turn, so the photo's rotation tag is not needed. */
    private String jpegBase64(Uri uri) {
        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            try (InputStream in = open(uri)) { BitmapFactory.decodeStream(in, null, bounds); }
            int edge = Math.max(bounds.outWidth, bounds.outHeight);
            if (edge <= 0) return null;
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = 1;
            while (edge / opts.inSampleSize > MAX_EDGE * 2) opts.inSampleSize *= 2;
            Bitmap bmp;
            try (InputStream in = open(uri)) { bmp = BitmapFactory.decodeStream(in, null, opts); }
            if (bmp == null) return null;
            int big = Math.max(bmp.getWidth(), bmp.getHeight());
            if (big > MAX_EDGE) {
                float k = (float) MAX_EDGE / big;
                Bitmap scaled = Bitmap.createScaledBitmap(bmp, Math.round(bmp.getWidth() * k), Math.round(bmp.getHeight() * k), true);
                if (scaled != bmp) bmp.recycle();
                bmp = scaled;
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.JPEG, 90, out);
            bmp.recycle();
            return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        } catch (Throwable t) {
            return null;
        } finally {
            if (cameraFile != null) cameraFile.delete();
        }
    }

    private InputStream open(Uri uri) throws Exception {
        if ("file".equals(uri.getScheme())) return new java.io.FileInputStream(new File(uri.getPath()));
        return getContext().getContentResolver().openInputStream(uri);
    }

    private void finish(JSObject r) {
        PluginCall c = pending;
        pending = null;
        if (c != null) c.resolve(r);
    }

    private static JSObject status(String s) {
        JSObject o = new JSObject();
        o.put("status", s);
        return o;
    }

    private static JSObject error(String code) {
        JSObject o = status("error");
        o.put("code", code);
        return o;
    }

    /** The texts the scanner shows, from the web in the seller's language; English if missing. */
    static final class ScannerTexts {
        String title, hint, one, photo, close, lightOn, lightOff, camOff, openSettings, fullScreen, camBusy, takePhoto, library, cancel;

        static ScannerTexts from(JSObject o) {
            ScannerTexts t = new ScannerTexts();
            t.title = s(o, "title", "Scan sticker QR");
            t.hint = s(o, "hint", "Point at the QR on the sticker");
            t.one = s(o, "one", "Point at one QR");
            t.photo = s(o, "photo", "Take a photo instead");
            t.close = s(o, "close", "Close");
            t.lightOn = s(o, "lightOn", "Turn on the light");
            t.lightOff = s(o, "lightOff", "Turn off the light");
            t.camOff = s(o, "camOff", "Camera is off for SellerFlowLive");
            t.openSettings = s(o, "openSettings", "Open Settings");
            t.fullScreen = s(o, "fullScreen", "Use SellerFlowLive full screen to scan");
            t.camBusy = s(o, "camBusy", "The camera isn't available right now");
            t.takePhoto = s(o, "takePhoto", "Take photo");
            t.library = s(o, "library", "Choose from photos");
            t.cancel = s(o, "cancel", "Cancel");
            return t;
        }

        private static String s(JSObject o, String key, String fallback) {
            if (o == null) return fallback;
            String v = o.optString(key, "");
            if (v == null || v.isEmpty()) return fallback;
            return v.length() > 120 ? v.substring(0, 120) : v;
        }
    }
}
