// Shared order/buyer/comment shapes, moved verbatim from App.tsx (Phase 2b)
// so the pure order-assembly core in orderLogic.ts can be typed without
// importing the 4k-line App module. Field semantics are load-bearing:
//   - LiveOrder.orderNum is EPOCH MILLISECONDS (Date.now()-style). The BT
//     sticker pipeline re-derives Taiwan local time from it when >1e12.
//   - LiveOrder.date is the UTC calendar day (toISOString().slice(0,10)) —
//     intentionally NOT unified with the device-local liveDayId.
export interface LiveOrder { orderNum:number; item:string; qty:number; price:number; total:number; time:string; handle:string; name:string; bNum:number; platform:string; status:string; date:string; }
export interface Buyer { handle:string; name:string; platform:string; num:number; orders:LiveOrder[]; totalSpent:number; totalOrders:number; }
export interface Comment { handle:string; name:string; comment:string; platform:"TikTok"|"Facebook"; isBuy:boolean; buyerNum:number|null; buyerData:Buyer|null; time:string; avatar?:string; timestamp?:string; sellerId?:string; sessionId?:string; sourceUsername?:string; }
