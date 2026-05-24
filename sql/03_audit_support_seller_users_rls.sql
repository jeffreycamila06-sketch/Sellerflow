-- ============================================================================
-- SellerFlow — Step 3: lock down audit_logs, support_messages, seller_users
-- ============================================================================
-- Replaces the open "to anon using(true)" policies from supabase-schema.sql.
-- Safe to re-run. Run AFTER 01_seller_profiles.sql.
-- ============================================================================

-- ===== AUDIT_LOGS (admin-only: append, read, edit, delete) ==================
-- audit_logs are written during admin actions (App.tsx saveAuditLog) and read
-- in the admin panel. If you later add a NON-admin flow that writes audit logs,
-- split out a broader INSERT policy.
drop policy if exists "audit_logs_anon_all" on public.audit_logs;
do $$
declare p record;
begin
  for p in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'audit_logs'
  loop
    execute format('drop policy if exists %I on public.audit_logs', p.policyname);
  end loop;
end $$;

alter table public.audit_logs enable row level security;

create policy "audit_logs_admin_all" on public.audit_logs
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ===== SUPPORT_MESSAGES (seller sees own by email; admin manages all) =======
-- No user_id column on this table, so ownership is matched on email against the
-- authenticated user's JWT email. Admin can insert for any email (auto plan
-- notices) and is the only one who can update (reply/status).
drop policy if exists "support_messages_anon_all" on public.support_messages;
do $$
declare p record;
begin
  for p in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'support_messages'
  loop
    execute format('drop policy if exists %I on public.support_messages', p.policyname);
  end loop;
end $$;

alter table public.support_messages enable row level security;

create policy "support_messages_select_own_or_admin" on public.support_messages
  for select to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email') or public.is_admin());

create policy "support_messages_insert_own_or_admin" on public.support_messages
  for insert to authenticated
  with check (lower(email) = lower(auth.jwt() ->> 'email') or public.is_admin());

create policy "support_messages_update_admin" on public.support_messages
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "support_messages_delete_own_or_admin" on public.support_messages
  for delete to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email') or public.is_admin());

-- ===== SELLER_USERS (dead bcrypt table — LOCK DOWN ONLY, do NOT drop) =======
-- App code no longer reads/writes this table. We only remove the open anon
-- policy so the old password hashes are no longer reachable via the anon key.
-- The table and its data are kept (reversible). With no policy granted to any
-- role, anon and authenticated keys get nothing — only the service_role key /
-- SQL editor can reach it.
drop policy if exists "seller_users_anon_all" on public.seller_users;
alter table public.seller_users enable row level security;
