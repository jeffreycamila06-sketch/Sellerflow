import { supabase } from "./supabase";

export async function saveOrderToDatabase(order: {
  customer_name: string;
  product: string;
  total_amount: number;
  status?: string;
}) {
  const { data, error } = await supabase
    .from("orders")
    .insert([
      {
        customer_name: order.customer_name,
        product: order.product,
        total_amount: order.total_amount,
        status: order.status || "Pending",
      },
    ])
    .select();

  if (error) {
    console.error("Supabase save order error:", error.message);
    alert("Database error: " + error.message);
    return { success: false, error };
  }

  console.log("Order saved to Supabase:", data);
  return { success: true, data };
}

export async function saveCustomerToDatabase(customer: {
  name: string;
  handle: string;
  platform: string;
  total_orders: number;
  total_spent: number;
}) {
  async function updateExistingCustomer() {
    const { data: existing, error: findError } = await supabase
      .from("customers")
      .select("*")
      .eq("handle", customer.handle)
      .maybeSingle();

    if (findError) {
      console.error("Find customer error:", findError.message);
      return { success: false, error: findError };
    }

    if (!existing) return null;

    const { data, error } = await supabase
      .from("customers")
      .update({
        name: customer.name,
        platform: customer.platform,
        total_orders: Number(existing.total_orders || 0) + customer.total_orders,
        total_spent: Number(existing.total_spent || 0) + customer.total_spent,
      })
      .eq("handle", customer.handle)
      .select();

    if (error) {
      console.error("Update customer error:", error.message);
      return { success: false, error };
    }

    console.log("Customer updated in Supabase:", data);
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
      },
    ])
    .select();

  if (error) {
    if (error.code === "23505") {
      return await updateExistingCustomer();
    }

    console.error("Supabase save customer error:", error.message);
    alert("Customer DB error: " + error.message);
    return { success: false, error };
  }

  console.log("Customer saved to Supabase:", data);
  return { success: true, data };
}

export async function getCustomersFromDatabase() {
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
