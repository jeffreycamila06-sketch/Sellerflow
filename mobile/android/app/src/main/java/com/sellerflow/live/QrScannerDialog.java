package com.sellerflow.live;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Dialog;
import android.content.Context;
import android.content.pm.ActivityInfo;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioManager;
import android.media.Image;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.CameraState;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.Preview;
import androidx.camera.core.resolutionselector.AspectRatioStrategy;
import androidx.camera.core.resolutionselector.ResolutionSelector;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.lifecycle.DefaultLifecycleObserver;
import androidx.lifecycle.LifecycleOwner;
import androidx.lifecycle.Observer;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScannerOptions;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The native "Scan sticker QR" screen (same look as the iPhone one): full-screen camera, a rounded
 * square frame in the middle, ✕ top-left, flashlight top-right (hidden when there is no light),
 * title + hint, "Take a photo instead" at the bottom. A full-screen Dialog over MainActivity — no
 * second Activity, so the WebView under it is never paused (no "app came back" work in the web).
 *
 * Camera = CameraX bound to MainActivity's lifecycle: the app goes to the background → the camera
 * pauses by itself, the scanner stays open; back → it resumes and the light comes back on.
 * Reader = ML Kit barcode scanning (bundled model, QR only). Every frame: the QRs' centres are
 * mapped to the screen (QrCentrePick.mapToView) and QrCentrePick.pick / step decide — nearest the
 * frame's centre, clearly nearer than the next one, 2 frames in a row; too close → "Point at one QR".
 * A read = a short beep (notification volume, silent in silent mode) + a haptic tap (no VIBRATE permission).
 */
final class QrScannerDialog extends Dialog {
    interface Listener {
        void onRead(String text);
        void onCancel();
        void onPhoto(boolean cameraAllowed);
        void onOpenSettings();
        void onNoCamera();
    }

    private final Activity activity;
    private final SellerFlowScannerPlugin.ScannerTexts texts;
    private final Listener listener;
    private boolean granted;
    private boolean finished;
    private boolean torchWanted;
    private boolean mirror;
    private boolean cameraStarted;
    private QrCentrePick.Streak streak;

    private FrameLayout root;
    private PreviewView previewView;
    private FrameOverlay overlay;
    private ImageButton torchButton;
    private TextView hintView;
    private LinearLayout panel;
    private TextView panelText;
    private Button settingsButton;

    private ProcessCameraProvider provider;
    private Preview preview;
    private ImageAnalysis analysis;
    private Camera camera;
    private BarcodeScanner scanner;
    private ExecutorService analysisExecutor;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final DefaultLifecycleObserver resumeObserver = new DefaultLifecycleObserver() {
        @Override
        public void onResume(@NonNull LifecycleOwner owner) {
            if (torchWanted && camera != null) camera.getCameraControl().enableTorch(true);
        }
    };
    // Built in the constructor (not as a field initializer): it reads the final `texts`, which javac
    // only treats as assigned after the constructor has set it.
    private final Observer<CameraState> stateObserver;

    QrScannerDialog(Activity activity, SellerFlowScannerPlugin.ScannerTexts texts, boolean granted, Listener listener) {
        super(activity, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
        this.activity = activity;
        this.texts = texts;
        this.granted = granted;
        this.listener = listener;
        this.stateObserver = state -> {
            if (state == null || finished) return;
            if (state.getError() != null) showPanel(this.texts.camBusy, false);
            else if (state.getType() == CameraState.Type.OPEN && this.granted) showPanel(null, false);
        };
        setCancelable(true);
        setCanceledOnTouchOutside(false);
        setOnCancelListener(d -> { if (!finished) { finished = true; listener.onCancel(); } });
        setOnDismissListener(d -> restoreOrientation()); // every way the screen goes away: ✕, Back, read, photo, close()
    }

    // ── portrait while the scanner is open ──────────────────────────────────────────────────
    // The scanner screen is always upright; the app's own orientation (whatever MainActivity had asked
    // for — normally "follow the phone") comes back the moment the scanner closes. MainActivity handles
    // orientation itself (manifest configChanges), so this never restarts the page under it.
    private static final int NOT_LOCKED = Integer.MIN_VALUE;
    private int savedOrientation = NOT_LOCKED;

    private void lockPortrait() {
        if (savedOrientation != NOT_LOCKED) return;
        try {
            int prev = activity.getRequestedOrientation();
            activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
            savedOrientation = prev;
        } catch (Exception ignored) {
            savedOrientation = NOT_LOCKED;
        }
    }

    private void restoreOrientation() {
        if (savedOrientation == NOT_LOCKED) return;
        int prev = savedOrientation;
        savedOrientation = NOT_LOCKED;
        try { activity.setRequestedOrientation(prev); } catch (Exception ignored) {}
    }

    @Override
    protected void onStart() {
        super.onStart();
        lockPortrait();
    }

    @Override
    protected void onStop() {
        restoreOrientation();
        super.onStop();
    }

    @Override
    protected void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        buildViews();
        setContentView(root);
        Window w = getWindow();
        if (w != null) {
            w.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
            w.setBackgroundDrawableResource(android.R.color.black);
            WindowCompat.setDecorFitsSystemWindows(w, false);
            w.setStatusBarColor(Color.TRANSPARENT);
            w.setNavigationBarColor(Color.TRANSPARENT);
            w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, w.getDecorView());
            c.setAppearanceLightStatusBars(false);
            c.setAppearanceLightNavigationBars(false);
        }
        if (granted) startCamera();
        else showPanel(texts.camOff, true);
    }

    /** Back from the phone's Settings: the camera may now be allowed. */
    void onPermissionMaybeChanged(boolean nowGranted) {
        if (finished || granted || !nowGranted) return;
        granted = true;
        showPanel(null, false);
        startCamera();
    }

    void close() {
        finished = true;
        stopCamera();
        try { if (isShowing()) dismiss(); } catch (Exception ignored) {}
        restoreOrientation(); // also when the dialog was never shown / already gone
    }

    // ── views ───────────────────────────────────────────────────────────────────────────────
    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getContext().getResources().getDisplayMetrics()));
    }

    private GradientDrawable pill(int fill, int stroke, float radiusDp) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(fill);
        g.setCornerRadius(dp(radiusDp));
        if (stroke != 0) g.setStroke(dp(1), stroke);
        return g;
    }

    private void buildViews() {
        Context ctx = getContext();
        root = new FrameLayout(ctx);
        root.setBackgroundColor(Color.BLACK);

        previewView = new PreviewView(ctx);
        previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);
        root.addView(previewView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        overlay = new FrameOverlay(ctx);
        root.addView(overlay, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout top = new LinearLayout(ctx);
        top.setOrientation(LinearLayout.VERTICAL);
        LinearLayout bar = new LinearLayout(ctx);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        ImageButton closeButton = roundButton(R.drawable.sfl_qr_close, texts.close);
        closeButton.setOnClickListener(v -> { if (!finished) { finished = true; listener.onCancel(); } });
        torchButton = roundButton(R.drawable.sfl_qr_light_off, texts.lightOn);
        torchButton.setVisibility(View.INVISIBLE);
        torchButton.setOnClickListener(v -> setTorch(!torchWanted));
        View spacer = new View(ctx);
        bar.addView(closeButton, new LinearLayout.LayoutParams(dp(46), dp(46)));
        bar.addView(spacer, new LinearLayout.LayoutParams(0, 1, 1f));
        bar.addView(torchButton, new LinearLayout.LayoutParams(dp(46), dp(46)));
        top.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        TextView title = label(texts.title, 19, true);
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        tp.topMargin = dp(10);
        top.addView(title, tp);
        FrameLayout.LayoutParams topLp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP);
        root.addView(top, topLp);

        hintView = label(texts.hint, 15, true);
        root.addView(hintView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP));

        Button photo = new Button(ctx);
        photo.setAllCaps(false);
        photo.setText(texts.photo);
        photo.setTextColor(Color.WHITE);
        photo.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        photo.setTypeface(photo.getTypeface(), android.graphics.Typeface.BOLD);
        photo.setBackground(pill(0x2EFFFFFF, 0x8CFFFFFF, 14));
        photo.setPadding(dp(18), dp(12), dp(18), dp(12));
        photo.setMinHeight(dp(50));
        photo.setOnClickListener(v -> {
            if (finished) return;
            finished = true;
            setTorch(false);
            listener.onPhoto(granted);
        });
        FrameLayout.LayoutParams photoLp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        root.addView(photo, photoLp);

        panel = new LinearLayout(ctx);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER_HORIZONTAL);
        panelText = label("", 17, true);
        settingsButton = new Button(ctx);
        settingsButton.setAllCaps(false);
        settingsButton.setText(texts.openSettings);
        settingsButton.setTextColor(Color.BLACK);
        settingsButton.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        settingsButton.setBackground(pill(Color.WHITE, 0, 12));
        settingsButton.setPadding(dp(22), dp(12), dp(22), dp(12));
        settingsButton.setOnClickListener(v -> listener.onOpenSettings());
        panel.addView(panelText, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        sp.topMargin = dp(16);
        panel.addView(settingsButton, sp);
        panel.setVisibility(View.GONE);
        FrameLayout.LayoutParams panelLp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER);
        panelLp.leftMargin = dp(28);
        panelLp.rightMargin = dp(28);
        root.addView(panel, panelLp);

        // Status bar / gesture bar (Android 15+ draws the app under them): keep the buttons clear.
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            top.setPadding(bars.left + dp(14), bars.top + dp(10), bars.right + dp(14), 0);
            int bottom = bars.bottom + dp(18);
            if (photoLp.bottomMargin != bottom) {
                photoLp.bottomMargin = bottom;
                photo.setLayoutParams(photoLp);
            }
            return insets;
        });
        // The hint sits under the frame; the frame is drawn by the overlay from the view's size.
        root.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> {
            RectF f = overlay.frameRect();
            FrameLayout.LayoutParams hp = (FrameLayout.LayoutParams) hintView.getLayoutParams();
            int topMargin = Math.round(f.bottom) + dp(18);
            if (hp.topMargin == topMargin && hp.leftMargin == dp(24)) return; // no relayout loop
            hp.topMargin = topMargin;
            hp.leftMargin = dp(24);
            hp.rightMargin = dp(24);
            hintView.setLayoutParams(hp);
        });
    }

    private ImageButton roundButton(int icon, String label) {
        ImageButton b = new ImageButton(getContext());
        b.setImageResource(icon);
        b.setBackground(pill(0x73000000, 0, 23));
        b.setContentDescription(label);
        b.setPadding(dp(11), dp(11), dp(11), dp(11));
        b.setScaleType(android.widget.ImageView.ScaleType.FIT_CENTER);
        return b;
    }

    private TextView label(String text, float sp, boolean bold) {
        TextView t = new TextView(getContext());
        t.setText(text);
        t.setTextColor(Color.WHITE);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setGravity(Gravity.CENTER);
        t.setMaxLines(3);
        if (bold) t.setTypeface(t.getTypeface(), android.graphics.Typeface.BOLD);
        return t;
    }

    private void showPanel(String text, boolean settings) {
        if (text == null) {
            panel.setVisibility(View.GONE);
            overlay.setVisibility(View.VISIBLE);
            hintView.setVisibility(View.VISIBLE);
            if (camera != null && camera.getCameraInfo().hasFlashUnit()) torchButton.setVisibility(View.VISIBLE);
            return;
        }
        panelText.setText(text);
        settingsButton.setVisibility(settings ? View.VISIBLE : View.GONE);
        panel.setVisibility(View.VISIBLE);
        overlay.setVisibility(View.INVISIBLE);
        hintView.setVisibility(View.INVISIBLE);
        torchButton.setVisibility(View.INVISIBLE);
    }

    // ── camera ──────────────────────────────────────────────────────────────────────────────
    private void startCamera() {
        if (cameraStarted || finished) return;
        cameraStarted = true;
        ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(getContext());
        future.addListener(() -> {
            try {
                provider = future.get();
                bindCamera();
            } catch (Exception e) {
                showPanel(texts.camBusy, false);
            }
        }, ContextCompat.getMainExecutor(getContext()));
    }

    private void bindCamera() throws Exception {
        if (finished || provider == null) return;
        CameraSelector selector;
        if (provider.hasCamera(CameraSelector.DEFAULT_BACK_CAMERA)) {
            selector = CameraSelector.DEFAULT_BACK_CAMERA;
            mirror = false;
        } else if (provider.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA)) {
            selector = CameraSelector.DEFAULT_FRONT_CAMERA; // front-only device → use it
            mirror = true;
        } else {
            finished = true;
            listener.onNoCamera();
            return;
        }
        ResolutionSelector rs = new ResolutionSelector.Builder()
            .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
            .build();
        preview = new Preview.Builder().setResolutionSelector(rs).build();
        preview.setSurfaceProvider(previewView.getSurfaceProvider());
        analysis = new ImageAnalysis.Builder()
            .setResolutionSelector(rs)
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build();
        scanner = BarcodeScanning.getClient(new BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build());
        analysisExecutor = Executors.newSingleThreadExecutor();
        analysis.setAnalyzer(analysisExecutor, this::analyze);
        LifecycleOwner owner = (LifecycleOwner) activity;
        camera = provider.bindToLifecycle(owner, selector, preview, analysis);
        camera.getCameraInfo().getCameraState().observe(owner, stateObserver);
        owner.getLifecycle().addObserver(resumeObserver);
        torchButton.setVisibility(camera.getCameraInfo().hasFlashUnit() ? View.VISIBLE : View.INVISIBLE);
    }

    private void stopCamera() {
        main.removeCallbacksAndMessages(null);
        try {
            if (camera != null) {
                camera.getCameraControl().enableTorch(false);
                camera.getCameraInfo().getCameraState().removeObserver(stateObserver);
            }
            ((LifecycleOwner) activity).getLifecycle().removeObserver(resumeObserver);
            if (analysis != null) analysis.clearAnalyzer();
            if (provider != null && preview != null && analysis != null) provider.unbind(preview, analysis);
        } catch (Exception ignored) {}
        try { if (scanner != null) scanner.close(); } catch (Exception ignored) {}
        if (analysisExecutor != null) analysisExecutor.shutdown();
        camera = null;
    }

    private void setTorch(boolean on) {
        torchWanted = on;
        if (camera == null || !camera.getCameraInfo().hasFlashUnit()) return;
        camera.getCameraControl().enableTorch(on);
        torchButton.setImageResource(on ? R.drawable.sfl_qr_light_on : R.drawable.sfl_qr_light_off);
        torchButton.setContentDescription(on ? texts.lightOff : texts.lightOn);
    }

    @SuppressLint("UnsafeOptInUsageError")
    private void analyze(ImageProxy proxy) {
        Image media = proxy.getImage();
        if (media == null || finished || scanner == null) {
            proxy.close();
            return;
        }
        int rotation = proxy.getImageInfo().getRotationDegrees();
        final int w = rotation % 180 == 0 ? proxy.getWidth() : proxy.getHeight();
        final int h = rotation % 180 == 0 ? proxy.getHeight() : proxy.getWidth();
        InputImage image = InputImage.fromMediaImage(media, rotation);
        scanner.process(image)
            .addOnSuccessListener(ContextCompat.getMainExecutor(getContext()), codes -> onCodes(codes, w, h))
            .addOnCompleteListener(task -> proxy.close());
    }

    private void onCodes(List<Barcode> codes, int imgW, int imgH) {
        if (finished) return;
        List<QrCentrePick.Hit> hits = new ArrayList<>();
        for (Barcode b : codes) {
            String text = b.getRawValue();
            Rect box = b.getBoundingBox();
            if (text == null || text.isEmpty() || box == null) continue;
            double[] p = QrCentrePick.mapToView(box.exactCenterX(), box.exactCenterY(), imgW, imgH, previewView.getWidth(), previewView.getHeight(), mirror);
            hits.add(new QrCentrePick.Hit(text, p[0], p[1]));
        }
        RectF f = overlay.frameRect();
        QrCentrePick.Verdict v = QrCentrePick.pick(hits.toArray(new QrCentrePick.Hit[0]), f.centerX(), f.centerY(), f.width());
        QrCentrePick.Step step = QrCentrePick.step(streak, v);
        streak = step.streak;
        hintView.setText(step.tie ? texts.one : texts.hint);
        if (step.read != null) read(step.read);
    }

    private void read(String text) {
        finished = true;
        feedback();
        setTorch(false);
        listener.onRead(text);
    }

    private void feedback() {
        try {
            int haptic = Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.VIRTUAL_KEY;
            root.performHapticFeedback(haptic, HapticFeedbackConstants.FLAG_IGNORE_VIEW_SETTING);
        } catch (Exception ignored) {}
        try {
            final ToneGenerator tone = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 80);
            tone.startTone(ToneGenerator.TONE_PROP_BEEP, 120);
            new Handler(Looper.getMainLooper()).postDelayed(tone::release, 300);
        } catch (Exception ignored) {}
    }

    /** Dims everything but the rounded square frame in the middle and draws its white edge. */
    private final class FrameOverlay extends View {
        private final Paint dim = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint edge = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Path path = new Path();

        FrameOverlay(Context ctx) {
            super(ctx);
            dim.setColor(0x8C000000);
            edge.setColor(Color.WHITE);
            edge.setStyle(Paint.Style.STROKE);
            edge.setStrokeWidth(dp(3));
        }

        RectF frameRect() {
            float side = Math.min(Math.min(getWidth(), getHeight()) * 0.68f, dp(320));
            float cx = getWidth() / 2f;
            float cy = getHeight() / 2f;
            return new RectF(cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2);
        }

        @Override
        protected void onDraw(Canvas canvas) {
            RectF f = frameRect();
            float r = dp(22);
            path.reset();
            path.setFillType(Path.FillType.EVEN_ODD);
            path.addRect(0, 0, getWidth(), getHeight(), Path.Direction.CW);
            path.addRoundRect(f, r, r, Path.Direction.CW);
            canvas.drawPath(path, dim);
            canvas.drawRoundRect(f, r, r, edge);
        }
    }
}
