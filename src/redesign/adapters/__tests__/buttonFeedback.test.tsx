// Button feedback — the ONE Copy / Save pattern of the seller app (adapters/buttonFeedback.ts,
// components/CopyButton.tsx, CopyFailNote.tsx, SaveButton.tsx). The clock is moved by hand.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, renderHook, act } from "@testing-library/react";
import { useState } from "react";
import CopyButton from "../../components/CopyButton";
import CopyFailNote from "../../components/CopyFailNote";
import SaveButton from "../../components/SaveButton";
import { FEEDBACK_MS, FB_GREEN, FB_RED, saveLook, useCopyFeedback, useSaveFeedback, type SaveOutcome } from "../buttonFeedback";
import { REDESIGN_STRINGS, buildT } from "../../i18n";
import { expectNothingLate, settle, tick, until } from "./pageGone";

const t = buildT("en") as unknown as Record<string, string>;
const rgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };
const LINK = "https://live.sellerflowlive.com";

/** The clipboard of the test: allowed (writes land in `written`) or refused (as in some phone apps). */
function clipboard(allowed: boolean) {
  const written: string[] = [];
  const writeText = vi.fn(async (s: string) => { if (!allowed) throw new Error("NotAllowedError"); written.push(s); });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  // the older way (document.execCommand) is refused too when the clipboard is
  (document as unknown as { execCommand: (c: string) => boolean }).execCommand = () => false;
  return { written, writeText };
}
function CopyRow({ text = LINK }: { text?: string }) {
  const fb = useCopyFeedback();
  return (<div><CopyButton fb={fb} text={text} label="Copy" t={t} testid="copy" /><CopyFailNote fb={fb} t={t} what="link" /></div>);
}
const copyBtn = () => screen.getByTestId("copy");

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Copy button", () => {
  it("copied: the button says ✓ Copied (green) for 2 s, then Copy again", async () => {
    const c = clipboard(true);
    render(<CopyRow />);
    expect(copyBtn()).toHaveTextContent(/^Copy$/);
    fireEvent.click(copyBtn());
    await until(() => copyBtn().textContent === "✓ Copied");
    expect(c.written).toEqual([LINK]);
    expect(copyBtn().style.background).toBe(rgb(FB_GREEN));
    expect(copyBtn().style.color).toBe("rgb(255, 255, 255)");
    expect(copyBtn()).toHaveAttribute("data-state", "copied");
    await tick(FEEDBACK_MS - 100);
    expect(copyBtn()).toHaveTextContent("✓ Copied");
    await tick(200);
    expect(copyBtn()).toHaveTextContent(/^Copy$/);
    expect(copyBtn().style.background).toBe("");
    expect(screen.queryByTestId("copy-fail")).toBeNull();
  });
  it("clipboard refused: never 'Copied' — the press-and-hold line and the text itself, selected", async () => {
    clipboard(false);
    render(<CopyRow />);
    fireEvent.click(copyBtn());
    await until(() => screen.queryByTestId("copy-fail"));
    expect(copyBtn()).toHaveTextContent(/^Copy$/);
    expect(screen.getByTestId("copy-fail")).toHaveTextContent("Couldn't copy — press and hold the link to copy");
    expect(screen.getByTestId("copy-fail")).toHaveAttribute("role", "alert");
    const box = screen.getByTestId("copy-fail-text") as HTMLTextAreaElement;
    expect(box.value).toBe(LINK);
    expect(box.readOnly).toBe(true);
    expect([box.selectionStart, box.selectionEnd]).toEqual([0, LINK.length]); // already selected
    expect(document.activeElement).toBe(box);
    // it stays until the seller closes it — no timer hides it
    await tick(60_000);
    expect(screen.getByTestId("copy-fail")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("copy-fail-close"));
    expect(screen.queryByTestId("copy-fail")).toBeNull();
  });
  it("refused, then allowed: the note goes away and the button says ✓ Copied", async () => {
    clipboard(false);
    render(<CopyRow />);
    fireEvent.click(copyBtn());
    await until(() => screen.queryByTestId("copy-fail"));
    clipboard(true);
    fireEvent.click(copyBtn());
    await until(() => copyBtn().textContent === "✓ Copied");
    expect(screen.queryByTestId("copy-fail")).toBeNull();
  });
  it("two taps: the 2 s count from the last one; the screen closing leaves no timer", async () => {
    clipboard(true);
    const r = render(<CopyRow />);
    fireEvent.click(copyBtn()); await until(() => copyBtn().textContent === "✓ Copied");
    await tick(1500);
    fireEvent.click(copyBtn()); await settle();
    await tick(1500); // 3 s after the first tap, 1.5 s after the second
    expect(copyBtn()).toHaveTextContent("✓ Copied");
    r.unmount();
    expectNothingLate();
  });
  it("the 'text' sentence for things that are not a link; a long message gets more lines", async () => {
    clipboard(false);
    function Row() { const fb = useCopyFeedback(); return (<div><CopyButton fb={fb} text={"Hi!\nYour parcel is at the store.\nPlease pick it up."} label="Copy message" t={t} testid="copy" /><CopyFailNote fb={fb} t={t} floating testid="f" /></div>); }
    render(<div data-redesign=""><Row /></div>);
    fireEvent.click(copyBtn());
    await until(() => screen.queryByTestId("f"));
    expect(screen.getByTestId("f")).toHaveTextContent("Couldn't copy — press and hold the text to copy");
    expect((screen.getByTestId("f-text") as HTMLTextAreaElement).rows).toBe(3);
    // drawn outside the screen's own box (above the bottom bar), inside the app root
    expect(screen.getByTestId("f").closest("[data-redesign]")).not.toBeNull();
    expect(copyBtn().parentElement!.contains(screen.getByTestId("f"))).toBe(false);
  });
});

// ── Save ──
interface Deferred<V> { promise: Promise<V>; resolve: (v: V) => void; reject: (e: unknown) => void }
function defer<V>(): Deferred<V> { let resolve!: (v: V) => void, reject!: (e: unknown) => void; const promise = new Promise<V>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
/** A small form: one field, a Save button. `send` is the save request. */
function Form({ send, withDirty = true }: { send: (v: string) => Promise<SaveOutcome>; withDirty?: boolean }) {
  const [saved, setSaved] = useState("A");
  const [v, setV] = useState("A");
  const onSave = async () => { const r = await send(v); if (r === true) setSaved(v); return r; };
  return (<div><input data-testid="field" value={v} onChange={(e) => setV(e.target.value)} /><SaveButton testid="save" label="Save" t={t} dirty={withDirty ? v !== saved : undefined} onSave={onSave} style={{ background: "blue" }} /></div>);
}
const saveBtn = () => screen.getByTestId("save");
const type = (v: string) => fireEvent.change(screen.getByTestId("field"), { target: { value: v } });

describe("Save button — what it shows (pure)", () => {
  it("every state", () => {
    expect(saveLook("idle", true, false)).toEqual({ look: "ready", disabled: false });
    expect(saveLook("idle", undefined, false)).toEqual({ look: "ready", disabled: false });
    expect(saveLook("idle", false, false)).toEqual({ look: "clean", disabled: true });
    expect(saveLook("idle", true, true)).toEqual({ look: "ready", disabled: true });
    expect(saveLook("saving", true, false)).toEqual({ look: "saving", disabled: true });
    expect(saveLook("done", false, false)).toEqual({ look: "done", disabled: true });
    expect(saveLook("done", undefined, false)).toEqual({ look: "done", disabled: true });
    expect(saveLook("done", true, false)).toEqual({ look: "ready", disabled: false }); // changed again → Save at once
    expect(saveLook("failed", true, false)).toEqual({ look: "failed", disabled: false });
    expect(saveLook("failed", false, false)).toEqual({ look: "failed", disabled: false });
  });
});

describe("Save button", () => {
  it("nothing changed since the last save: 'Saved', not tappable, no request", async () => {
    const send = vi.fn(async () => true as SaveOutcome);
    render(<Form send={send} />);
    expect(saveBtn()).toHaveTextContent(/^Saved$/);
    expect(saveBtn()).toBeDisabled();
    expect(saveBtn()).toHaveAttribute("data-state", "clean");
    fireEvent.click(saveBtn());
    await settle();
    expect(send).not.toHaveBeenCalled();
  });
  it("Save → Saving… (not tappable) → ✓ Saved (green) 2 s → Saved", async () => {
    const d = defer<SaveOutcome>(); const send = vi.fn(() => d.promise);
    render(<Form send={send} />);
    type("B");
    expect(saveBtn()).toHaveTextContent(/^Save$/);
    expect(saveBtn()).toBeEnabled();
    fireEvent.click(saveBtn());
    expect(saveBtn()).toHaveTextContent("Saving…");
    expect(saveBtn()).toBeDisabled();
    expect(saveBtn()).toHaveAttribute("aria-busy", "true");
    d.resolve(true);
    await until(() => saveBtn().textContent === "✓ Saved");
    expect(saveBtn().style.background).toBe(rgb(FB_GREEN));
    expect(saveBtn()).toBeDisabled();
    await tick(FEEDBACK_MS - 100);
    expect(saveBtn()).toHaveTextContent("✓ Saved");
    await tick(200);
    expect(saveBtn()).toHaveTextContent(/^Saved$/); // nothing changed since → not "Save"
    expect(saveBtn()).toBeDisabled();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("double tap (and a third, a fourth): ONE save request", async () => {
    const d = defer<SaveOutcome>(); const send = vi.fn(() => d.promise);
    render(<Form send={send} />);
    type("B");
    const b = saveBtn();
    fireEvent.click(b); fireEvent.click(b); fireEvent.click(b);
    // a tap that slips through before the button is off (same moment) is ignored as well
    b.removeAttribute("disabled"); fireEvent.click(b);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    d.resolve(true);
    await until(() => saveBtn().textContent === "✓ Saved");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("two calls in the very same moment (before the button could turn off): still ONE save request", async () => {
    const d = defer<SaveOutcome>(); const send = vi.fn(() => d.promise);
    const { result } = renderHook(() => useSaveFeedback());
    await act(async () => { void result.current.run(send); void result.current.run(send); void result.current.run(send); });
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("saving");
    await act(async () => { d.resolve(true); });
    expect(result.current.phase).toBe("done");
    // and after it finished a new save is possible again
    await act(async () => { void result.current.run(send); });
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("failed: red 'Couldn't save — tap to try again', the form keeps what was typed, a tap tries again", async () => {
    const send = vi.fn<(v: string) => Promise<SaveOutcome>>().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<Form send={send} />);
    type("my new text");
    fireEvent.click(saveBtn());
    await until(() => saveBtn().textContent === "Couldn't save — tap to try again");
    expect(saveBtn().style.background).toBe(rgb(FB_RED));
    expect(saveBtn()).toBeEnabled();
    expect((screen.getByTestId("field") as HTMLInputElement).value).toBe("my new text"); // nothing lost
    await tick(60_000);
    expect(saveBtn()).toHaveTextContent("Couldn't save — tap to try again"); // it does not hide by itself
    fireEvent.click(saveBtn());
    await until(() => saveBtn().textContent === "✓ Saved");
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith("my new text");
  });
  it("a save that throws counts as failed (never stuck on Saving…)", async () => {
    const send = vi.fn(async () => { throw new Error("offline"); });
    render(<Form send={send as never} />);
    type("B");
    fireEvent.click(saveBtn());
    await until(() => saveBtn().textContent === "Couldn't save — tap to try again");
    expect(saveBtn()).toBeEnabled();
  });
  it("'blocked' (a field is missing — nothing was sent): back to Save, not red", async () => {
    const send = vi.fn(async () => "blocked" as SaveOutcome);
    render(<Form send={send} />);
    type("B");
    fireEvent.click(saveBtn());
    await until(() => send.mock.calls.length === 1 && saveBtn().textContent === "Save");
    expect(saveBtn()).toBeEnabled();
    expect(saveBtn().style.background).toBe("blue");
  });
  it("changed again while ✓ Saved shows: Save is back at once (the tap is not swallowed)", async () => {
    const send = vi.fn(async () => true as SaveOutcome);
    render(<Form send={send} />);
    type("B");
    fireEvent.click(saveBtn());
    await until(() => saveBtn().textContent === "✓ Saved");
    type("C");
    expect(saveBtn()).toHaveTextContent(/^Save$/);
    expect(saveBtn()).toBeEnabled();
    fireEvent.click(saveBtn());
    await until(() => send.mock.calls.length === 2);
    expect(send).toHaveBeenLastCalledWith("C");
  });
  it("a form that closes or clears after saving (no 'changed' idea): ✓ Saved 2 s, then Save", async () => {
    const send = vi.fn(async () => true as SaveOutcome);
    render(<Form send={send} withDirty={false} />);
    expect(saveBtn()).toHaveTextContent(/^Save$/);
    fireEvent.click(saveBtn());
    await until(() => saveBtn().textContent === "✓ Saved");
    await tick(FEEDBACK_MS + 50);
    expect(saveBtn()).toHaveTextContent(/^Save$/);
    expect(saveBtn()).toBeEnabled();
  });
  it("the screen closing while saving or while ✓ Saved shows: nothing runs late", async () => {
    const d = defer<SaveOutcome>(); const send = vi.fn(() => d.promise);
    const r = render(<Form send={send} />);
    type("B"); fireEvent.click(saveBtn());
    r.unmount();
    d.resolve(true); await settle();
    expectNothingLate();
    const r2 = render(<Form send={async () => true} />);
    type("B"); fireEvent.click(saveBtn());
    await until(() => saveBtn().textContent === "✓ Saved");
    r2.unmount();
    expectNothingLate();
  });
});

describe("the texts", () => {
  const KEYS = ["rd_fb_copied", "rd_fb_copy_failed_link", "rd_fb_copy_failed_text", "rd_fb_saving", "rd_fb_saved", "rd_fb_save_failed"];
  it("all six in all 8 languages", () => {
    const all = REDESIGN_STRINGS as unknown as Record<string, Record<string, string>>;
    expect(Object.keys(all).sort()).toEqual(["bg", "en", "fil", "id", "th", "vi", "zh", "zh-TW"]);
    for (const lang of Object.keys(all)) for (const k of KEYS) expect((all[lang][k] || "").trim().length, `${lang} ${k}`).toBeGreaterThan(1);
    for (const k of KEYS) expect(new Set(Object.keys(all).map((l) => all[l][k])).size, `${k} is translated`).toBeGreaterThanOrEqual(7);
  });
  it("English is the owner's wording; nothing in them is about plans or paying (iPhone rule)", () => {
    expect(t.rd_fb_copied).toBe("Copied");
    expect(t.rd_fb_copy_failed_link).toBe("Couldn't copy — press and hold the link to copy");
    expect(t.rd_fb_saving).toBe("Saving…");
    expect(t.rd_fb_saved).toBe("Saved");
    expect(t.rd_fb_save_failed).toBe("Couldn't save — tap to try again");
    for (const k of KEYS) expect(t[k]).not.toMatch(/plan|pay|subscri|price|upgrade|renew/i);
  });
});
