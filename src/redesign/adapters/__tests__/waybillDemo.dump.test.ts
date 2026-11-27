// Writes the demo files ONLY when WB_DUMP=<folder> is set (pictures for docs/design/waybill-username).
// Normal test runs just check the demo still builds.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildOrderCsv, buildWaybillPdf } from "./fixtures/waybillFixture";
import { DEMO_ORDERS, DEMO_PAGES } from "./fixtures/waybillDemo";
import { scanWaybills, stampWaybills } from "../waybillPdf";

test("the demo order list + waybills build", async () => {
  const csv = buildOrderCsv(DEMO_ORDERS, { bom: true, crlf: true });
  const pdf = await buildWaybillPdf(DEMO_PAGES, { embed: !!process.env.WB_DUMP });
  expect(csv.startsWith("\uFEFFOrder ID,")).toBe(true);
  expect(pdf.length).toBeGreaterThan(1000);
  const dir = process.env.WB_DUMP;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "All order-demo.csv"), csv);
    writeFileSync(join(dir, "Shipping label-demo.pdf"), pdf);
    // the pictures of the stamped waybill: the demo as the seller would get it (2 picks made, 1 left blank),
    // and one page with a long username (made smaller to fit one line)
    const scan = await scanWaybills(pdf);
    if (!scan.ok) throw new Error("scan");
    const picks = new Map([[0, "mariel_3"], [1, "jessa.ukays"], [2, "amy_bae8"], [3, "rhea_pinta"], [4, "kaycee.bay"], [6, "bennyshop01"], [7, "cheska.uz"]]);
    writeFileSync(join(dir, "stamped-demo.pdf"), (await stampWaybills(pdf, scan.pages, picks)).bytes);
    const one = await buildWaybillPdf([DEMO_PAGES[0], DEMO_PAGES[1]], { embed: true });
    const s1 = await scanWaybills(one);
    if (!s1.ok) throw new Error("scan");
    writeFileSync(join(dir, "stamped-long.pdf"), (await stampWaybills(one, s1.pages, new Map([[0, "ana_ukay8"], [1, "the.longest_name_24char"]]))).bytes);
  }
});
