// Admin broadcast composer — auto-translate flow: type ONE message → Translate &
// preview (mocked server call) → preview all 7 langs → Confirm & send / Edit
// (back, text intact) / Send English only (skip translations). The translate
// adapter is mocked; ann.publish is a spy so we assert the exact write.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AdminPanel } from "../Admin";
import { TProvider } from "../../i18n";
import type { Announcement } from "../../adapters/useAnnouncements";

const { translateBroadcast } = vi.hoisted(() => ({ translateBroadcast: vi.fn() }));
vi.mock("../../adapters/broadcastTranslate", () => ({ translateBroadcast: (...a: unknown[]) => translateBroadcast(...a) }));

const I18N = { en: "Big sale tonight", fil: "Malaking sale mamaya", zh: "今晚大促销", "zh-TW": "今晚大促銷", vi: "Giảm giá lớn tối nay", th: "ลดราคาคืนนี้", id: "Diskon besar malam ini" };

const renderComposer = (publish = vi.fn(async () => ({ ok: true }))) => {
  const list: Announcement[] = [];
  render(
    <TProvider lang="en">
      <AdminPanel
        panel="broadcast" onClose={() => {}} assignAmount="" onAssignAmount={() => {}} cur="NT$"
        ann={{ list, publish, unpublish: async () => ({ ok: true }), remove: async () => ({ ok: true }) }}
      />
    </TProvider>,
  );
  return { publish };
};

const typeMsg = (v: string) => fireEvent.change(screen.getByPlaceholderText(/./), { target: { value: v } });

beforeEach(() => {
  vi.clearAllMocks();
  translateBroadcast.mockResolvedValue({ ok: true, i18n: I18N });
});

describe("Admin broadcast — auto-translate composer", () => {
  it("Send → translate → preview shows all 7 languages", async () => {
    renderComposer();
    typeMsg("Big sale tonight po!");
    fireEvent.click(screen.getByText("Translate & preview"));
    await waitFor(() => expect(screen.getByText("Preview — all languages")).toBeTruthy());
    expect(translateBroadcast).toHaveBeenCalledWith("Big sale tonight po!");
    // every language's translated text is rendered
    for (const v of Object.values(I18N)) expect(screen.getByText(v)).toBeTruthy();
  });

  it("Confirm & send → publishes EN message + full i18n map", async () => {
    const { publish } = renderComposer();
    typeMsg("Big sale tonight po!");
    fireEvent.click(screen.getByText("Translate & preview"));
    await waitFor(() => screen.getByText("Preview — all languages"));
    fireEvent.click(screen.getByText("Confirm & send"));
    await waitFor(() => expect(publish).toHaveBeenCalledWith("Big sale tonight", I18N));
  });

  it("Edit → returns to the composer with the typed text intact", async () => {
    renderComposer();
    typeMsg("Keep me");
    fireEvent.click(screen.getByText("Translate & preview"));
    await waitFor(() => screen.getByText("Preview — all languages"));
    fireEvent.click(screen.getByText("Edit"));
    await waitFor(() => expect(screen.getByText("Translate & preview")).toBeTruthy());
    expect((screen.getByPlaceholderText(/./) as HTMLTextAreaElement).value).toBe("Keep me");
  });

  it("Send English only (from preview) → publishes raw text, NO i18n map", async () => {
    const { publish } = renderComposer();
    typeMsg("English only please");
    fireEvent.click(screen.getByText("Translate & preview"));
    await waitFor(() => screen.getByText("Preview — all languages"));
    fireEvent.click(screen.getByText("Send English only"));
    await waitFor(() => expect(publish).toHaveBeenCalledWith("English only please", null));
  });

  it("translate failure → error + English-only fallback publishes raw text", async () => {
    translateBroadcast.mockResolvedValue({ ok: false, error: "unreachable" });
    const { publish } = renderComposer();
    typeMsg("Server is down");
    fireEvent.click(screen.getByText("Translate & preview"));
    await waitFor(() => expect(screen.getByText(/Couldn't translate/)).toBeTruthy());
    expect(screen.queryByText("Preview — all languages")).toBeNull(); // no partial preview
    fireEvent.click(screen.getByText("Send English only"));
    await waitFor(() => expect(publish).toHaveBeenCalledWith("Server is down", null));
  });

  // U9 — a 403 "forbidden" (caller isn't admin) shows a distinct message and hides
  // the Retry button, which would just 403 again.
  it("forbidden (403) → distinct message, NO Retry button", async () => {
    translateBroadcast.mockResolvedValue({ ok: false, error: "forbidden" });
    renderComposer();
    typeMsg("Nope");
    fireEvent.click(screen.getByText("Translate & preview"));
    await waitFor(() => expect(screen.getByText(/don't have permission/i)).toBeTruthy());
    expect(screen.queryByText("Try again")).toBeNull();       // Retry hidden
    expect(screen.queryByText(/Couldn't translate/)).toBeNull(); // generic message not used
    expect(screen.getByText("Send English only")).toBeTruthy(); // still offered
  });
});
