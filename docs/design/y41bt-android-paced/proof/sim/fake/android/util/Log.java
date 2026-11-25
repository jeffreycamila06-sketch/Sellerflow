package android.util;
import sim.World;
public class Log {
    public static int i(String tag, String msg) { World.say("LOG i " + tag + ": " + msg); return 0; }
    public static int w(String tag, String msg) { World.say("LOG w " + tag + ": " + msg); return 0; }
    public static int e(String tag, String msg) { World.say("LOG e " + tag + ": " + msg); return 0; }
}
