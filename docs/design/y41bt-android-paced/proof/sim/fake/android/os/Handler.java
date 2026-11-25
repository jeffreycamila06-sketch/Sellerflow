package android.os;
import sim.World;
/** Runs everything on the pretend clock, in order (the real Handler runs on one thread, in order). */
public class Handler {
    public Handler(Looper looper) {}
    public boolean post(Runnable r) { World.later(0, r); return true; }
    public boolean postDelayed(Runnable r, long ms) { World.later(ms, r); return true; }
    public void removeCallbacks(Runnable r) { World.cancel(r); }
}
