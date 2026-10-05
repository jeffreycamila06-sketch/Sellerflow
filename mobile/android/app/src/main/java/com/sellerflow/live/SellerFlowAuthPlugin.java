package com.sellerflow.live;

import android.content.Intent;
import android.net.Uri;
import androidx.browser.customtabs.CustomTabsIntent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * In-app sign-in sheet for the Facebook Page authorization (app builds 1.8+).
 * JS: window.Capacitor.Plugins.SellerFlowAuth.openAuthSession({ url })
 *   → { status: "connected" | "error" | "cancelled" | "busy", code? }
 *
 * Opens the Facebook dialog URL (from GET /fb/oauth/start?client=app) in a Chrome Custom Tab.
 * Our server's confirm page ends the flow with a 303 to
 * com.sellerflow.live://fb-auth?fb=connected|error&code=…, which MainActivity's intent filter
 * receives; because MainActivity is singleTask, bringing it to the front closes the Custom Tab
 * above it. The URL carries only a status word — never a code, state or token.
 * Closing the tab by hand (X / back) resumes the app with no callback → "cancelled".
 *
 * Separate from SellerFlowPrinterPlugin (not touched). Registered with one line in MainActivity.
 */
@CapacitorPlugin(name = "SellerFlowAuth")
public class SellerFlowAuthPlugin extends Plugin {
    private PluginCall pending;
    private boolean pausedSinceLaunch;

    @PluginMethod
    public void openAuthSession(PluginCall call) {
        String url = call.getString("url", "");
        if (!AuthCallback.isAllowedStartUrl(url)) {
            call.resolve(result("error", "bad_url"));
            return;
        }
        if (pending != null) {
            call.resolve(result("busy", null));
            return;
        }
        try {
            pending = call;
            pausedSinceLaunch = false;
            bridge.saveCall(call);
            CustomTabsIntent tab = new CustomTabsIntent.Builder().setShowTitle(true).build();
            tab.launchUrl(getActivity(), Uri.parse(url));
        } catch (Exception e) {
            finish(result("error", "session_failed"));
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (pending == null || intent == null) return;
        Uri data = intent.getData();
        if (!AuthCallback.isCallback(data == null ? null : data.toString())) return;
        String[] r = AuthCallback.parse(data.toString());
        finish(result(r[0], r[1]));
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        if (pending != null) pausedSinceLaunch = true;
    }

    // Back in the app without a callback (tab closed by hand) → cancelled. A callback arrives
    // through onNewIntent, which Android delivers before onResume, so it is resolved first.
    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (pending != null && pausedSinceLaunch) finish(result("cancelled", null));
    }

    private void finish(JSObject r) {
        PluginCall c = pending;
        pending = null;
        pausedSinceLaunch = false;
        if (c == null) return;
        c.resolve(r);
        bridge.releaseCall(c);
    }

    private static JSObject result(String status, String code) {
        JSObject o = new JSObject();
        o.put("status", status);
        if (code != null) o.put("code", code);
        return o;
    }

    /** Pure helpers (unit-tested in AuthCallbackTest). */
    static final class AuthCallback {
        static final String SCHEME = "com.sellerflow.live";
        static final String HOST = "fb-auth";

        /** Only Facebook's own https pages may be opened in the tab. */
        static boolean isAllowedStartUrl(String url) {
            if (url == null) return false;
            try {
                java.net.URI u = new java.net.URI(url);
                String host = u.getHost() == null ? "" : u.getHost().toLowerCase(java.util.Locale.ROOT);
                return "https".equalsIgnoreCase(u.getScheme()) && (host.equals("facebook.com") || host.endsWith(".facebook.com"));
            } catch (Exception e) {
                return false;
            }
        }

        static boolean isCallback(String url) {
            if (url == null) return false;
            try {
                java.net.URI u = new java.net.URI(url);
                return SCHEME.equalsIgnoreCase(u.getScheme()) && HOST.equalsIgnoreCase(u.getHost());
            } catch (Exception e) {
                return false;
            }
        }

        /** → { status, code-or-null }. Only a short safe word is passed on. */
        static String[] parse(String url) {
            String fb = "";
            String code = "";
            try {
                String q = new java.net.URI(url).getRawQuery();
                if (q != null) {
                    for (String part : q.split("&")) {
                        int i = part.indexOf('=');
                        String k = i < 0 ? part : part.substring(0, i);
                        String v = i < 0 ? "" : java.net.URLDecoder.decode(part.substring(i + 1), "UTF-8");
                        if (k.equals("fb")) fb = v;
                        else if (k.equals("code")) code = v;
                    }
                }
            } catch (Exception e) {
                return new String[] { "error", "bad_callback" };
            }
            if (fb.equals("connected")) return new String[] { "connected", null };
            if (code.equals("cancelled")) return new String[] { "cancelled", null };
            StringBuilder safe = new StringBuilder();
            for (char ch : code.toCharArray()) {
                if (safe.length() >= 40) break;
                if (Character.isLetterOrDigit(ch) || ch == '_') safe.append(ch);
            }
            return new String[] { "error", safe.length() == 0 ? "unknown" : safe.toString() };
        }
    }
}
