package sim;

import java.util.ArrayList;
import java.util.List;
import java.util.PriorityQueue;

/** The pretend world: ONE clock, ONE queue of things that happen later, ONE trace of what the app did. */
public final class World {
    private World() {}
    public static final class Ev implements Comparable<Ev> {
        final long at; final long seq; final Runnable run; boolean cancelled;
        Ev(long at, long seq, Runnable run) { this.at = at; this.seq = seq; this.run = run; }
        @Override public int compareTo(Ev o) { return at != o.at ? Long.compare(at, o.at) : Long.compare(seq, o.seq); }
    }
    public static long now;
    private static long seq;
    private static final PriorityQueue<Ev> queue = new PriorityQueue<>();
    public static final List<String> trace = new ArrayList<>();

    public static void reset() { now = 0; seq = 0; queue.clear(); trace.clear(); }
    public static Ev later(long ms, Runnable r) { Ev e = new Ev(now + Math.max(0, ms), seq++, r); queue.add(e); return e; }
    public static void cancel(Runnable r) { for (Ev e : queue) if (e.run == r) e.cancelled = true; }
    public static void cancel(Ev e) { e.cancelled = true; }
    public static void say(String what) { trace.add(String.format("%6d ms  %s", now, what)); }
    public static void run(long untilMs) {
        int guard = 0;
        while (!queue.isEmpty()) {
            Ev e = queue.peek();
            if (e.at > untilMs) break;
            queue.poll();
            if (e.cancelled) continue;
            now = Math.max(now, e.at);
            e.run.run();
            if (++guard > 5_000_000) throw new IllegalStateException("never ends");
        }
    }
}
