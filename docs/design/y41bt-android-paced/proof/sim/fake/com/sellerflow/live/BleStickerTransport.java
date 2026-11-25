package com.sellerflow.live;
/** Only the error type GenericBleTransport uses (the real BleStickerTransport is the AIMO D520BT's own Bluetooth). */
final class BleStickerTransport {
    static final class BtError {
        final String message; final String code;
        BtError(String message, String code) { this.message = message; this.code = code; }
    }
}
