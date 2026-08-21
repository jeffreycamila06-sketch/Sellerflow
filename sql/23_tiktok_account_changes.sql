-- sql/23 — MIRROR ONLY (already applied to production via MCP; do NOT re-run).
-- Self-service TikTok/Facebook username cooldown: one row per (user, platform, slot)
-- recording when that slot's @username was last changed. The 4-hour cooldown decision
-- is SERVER-authoritative (see sql/24 tiktok_slot_cooldowns / touch_tiktok_slot); this
-- table is the persistence + RLS scope. Additive, own-scoped — no other table touched.
create table if not exists public.tiktok_account_changes (
  user_id         uuid        not null,
  platform        text        not null,
  slot_index      smallint    not null,
  last_changed_at timestamptz not null default now(),
  primary key (user_id, platform, slot_index)
);

alter table public.tiktok_account_changes enable row level security;

-- Own-scoped RLS (auth.uid()). No delete policy — rows are upserted by touch_tiktok_slot.
create policy tac_select_own on public.tiktok_account_changes
  for select using (user_id = (select auth.uid()));
create policy tac_insert_own on public.tiktok_account_changes
  for insert with check (user_id = (select auth.uid()));
create policy tac_update_own on public.tiktok_account_changes
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
