create table if not exists public.seller_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password text not null,
  full_name text not null default '',
  store_name text not null default '',
  phone text not null default '',
  tiktok text not null default '',
  facebook text not null default '',
  plan text not null default 'trial',
  plan_status text not null default 'active',
  plan_expiry timestamptz not null default (now() + interval '7 days'),
  connected_accounts text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  email text not null,
  subject text not null default '',
  message text not null default '',
  has_proof boolean not null default false,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

alter table public.seller_users enable row level security;
alter table public.support_messages enable row level security;

drop policy if exists "seller_users_anon_all" on public.seller_users;
create policy "seller_users_anon_all"
on public.seller_users
for all
to anon
using (true)
with check (true);

drop policy if exists "support_messages_anon_all" on public.support_messages;
create policy "support_messages_anon_all"
on public.support_messages
for all
to anon
using (true)
with check (true);
