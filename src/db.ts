import { supabase } from "./supabase";

export async function saveOrderToDatabase(order: {
  customer_name: string;
  product: string;
  total_amount: number;
  status?: string;
}) {
  const { data, error } = await supabase.from("orders").insert([
    {
      customer_name: order.customer_name,
      product: order.product,
      total_amount: order.total_amount,
      status: order.status || "Pending",
    },
  ]);

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
  const { data, error } = await supabase.from("customers").insert([
    {
      name: customer.name,
      handle: customer.handle,
      platform: customer.platform,
      total_orders: customer.total_orders,
      total_spent: customer.total_spent,
    },
  ]);

  if (error) {
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