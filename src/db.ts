import { isSupabaseConfigured, supabase } from "./supabase";
import { taipeiDayId } from "./lib/dateHelpers";
import type { LiveSessionRow } from "./lib/orderLogic";

export async function saveOrderToDatabase(order: {
  customer_name: string;
  product: string;
  total_amount: number;
  status?: string;
}) {
  if (!isSupabaseConfigured || !supabase) {
    console.info("Supabase is not configured. Order kept in local app state.", order);
    return { success: true, data: null, skipped: true };
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    console.error("Supabase save order error: no authenticated user");
    return { success: false, error: new Error("Not authenticated") };
  }

  const { data, error } = await supabase
    .from("orders")
    .insert([
      {
        customer_name: order.customer_name,
        product: order.product,
        total_amount: order.total_amount,
        status: order.status || "Pending",
        user_id: user.id,
      },
    ])
    .select();

  if (error) {
    console.error("Supabase save order error:", error.message);
    return { success: false, error };
  }

  return { success: true, data };
}

export async function saveCustomerToDatabase(customer: {
  name: string;
  handle: string;
  platform: string;
  total_orders: number;
  total_spent: number;
}) {
  if (!isSupabaseConfigured || !supabase) {
    console.info("Supabase is not configured. Customer kept in local app state.", customer);
    return { success: true, data: null, skipped: true };
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    console.error("Supabase save customer error: no authenticated user");
    return { success: false, error: new Error("Not authenticated") };
  }

  async function updateExistingCustomer() {
    const { data: existing, error: findError } = await supabase!
      .from("customers")
      .select("*")
      .eq("user_id", user!.id)
      .eq("handle", customer.handle)
      .maybeSingle();

    if (findError) {
      console.error("Find customer error:", findError.message);
      return { success: false, error: findError };
    }

    if (!existing) return null;

    const { data, error } = await supabase!
      .from("customers")
      .update({
        name: customer.name,
        platform: customer.platform,
        total_orders: Number(existing.total_orders || 0) + customer.total_orders,
        total_spent: Number(existing.total_spent || 0) + customer.total_spent,
      })
      .eq("user_id", user!.id)
      .eq("handle", customer.handle)
      .select();

    if (error) {
      console.error("Update customer error:", error.message);
      return { success: false, error };
    }

    return { success: true, data };
  }

  const updated = await updateExistingCustomer();
  if (updated) return updated;

  const { data, error } = await supabase
    .from("customers")
    .insert([
      {
        name: customer.name,
        handle: customer.handle,
        platform: customer.platform,
        total_orders: customer.total_orders,
        total_spent: customer.total_spent,
        user_id: user.id,
      },
    ])
    .select();

  if (error) {
    if (error.code === "23505") {
      return await updateExistingCustomer();
    }

    console.error("Supabase save customer error:", error.message);
    return { success: false, error };
  }

  return { success: true, data };
}

// ── Cross-device live session sync ───────────────────────────────────────
// live_session_orders is the shared, per-seller, per-day ledger that lets a
// seller open their live session on a second device and see the same buyers
// and orders. It is SEPARATE from the `orders` billing ledger (untouched).
// RLS scopes every row to user_id = auth.uid().

export interface LiveSessionOrderInput {
  buyer_number: number;
  handle: string;
  customer_name: string;
  platform: string;
  product: string;
  price: number;
  // Asia/Taipei calendar day. Defaults to today so all devices agree on the
  // session bucket regardless of their own timezone.
  session_date?: string;
}

// Fire-and-forget write on the 1-click order create. One INSERT per order; no
// polling. Mirrors saveOrderToDatabase's auth + skip-when-unconfigured shape.
export async function saveLiveSessionOrder(order: LiveSessionOrderInput) {
  if (!isSupabaseConfigured || !supabase) {
    console.info("Supabase is not configured. Live session order kept in local app state.", order);
    return { success: true, data: null, skipped: true };
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    console.error("Supabase save live session order error: no authenticated user");
    return { success: false, error: new Error("Not authenticated") };
  }

  const { data, error } = await supabase
    .from("live_session_orders")
    .insert([
      {
        user_id: user.id,
        session_date: order.session_date || taipeiDayId(),
        buyer_number: order.buyer_number,
        handle: order.handle,
        customer_name: order.customer_name,
        platform: order.platform,
        product: order.product,
        price: order.price,
      },
    ])
    .select();

  if (error) {
    console.error("Supabase save live session order error:", error.message);
    return { success: false, error };
  }

  return { success: true, data };
}

// One read on load (no polling). Returns today's rows ordered oldest-first so
// rebuildSessionFromRows reproduces buyer numbering in creation order. RLS
// already restricts to the current user; the explicit user_id filter is belt
// and suspenders.
export async function loadTodaysLiveSession(sessionDate?: string): Promise<LiveSessionRow[]> {
  if (!isSupabaseConfigured || !supabase) {
    return [];
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return [];
  }

  const day = sessionDate || taipeiDayId();
  const { data, error } = await supabase
    .from("live_session_orders")
    .select("buyer_number,handle,customer_name,platform,product,price,created_at,session_date")
    .eq("user_id", user.id)
    .eq("session_date", day)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Load today's live session error:", error.message);
    return [];
  }

  return (data || []) as LiveSessionRow[];
}

export async function getCustomersFromDatabase() {
  if (!isSupabaseConfigured || !supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Load customers error:", error.message);
    return [];
  }

  return data || [];
}
