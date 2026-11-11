// Nov 11 2026 — wording only.
//  • Settings → General Settings: "LIVE SESSION" / "Live session" → "LIVE SETUP" / "Live setup" (8 languages).
//  • 7-11 Parcel Scan: no camera wording left — new subtitle + empty-list text, and the
//    "coming soon" photo-scan note (rd_ps2_ai_soon) is no longer shown (the key is kept).
//  • Other "session" words (session length, past sessions…) are NOT renamed.
import { describe, it, expect, vi } from "vitest";
import { render, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { REDESIGN_STRINGS, buildT, TProvider } from "../../i18n";

vi.mock("../../adapters/parcelScan", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/parcelScan")>("../../adapters/parcelScan");
  return {
    ...actual,
    loadLastExportBatch: vi.fn(async () => ({ ok: true, batch: null })),
    loadUndeliveredExports: vi.fn(async () => ({ ok: true, batches: [] })),
    loadParcelScans: vi.fn(async () => ({ ok: true, rows: [] })),
    getCreditBalance: vi.fn(async () => ({ ok: true, balance: 5 })),
  };
});
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));

import ParcelScan from "../ParcelScan";
import GeneralSettings from "../GeneralSettings";
import type { AccountUser } from "../../../accountDb";

const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"] as const;
type Lang = (typeof LANGS)[number];
const S = (lang: Lang) => REDESIGN_STRINGS[lang] as Record<string, string>;

const NEW: Record<string, Record<Lang, string>> = {
  rd_set_live_session: { en: "LIVE SETUP", fil: "LIVE SETUP", zh: "直播设置", "zh-TW": "直播設定", vi: "CÀI ĐẶT LIVE", th: "ตั้งค่าไลฟ์", id: "PENGATURAN LIVE", bg: "НАСТРОЙКИ ЗА ЛАЙВ" },
  rd_set_ls_title: { en: "Live setup", fil: "Live setup", zh: "直播设置", "zh-TW": "直播設定", vi: "Cài đặt live", th: "ตั้งค่าไลฟ์", id: "Pengaturan live", bg: "Настройки за лайв" },
  rd_ps2_sub: { en: "Type each parcel, then export the bulk-order file.", fil: "I-type ang bawat parcel, tapos i-export ang bulk-order file.", zh: "逐一输入包裹，再汇出大量汇单档。", "zh-TW": "逐一輸入包裹，再匯出大量匯單檔。", vi: "Nhập từng kiện, rồi xuất tệp đặt hàng loạt.", th: "กรอกพัสดุทีละชิ้น แล้วส่งออกไฟล์สั่งซื้อจำนวนมาก", id: "Ketik setiap paket, lalu ekspor file pesanan massal.", bg: "Въведете всяка пратка и експортирайте файла за масови поръчки." },
  rd_ps2_empty: { en: "No saved parcels yet. Add your first parcel above.", fil: "Wala pang na-save na parcel. Idagdag ang unang parcel sa itaas.", zh: "还没有已保存的包裹。请先在上方添加第一个包裹。", "zh-TW": "還沒有已儲存的包裹。請先在上方新增第一個包裹。", vi: "Chưa có kiện nào. Hãy thêm kiện đầu tiên ở trên.", th: "ยังไม่มีพัสดุที่บันทึก เพิ่มพัสดุชิ้นแรกด้านบน", id: "Belum ada paket tersimpan. Tambahkan paket pertama di atas.", bg: "Още няма запазени пратки. Добави първата си пратка по-горе." },
};

const account: AccountUser = {
  authUserId: "u1", email: "seller@example.com",
  profile: { fullName: "Owner", storeName: "Shop", phone: "0912345678", tiktok: "", facebook: "", adminContactNote: "" },
  plan: "pro", planStatus: "active", planExpiry: "", connectedAccounts: [], role: "seller",
};
const noop = () => {};
const settings = (lang: Lang) => render(
  <TProvider lang={lang}>
    <GeneralSettings theme="light" accent="indigo" onSetTheme={noop} onSetAccent={noop}
      auto={{ detect: false, toggle: noop }} cur="NT$" lang={lang} onSetLang={noop} currency="TWD" onSetCurrency={noop}
      profileOpen={false} onToggleProfile={noop} keepAwake onToggleKeepAwake={noop} pinPrint={false} onTogglePinPrint={noop}
      printerIdx={1} printerOpen={false} onTogglePrinter={noop} onPickPrinter={noop} onPrintPattern={noop}
      onSubscription={noop} onSupport={noop} onDelete={noop}
      account={account} onSaveProfile={vi.fn().mockResolvedValue({ ok: true })} onManageChannel={noop} />
  </TProvider>,
);
const parcelScan = (lang: Lang) => render(<TProvider lang={lang}><ParcelScan cur="NT$" manualOnly /></TProvider>);

describe("the new wording, in all 8 languages", () => {
  it("the 8 app languages are exactly these", () => {
    expect(Object.keys(REDESIGN_STRINGS).sort()).toEqual([...LANGS].sort());
  });
  for (const [key, byLang] of Object.entries(NEW)) {
    it(`${key} carries the new text in every language`, () => {
      for (const lang of LANGS) expect(S(lang)[key], `${key}/${lang}`).toBe(byLang[lang]);
    });
  }
  it("no camera / snap / scan-a-slip words left in the 7-11 subtitle and empty-list text", () => {
    for (const lang of LANGS) {
      expect(S(lang).rd_ps2_sub).not.toMatch(/snap|slip|scan|picturan|sulat-kamay|拍|扫描|掃描|chụp|ถ่าย|foto|снимай/i);
      expect(S(lang).rd_ps2_empty).not.toMatch(/snap|slip|scan|i-scan|扫描|掃描|quét|สแกน|pindai|сканирай/i);
    }
  });
  it("the 7-11 subtitle means the same as FamilyMart's (type each parcel, then export)", () => {
    expect(buildT("en").rd_ps2_sub).toBe("Type each parcel, then export the bulk-order file.");
    expect(buildT("en").rd_fms_sub).toBe("Type each 全家 parcel, then export the 好賣+ bulk-order file.");
  });
  it("the coming-soon key is kept (unchanged), only no longer shown", () => {
    expect(buildT("en").rd_ps2_ai_soon).toBe("Snap a parcel slip, we fill in the details — coming soon");
    expect(readFileSync("src/redesign/screens/ParcelScan.tsx", "utf8")).not.toContain("t.rd_ps2_ai_soon");
  });
  it("other 'session' words are not renamed", () => {
    expect(buildT("en").rd_dash_session_length).toBe("LIVE SESSION LENGTH");
  });
});

describe("General Settings shows LIVE SETUP / Live setup", () => {
  for (const lang of LANGS) {
    it(`renders in ${lang}`, () => {
      const { container, getByTestId, unmount } = settings(lang);
      expect(within(getByTestId("ls-header")).getByText(NEW.rd_set_ls_title[lang])).toBeTruthy();
      // the section label above the card (zh / zh-TW / th use the same word as the row title)
      const labels = [...container.querySelectorAll(".sfl-anim-textglow")].map((e) => e.textContent);
      expect(labels).toContain(NEW.rd_set_live_session[lang]);
      unmount();
    });
  }
});

describe("7-11 Parcel Scan shows the new subtitle + empty text, no coming-soon line", () => {
  for (const lang of LANGS) {
    it(`renders in ${lang}`, async () => {
      const { findByTestId, getByText, queryByTestId, unmount } = parcelScan(lang);
      expect((await findByTestId("ps-empty")).textContent).toBe(NEW.rd_ps2_empty[lang]);
      expect(getByText(NEW.rd_ps2_sub[lang])).toBeTruthy();
      expect(queryByTestId("ps-ai-soon")).toBeNull();
      expect(queryByTestId("ps-manual")).toBeTruthy(); // manual add stays
      unmount();
    });
  }
});
