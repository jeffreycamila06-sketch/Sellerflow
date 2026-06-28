// APK-safety gate: the marketing landing must NEVER show in the app shell. Web
// browsers (no Capacitor, no ?apk) → "landing"; APK (Capacitor) or ?apk → "login".
import { describe, it, expect, afterEach } from "vitest";
import { isAppShell, anonScreen } from "../appShell";

const clearCap = () => { delete (window as unknown as { Capacitor?: unknown }).Capacitor; };
const setUrl = (u: string) => window.history.replaceState({}, "", u);

afterEach(() => { clearCap(); setUrl("/"); });

describe("isAppShell / anonScreen — APK-safety gate", () => {
  it("plain web (no Capacitor, no ?apk) → NOT app shell → landing", () => {
    setUrl("/");
    expect(isAppShell()).toBe(false);
    expect(anonScreen()).toBe("landing");
  });

  it("APK WebView (window.Capacitor present) → app shell → login (never landing)", () => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = {};
    expect(isAppShell()).toBe(true);
    expect(anonScreen()).toBe("login");
  });

  it("prod APK URL (?apk=...) → app shell → login (never landing)", () => {
    setUrl("/?apk=20260523-dark-mobile");
    expect(isAppShell()).toBe(true);
    expect(anonScreen()).toBe("login");
  });

  it("?apk=1 desktop override → app shell → login", () => {
    setUrl("/?apk=1");
    expect(isAppShell()).toBe(true);
    expect(anonScreen()).toBe("login");
  });

  it("test-APK path with Capacitor but NO ?apk → still app shell (Capacitor wins)", () => {
    setUrl("/redesign.html");
    (window as unknown as { Capacitor?: unknown }).Capacitor = {};
    expect(isAppShell()).toBe(true);
    expect(anonScreen()).toBe("login");
  });
});
