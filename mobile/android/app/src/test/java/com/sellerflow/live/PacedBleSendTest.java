package com.sellerflow.live;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.PriorityQueue;
import org.junit.Test;

/**
 * PacedBleSend on the plain JVM (CI cannot build or run the Android Bluetooth code). The Driver is run for
 * real against a FAKE phone with its own clock: which bytes go out, in which order, how far apart, and how
 * the job ends — for the FLASH LABEL Y41BT only. Runs via `./gradlew test`.
 */
public class PacedBleSendTest {

    // ── who gets the paced send ──────────────────────────────────────────────────────────────────────────

    @Test
    public void appliesTo_onlyTheY41bt() {
        assertArrayEquals(new String[] { "Y41BT" }, PacedBleSend.NAME_PREFIXES);
        assertTrue(PacedBleSend.appliesTo("Y41BT-0FC4_LE"));
        assertTrue(PacedBleSend.appliesTo("y41bt-0fc4_le"));
        assertTrue(PacedBleSend.appliesTo("  Y41BT-AB12_LE  "));
        assertTrue(PacedBleSend.appliesTo("Y41BT"));
        // any of the names: the saved name, the name the web sent, the device's own name
        assertTrue(PacedBleSend.appliesTo("", "Y41BT-0FC4_LE"));
        assertTrue(PacedBleSend.appliesTo(null, "Y41BT-0FC4_LE"));
        assertTrue(PacedBleSend.appliesTo("Y41BT-0FC4_LE", null));
    }

    @Test
    public void appliesTo_neverAnyOtherPrinter() {
        String[] others = {
            "D520BT-Z", "D520BT", "d520bt-z",           // AIMO / Phomemo D520BT
            "XP-420B", "XP-420B-1A2B", "xp-420b",        // Xprinter XP-420B
            "B1-I603042141", "B1 Pro-I616030055", "B21-H123", "B203-X", "B3S-X", // Niimbot
            "Printer_Y41BT", "MY Y41BT", "41BT-0FC4", "Y41", "Y41B", "Y4lBT-0FC4", // not a prefix match
            "", "   ", "BT-Printer", "MPT-II", "GP-1324D", "PT-210", "M110", "HPRT MT800",
        };
        for (String n : others) assertFalse(n, PacedBleSend.appliesTo(n));
        // every name on the Android printer-name list, as a bare prefix and with a serial after it
        for (String p : BleStickerLogic.PRINTER_NAME_PREFIXES) {
            assertFalse(p, PacedBleSend.appliesTo(p));
            assertFalse(p, PacedBleSend.appliesTo(p + "1234"));
        }
        assertFalse(PacedBleSend.appliesTo());
        assertFalse(PacedBleSend.appliesTo((String[]) null));
        assertFalse(PacedBleSend.appliesTo((String) null));
        assertFalse(PacedBleSend.appliesTo(null, "", "D520BT-Z", "XP-420B"));
    }

    // ── piece size ───────────────────────────────────────────────────────────────────────────────────────

    @Test
    public void chunkSize_neverOver180_neverOverWhatWasAgreed() {
        assertEquals(180, PacedBleSend.MAX_CHUNK);
        assertEquals(180, PacedBleSend.chunkSize(509)); // the size the generic send uses with MTU 512
        assertEquals(180, PacedBleSend.chunkSize(244)); // MTU 247
        assertEquals(180, PacedBleSend.chunkSize(182)); // MTU 185
        assertEquals(180, PacedBleSend.chunkSize(180));
        assertEquals(179, PacedBleSend.chunkSize(179));
        assertEquals(100, PacedBleSend.chunkSize(100));
        assertEquals(20, PacedBleSend.chunkSize(20));   // MTU 23
        assertEquals(20, PacedBleSend.chunkSize(5));
        assertEquals(20, PacedBleSend.chunkSize(0));    // unknown → the smallest
        assertEquals(20, PacedBleSend.chunkSize(-7));
        // whatever the generic send would use (BleStickerLogic.clampChunkSize), the paced piece is never bigger
        for (int mtuPayload = -3; mtuPayload <= 600; mtuPayload++) {
            int generic = BleStickerLogic.clampChunkSize(mtuPayload <= 0 ? BleStickerLogic.MIN_CHUNK : mtuPayload);
            int paced = PacedBleSend.chunkSize(generic);
            assertTrue(paced <= generic);
            assertTrue(paced <= 180);
            assertTrue(paced >= 20);
        }
    }

    // ── the question after the last piece ────────────────────────────────────────────────────────────────

    private static BleStickerLogic.Svc svc(String uuid, BleStickerLogic.Chr... chars) {
        return new BleStickerLogic.Svc(uuid, Arrays.asList(chars));
    }
    private static BleStickerLogic.Chr chr(String uuid, int props) { return new BleStickerLogic.Chr(uuid, props); }
    private static final int READ = PacedBleSend.PROP_READ;
    private static final int WRITE_NR = BleStickerLogic.PROP_WRITE_NO_RESPONSE;
    private static final int NOTIFY = BleStickerLogic.PROP_NOTIFY;

    @Test
    public void pickConfirmRead_standardReadOnlyValuesOnly() {
        assertEquals(2, PacedBleSend.PROP_READ); // android.bluetooth.BluetoothGattCharacteristic.PROPERTY_READ
        // the device name, in both UUID spellings
        assertArrayEquals(new String[] { "1800", "2A00" }, PacedBleSend.pickConfirmRead(Arrays.asList(
            svc("FF00", chr("FF02", WRITE_NR), chr("FF01", NOTIFY)),
            svc("1800", chr("2A00", READ), chr("2A01", READ)))));
        assertArrayEquals(new String[] { "1800", "2A00" }, PacedBleSend.pickConfirmRead(Collections.singletonList(
            svc("00001800-0000-1000-8000-00805f9b34fb", chr("00002a00-0000-1000-8000-00805f9b34fb", READ)))));
        // device name not readable → the next standard value
        assertArrayEquals(new String[] { "1800", "2A01" }, PacedBleSend.pickConfirmRead(Collections.singletonList(
            svc("1800", chr("2A00", WRITE_NR), chr("2A01", READ)))));
        // only Device Information
        assertArrayEquals(new String[] { "180A", "2A29" }, PacedBleSend.pickConfirmRead(Collections.singletonList(
            svc("180A", chr("2A24", READ), chr("2A29", READ)))));
        // NEVER a value of the service that carries the print data, or any other vendor value
        assertNull(PacedBleSend.pickConfirmRead(Arrays.asList(
            svc("FF00", chr("FF02", WRITE_NR | READ), chr("FF01", NOTIFY | READ)),
            svc("49535343-FE7D-4AE5-8FA9-9FAFD205E455", chr("49535343-8841-43F4-A8D4-ECBE34729BB3", READ | WRITE_NR)),
            svc("1801", chr("2A05", READ)))));
        assertNull(PacedBleSend.pickConfirmRead(Collections.singletonList(svc("1800", chr("2A00", WRITE_NR)))));
        assertNull(PacedBleSend.pickConfirmRead(Collections.<BleStickerLogic.Svc>emptyList()));
        assertNull(PacedBleSend.pickConfirmRead(null));
        for (String[] pair : PacedBleSend.CONFIRM_READS) {
            assertTrue(pair[0], pair[0].equals("1800") || pair[0].equals("180A"));
        }
    }

    @Test
    public void printerAnswered_onlyThePrintersOwnAnswers() {
        assertTrue(PacedBleSend.printerAnswered(0));     // the value came back
        assertTrue(PacedBleSend.printerAnswered(0x02));  // "read not permitted" — still the printer's answer
        assertTrue(PacedBleSend.printerAnswered(0x0A));
        assertTrue(PacedBleSend.printerAnswered(0x13));
        assertFalse(PacedBleSend.printerAnswered(0x08)); // also Android's number for a lost link
        assertFalse(PacedBleSend.printerAnswered(133));  // the phone's own error
        assertFalse(PacedBleSend.printerAnswered(257));
        assertFalse(PacedBleSend.printerAnswered(0x14));
        assertFalse(PacedBleSend.printerAnswered(-1));
    }

    // ── the fake phone ───────────────────────────────────────────────────────────────────────────────────

    /** A phone with its own clock. Events (answers, timers, the link closing) run in time order. */
    private static final class FakePhone implements PacedBleSend.Phone {
        private static final class Ev implements Comparable<Ev> {
            final long at; final long seq; final Runnable run; boolean cancelled;
            Ev(long at, long seq, Runnable run) { this.at = at; this.seq = seq; this.run = run; }
            @Override public int compareTo(Ev o) { return at != o.at ? Long.compare(at, o.at) : Long.compare(seq, o.seq); }
        }
        final PriorityQueue<Ev> queue = new PriorityQueue<>();
        long now;
        long seq;
        PacedBleSend.Driver driver;

        // how this phone behaves
        long answerAfterMs = 3;          // the phone answers a hand-over after this long
        int busyFirst = 0;               // the first N hand-overs are refused (busy)
        int failAnswerAtPiece = -1;      // the answer for this piece (0-based) says "not written"
        int dropAnswerAtPiece = -1;      // no answer ever comes for this piece
        boolean canAsk = true;
        int askRefusedFirst = 0;         // the first N questions are not taken by the phone
        long confirmAfterMs = 40;        // the printer answers the question after this long; < 0 = never
        int confirmStatus = 0;
        int writeErrorAtPiece = -1;      // phone.write() itself fails (and reports the failure)

        // what happened
        final ByteArrayOutputStream sent = new ByteArrayOutputStream();
        final List<Long> handOverAt = new ArrayList<>();
        final List<Long> answerAt = new ArrayList<>();
        final List<Integer> pieceSizes = new ArrayList<>();
        int inFlight, maxInFlight, busyCount, asks, pieces;
        long allTakenAt = -1, confirmedAt = -1, settleAt = -1, doneAt = -1, failAt = -1;
        String failMessage;
        int settles, dones, fails;
        final List<Integer> progress = new ArrayList<>();

        Ev at(long ms, Runnable r) { Ev e = new Ev(now + ms, seq++, r); queue.add(e); return e; }
        /** Run everything that is due, in order, until nothing is left (or the limit of events is reached). */
        void run() {
            int guard = 0;
            while (!queue.isEmpty()) {
                Ev e = queue.poll();
                if (e.cancelled) continue;
                now = Math.max(now, e.at);
                e.run.run();
                if (++guard > 2_000_000) throw new IllegalStateException("the job never ends");
            }
        }
        int pendingTimers() { int n = 0; for (Ev e : queue) if (!e.cancelled) n++; return n; }

        @Override public int write(byte[] piece) {
            if (writeErrorAtPiece == pieces) { driver.stop(); failMessage = "phone error"; fails++; failAt = now; return PacedBleSend.WRITE_ERROR; }
            if (busyCount < busyFirst) { busyCount++; return PacedBleSend.WRITE_BUSY; }
            final int index = pieces++;
            sent.write(piece, 0, piece.length);
            pieceSizes.add(piece.length);
            handOverAt.add(now);
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            if (index != dropAnswerAtPiece) {
                at(answerAfterMs, () -> { inFlight--; answerAt.add(now); driver.onWriteAnswer(index != failAnswerAtPiece); });
            }
            return PacedBleSend.WRITE_STARTED;
        }
        @Override public boolean canAsk() { return canAsk; }
        @Override public boolean ask() {
            asks++;
            if (asks <= askRefusedFirst) return false;
            if (confirmAfterMs >= 0) at(confirmAfterMs, () -> driver.onConfirmAnswer(confirmStatus));
            return true;
        }
        @Override public Object later(long ms, Runnable r) { return at(ms, r); }
        @Override public void cancel(Object handle) { ((Ev) handle).cancelled = true; }
        @Override public void progress(int taken) { progress.add(taken); }
        @Override public void allTaken() { allTakenAt = now; }
        @Override public void confirmed() { confirmedAt = now; }
        @Override public void settle() { settles++; settleAt = now; }
        @Override public void done() { dones++; doneAt = now; }
        @Override public void fail(String message) { fails++; failAt = now; failMessage = message; }
    }

    private static byte[] bytes(int n) {
        byte[] b = new byte[n];
        for (int i = 0; i < n; i++) b[i] = (byte) ((i * 31 + 7) & 0xFF);
        return b;
    }

    private static FakePhone job(byte[] payload, int negotiated, FakePhone phone) {
        PacedBleSend.Session s = new PacedBleSend.Session(payload, PacedBleSend.chunkSize(negotiated));
        phone.driver = new PacedBleSend.Driver(s, phone);
        phone.driver.start();
        phone.run();
        return phone;
    }

    // ── the bytes ────────────────────────────────────────────────────────────────────────────────────────

    @Test
    public void sameBytesSameOrder_whateverTheSize() {
        int[] sizes = { 1, 19, 20, 179, 180, 181, 359, 360, 455, 19_238, 48_077, 120_011 };
        int[] agreed = { 509, 244, 182, 180, 100, 20 };
        for (int n : sizes) {
            for (int a : agreed) {
                byte[] payload = bytes(n);
                FakePhone p = job(payload, a, new FakePhone());
                String what = "bytes=" + n + " agreed=" + a;
                assertArrayEquals(what, payload, p.sent.toByteArray());
                int piece = Math.min(180, a);
                assertEquals(what, (n + piece - 1) / piece, p.pieces);
                for (int size : p.pieceSizes) assertTrue(what, size >= 1 && size <= piece);
                assertEquals(what, 1, p.maxInFlight);
                assertEquals(what, 1, p.settles);
                assertEquals(what, 0, p.fails);
                assertTrue(what, p.driver.session().delivered());
                assertEquals(what, 0, p.pendingTimers());
            }
        }
    }

    @Test
    public void samePiecesAsTheGenericSplit_onlySmaller() {
        // the paced pieces are BleStickerLogic.chunks() at the paced size — the same split code every printer uses
        byte[] payload = bytes(1000);
        PacedBleSend.Session s = new PacedBleSend.Session(payload, PacedBleSend.chunkSize(509));
        List<byte[]> expected = BleStickerLogic.chunks(payload, 180);
        assertEquals(expected.size(), s.pieces().size());
        for (int i = 0; i < expected.size(); i++) assertArrayEquals(expected.get(i), s.pieces().get(i));
        assertEquals(180, s.pieceSize());
    }

    // ── the pace ─────────────────────────────────────────────────────────────────────────────────────────

    @Test
    public void nextPieceOnlyAfterTheAnswerPlusThePause() {
        assertEquals(8, PacedBleSend.GAP_MS);
        for (long answerMs : new long[] { 0, 1, 3, 25, 400 }) {
            FakePhone phone = new FakePhone();
            phone.answerAfterMs = answerMs;
            FakePhone p = job(bytes(180 * 40 + 5), 509, phone);
            assertEquals(41, p.pieces);
            assertEquals(1, p.maxInFlight);
            for (int i = 1; i < p.handOverAt.size(); i++) {
                long sinceAnswer = p.handOverAt.get(i) - p.answerAt.get(i - 1);
                assertEquals("answer after " + answerMs + " ms, piece " + i, PacedBleSend.GAP_MS, sinceAnswer);
            }
            // never faster than one piece of 180 bytes per 8 ms
            long sendMs = p.allTakenAt;
            assertTrue(sendMs >= (p.pieces - 1) * PacedBleSend.GAP_MS);
            assertEquals(1, p.settles);
        }
    }

    @Test
    public void busyPhone_samePieceAgain_nothingSkippedOrDoubled() {
        FakePhone phone = new FakePhone();
        phone.busyFirst = 7;
        byte[] payload = bytes(1000);
        FakePhone p = job(payload, 509, phone);
        assertEquals(7, p.busyCount);
        assertArrayEquals(payload, p.sent.toByteArray());
        assertEquals(6, p.pieces);
        // the first piece really went out only after the 7 refusals, 8 ms apart
        assertEquals(7 * PacedBleSend.GAP_MS, (long) p.handOverAt.get(0));
        assertEquals(1, p.settles);
        assertEquals(0, p.fails);
    }

    @Test
    public void progressIsReportedForEveryPiece_andAllTakenOnce() {
        FakePhone p = job(bytes(900), 509, new FakePhone());
        assertEquals(Arrays.asList(1, 2, 3, 4, 5), p.progress);
        assertTrue(p.allTakenAt >= 0);
    }

    // ── "sent" only when it really went through ──────────────────────────────────────────────────────────

    @Test
    public void sentOnlyAfterThePrinterAnswered() {
        FakePhone phone = new FakePhone();
        phone.confirmAfterMs = 700; // a slow link: the pieces need 700 ms more to reach the printer
        FakePhone p = job(bytes(2000), 509, phone);
        assertEquals(1, p.asks);
        assertEquals(1, p.settles);
        assertEquals(p.allTakenAt + 700, p.settleAt); // the 1.5 s wait starts at the ANSWER, not at the last hand-over
        assertEquals(p.settleAt, p.confirmedAt);
        assertTrue(p.driver.session().delivered());
        assertEquals(0, p.fails);
        assertEquals(0, p.pendingTimers()); // the time-out was cancelled
    }

    @Test
    public void printersOwnNoIsStillAnAnswer() {
        FakePhone phone = new FakePhone();
        phone.confirmStatus = 0x02; // "read not permitted"
        FakePhone p = job(bytes(500), 509, phone);
        assertEquals(1, p.settles);
        assertTrue(p.driver.session().delivered());
    }

    @Test
    public void noAnswer_isReportedAsFailed_notAsSent() {
        FakePhone phone = new FakePhone();
        phone.confirmAfterMs = -1; // the printer never answers
        FakePhone p = job(bytes(2000), 509, phone);
        assertEquals(0, p.settles);
        assertEquals(0, p.dones);
        assertEquals(1, p.fails);
        assertEquals(PacedBleSend.MSG_NOT_CONFIRMED, p.failMessage);
        assertEquals(p.allTakenAt + PacedBleSend.confirmTimeoutMs(2000), p.failAt);
        assertEquals(8500, PacedBleSend.confirmTimeoutMs(2000));
        assertFalse(p.driver.session().delivered());
        assertTrue(p.driver.over());
    }

    @Test
    public void theWaitForTheAnswerGrowsWithTheJob_neverOver20s() {
        assertEquals(8000, PacedBleSend.confirmTimeoutMs(0));
        assertEquals(8000, PacedBleSend.confirmTimeoutMs(-5));
        assertEquals(12809, PacedBleSend.confirmTimeoutMs(19_238)); // a 60x40 sticker
        assertEquals(20000, PacedBleSend.confirmTimeoutMs(48_000)); // 100x60
        assertEquals(20000, PacedBleSend.confirmTimeoutMs(500_000));
        // a slow link: the answer comes 11 s after the last piece of a 19 kB job — still "sent"
        FakePhone phone = new FakePhone();
        phone.confirmAfterMs = 11_000;
        FakePhone p = job(bytes(19_238), 509, phone);
        assertEquals(1, p.settles);
        assertEquals(0, p.fails);
        assertTrue(p.driver.session().delivered());
        // …and 13 s is too late for that job
        FakePhone late = new FakePhone();
        late.confirmAfterMs = 13_000;
        FakePhone q = job(bytes(19_238), 509, late);
        assertEquals(1, q.fails);
        assertEquals(0, q.settles);
    }

    @Test
    public void phonesOwnErrorForTheQuestion_isFailed() {
        for (int status : new int[] { 133, 257, 0x08, -1 }) {
            FakePhone phone = new FakePhone();
            phone.confirmStatus = status;
            FakePhone p = job(bytes(500), 509, phone);
            assertEquals("status " + status, 1, p.fails);
            assertEquals(PacedBleSend.MSG_NOT_CONFIRMED, p.failMessage);
            assertEquals(0, p.settles);
            assertEquals(0, p.pendingTimers());
        }
    }

    @Test
    public void aPieceNotWritten_isFailed_andNothingMoreIsSent() {
        FakePhone phone = new FakePhone();
        phone.failAnswerAtPiece = 3;
        FakePhone p = job(bytes(180 * 10), 509, phone);
        assertEquals(1, p.fails);
        assertEquals(PacedBleSend.MSG_WRITE_FAILED, p.failMessage);
        assertEquals(4, p.pieces); // pieces 0..3 went out, nothing after the failure
        assertEquals(0, p.asks);
        assertEquals(0, p.settles);
        assertEquals(0, p.pendingTimers());
    }

    @Test
    public void anAnswerThatNeverComes_sendsNothingMore() {
        // the stall watchdog of GenericBleTransport ends such a job (12 s); the driver itself never sends past it
        FakePhone phone = new FakePhone();
        phone.dropAnswerAtPiece = 2;
        FakePhone p = job(bytes(180 * 10), 509, phone);
        assertEquals(3, p.pieces);
        assertEquals(0, p.asks);
        assertEquals(0, p.settles);
        assertEquals(0, p.fails);
        assertFalse(p.driver.over());
        p.driver.stop(); // what the watchdog's failure does
        assertTrue(p.driver.over());
        p.driver.onWriteAnswer(true); // a late answer changes nothing
        p.run();
        assertEquals(3, p.pieces);
    }

    @Test
    public void phoneFailsInsideWrite_nothingMoreHappens() {
        FakePhone phone = new FakePhone();
        phone.writeErrorAtPiece = 2;
        FakePhone p = job(bytes(180 * 6), 509, phone);
        assertEquals(2, p.pieces);
        assertEquals(1, p.fails); // reported once, by the phone
        assertEquals(0, p.settles);
        assertEquals(0, p.pendingTimers());
    }

    @Test
    public void nothingToAsk_endsLikeBefore() {
        FakePhone phone = new FakePhone();
        phone.canAsk = false;
        FakePhone p = job(bytes(2000), 509, phone);
        assertEquals(0, p.asks);
        assertEquals(1, p.settles);
        assertEquals(p.allTakenAt, p.settleAt); // right after the last piece was taken, as every generic printer
        assertFalse(p.driver.session().delivered());
        assertTrue(p.driver.session().nothingToAsk());
        assertEquals(0, p.fails);
    }

    @Test
    public void phoneBusyForTheQuestion_isAskedAgain_thenGivenUpAsNothingToAsk() {
        FakePhone phone = new FakePhone();
        phone.askRefusedFirst = 2;
        FakePhone p = job(bytes(500), 509, phone);
        assertEquals(3, p.asks);
        assertTrue(p.driver.session().delivered());
        assertEquals(p.allTakenAt + 2 * PacedBleSend.CONFIRM_RETRY_MS + phone.confirmAfterMs, p.settleAt);

        FakePhone never = new FakePhone();
        never.askRefusedFirst = 99;
        FakePhone q = job(bytes(500), 509, never);
        assertEquals(PacedBleSend.CONFIRM_START_TRIES, q.asks);
        assertEquals(1, q.settles);
        assertFalse(q.driver.session().delivered());
        assertTrue(q.driver.session().nothingToAsk());
        assertEquals(0, q.fails);
    }

    // ── the link closes ──────────────────────────────────────────────────────────────────────────────────

    private static FakePhone jobWithDisconnect(long atMs, FakePhone phone, int bytes) {
        PacedBleSend.Session s = new PacedBleSend.Session(bytes(bytes), PacedBleSend.chunkSize(509));
        phone.driver = new PacedBleSend.Driver(s, phone);
        phone.at(atMs, () -> phone.driver.onDisconnected());
        phone.driver.start();
        phone.run();
        return phone;
    }

    @Test
    public void linkClosesWhileSending_isFailed() {
        FakePhone p = jobWithDisconnect(30, new FakePhone(), 180 * 50);
        assertEquals(1, p.fails);
        assertEquals(PacedBleSend.MSG_DISCONNECTED, p.failMessage);
        assertEquals(0, p.settles);
        assertTrue(p.pieces < 50);
        int sentBefore = p.pieces;
        p.run();
        assertEquals(sentBefore, p.pieces); // nothing more after the failure
        assertEquals(0, p.pendingTimers());
    }

    @Test
    public void linkClosesBeforeThePrinterAnswered_isFailed_notSent() {
        FakePhone phone = new FakePhone();
        phone.confirmAfterMs = 5000;
        // 2 pieces: taken at 3 and 14 ms; the question is on its way; the link closes at 200 ms
        FakePhone p = jobWithDisconnect(200, phone, 300);
        assertEquals(1, p.fails);
        assertEquals(PacedBleSend.MSG_NOT_CONFIRMED, p.failMessage);
        assertEquals(0, p.settles);
        assertEquals(0, p.dones);
        assertFalse(p.driver.session().delivered());
    }

    @Test
    public void linkClosesAfterThePrinterAnswered_isSent() {
        FakePhone phone = new FakePhone();
        phone.confirmAfterMs = 40;
        FakePhone p = jobWithDisconnect(500, phone, 300); // answered at ~54 ms; the printer closes the link during the 1.5 s
        assertEquals(1, p.settles);
        assertEquals(1, p.dones);
        assertEquals(0, p.fails);
        assertTrue(p.driver.session().delivered());
    }

    @Test
    public void linkClosesWithNothingToAsk_isSentLikeBefore() {
        FakePhone phone = new FakePhone();
        phone.canAsk = false;
        FakePhone p = jobWithDisconnect(500, phone, 300);
        assertEquals(1, p.dones);
        assertEquals(0, p.fails);
    }

    @Test
    public void theJobEndsOnce_lateEventsChangeNothing() {
        FakePhone p = job(bytes(700), 509, new FakePhone());
        assertEquals(1, p.settles);
        // the 1.5 s passed and GenericBleTransport reported "sent": it stops the driver
        p.driver.stop();
        p.driver.onWriteAnswer(true);
        p.driver.onWriteAnswer(false);
        p.driver.onConfirmAnswer(0);
        p.driver.onConfirmAnswer(133);
        p.driver.onDisconnected();
        p.driver.start();
        p.run();
        assertEquals(1, p.settles);
        assertEquals(0, p.dones);
        assertEquals(0, p.fails);
        assertEquals(4, p.pieces);
    }

    @Test
    public void emptyJob_asksAndEnds() {
        FakePhone p = job(new byte[0], 509, new FakePhone());
        assertEquals(0, p.pieces);
        assertEquals(1, p.asks);
        assertEquals(1, p.settles);
        assertEquals(0, p.fails);
    }

    // ── the session alone (answers nobody waits for) ─────────────────────────────────────────────────────

    @Test
    public void session_oneInFlight_strayAnswersIgnored() {
        PacedBleSend.Session s = new PacedBleSend.Session(bytes(400), 180);
        assertEquals(3, s.pieces().size());
        assertEquals(PacedBleSend.Next.IGNORE, s.onWriteAnswer(true)); // nothing handed over yet
        byte[] first = s.pieceToWrite();
        assertNotNull(first);
        assertSame(first, s.pieceToWrite()); // not started → the same piece
        s.onWriteStarted();
        assertNull(s.pieceToWrite());         // one in flight → nothing to hand over
        assertEquals(PacedBleSend.Next.WRITE_AFTER_GAP, s.onWriteAnswer(true));
        assertEquals(PacedBleSend.Next.IGNORE, s.onWriteAnswer(true)); // a second answer for the same piece
        assertEquals(1, s.taken());
        assertEquals(PacedBleSend.Next.IGNORE, s.onConfirmStart(true, true)); // not all taken yet
        assertEquals(PacedBleSend.Next.IGNORE, s.onConfirmAnswer(0));
        assertEquals(PacedBleSend.Next.IGNORE, s.onConfirmTimeout());
        s.onWriteStarted();
        assertEquals(PacedBleSend.Next.WRITE_AFTER_GAP, s.onWriteAnswer(true));
        s.onWriteStarted();
        assertEquals(PacedBleSend.Next.ASK_CONFIRM, s.onWriteAnswer(true));
        assertTrue(s.allTaken());
        assertNull(s.pieceToWrite());
        assertFalse(s.delivered());
        assertEquals(PacedBleSend.Next.WAIT_CONFIRM, s.onConfirmStart(true, true));
        assertEquals(PacedBleSend.Next.IGNORE, s.onConfirmStart(true, true)); // asked once
        assertEquals(PacedBleSend.Next.SETTLE, s.onConfirmAnswer(0));
        assertTrue(s.delivered());
        assertEquals(PacedBleSend.Next.IGNORE, s.onConfirmAnswer(0));
        assertEquals(PacedBleSend.Next.IGNORE, s.onConfirmTimeout());
        assertEquals(PacedBleSend.Next.DONE_OK, s.onDisconnected());
    }

    @Test
    public void session_afterAFailure_everythingIsIgnored() {
        PacedBleSend.Session s = new PacedBleSend.Session(bytes(400), 180);
        s.onWriteStarted();
        assertEquals(PacedBleSend.Next.FAIL_WRITE, s.onWriteAnswer(false));
        assertNull(s.pieceToWrite());
        assertEquals(PacedBleSend.Next.IGNORE, s.onWriteAnswer(true));
        assertEquals(PacedBleSend.Next.IGNORE, s.onConfirmStart(true, true));
        assertEquals(PacedBleSend.Next.IGNORE, s.onDisconnected());
        assertFalse(s.delivered());

        PacedBleSend.Session t = new PacedBleSend.Session(bytes(100), 180);
        t.onWriteStarted();
        assertEquals(PacedBleSend.Next.ASK_CONFIRM, t.onWriteAnswer(true));
        // the link closes after the last piece was taken but before the question was asked → not confirmed
        assertEquals(PacedBleSend.Next.FAIL_NOT_CONFIRMED, t.onDisconnected());
    }
}
