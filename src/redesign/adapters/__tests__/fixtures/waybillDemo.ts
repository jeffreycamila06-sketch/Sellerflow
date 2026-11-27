// The demo pair used for the pictures in docs/design/waybill-username (fictional buyers that match
// the ?wb=ph preview seed in src/dev/fakeSupabase.ts).
import type { FixtureOrder, FixturePage } from "./waybillFixture";

export const DEMO_ORDERS: FixtureOrder[] = [
  { orderId: "580000000000004821", tracking: "JT0000000004821", masked: "m******3", items: 2 },   // mariel_3 → filled
  { orderId: "580000000000004822", tracking: "JT0000000004822", masked: "j*********s" },         // jessa.ukays → filled
  { orderId: "580000000000004823", tracking: "JT0000000004823", masked: "a******8" },            // angel_m8 / amy_bae8 → pick
  { orderId: "580000000000004824", tracking: "JT0000000004824", masked: "r********a" },          // rhea_pinta (yesterday)
  { orderId: "580000000000004825", tracking: "JT0000000004825", masked: "k********y" },          // kaycee.bay
  { orderId: "580000000000004826", tracking: "JT0000000004826", masked: "l*****n" },             // nobody → pick
  { orderId: "580000000000004827", tracking: "JT0000000004827", masked: "b*********1", items: 3 }, // bennyshop01
  { orderId: "580000000000004828", tracking: "JT0000000004828", masked: "c*******z" },           // cheska.uz
];
export const DEMO_PAGES: FixturePage[] = [
  ...DEMO_ORDERS.map((o) => ({ orderId: o.orderId, tracking: o.tracking })),
  { orderId: "580000000000009999", tracking: "JT0000000009999" }, // not in the order list → printed as is
];
