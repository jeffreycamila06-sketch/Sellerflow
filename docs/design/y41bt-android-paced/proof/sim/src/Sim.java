package com.sellerflow.live;

import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattService;
import android.content.Context;
import android.os.Build;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import sim.World;

/**
 * Runs the REAL GenericBleTransport (main's or this branch's — whichever is on the classpath) against the
 * pretend phone + printer in fake/. Usage:
 *   Sim others   → the scenarios for printers that are NOT a Y41BT; prints the full trace (main and the
 *                  branch must print the same text)
 *   Sim y41      → the Y41BT scenarios; prints the trace + the checks
 */
public final class Sim {
    private static UUID u(String s) { return UUID.fromString(s.length() == 4 ? "0000" + s + "-0000-1000-8000-00805f9b34fb" : s); }
    private static final int READ = 0x02, WRITE_NR = 0x04, WRITE = 0x08, NOTIFY = 0x10;

    private static BluetoothGattService service(String id, Object... chars) {
        BluetoothGattService s = new BluetoothGattService(u(id));
        for (int i = 0; i < chars.length; i += 2) {
            int props = (Integer) chars[i + 1];
            s.chars.add(new BluetoothGattCharacteristic(u((String) chars[i]), props, (props & NOTIFY) != 0));
        }
        return s;
    }

    /** A printer laid out like the common TSPL chips: standard services + FF00 (FF02 write, FF01/FF03 notify). */
    static BluetoothGatt.Printer printer(String name) {
        BluetoothGatt.Printer p = new BluetoothGatt.Printer();
        p.deviceName = name;
        p.services.add(service("1800", "2A00", READ, "2A01", READ));
        p.services.add(service("1801", "2A05", 0x20));
        p.services.add(service("FF00", "FF01", NOTIFY, "FF02", WRITE_NR | WRITE, "FF03", NOTIFY));
        return p;
    }

    static byte[] bytes(int n) {
        byte[] b = new byte[n];
        for (int i = 0; i < n; i++) b[i] = (byte) ((i * 131 + 17) & 0xFF);
        return b;
    }

    static final class Outcome {
        boolean called; String error; String code; boolean confirmed; int chunks, mtu; Boolean paced, delivered;
        long at;
        BluetoothGatt.Printer printer; byte[] payload; List<String> trace;
        boolean ok() { return called && error == null; }
        boolean printerGotEverything() { return Arrays.equals(printer.arrived.toByteArray(), payload); }
    }

    static Context sharedCtx;
    static GenericBleTransport sharedTransport;

    static Outcome run(String title, BluetoothGatt.Printer p, int api, int size, String nameHint) throws Exception {
        return run(title, p, api, size, nameHint, false);
    }

    /** sameApp = the SAME GenericBleTransport object as the job before (the app keeps one for its whole life). */
    static Outcome run(String title, BluetoothGatt.Printer p, int api, int size, String nameHint, boolean sameApp) throws Exception {
        World.reset();
        Build.VERSION.SDK_INT = api;
        if (!sameApp || sharedTransport == null) { sharedCtx = new Context(); sharedTransport = new GenericBleTransport(sharedCtx); }
        Context ctx = sharedCtx;
        ctx.manager.adapter.device = new BluetoothDevice(p);
        byte[] payload = bytes(size);
        p.expectBytes = size;
        GenericBleTransport t = sharedTransport;
        final Outcome o = new Outcome();
        o.printer = p; o.payload = payload;
        GenericBleTransport.Callback cb = r -> {
            o.called = true; o.at = World.now;
            if (r.error != null) { o.error = r.error.message; o.code = r.error.code; }
            o.confirmed = r.confirmed; o.chunks = r.chunks; o.mtu = r.mtu;
            try {
                Field f = r.getClass().getDeclaredField("paced"); o.paced = f.getBoolean(r);
                Field d = r.getClass().getDeclaredField("delivered"); o.delivered = d.getBoolean(r);
            } catch (NoSuchFieldException e) { /* main: no such fields */ } catch (Exception e) { throw new RuntimeException(e); }
            World.say("RESULT " + (r.error == null ? "sent" : "FAILED " + r.error.code + " \"" + r.error.message + "\"")
                + " chunks=" + r.chunks + " mtu=" + r.mtu + " confirmed=" + r.confirmed
                + " | printer has " + p.arrived.size() + " of " + size + " bytes" + (Arrays.equals(p.arrived.toByteArray(), payload) ? " (all, in order)" : ""));
        };
        Method m = null;
        for (Method x : GenericBleTransport.class.getDeclaredMethods()) if (x.getName().equals("printJob")) m = x;
        m.setAccessible(true);
        if (m.getParameterCount() == 3) m.invoke(t, payload, "AA:BB:CC:DD:EE:FF", cb);
        else m.invoke(t, payload, "AA:BB:CC:DD:EE:FF", nameHint, cb);
        World.run(120_000);
        o.trace = new ArrayList<>(World.trace);
        System.out.println("── " + title + " ──");
        return o;
    }

    static void print(Outcome o, boolean full) {
        List<String> t = o.trace;
        if (full || t.size() <= 40) { for (String l : t) System.out.println(l); }
        else {
            for (String l : t.subList(0, 16)) System.out.println(l);
            System.out.println("            … " + (t.size() - 28) + " more lines …");
            for (String l : t.subList(t.size() - 12, t.size())) System.out.println(l);
        }
        if (!o.called) System.out.println("            (the job never reported a result)");
        System.out.println();
    }

    // ── printers that are NOT a Y41BT: main and the branch must do exactly the same ───────────────────────
    static void others() throws Exception {
        String[] names = { "XP-420B", "Printer_8A2F", "" };
        for (String name : names) {
            String who = name.isEmpty() ? "(no name)" : name;
            BluetoothGatt.Printer p;

            p = printer(name);
            print(run(who + " · Android 14 · agreed 512 · 19,238 bytes", p, 34, 19_238, name), true);

            p = printer(name); p.grantMtu = 247;
            print(run(who + " · Android 14 · agreed 247 · 5,000 bytes", p, 34, 5_000, name), true);

            p = printer(name); p.grantMtu = 0;
            print(run(who + " · Android 14 · size cannot be agreed · 600 bytes", p, 34, 600, name), true);

            p = printer(name); p.grantMtu = -1;
            print(run(who + " · Android 14 · size never answered · 300 bytes", p, 34, 300, name), true);

            p = printer(name);
            print(run(who + " · Android 12 · agreed 512 · 19,238 bytes", p, 31, 19_238, name), true);

            p = printer(name); p.refuseEvery = 5;
            print(run(who + " · Android 12 · phone busy now and then · 6,000 bytes", p, 31, 6_000, name), true);

            p = printer(name); p.services.remove(2); p.services.add(service("FF00", "FF01", NOTIFY, "FF02", WRITE));
            print(run(who + " · Android 14 · printer only takes writes WITH response · 3,000 bytes", p, 34, 3_000, name), true);

            p = printer(name); p.failWriteAt = 3;
            print(run(who + " · Android 14 · a write fails", p, 34, 6_000, name), true);

            p = printer(name); p.dropLinkAtMs = 700;
            print(run(who + " · Android 14 · the link closes while sending", p, 34, 60_000, name), true);

            p = printer(name); p.closesLinkAfterPrinting = true;
            print(run(who + " · Android 14 · the printer closes the link after printing", p, 34, 4_000, name), true);

            p = printer(name); p.notifyWhenArrived = "SSGETPRINTING:DONE";
            print(run(who + " · Android 14 · the printer says PRINTING:DONE", p, 34, 4_000, name), true);

            p = printer(name); p.linkBytesPerSec = 3000; p.phoneQueueBytes = 12000;
            print(run(who + " · Android 14 · SLOW link (3 kB/s), phone queue 12 kB · 19,238 bytes", p, 34, 19_238, name), true);

            p = printer(name); p.services.clear(); p.services.add(service("1800", "2A00", READ));
            print(run(who + " · Android 14 · nothing to write to", p, 34, 500, name), true);
        }
    }

    // ── the Y41BT ─────────────────────────────────────────────────────────────────────────────────────────
    private static int pass, fail;
    static void check(String what, boolean ok) {
        if (ok) pass++; else fail++;
        System.out.println((ok ? "   ok    " : "   FAIL  ") + what);
    }
    static int maxWriteLen(Outcome o) {
        int max = 0;
        for (String l : o.trace) { int i = l.indexOf(" len="); if (l.contains("APP write #") && i > 0) max = Math.max(max, Integer.parseInt(l.substring(i + 5, l.indexOf(' ', i + 5)))); }
        return max;
    }
    static int count(Outcome o, String needle) { int n = 0; for (String l : o.trace) if (l.contains(needle)) n++; return n; }
    static long timeOf(Outcome o, String needle) { for (String l : o.trace) if (l.contains(needle)) return Long.parseLong(l.trim().split(" ")[0]); return -1; }
    static long lastTimeOf(Outcome o, String needle) { long t = -1; for (String l : o.trace) if (l.contains(needle)) t = Long.parseLong(l.trim().split(" ")[0]); return t; }
    static boolean isBranch() { try { Class.forName("com.sellerflow.live.PacedBleSend"); return true; } catch (ClassNotFoundException e) { return false; } }

    static void y41() throws Exception {
        final String Y = "Y41BT-0FC4_LE";
        boolean branch = isBranch();
        System.out.println(branch ? "THIS BRANCH (paced send for the Y41BT)\n" : "MAIN (today's send — the Y41BT is sent like every generic printer)\n");
        BluetoothGatt.Printer p;
        Outcome o;

        p = printer(Y);
        o = run("Y41BT · Android 14 · agreed 512 · 19,238 bytes · normal link", p, 34, 19_238, Y); print(o, false);
        if (branch) {
            check("reported sent", o.ok());
            check("no piece bigger than 180 bytes (biggest: " + maxWriteLen(o) + ")", maxWriteLen(o) <= 180);
            check("107 pieces (19,238 / 180)", o.chunks == 107 && count(o, "APP write #") == 107);
            check("the printer got every byte, in order", o.printerGotEverything());
            check("one question after the last piece (read 2A00)", count(o, "APP read 2A00") == 1 && timeOf(o, "APP read 2A00") >= lastTimeOf(o, "APP write #"));
            check("\"sent\" only after the printer had every byte", timeOf(o, "PRINTER has every byte") >= 0 && o.at >= timeOf(o, "PRINTER has every byte"));
            check("the link is closed only after the printer had every byte", timeOf(o, "APP disconnect") >= timeOf(o, "PRINTER has every byte"));
            check("answer fields: paced=true delivered=true", Boolean.TRUE.equals(o.paced) && Boolean.TRUE.equals(o.delivered));
        }

        p = printer(Y); p.linkBytesPerSec = 3000; p.phoneQueueBytes = 12000;
        o = run("Y41BT · Android 14 · SLOW link (3 kB/s), the phone queues up to 12 kB · 19,238 bytes", p, 34, 19_238, Y); print(o, false);
        if (branch) {
            check("reported sent", o.ok());
            check("the printer got every byte, in order (nothing lost at the end)", o.printerGotEverything() && p.lost == 0);
            check("\"sent\" only after the printer had every byte", o.at >= timeOf(o, "PRINTER has every byte") && timeOf(o, "PRINTER has every byte") >= 0);
        } else {
            System.out.println("   (main, in this model: reported " + (o.ok() ? "SENT" : "failed") + " while the printer has " + p.arrived.size() + " of 19,238 bytes — " + p.lost + " lost when the link was closed)");
        }

        if (!branch) { System.out.println(); return; }

        p = printer(Y); p.answersRead = false;
        o = run("Y41BT · the printer never answers the question", p, 34, 5_000, Y); print(o, false);
        check("reported FAILED, not sent", !o.ok() && "BT_PRINT_FAILED".equals(o.code) && "The printer did not confirm it received the sticker.".equals(o.error));
        check("the failure comes 9.25 s after the question (8 s + 1 s per 4,000 bytes of the job)", o.at - lastTimeOf(o, "APP read 2A00") == 9250);

        p = printer(Y); p.linkBytesPerSec = 2000; p.phoneQueueBytes = 20000; p.dropLinkAtMs = 2500;
        o = run("Y41BT · the link closes before the printer answered (slow link)", p, 34, 6_000, Y); print(o, false);
        check("reported FAILED, not sent", !o.ok());
        check("the printer really did not get everything", !o.printerGotEverything());

        p = printer(Y); p.services.remove(0);
        o = run("Y41BT · a printer with no standard value to read", p, 34, 5_000, Y); print(o, false);
        check("reported sent, the old way (1.5 s after the last piece)", o.ok() && count(o, "APP read") == 0);
        check("still pieces of at most 180 bytes, one at a time", maxWriteLen(o) <= 180 && o.printerGotEverything());
        check("answer fields: paced=true delivered=false", Boolean.TRUE.equals(o.paced) && Boolean.FALSE.equals(o.delivered));

        p = printer(Y);
        o = run("Y41BT · Android 12 (the older write call)", p, 31, 5_000, Y); print(o, false);
        check("reported sent, every byte arrived, pieces ≤ 180", o.ok() && o.printerGotEverything() && maxWriteLen(o) <= 180);
        check("no hand-over was refused as busy (one piece at a time)", count(o, "REFUSED") == 0);

        p = printer(Y); p.refuseEvery = 4;
        o = run("Y41BT · the phone is busy now and then", p, 34, 5_000, Y); print(o, false);
        check("reported sent, every byte arrived in order", o.ok() && o.printerGotEverything());

        p = printer(Y); p.failWriteAt = 5;
        o = run("Y41BT · a write fails", p, 34, 5_000, Y); print(o, false);
        check("reported FAILED \"Printer write failed.\"", !o.ok() && "Printer write failed.".equals(o.error));
        check("nothing was handed over after the failed piece", count(o, "APP write #") == 6);

        p = printer(Y); p.grantMtu = 23;
        o = run("Y41BT · the phone and printer agree on the smallest size (20 bytes)", p, 34, 700, Y); print(o, false);
        check("pieces of 20 bytes, sent", o.ok() && maxWriteLen(o) == 20 && o.printerGotEverything());

        p = printer(Y); p.grantMtu = 23; p.connectMs = 1500; p.writeAnswerMs = 4;
        o = run("Y41BT · smallest size (20 bytes) and a 100x60 sticker (48,040 bytes)", p, 34, 48_040, Y); print(o, false);
        check("sent, every byte arrived, inside the 30 s a job may take (at " + o.at + " ms)", o.ok() && o.printerGotEverything() && o.at < 30_000);
        check("2,402 pieces of 20 bytes", count(o, "APP write #") == 2402 && maxWriteLen(o) == 20);

        p = printer(Y); p.grantMtu = -1; p.connectMs = 1500; p.writeAnswerMs = 4;
        o = run("Y41BT · the size is never agreed (20 bytes after 3 s) and an 80x60 sticker (38,440 bytes)", p, 34, 38_440, Y); print(o, false);
        check("sent, every byte arrived, inside 30 s (at " + o.at + " ms)", o.ok() && o.printerGotEverything() && o.at < 30_000);

        p = printer(Y); p.services.remove(2); p.services.add(service("FF00", "FF01", NOTIFY, "FF02", WRITE));
        o = run("Y41BT · a unit that only takes writes WITH response", p, 34, 2_000, Y); print(o, false);
        check("reported sent, every byte arrived", o.ok() && o.printerGotEverything() && maxWriteLen(o) <= 180);

        p = printer(null);
        o = run("Y41BT · the phone does not know the device's name; the SAVED name says Y41BT", p, 34, 3_000, Y); print(o, false);
        check("paced (pieces ≤ 180, question asked)", maxWriteLen(o) <= 180 && count(o, "APP read 2A00") == 1 && o.ok());

        p = printer(Y); p.dropLinkAtMs = 500;
        o = run("Y41BT · the link closes while sending", p, 34, 60_000, Y); print(o, false);
        check("reported FAILED \"Printer disconnected during printing.\"", !o.ok() && "Printer disconnected during printing.".equals(o.error));

        p = printer(Y); p.closesLinkAfterPrinting = true;
        o = run("Y41BT · the printer closes the link itself after printing", p, 34, 3_000, Y); print(o, false);
        check("reported sent (the printer had answered first)", o.ok() && o.printerGotEverything() && Boolean.TRUE.equals(o.delivered));

        // the app keeps ONE sender object: a Y41BT job must leave nothing behind for the next printer, and back
        p = printer(Y);
        o = run("same app · job 1: Y41BT", p, 34, 3_000, Y);
        check("job 1 (Y41BT): paced", maxWriteLen(o) <= 180 && count(o, "APP read 2A00") == 1 && o.ok());
        p = printer("XP-420B");
        o = run("same app · job 2: XP-420B right after the Y41BT", p, 34, 3_000, "XP-420B", true);
        check("job 2 (XP-420B): today's send (pieces of 509, no question, not paced)", maxWriteLen(o) == 509 && count(o, "APP read") == 0 && o.ok() && Boolean.FALSE.equals(o.paced));
        p = printer(Y); p.answersRead = false;
        o = run("same app · job 3: Y41BT, the printer does not answer", p, 34, 3_000, Y, true);
        check("job 3 (Y41BT): failed, not sent", !o.ok());
        p = printer("XP-420B");
        o = run("same app · job 4: XP-420B right after the FAILED Y41BT job", p, 34, 3_000, "XP-420B", true);
        check("job 4 (XP-420B): today's send, sent", maxWriteLen(o) == 509 && count(o, "APP read") == 0 && o.ok() && Boolean.FALSE.equals(o.paced));
        p = printer(Y);
        o = run("same app · job 5: Y41BT again", p, 34, 3_000, Y, true);
        check("job 5 (Y41BT): paced again, sent", maxWriteLen(o) <= 180 && count(o, "APP read 2A00") == 1 && o.ok() && Boolean.TRUE.equals(o.delivered));

        // and the names that must NOT be paced, on this branch
        for (String other : new String[] { "XP-420B", "D520BT-Z", "B1-I603042141", "Printer_8A2F" }) {
            p = printer(other);
            o = run(other + " · not a Y41BT", p, 34, 3_000, other);
            check(other + ": today's send (pieces of 509, no question)", maxWriteLen(o) == 509 && count(o, "APP read") == 0 && o.paced != null && !o.paced);
        }
        // a saved Y41BT name must never make ANOTHER device paced unless that device is the saved one — the plugin
        // decides that (genericNameHint); here: the hint is empty and the device is an XP-420B
        p = printer("XP-420B");
        o = run("XP-420B with an empty saved-name hint", p, 34, 3_000, "");
        check("XP-420B, no hint: today's send", maxWriteLen(o) == 509 && count(o, "APP read") == 0);

        System.out.println();
        System.out.println("CHECKS: " + pass + " ok, " + fail + " failed");
        if (fail > 0) System.exit(1);
    }

    public static void main(String[] args) throws Exception {
        if (args.length > 0 && args[0].equals("others")) others();
        else y41();
    }
}
