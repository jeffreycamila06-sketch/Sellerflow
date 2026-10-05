package com.sellerflow.live;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Pure callback helpers of SellerFlowAuthPlugin (no Android runtime needed). */
public class AuthCallbackTest {
    private static final String CB = "com.sellerflow.live://fb-auth";

    @Test
    public void onlyFacebookHttpsMayBeOpened() {
        assertTrue(SellerFlowAuthPlugin.AuthCallback.isAllowedStartUrl("https://www.facebook.com/v25.0/dialog/oauth?x=1"));
        assertTrue(SellerFlowAuthPlugin.AuthCallback.isAllowedStartUrl("https://facebook.com/dialog"));
        assertFalse(SellerFlowAuthPlugin.AuthCallback.isAllowedStartUrl("http://www.facebook.com/dialog"));
        assertFalse(SellerFlowAuthPlugin.AuthCallback.isAllowedStartUrl("https://evil.com/?facebook.com"));
        assertFalse(SellerFlowAuthPlugin.AuthCallback.isAllowedStartUrl("https://facebook.com.evil.com/"));
        assertFalse(SellerFlowAuthPlugin.AuthCallback.isAllowedStartUrl(""));
        assertFalse(SellerFlowAuthPlugin.AuthCallback.isAllowedStartUrl(null));
    }

    @Test
    public void recognisesOnlyOurCallback() {
        assertTrue(SellerFlowAuthPlugin.AuthCallback.isCallback(CB + "?fb=connected"));
        assertFalse(SellerFlowAuthPlugin.AuthCallback.isCallback("com.sellerflow.live://other?fb=connected"));
        assertFalse(SellerFlowAuthPlugin.AuthCallback.isCallback("https://www.sellerflowlive.com/?fb=connected"));
        assertFalse(SellerFlowAuthPlugin.AuthCallback.isCallback(null));
    }

    @Test
    public void parsesStatusAndSafeCode() {
        assertArrayEquals(new String[] { "connected", null }, SellerFlowAuthPlugin.AuthCallback.parse(CB + "?fb=connected"));
        assertArrayEquals(new String[] { "error", "cap" }, SellerFlowAuthPlugin.AuthCallback.parse(CB + "?fb=error&code=cap"));
        assertArrayEquals(new String[] { "cancelled", null }, SellerFlowAuthPlugin.AuthCallback.parse(CB + "?fb=error&code=cancelled"));
        assertArrayEquals(new String[] { "error", "scriptalert1script" }, SellerFlowAuthPlugin.AuthCallback.parse(CB + "?fb=error&code=%3Cscript%3Ealert(1)%3C/script%3E"));
        assertArrayEquals(new String[] { "error", "unknown" }, SellerFlowAuthPlugin.AuthCallback.parse(CB + "?fb=error"));
    }
}
