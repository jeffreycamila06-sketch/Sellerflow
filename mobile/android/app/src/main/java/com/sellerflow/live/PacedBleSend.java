package com.sellerflow.live;

import java.util.List;
import java.util.Locale;

/**
 * PACED SEND for ONE printer on Android: the FLASH LABEL Y41BT (scans as "Y41BT-0FC4_LE").
 *
 * Why (Nov 25 2026): on a Samsung A52 the generic send ended with "sent" and no paper, while the same
 * printer prints from an iPhone. The generic send hands the phone pieces as big as the phone and the printer
 * agreed on (up to 509 bytes), one right after the other, and says "sent" 1.5 s after the LAST piece was handed
 * to the phone — whether or not those pieces had reached the printer. For the Y41BT only, Android now sends
 * like this:
 *   1. pieces of at most MAX_CHUNK bytes (never more than the phone and the printer agreed on);
 *   2. the next piece is handed over only after the phone's Bluetooth answered that it took the previous
 *      one, with a pause of GAP_MS (the iPhone app's pause) so that never more than MAX_CHUNK bytes go out
 *      between two pauses — with pieces of 180 bytes that is a pause after every piece; with smaller pieces
 *      (a phone and printer that agreed on less) one pause per 180 bytes, not one per piece;
 *   3. after the last piece the phone asks the printer's Bluetooth ONE small question: it reads a standard,
 *      read-only value (the device name). Bluetooth keeps the order, so the answer can only come back after
 *      every piece before it reached the printer's Bluetooth. Answer → "sent". No answer (time-out, or the
 *      link closed first) → the print is reported as FAILED. A printer that offers no such value ends the
 *      job as before (1.5 s after the last piece).
 * The bytes the printer gets are the same bytes in the same order (PacedBleSendTest). What this still cannot
 * know: whether paper came out — the printer does not say so.
 *
 * Every other printer (AIMO D520BT, Niimbot, Xprinter XP-420B, any other generic model): appliesTo() is
 * false, and GenericBleTransport runs exactly the code it ran before.
 *
 * Pure — no Android imports — so it runs on the plain JVM.
 */
final class PacedBleSend {
    /** Device-name prefixes that get the paced send. ONE printer; add a model only after it was tested on paper. */
    static final String[] NAME_PREFIXES = { "Y41BT" };
    /** Biggest piece (Jeff, Nov 25 2026: "small chunks ~180 bytes"). */
    static final int MAX_CHUNK = 180;
    /**
     * The pause (the iPhone app's). Never more than MAX_CHUNK bytes are handed over between two pauses: after
     * every piece of 180 bytes; with smaller pieces after as many as fit in 180 bytes (9 pieces of 20).
     */
    static final long GAP_MS = 8;
    /**
     * How long the printer's Bluetooth may take to answer the question after the last piece: 8 s, plus 1 s
     * for every 4,000 bytes of the job (pieces the phone already took may still be travelling on a slow
     * link), 20 s at most. The whole job still ends inside GenericBleTransport's 30 s limit.
     */
    static final long CONFIRM_TIMEOUT_MS = 8000;
    static final long CONFIRM_TIMEOUT_MAX_MS = 20000;
    static long confirmTimeoutMs(int jobBytes) {
        return Math.min(CONFIRM_TIMEOUT_MAX_MS, CONFIRM_TIMEOUT_MS + Math.max(0, jobBytes) / 4);
    }
    /** The phone may be busy for a moment right after the last piece: how often the question is handed over again. */
    static final int CONFIRM_START_TRIES = 5;
    static final long CONFIRM_RETRY_MS = 30;
    /** GATT characteristic property bit "can be read" (android.bluetooth value, copied so this stays pure). */
    static final int PROP_READ = 0x02;

    private PacedBleSend() {}

    /** True when ANY of the names (saved name, the name the web sent, the device's own name) is a paced printer. */
    static boolean appliesTo(String... names) {
        if (names == null) return false;
        for (String raw : names) {
            if (raw == null) continue;
            String n = raw.trim().toUpperCase(Locale.US);
            if (n.isEmpty()) continue;
            for (String p : NAME_PREFIXES) if (n.startsWith(p.toUpperCase(Locale.US))) return true;
        }
        return false;
    }

    /**
     * Piece size: what the generic send would use (the size the phone and the printer agreed on, already
     * between 20 and 509), but never more than MAX_CHUNK. Unknown (0 or less) → the smallest size.
     */
    static int chunkSize(int negotiated) {
        if (negotiated <= 0) return BleStickerLogic.MIN_CHUNK;
        return Math.max(BleStickerLogic.MIN_CHUNK, Math.min(negotiated, MAX_CHUNK));
    }

    /**
     * The standard read-only values the question may read, in order: Generic Access (device name, appearance),
     * then Device Information. Never a value of the service that carries the print data.
     */
    static final String[][] CONFIRM_READS = {
        {"1800", "2A00"}, {"1800", "2A01"},
        {"180A", "2A29"}, {"180A", "2A24"}, {"180A", "2A26"}, {"180A", "2A27"}, {"180A", "2A28"}, {"180A", "2A25"},
    };

    /** {service, characteristic} (normalised UUIDs) of the first readable standard value, or null = nothing to ask. */
    static String[] pickConfirmRead(List<BleStickerLogic.Svc> services) {
        if (services == null) return null;
        for (String[] pair : CONFIRM_READS) {
            for (BleStickerLogic.Svc svc : services) {
                if (svc == null || svc.chars == null || !pair[0].equals(BleStickerLogic.normUuid(svc.uuid))) continue;
                for (BleStickerLogic.Chr c : svc.chars) {
                    if (c != null && pair[1].equals(BleStickerLogic.normUuid(c.uuid)) && (c.props & PROP_READ) != 0) {
                        return new String[] { pair[0], pair[1] };
                    }
                }
            }
        }
        return null;
    }

    /**
     * Did the PRINTER's Bluetooth answer the question? 0 = it sent the value; 0x01–0x13 = it sent its own
     * "no" (still an answer, so everything before it arrived). 0x08 is left out: Android uses the same number
     * for a lost link. Anything else is the phone's own failure = no answer.
     */
    static boolean printerAnswered(int status) {
        if (status == 0) return true;
        return status >= 0x01 && status <= 0x13 && status != 0x08;
    }

    /** What GenericBleTransport does next. */
    enum Next {
        /** Nothing: an event nobody was waiting for. */
        IGNORE,
        /** Hand over the next piece after GAP_MS. */
        WRITE_AFTER_GAP,
        /** Hand over the next piece now (small pieces: fewer than MAX_CHUNK bytes went out since the last pause). */
        WRITE_NOW,
        /** Every piece was taken by the phone: ask the printer the question. */
        ASK_CONFIRM,
        /** The phone did not take the question: hand it over again after CONFIRM_RETRY_MS. */
        RETRY_CONFIRM,
        /** The question is on its way: wait for the answer (confirmTimeoutMs at most). */
        WAIT_CONFIRM,
        /** Wait the usual 1.5 s, then report "sent". */
        SETTLE,
        /** Report "sent" now (the link closed while waiting the 1.5 s). */
        DONE_OK,
        /** Failed: the phone reported a piece as not written. */
        FAIL_WRITE,
        /** Failed: the link closed before every piece was taken. */
        FAIL_DISCONNECTED,
        /** Failed: the printer never answered the question. */
        FAIL_NOT_CONFIRMED,
    }

    /** One print job: which piece is next, and whether the printer answered. Not thread-safe — one thread only. */
    static final class Session {
        private static final int C_NOT_ASKED = 0, C_ASKED = 1, C_ANSWERED = 2, C_NOTHING_TO_ASK = 3;

        private final List<byte[]> pieces;
        private final int pieceSize;
        private final int totalBytes;
        private int taken;          // pieces the phone answered "taken" for
        private int sincePause;     // bytes taken since the last pause
        private boolean inFlight;   // one piece was handed over and its answer is not back yet
        private boolean failed;
        private int confirm = C_NOT_ASKED;
        private int confirmTries;

        Session(byte[] payload, int chunkSize) {
            this.pieceSize = Math.max(1, chunkSize);
            this.pieces = BleStickerLogic.chunks(payload, this.pieceSize);
            this.totalBytes = payload == null ? 0 : payload.length;
        }

        List<byte[]> pieces() { return pieces; }
        int pieceSize() { return pieceSize; }
        int totalBytes() { return totalBytes; }
        int taken() { return taken; }
        boolean allTaken() { return taken >= pieces.size(); }
        /** True only when the printer's Bluetooth answered after the last piece. */
        boolean delivered() { return confirm == C_ANSWERED; }
        /** True when the printer offered nothing to read (or the phone never took the question): ended as before. */
        boolean nothingToAsk() { return confirm == C_NOTHING_TO_ASK; }

        /** The piece to hand to the phone now; null while one is in flight, after a failure, or when none is left. */
        byte[] pieceToWrite() {
            if (failed || inFlight || allTaken()) return null;
            return pieces.get(taken);
        }

        /** The phone accepted the hand-over of pieceToWrite(); its answer follows. */
        void onWriteStarted() {
            if (!failed && !allTaken()) inFlight = true;
        }

        /** The phone's answer for the piece in flight. */
        Next onWriteAnswer(boolean ok) {
            if (failed || !inFlight) return Next.IGNORE;
            inFlight = false;
            if (!ok) { failed = true; return Next.FAIL_WRITE; }
            sincePause += pieces.get(taken).length;
            taken++;
            if (allTaken()) return Next.ASK_CONFIRM;
            // pause before a piece that would make it more than MAX_CHUNK bytes since the last pause
            if (sincePause + pieces.get(taken).length > MAX_CHUNK) { sincePause = 0; return Next.WRITE_AFTER_GAP; }
            return Next.WRITE_NOW;
        }

        /**
         * After the last piece. available = the printer offers a value to read; started = the phone took the
         * question.
         */
        Next onConfirmStart(boolean available, boolean started) {
            if (failed || !allTaken() || confirm != C_NOT_ASKED) return Next.IGNORE;
            if (!available) { confirm = C_NOTHING_TO_ASK; return Next.SETTLE; }
            if (started) { confirm = C_ASKED; return Next.WAIT_CONFIRM; }
            confirmTries++;
            if (confirmTries < CONFIRM_START_TRIES) return Next.RETRY_CONFIRM;
            confirm = C_NOTHING_TO_ASK; // the phone never took the question → end as before
            return Next.SETTLE;
        }

        /** The answer to the question (the read's status). */
        Next onConfirmAnswer(int status) {
            if (failed || confirm != C_ASKED) return Next.IGNORE;
            if (printerAnswered(status)) { confirm = C_ANSWERED; return Next.SETTLE; }
            failed = true;
            return Next.FAIL_NOT_CONFIRMED;
        }

        /** confirmTimeoutMs passed without an answer. */
        Next onConfirmTimeout() {
            if (failed || confirm != C_ASKED) return Next.IGNORE;
            failed = true;
            return Next.FAIL_NOT_CONFIRMED;
        }

        /** The link closed. */
        Next onDisconnected() {
            if (failed) return Next.IGNORE;
            if (!allTaken()) { failed = true; return Next.FAIL_DISCONNECTED; }
            if (confirm == C_ANSWERED || confirm == C_NOTHING_TO_ASK) return Next.DONE_OK; // closed during the 1.5 s wait
            failed = true; // the question was not asked yet, or not answered yet
            return Next.FAIL_NOT_CONFIRMED;
        }
    }

    /** phone.write(): the piece was taken over — an answer follows. */
    static final int WRITE_STARTED = 0;
    /** phone.write(): the phone is busy — hand over the SAME piece again after GAP_MS. */
    static final int WRITE_BUSY = 1;
    /** phone.write(): the phone could not write and has reported the failure itself. */
    static final int WRITE_ERROR = 2;

    static final String MSG_WRITE_FAILED = "Printer write failed.";
    static final String MSG_DISCONNECTED = "Printer disconnected during printing.";
    static final String MSG_NOT_CONFIRMED = "The printer did not confirm it received the sticker.";

    /**
     * What the driver needs from the phone. GenericBleTransport gives it the real Bluetooth; the unit test
     * gives it a fake phone with its own clock. Everything is called on ONE thread.
     */
    interface Phone {
        /** Hand one piece to the phone's Bluetooth: WRITE_STARTED, WRITE_BUSY or WRITE_ERROR. */
        int write(byte[] piece);
        /** True when the printer offers a standard value to read. */
        boolean canAsk();
        /** Hand the question to the phone's Bluetooth: true = an answer follows. */
        boolean ask();
        /** Run r after ms; returns a handle for cancel(). */
        Object later(long ms, Runnable r);
        void cancel(Object handle);
        /** A piece was taken (how many so far). */
        void progress(int taken);
        /** Every piece was taken by the phone. */
        void allTaken();
        /** The printer answered the question. */
        void confirmed();
        /** Wait the usual 1.5 s, then report "sent" (the phone calls nothing back for it). */
        void settle();
        /** Report "sent" now. */
        void done();
        /** Report the print as failed. */
        void fail(String message);
    }

    /**
     * Drives one paced job: hands the pieces over one at a time, asks the question, and tells the phone how
     * the job ended — exactly once. All the timing rules of the paced send are here.
     */
    static final class Driver {
        private final Session s;
        private final Phone phone;
        private Object timer;   // the ONE pending timer: the pause before the next piece, or the question's retry / time-out
        private boolean over;   // the job ended (done / failed / stopped): nothing more is sent or reported

        Driver(Session session, Phone phone) {
            this.s = session;
            this.phone = phone;
        }

        Session session() { return s; }
        boolean over() { return over; }

        /** Start sending (call once, when the connection is ready for the data). */
        void start() {
            if (over) return;
            if (s.allTaken()) { phone.allTaken(); askConfirm(); }
            else pump();
        }

        private void pump() {
            timer = null;
            if (over) return;
            byte[] piece = s.pieceToWrite();
            if (piece == null) return; // waiting for the phone's answer, or nothing left
            int w = phone.write(piece);
            if (over) return; // the phone failed the job inside write()
            if (w == WRITE_STARTED) s.onWriteStarted();
            else if (w == WRITE_BUSY) schedule(GAP_MS, this::pump);
            // WRITE_ERROR: the phone reports the failure itself
        }

        /** The phone's answer for the piece in flight (ok = it was written). */
        void onWriteAnswer(boolean ok) {
            if (over) return;
            Next next = s.onWriteAnswer(ok);
            if (next == Next.FAIL_WRITE) { fail(MSG_WRITE_FAILED); return; }
            if (next == Next.WRITE_AFTER_GAP) {
                phone.progress(s.taken());
                schedule(GAP_MS, this::pump);
            } else if (next == Next.WRITE_NOW) {
                phone.progress(s.taken());
                pump();
            } else if (next == Next.ASK_CONFIRM) {
                phone.progress(s.taken());
                phone.allTaken();
                askConfirm();
            }
        }

        private void askConfirm() {
            timer = null;
            if (over) return;
            boolean can = phone.canAsk();
            boolean started = can && phone.ask();
            if (over) return;
            Next next = s.onConfirmStart(can, started);
            if (next == Next.WAIT_CONFIRM) schedule(confirmTimeoutMs(s.totalBytes()), this::onConfirmTimeout);
            else if (next == Next.RETRY_CONFIRM) schedule(CONFIRM_RETRY_MS, this::askConfirm);
            else if (next == Next.SETTLE) phone.settle();
        }

        /** The answer to the question (the read's status). */
        void onConfirmAnswer(int status) {
            if (over) return;
            Next next = s.onConfirmAnswer(status);
            if (next == Next.SETTLE) {
                cancelTimer();
                phone.confirmed();
                phone.settle();
            } else if (next == Next.FAIL_NOT_CONFIRMED) {
                fail(MSG_NOT_CONFIRMED);
            }
        }

        private void onConfirmTimeout() {
            timer = null;
            if (over) return;
            if (s.onConfirmTimeout() == Next.FAIL_NOT_CONFIRMED) fail(MSG_NOT_CONFIRMED);
        }

        /** The link closed. */
        void onDisconnected() {
            if (over) return;
            Next next = s.onDisconnected();
            if (next == Next.DONE_OK) {
                over = true;
                cancelTimer();
                phone.done();
            } else if (next == Next.FAIL_DISCONNECTED) {
                fail(MSG_DISCONNECTED);
            } else if (next == Next.FAIL_NOT_CONFIRMED) {
                fail(MSG_NOT_CONFIRMED);
            }
        }

        /** The job ended for another reason (time-out, the 1.5 s passed, an error): send and report nothing more. */
        void stop() {
            over = true;
            cancelTimer();
        }

        private void fail(String message) {
            over = true;
            cancelTimer();
            phone.fail(message);
        }

        private void schedule(long ms, Runnable r) {
            cancelTimer();
            timer = phone.later(ms, r);
        }

        private void cancelTimer() {
            if (timer != null) { phone.cancel(timer); timer = null; }
        }
    }
}
