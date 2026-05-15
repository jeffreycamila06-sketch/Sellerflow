import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  "https://sqeuyuktdpidmlfpqgoc.supabase.co";

const supabaseAnonKey =
  "sb_publishable_wU7bkjZDNXz6NmXqgCFu8A_A31_7e1L";

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey
);