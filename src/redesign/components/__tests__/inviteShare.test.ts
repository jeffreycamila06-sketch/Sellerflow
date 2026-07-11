// C8 (audit) — copyText's real branching was untested: modern clipboard API →
// legacy execCommand fallback → honest false when both fail (the card's U5
// "couldn't copy" feedback depends on that boolean never lying).
import { describe, it, expect, vi, afterEach } from "vitest";
import { copyText, INVITE_URL } from "../inviteShare";

const setClipboard = (writeText?: (t: string) => Promise<void>) =>
  Object.defineProperty(navigator, "clipboard", { value: writeText ? { writeText } : undefined, configurable: true, writable: true });

afterEach(() => {
  setClipboard(undefined);
  vi.restoreAllMocks();
});

describe("copyText", () => {
  it("uses the modern clipboard API when available → true", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    await expect(copyText("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  // jsdom has no execCommand — assign it directly (same approach as the
  // InviteFriendsCard U5 test), restore after.
  it("falls back to execCommand when the clipboard API throws → its result", async () => {
    setClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    const exec = vi.fn().mockReturnValue(true);
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    await expect(copyText("hello")).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
    delete (document as unknown as { execCommand?: unknown }).execCommand;
  });

  it("returns false (never lies) when both paths fail", async () => {
    setClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    (document as unknown as { execCommand: unknown }).execCommand = vi.fn().mockReturnValue(false);
    await expect(copyText("hello")).resolves.toBe(false);
    delete (document as unknown as { execCommand?: unknown }).execCommand;
  });

  it("INVITE_URL stays the landing router (not a store deep-link)", () => {
    expect(INVITE_URL).toBe("https://sellerflowlive.com");
  });
});
