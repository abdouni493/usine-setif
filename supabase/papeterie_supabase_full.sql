-- =============================================================================
--  PAPETERIE PRODUCTION — FULL SUPABASE SCHEMA
--  Paper production factory management (stock, purchases, production,
--  comptoir, POS, sales, commands & deliveries, clients, suppliers, workers,
--  expenses, caisse, reports, settings, recycle bin, storage buckets).
--
--  Run this file ONCE on a fresh Supabase project (SQL editor → Run).
--  It is idempotent for functions/policies (create or replace / drop if exists)
--  but tables are created with IF NOT EXISTS.
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- -----------------------------------------------------------------------------
--  0. IDENTITY & PERMISSIONS
-- -----------------------------------------------------------------------------

-- Application identity of every auth user (admin or worker).
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  username    text unique,
  email       text not null,
  role        text not null default 'worker' check (role in ('admin','worker')),
  permissions jsonb not null default '{}'::jsonb,
  worker_id   uuid,
  language    text not null default 'fr',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Username of the caller — stamped on every created row (created_by).
create or replace function public.current_username()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select coalesce(nullif(username,''), full_name, email) from public.profiles where id = auth.uid()),
    'system')
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role = 'admin' and is_active)
$$;

-- has_perm('sales','view') — admin always true; worker reads profiles.permissions.
create or replace function public.has_perm(p_module text, p_action text default 'view')
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active
      and coalesce((p.permissions -> p_module ->> p_action)::boolean, false)
  )
$$;

-- true when the caller may VIEW at least one of the given modules.
create or replace function public.can_view_any(p_modules text[])
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.profiles p, unnest(p_modules) m
    where p.id = auth.uid() and p.is_active
      and coalesce((p.permissions -> m ->> 'view')::boolean, false)
  )
$$;

-- RPC guard: raises when the caller has none of the (module, action) pairs.
-- p_pairs = array['pos:create','sales:create']
create or replace function public.require_perm(p_pairs text[])
returns void language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if public.is_admin() then return; end if;
  foreach v in array p_pairs loop
    if public.has_perm(split_part(v, ':', 1), split_part(v, ':', 2)) then return; end if;
  end loop;
  raise exception 'permission denied (%)', array_to_string(p_pairs, ', ');
end $$;

-- -----------------------------------------------------------------------------
--  1. REFERENCE LISTS
-- -----------------------------------------------------------------------------
create table if not exists public.marques               (id uuid primary key default gen_random_uuid(), name text not null unique, created_at timestamptz default now());
create table if not exists public.categories            (id uuid primary key default gen_random_uuid(), name text not null unique, created_at timestamptz default now());
create table if not exists public.units                 (id uuid primary key default gen_random_uuid(), name text not null unique, created_at timestamptz default now());
create table if not exists public.production_categories (id uuid primary key default gen_random_uuid(), name text not null unique, created_at timestamptz default now());
create table if not exists public.fiche_categories      (id uuid primary key default gen_random_uuid(), name text not null unique, created_at timestamptz default now());
create table if not exists public.expense_categories    (id uuid primary key default gen_random_uuid(), name text not null unique, created_at timestamptz default now());
create table if not exists public.caisse_categories     (id uuid primary key default gen_random_uuid(), name text not null unique, created_at timestamptz default now());
create table if not exists public.roles                 (id uuid primary key default gen_random_uuid(), name text not null unique, created_at timestamptz default now());

create table if not exists public.document_titles (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  scope text not null default 'statement',
  created_at timestamptz default now(),
  created_by text default public.current_username()
);

-- -----------------------------------------------------------------------------
--  2. SETTINGS (singletons)
-- -----------------------------------------------------------------------------
create table if not exists public.store_settings (
  id boolean primary key default true check (id),
  logo text, name text default 'Papeterie Production',
  description text default 'Production & Vente de Papier',
  email text, phone text, address text, social_media text,
  nif text, nis text, article text, rc text, activity_place text, city text,
  updated_at timestamptz default now()
);
insert into public.store_settings (id) values (true) on conflict do nothing;

create table if not exists public.caisse_settings (
  id boolean primary key default true check (id),
  initial_balance numeric(14,2) not null default 0
);
insert into public.caisse_settings (id) values (true) on conflict do nothing;

-- -----------------------------------------------------------------------------
--  3. STOCK (raw materials & paper products)
-- -----------------------------------------------------------------------------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text default '',
  barcode text,
  image_url text,
  marque_id uuid references public.marques(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  principal_quantity numeric(14,3) not null default 0,
  current_quantity numeric(14,3) not null default 0,
  min_alert_quantity numeric(14,3) not null default 0,
  purchase_price numeric(14,2) not null default 0,
  unit_enabled boolean not null default false,
  unit text,
  expiration_enabled boolean not null default false,
  expiration_date date,
  created_at timestamptz not null default now(),
  created_by text default public.current_username()
);
create index if not exists products_name_idx on public.products (lower(name));

-- -----------------------------------------------------------------------------
--  4. PARTIES
-- -----------------------------------------------------------------------------
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null, phone text default '', address text default '',
  credit_amount numeric(14,2) not null default 0,   -- paid in excess (acompte)
  created_at timestamptz default now(),
  created_by text default public.current_username()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null, phone text default '', address text default '', note text default '',
  rc text, nif text, nis text, article text,
  credit_amount numeric(14,2) not null default 0,   -- paid in excess (acompte)
  created_at timestamptz default now(),
  created_by text default public.current_username()
);

-- -----------------------------------------------------------------------------
--  5. CAISSE (cash register) — every money movement lands here
-- -----------------------------------------------------------------------------
create table if not exists public.caisse_transactions (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('deposit','withdrawal')),
  amount numeric(14,2) not null check (amount >= 0),
  date date not null default current_date,
  description text default '',
  category_id uuid references public.caisse_categories(id) on delete set null,
  category_name text,
  ref_table text,          -- source document table (sale_payments, expenses …)
  ref_id uuid,             -- source row id
  created_at timestamptz not null default now(),
  created_by text default public.current_username()
);
create index if not exists caisse_ref_idx on public.caisse_transactions (ref_table, ref_id);
create index if not exists caisse_date_idx on public.caisse_transactions (date);

create table if not exists public.caisse_reports (
  id uuid primary key default gen_random_uuid(),
  report_type text not null default 'day' check (report_type in ('day','period')),
  date date not null default current_date,
  end_date date,
  hour text default to_char(now() at time zone 'Africa/Algiers', 'HH24:MI'),
  description text default '',
  declared_amount numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  created_by text default public.current_username()
);

-- -----------------------------------------------------------------------------
--  6. PURCHASES
-- -----------------------------------------------------------------------------
create sequence if not exists public.purchase_ref_seq;
create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  reference text not null default ('ACH-' || lpad(nextval('public.purchase_ref_seq')::text, 6, '0')),
  supplier_id uuid references public.suppliers(id) on delete set null,
  date date not null default current_date,
  driver_plate text, bon_number text, note text,
  is_historical boolean not null default false,   -- old purchase: no stock, no caisse
  total_amount numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  rest_amount numeric(14,2) not null default 0,
  allocated_amount numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  created_by text default public.current_username()
);

create table if not exists public.purchase_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity numeric(14,3) not null default 0,
  purchase_price numeric(14,2) not null default 0,
  min_alert_quantity numeric(14,3),
  unit_enabled boolean default false, unit text,
  expiration_enabled boolean default false, expiration_date date
);

-- -----------------------------------------------------------------------------
--  7. PRODUCTION
-- -----------------------------------------------------------------------------
create table if not exists public.fiche_technics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category_id uuid, category_name text,
  description text default '',
  sell_by_unit boolean default false, sell_unit text,
  usable_in_production boolean default false, product_unit text,
  output_quantity numeric(14,3) not null default 1,
  unit_price numeric(14,2) default 0, total_cost numeric(14,2) default 0,
  cost_per_unit numeric(14,4) default 0, total_value numeric(14,2) default 0,
  gains_per_unit numeric(14,4) default 0, total_gains numeric(14,2) default 0,
  created_at timestamptz not null default now(),
  created_by text default public.current_username()
);
create table if not exists public.fiche_technic_lines (
  id uuid primary key default gen_random_uuid(),
  fiche_technic_id uuid not null references public.fiche_technics(id) on delete cascade,
  product_id uuid,             -- products.id (stock) or fiche_technics.id (fiche)
  product_name text not null,
  quantity_used numeric(14,4) not null default 0,
  source_type text default 'stock' check (source_type in ('stock','fiche')),
  unit text, unit_cost numeric(14,4) default 0, line_cost numeric(14,2) default 0
);

create table if not exists public.productions (
  id uuid primary key default gen_random_uuid(),
  name text not null, description text default '',
  date date not null default current_date, hour text,
  fiche_technic_id uuid references public.fiche_technics(id) on delete set null,
  category_id uuid, category_name text,
  total_cost numeric(14,2) not null default 0,
  output_quantity numeric(14,3) not null default 0,
  unit_price numeric(14,2) not null default 0,
  total_value numeric(14,2) not null default 0,
  sell_by_unit boolean default false, sell_unit text,
  sent_to_comptoir numeric(14,3) not null default 0,
  has_loss boolean default false, expected_quantity numeric(14,3),
  loss_quantity numeric(14,3) default 0, loss_description text, loss_value numeric(14,2) default 0,
  origin text not null default 'manual' check (origin in ('manual','pos')),
  sale_id uuid, sale_reference text, line_key text,
  created_at timestamptz not null default now(),
  created_by text default public.current_username()
);
create table if not exists public.production_used_products (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.productions(id) on delete cascade,
  product_id uuid,
  product_name text not null,
  quantity_used numeric(14,4) not null default 0,
  source_type text default 'stock',
  unit text, unit_cost numeric(14,4) default 0, line_cost numeric(14,2) default 0
);

-- -----------------------------------------------------------------------------
--  8. COMPTOIR (finished goods ready to sell) & DESTRUCTIONS
-- -----------------------------------------------------------------------------
create table if not exists public.comptoir_items (
  id uuid primary key default gen_random_uuid(),
  production_id uuid references public.productions(id) on delete set null,
  product_name text not null, description text,
  quantity numeric(14,3) not null default 0,
  initial_quantity numeric(14,3) not null default 0,
  unit_price numeric(14,2) not null default 0,
  date date not null default current_date,
  category_id uuid, category_name text,
  sell_by_unit boolean default false, unit text,
  created_at timestamptz not null default now(),
  created_by text default public.current_username()
);
create table if not exists public.destructions (
  id uuid primary key default gen_random_uuid(),
  comptoir_id uuid references public.comptoir_items(id) on delete set null,
  product_name text not null,
  quantity numeric(14,3) not null default 0,
  value numeric(14,2) not null default 0,
  reason text default '', unit text,
  date date not null default current_date,
  created_at timestamptz not null default now(),
  created_by text default public.current_username()
);

-- -----------------------------------------------------------------------------
--  9. COMMANDS & DELIVERIES (a delivery = a sale)
-- -----------------------------------------------------------------------------
create sequence if not exists public.command_ref_seq;
create table if not exists public.commands (
  id uuid primary key default gen_random_uuid(),
  reference text not null default ('CMD-' || lpad(nextval('public.command_ref_seq')::text, 6, '0')),
  bon_number text,
  client_id uuid references public.clients(id) on delete set null,
  client_name text not null default '', client_phone text, client_address text,
  driver_name text, driver_plate text,
  receive_date date, receive_hour text, receive_minute text,
  total_amount numeric(14,2) not null default 0,       -- H.T
  tva_enabled boolean not null default false,
  tva_rate numeric(6,2) not null default 0,
  tva_amount numeric(14,2) not null default 0,
  total_ttc numeric(14,2) not null default 0,
  advance_paid numeric(14,2) not null default 0,
  extra_paid numeric(14,2) not null default 0,
  credit_applied numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  rest_amount numeric(14,2) not null default 0,
  status text not null default 'pending' check (status in ('pending','finalised','cancelled')),
  is_historical boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  created_by text default public.current_username()
);
create table if not exists public.command_items (
  id uuid primary key default gen_random_uuid(),
  command_id uuid not null references public.commands(id) on delete cascade,
  position int not null default 0,
  product_id uuid,
  fiche_technic_id uuid references public.fiche_technics(id) on delete set null,
  product_name text not null,
  quantity numeric(14,3) not null default 0,
  delivered_quantity numeric(14,3) not null default 0,
  cancelled_quantity numeric(14,3) not null default 0,
  unit_price numeric(14,2) not null default 0,
  total_price numeric(14,2) not null default 0,
  sell_by_unit boolean default false, sell_unit text
);
create table if not exists public.command_payments (
  id uuid primary key default gen_random_uuid(),
  command_id uuid not null references public.commands(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  date date not null default current_date,
  notes text,
  created_at timestamptz not null default now(),
  created_by text default public.current_username()
);
create table if not exists public.command_adjustments (
  id uuid primary key default gen_random_uuid(),
  command_id uuid not null references public.commands(id) on delete cascade,
  command_reference text, client_id uuid, client_name text,
  type text not null check (type in ('cancel','increase')),
  date date not null default current_date,
  reason text,
  total_quantity numeric(14,3) default 0, total_amount numeric(14,2) default 0,
  created_at timestamptz not null default now(),
  created_by text default public.current_username()
);
create table if not exists public.command_adjustment_lines (
  id uuid primary key default gen_random_uuid(),
  adjustment_id uuid not null references public.command_adjustments(id) on delete cascade,
  command_item_id uuid references public.command_items(id) on delete set null,
  product_name text not null,
  quantity numeric(14,3) not null default 0,
  unit_price numeric(14,2) default 0, amount numeric(14,2) default 0, unit text
);

-- -----------------------------------------------------------------------------
--  10. SALES (POS, old sales, delivery invoices)
-- -----------------------------------------------------------------------------
create sequence if not exists public.sale_ref_seq;
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  reference text not null default ('V-' || lpad(nextval('public.sale_ref_seq')::text, 6, '0')),
  client_id uuid references public.clients(id) on delete set null,
  date date not null default current_date,
  bon_number text, note text,
  is_historical boolean not null default false,  -- old sale: no stock / comptoir / caisse movement
  tva_enabled boolean not null default false,
  tva_rate numeric(6,2) not null default 0,
  tva_amount numeric(14,2) not null default 0,
  delivery_id uuid,
  command_id uuid references public.commands(id) on delete set null,
  total_amount numeric(14,2) not null default 0,   -- H.T lines
  reduction numeric(14,2) not null default 0,
  final_amount numeric(14,2) not null default 0,   -- T.T.C
  paid_amount numeric(14,2) not null default 0,
  rest_amount numeric(14,2) not null default 0,
  allocated_amount numeric(14,2) not null default 0,
  status text not null default 'paid' check (status in ('paid','debt')),
  created_at timestamptz not null default now(),
  created_by text default public.current_username()
);
create index if not exists sales_client_idx on public.sales (client_id);
create index if not exists sales_date_idx on public.sales (date);

create table if not exists public.sale_lines (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  comptoir_id uuid references public.comptoir_items(id) on delete set null,
  fiche_technic_id uuid references public.fiche_technics(id) on delete set null,
  production_id uuid references public.productions(id) on delete set null,
  command_item_id uuid references public.command_items(id) on delete set null,
  line_key text,
  product_name text not null,
  quantity numeric(14,3) not null default 0,
  selling_price numeric(14,2) not null default 0,
  base_price numeric(14,2),
  sell_by_unit boolean default false, unit text,
  stock_applied boolean not null default false   -- true when stock/comptoir was decremented
);

create sequence if not exists public.delivery_ref_seq;
create table if not exists public.command_deliveries (
  id uuid primary key default gen_random_uuid(),
  command_id uuid not null references public.commands(id) on delete cascade,
  reference text not null default ('BL-' || lpad(nextval('public.delivery_ref_seq')::text, 6, '0')),
  date date not null default current_date,
  delivered_at timestamptz not null default now(),
  notes text default '',
  driver_name text, driver_plate text, location text,
  is_historical boolean not null default false,
  tva_enabled boolean not null default false,
  tva_rate numeric(6,2) not null default 0,
  tva_amount numeric(14,2) not null default 0,
  total_ht numeric(14,2) not null default 0,
  total_ttc numeric(14,2) not null default 0,
  advance_applied numeric(14,2) not null default 0,
  cash_paid numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  rest_amount numeric(14,2) not null default 0,
  sale_id uuid references public.sales(id) on delete cascade,
  sale_reference text,
  created_at timestamptz not null default now(),
  created_by text default public.current_username()
);
do $$ begin
  alter table public.sales add constraint sales_delivery_fk
    foreign key (delivery_id) references public.command_deliveries(id) on delete set null
    deferrable initially immediate;
exception when duplicate_object then null; end $$;
-- sales <-> command_deliveries reference each other: deferrable so both can be restored together
do $$ begin
  alter table public.command_deliveries alter constraint command_deliveries_sale_id_fkey deferrable initially immediate;
exception when others then null; end $$;

create table if not exists public.command_delivery_items (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.command_deliveries(id) on delete cascade,
  command_item_id uuid references public.command_items(id) on delete set null,
  product_name text not null,
  quantity numeric(14,3) not null default 0,
  sell_unit text
);
create table if not exists public.command_delivery_consumptions (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.command_deliveries(id) on delete cascade,
  command_item_id uuid references public.command_items(id) on delete set null,
  fiche_technic_id uuid references public.fiche_technics(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  unit text,
  delivered_quantity numeric(14,3) default 0,
  quantity numeric(14,4) not null default 0,
  unit_cost numeric(14,4) default 0,
  line_cost numeric(14,2) default 0
);

-- -----------------------------------------------------------------------------
--  11. PAYMENTS & PARTY LEDGER
-- -----------------------------------------------------------------------------
create table if not exists public.client_payments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  client_name text,
  amount numeric(14,2) not null check (amount > 0),
  date date not null default current_date,
  paid_at timestamptz not null default now(),
  notes text default '',
  method text not null default 'especes' check (method in ('especes','cheque','virement')),
  cheque_number text, virement_number text, bank_name text,
  credit_part numeric(14,2) not null default 0,   -- part kept as acompte
  created_at timestamptz not null default now(),
  created_by text default public.current_username()
);
create table if not exists public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.suppliers(id) on delete cascade,
  supplier_name text,
  amount numeric(14,2) not null check (amount > 0),
  date date not null default current_date,
  paid_at timestamptz not null default now(),
  notes text default '',
  method text not null default 'especes' check (method in ('especes','cheque','virement')),
  cheque_number text, virement_number text, bank_name text,
  credit_part numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  created_by text default public.current_username()
);

-- origin: null (cash at the counter / pay debt) | 'client_payment' | 'credit' | 'command_advance'
create table if not exists public.sale_payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  description text default '',
  origin text,
  client_payment_id uuid references public.client_payments(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by text default public.current_username()
);
-- origin: null | 'supplier_payment' | 'credit'
create table if not exists public.purchase_payments (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  description text default '',
  origin text,
  supplier_payment_id uuid references public.supplier_payments(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by text default public.current_username()
);

create table if not exists public.party_old_debts (
  id uuid primary key default gen_random_uuid(),
  party_type text not null check (party_type in ('client','supplier')),
  party_id uuid not null,
  party_name text,
  amount numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  rest_amount numeric(14,2) not null default 0,
  date date not null default current_date,
  description text default '',
  created_at timestamptz not null default now(),
  created_by text default public.current_username()
);
create table if not exists public.party_old_debt_allocations (
  id uuid primary key default gen_random_uuid(),
  old_debt_id uuid not null references public.party_old_debts(id) on delete cascade,
  client_payment_id uuid references public.client_payments(id) on delete cascade,
  supplier_payment_id uuid references public.supplier_payments(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0)
);
create table if not exists public.party_credit_refunds (
  id uuid primary key default gen_random_uuid(),
  party_type text not null check (party_type in ('client','supplier')),
  party_id uuid not null,
  party_name text,
  amount numeric(14,2) not null check (amount > 0),
  date date not null default current_date,
  refunded_at timestamptz not null default now(),
  notes text default '',
  method text not null default 'especes',
  cheque_number text, virement_number text, bank_name text,
  created_at timestamptz not null default now(),
  created_by text default public.current_username()
);

-- legacy « dettes clients » screen
create table if not exists public.client_debts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  client_name text not null default '', client_phone text,
  total_debt numeric(14,2) not null default 0,
  total_paid numeric(14,2) not null default 0,
  rest_amount numeric(14,2) not null default 0,
  date date not null default current_date,
  description text default '',
  created_at timestamptz not null default now(),
  created_by text default public.current_username()
);
create table if not exists public.client_debt_versements (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null references public.client_debts(id) on delete cascade,
  client_id uuid, client_name text,
  amount numeric(14,2) not null check (amount > 0),
  date date not null default current_date,
  notes text,
  created_at timestamptz not null default now(),
  created_by text default public.current_username()
);

-- -----------------------------------------------------------------------------
--  12. WORKERS
-- -----------------------------------------------------------------------------
create table if not exists public.workers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  birthday date, id_card_number text, phone text,
  role_id uuid references public.roles(id) on delete set null,
  payment_enabled boolean default true,
  payment_type text default 'monthly',
  payment_amount numeric(14,2) default 0,
  start_date date,
  has_account boolean default false,
  email text, username text,
  permissions jsonb not null default '{}'::jsonb,
  auth_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by text default public.current_username()
);
do $$ begin
  alter table public.profiles add constraint profiles_worker_fk
    foreign key (worker_id) references public.workers(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists public.worker_acomptes (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete cascade,
  date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  description text default '',
  created_at timestamptz default now(), created_by text default public.current_username()
);
create table if not exists public.worker_absences (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete cascade,
  date date not null default current_date,
  description text default '', cost numeric(14,2) default 0,
  created_at timestamptz default now(), created_by text default public.current_username()
);
create table if not exists public.worker_payments (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete cascade,
  date date not null default current_date,
  period text default '',
  amount numeric(14,2) not null check (amount > 0),
  description text default '',
  kind text not null default 'salary' check (kind in ('salary','overtime')),
  created_at timestamptz default now(), created_by text default public.current_username()
);
create table if not exists public.worker_overtimes (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete cascade,
  date date not null default current_date,
  work_end_hour int default 0, work_end_minute int default 0,
  overtime_end_hour int default 0, overtime_end_minute int default 0,
  hours numeric(8,2) default 0, hourly_rate numeric(14,2) default 0,
  amount numeric(14,2) default 0, description text default '',
  is_paid boolean not null default false, paid_at date,
  payment_id uuid references public.worker_payments(id) on delete set null,
  created_at timestamptz default now(), created_by text default public.current_username()
);

-- -----------------------------------------------------------------------------
--  13. EXPENSES & PURCHASE ORDERS
-- -----------------------------------------------------------------------------
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  name text not null, description text default '',
  amount numeric(14,2) not null default 0,
  date date not null default current_date,
  category_id uuid references public.expense_categories(id) on delete set null,
  category_name text,
  created_at timestamptz default now(), created_by text default public.current_username()
);

create sequence if not exists public.purchase_order_ref_seq;
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null default ('BC-' || lpad(nextval('public.purchase_order_ref_seq')::text, 6, '0')),
  date date not null default current_date,
  supplier_name text default '', notes text default '',
  created_at timestamptz default now(), created_by text default public.current_username()
);
create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.purchase_orders(id) on delete cascade,
  product_name text not null, description text default '',
  quantity numeric(14,3) default 0, unit text
);

-- -----------------------------------------------------------------------------
--  14. RECYCLE BIN
-- -----------------------------------------------------------------------------
create table if not exists public.recycle_bin (
  id bigserial primary key,
  tx_id bigint not null,
  table_name text not null,
  row_id text,
  data jsonb not null,
  deleted_at timestamptz not null default now(),
  deleted_by_name text default public.current_username()
);
create index if not exists recycle_tx_idx on public.recycle_bin (tx_id);
-- =============================================================================
--  BUSINESS TRIGGERS
--  Rule: every side effect written on INSERT is undone on DELETE, so editing a
--  document (delete + re-insert lines) and restoring from the recycle bin stay
--  consistent. All trigger functions are SECURITY DEFINER: a worker allowed to
--  sell can move stock and write the caisse without direct rights on them.
-- =============================================================================

alter table public.purchase_lines add column if not exists stock_applied boolean not null default false;
alter table public.production_used_products add column if not exists stock_applied boolean not null default false;
alter table public.command_delivery_consumptions add column if not exists stock_applied boolean not null default false;

-- -----------------------------------------------------------------------------
--  Caisse helpers
-- -----------------------------------------------------------------------------
create or replace function public._caisse_set(
  p_ref_table text, p_ref_id uuid, p_type text, p_amount numeric,
  p_date date, p_description text, p_category text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.caisse_transactions where ref_table = p_ref_table and ref_id = p_ref_id;
  if coalesce(p_amount, 0) > 0 then
    insert into public.caisse_transactions (type, amount, date, description, category_name, ref_table, ref_id)
    values (p_type, round(p_amount, 2), coalesce(p_date, current_date), coalesce(p_description, ''), p_category, p_ref_table, p_ref_id);
  end if;
end $$;

create or replace function public._caisse_clear(p_ref_table text, p_ref_id uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.caisse_transactions where ref_table = p_ref_table and ref_id = p_ref_id;
$$;

-- -----------------------------------------------------------------------------
--  Recalculation helpers
-- -----------------------------------------------------------------------------
create or replace function public._recalc_sale(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.sales; v_total numeric; v_base numeric; v_tva numeric; v_final numeric;
        v_paid numeric; v_alloc numeric; v_has_lines boolean;
begin
  if position(p_id::text in coalesce(current_setting('app.deleting_doc', true), '')) > 0 then return; end if;
  select * into s from public.sales where id = p_id;
  if not found then return; end if;
  select exists(select 1 from public.sale_lines where sale_id = p_id),
         coalesce(sum(quantity * selling_price), 0)
    into v_has_lines, v_total from public.sale_lines where sale_id = p_id;
  if not v_has_lines then v_total := s.total_amount; end if;
  v_base := greatest(0, round(v_total, 2) - coalesce(s.reduction, 0));
  v_tva := case when s.tva_enabled then round(v_base * s.tva_rate) / 100 else 0 end;
  v_final := round(v_base + v_tva, 2);
  select coalesce(sum(amount), 0), coalesce(sum(amount) filter (where origin = 'credit'), 0)
    into v_paid, v_alloc from public.sale_payments where sale_id = p_id;
  update public.sales set
    total_amount = round(v_total, 2), tva_amount = v_tva, final_amount = v_final,
    paid_amount = v_paid, allocated_amount = v_alloc,
    rest_amount = greatest(0, v_final - v_paid),
    status = case when v_final - v_paid > 0.004 then 'debt' else 'paid' end
  where id = p_id;
  -- a delivery invoice mirrors its money on the delivery note
  if s.delivery_id is not null then
    update public.command_deliveries d set
      total_ht = v_base, tva_amount = v_tva, total_ttc = v_final,
      tva_enabled = s.tva_enabled, tva_rate = s.tva_rate,
      advance_applied = coalesce((select sum(amount) from public.sale_payments where sale_id = p_id and origin = 'command_advance'), 0),
      cash_paid = coalesce((select sum(amount) from public.sale_payments where sale_id = p_id and origin is distinct from 'command_advance'), 0),
      paid_amount = v_paid, rest_amount = greatest(0, v_final - v_paid)
    where d.id = s.delivery_id;
  end if;
end $$;

create or replace function public._recalc_purchase(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_total numeric; v_paid numeric; v_alloc numeric; v_has boolean; p public.purchases;
begin
  if position(p_id::text in coalesce(current_setting('app.deleting_doc', true), '')) > 0 then return; end if;
  select * into p from public.purchases where id = p_id;
  if not found then return; end if;
  select exists(select 1 from public.purchase_lines where purchase_id = p_id),
         coalesce(sum(quantity * purchase_price), 0)
    into v_has, v_total from public.purchase_lines where purchase_id = p_id;
  if not v_has then v_total := p.total_amount; end if;
  select coalesce(sum(amount), 0), coalesce(sum(amount) filter (where origin = 'credit'), 0)
    into v_paid, v_alloc from public.purchase_payments where purchase_id = p_id;
  update public.purchases set
    total_amount = round(v_total, 2), paid_amount = v_paid, allocated_amount = v_alloc,
    rest_amount = greatest(0, round(v_total, 2) - v_paid)
  where id = p_id;
end $$;

create or replace function public._recalc_command(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c public.commands; v_ht numeric; v_tva numeric; v_ttc numeric; v_extra numeric; v_paid numeric;
begin
  select * into c from public.commands where id = p_id;
  if not found then return; end if;
  update public.command_items set total_price = round(quantity * unit_price, 2) where command_id = p_id;
  select coalesce(sum(greatest(0, quantity - cancelled_quantity) * unit_price), 0)
    into v_ht from public.command_items where command_id = p_id;
  v_ht := round(v_ht, 2);
  v_tva := case when c.tva_enabled then round(v_ht * c.tva_rate) / 100 else 0 end;
  v_ttc := round(v_ht + v_tva, 2);
  select coalesce(sum(amount), 0) into v_extra from public.command_payments where command_id = p_id;
  v_paid := c.advance_paid + v_extra + c.credit_applied;
  update public.commands set
    total_amount = v_ht, tva_amount = v_tva, total_ttc = v_ttc,
    extra_paid = v_extra, paid_amount = v_paid, rest_amount = greatest(0, v_ttc - v_paid)
  where id = p_id;
end $$;

create or replace function public._recalc_old_debt(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_paid numeric;
begin
  select coalesce(sum(amount), 0) into v_paid from public.party_old_debt_allocations where old_debt_id = p_id;
  update public.party_old_debts set paid_amount = v_paid, rest_amount = greatest(0, amount - v_paid) where id = p_id;
end $$;

-- -----------------------------------------------------------------------------
--  PURCHASE LINES → stock (skipped for « ancien achat »)
-- -----------------------------------------------------------------------------
create or replace function public.trg_purchase_line_stock()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_hist boolean;
begin
  if tg_op in ('UPDATE','DELETE') and old.stock_applied and old.product_id is not null then
    update public.products set
      current_quantity = current_quantity - old.quantity,
      principal_quantity = greatest(0, principal_quantity - old.quantity)
    where id = old.product_id;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    select is_historical into v_hist from public.purchases where id = new.purchase_id;
    new.stock_applied := (not coalesce(v_hist, false)) and new.product_id is not null;
    if new.stock_applied then
      update public.products set
        current_quantity = current_quantity + new.quantity,
        principal_quantity = principal_quantity + new.quantity,
        purchase_price = case when new.purchase_price > 0 then new.purchase_price else purchase_price end,
        min_alert_quantity = coalesce(nullif(new.min_alert_quantity, 0), min_alert_quantity),
        unit_enabled = coalesce(new.unit_enabled, unit_enabled),
        unit = case when new.unit_enabled then coalesce(new.unit, unit) else unit end,
        expiration_enabled = case when new.expiration_date is not null then true else expiration_enabled end,
        expiration_date = coalesce(new.expiration_date, expiration_date)
      where id = new.product_id;
    end if;
    return new;
  end if;
  return old;
end $$;
drop trigger if exists purchase_line_stock on public.purchase_lines;
create trigger purchase_line_stock before insert or update or delete on public.purchase_lines
  for each row execute function public.trg_purchase_line_stock();

create or replace function public.trg_purchase_line_recalc()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public._recalc_purchase(coalesce(new.purchase_id, old.purchase_id));
  return null;
end $$;
drop trigger if exists purchase_line_recalc on public.purchase_lines;
create trigger purchase_line_recalc after insert or update or delete on public.purchase_lines
  for each row execute function public.trg_purchase_line_recalc();

-- -----------------------------------------------------------------------------
--  PURCHASE PAYMENTS → caisse withdrawal + totals
-- -----------------------------------------------------------------------------
create or replace function public.trg_purchase_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare p public.purchases;
begin
  if tg_op = 'DELETE' then
    perform public._caisse_clear('purchase_payments', old.id);
    if old.origin = 'credit' then
      update public.suppliers set credit_amount = credit_amount + old.amount
      where id = (select supplier_id from public.purchases where id = old.purchase_id);
    end if;
    perform public._recalc_purchase(old.purchase_id);
    return old;
  end if;
  select * into p from public.purchases where id = new.purchase_id;
  if tg_op = 'INSERT' and new.origin = 'credit' then
    update public.suppliers set credit_amount = credit_amount - new.amount where id = p.supplier_id;
  end if;
  if new.origin is null and not coalesce(p.is_historical, false) then
    perform public._caisse_set('purchase_payments', new.id, 'withdrawal', new.amount, new.date,
      'Achat ' || coalesce(p.reference, ''), 'Achat');
  else
    perform public._caisse_clear('purchase_payments', new.id);
  end if;
  perform public._recalc_purchase(new.purchase_id);
  return new;
end $$;
drop trigger if exists purchase_payment_trg on public.purchase_payments;
create trigger purchase_payment_trg after insert or update or delete on public.purchase_payments
  for each row execute function public.trg_purchase_payment();

-- -----------------------------------------------------------------------------
--  SALE LINES → comptoir / stock (skipped for « ancienne vente » & delivery invoices)
-- -----------------------------------------------------------------------------
create or replace function public.trg_sale_line_stock()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_hist boolean; v_delivery uuid;
begin
  if tg_op in ('UPDATE','DELETE') and old.stock_applied then
    if old.comptoir_id is not null then
      update public.comptoir_items set quantity = quantity + old.quantity where id = old.comptoir_id;
    elsif old.product_id is not null then
      update public.products set current_quantity = current_quantity + old.quantity where id = old.product_id;
    end if;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    select is_historical, delivery_id into v_hist, v_delivery from public.sales where id = new.sale_id;
    -- delivery invoices consume raw materials through command_delivery_consumptions instead
    new.stock_applied := not coalesce(v_hist, false) and v_delivery is null
                         and (new.comptoir_id is not null or new.product_id is not null);
    if new.stock_applied then
      if new.comptoir_id is not null then
        update public.comptoir_items set quantity = quantity - new.quantity where id = new.comptoir_id;
      else
        update public.products set current_quantity = current_quantity - new.quantity where id = new.product_id;
      end if;
    end if;
    return new;
  end if;
  return old;
end $$;
drop trigger if exists sale_line_stock on public.sale_lines;
create trigger sale_line_stock before insert or update or delete on public.sale_lines
  for each row execute function public.trg_sale_line_stock();

create or replace function public.trg_sale_line_recalc()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public._recalc_sale(coalesce(new.sale_id, old.sale_id));
  return null;
end $$;
drop trigger if exists sale_line_recalc on public.sale_lines;
create trigger sale_line_recalc after insert or update or delete on public.sale_lines
  for each row execute function public.trg_sale_line_recalc();

-- -----------------------------------------------------------------------------
--  SALE PAYMENTS → caisse deposit (cash only) + totals
-- -----------------------------------------------------------------------------
create or replace function public.trg_sale_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare s public.sales;
begin
  if tg_op = 'DELETE' then
    perform public._caisse_clear('sale_payments', old.id);
    -- money that came from the client's acompte goes back to it
    if old.origin = 'credit' then
      update public.clients set credit_amount = credit_amount + old.amount
      where id = (select client_id from public.sales where id = old.sale_id);
    end if;
    perform public._recalc_sale(old.sale_id);
    return old;
  end if;
  select * into s from public.sales where id = new.sale_id;
  if tg_op = 'INSERT' and new.origin = 'credit' then
    update public.clients set credit_amount = credit_amount - new.amount where id = s.client_id;
  end if;
  if new.origin is null and not coalesce(s.is_historical, false) then
    perform public._caisse_set('sale_payments', new.id, 'deposit', new.amount, new.date,
      case when s.delivery_id is not null then 'Bon de livraison ' else 'Vente ' end || coalesce(s.reference, ''),
      case when s.delivery_id is not null then 'Livraison' else 'Vente' end);
  else
    perform public._caisse_clear('sale_payments', new.id);
  end if;
  perform public._recalc_sale(new.sale_id);
  return new;
end $$;
drop trigger if exists sale_payment_trg on public.sale_payments;
create trigger sale_payment_trg after insert or update or delete on public.sale_payments
  for each row execute function public.trg_sale_payment();

-- Payments are removed BEFORE their document so acompte money finds its party.
create or replace function public.trg_doc_before_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- the document itself must not be re-updated while it is being deleted
  perform set_config('app.deleting_doc', coalesce(current_setting('app.deleting_doc', true), '') || ',' || old.id::text, true);
  if tg_table_name = 'sales' then
    delete from public.sale_payments where sale_id = old.id;
    delete from public.sale_lines where sale_id = old.id;
  else
    delete from public.purchase_payments where purchase_id = old.id;
    delete from public.purchase_lines where purchase_id = old.id;
  end if;
  return old;
end $$;
drop trigger if exists sale_before_delete on public.sales;
create trigger sale_before_delete before delete on public.sales
  for each row execute function public.trg_doc_before_delete();
drop trigger if exists purchase_before_delete on public.purchases;
create trigger purchase_before_delete before delete on public.purchases
  for each row execute function public.trg_doc_before_delete();

-- -----------------------------------------------------------------------------
--  COMMANDS — advance & payments → caisse ; totals
-- -----------------------------------------------------------------------------
create or replace function public.trg_command_advance()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public._caisse_clear('commands', old.id);
    if old.credit_applied > 0 and old.client_id is not null then
      update public.clients set credit_amount = credit_amount + old.credit_applied where id = old.client_id;
    end if;
    return old;
  end if;
  if new.is_historical then
    perform public._caisse_clear('commands', new.id);
  else
    perform public._caisse_set('commands', new.id, 'deposit', new.advance_paid,
      coalesce(new.created_at::date, current_date), 'Acompte commande ' || new.reference, 'Commande');
  end if;
  return new;
end $$;
drop trigger if exists command_advance_trg on public.commands;
create trigger command_advance_trg after insert or update of advance_paid, is_historical, created_at or delete on public.commands
  for each row execute function public.trg_command_advance();

create or replace function public.trg_command_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare c public.commands;
begin
  if tg_op = 'DELETE' then
    perform public._caisse_clear('command_payments', old.id);
    perform public._recalc_command(old.command_id);
    return old;
  end if;
  select * into c from public.commands where id = new.command_id;
  if coalesce(c.is_historical, false) then
    perform public._caisse_clear('command_payments', new.id);
  else
    perform public._caisse_set('command_payments', new.id, 'deposit', new.amount, new.date,
      'Règlement commande ' || coalesce(c.reference, ''), 'Commande');
  end if;
  perform public._recalc_command(new.command_id);
  return new;
end $$;
drop trigger if exists command_payment_trg on public.command_payments;
create trigger command_payment_trg after insert or update or delete on public.command_payments
  for each row execute function public.trg_command_payment();

-- -----------------------------------------------------------------------------
--  DELIVERIES — delivered quantities, raw-material consumption, linked sale
-- -----------------------------------------------------------------------------
create or replace function public.trg_delivery_item()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE','DELETE') and old.command_item_id is not null then
    update public.command_items set delivered_quantity = greatest(0, delivered_quantity - old.quantity)
    where id = old.command_item_id;
  end if;
  if tg_op in ('INSERT','UPDATE') and new.command_item_id is not null then
    update public.command_items set delivered_quantity = delivered_quantity + new.quantity
    where id = new.command_item_id;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists delivery_item_trg on public.command_delivery_items;
create trigger delivery_item_trg after insert or update or delete on public.command_delivery_items
  for each row execute function public.trg_delivery_item();

create or replace function public.trg_delivery_consumption()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_hist boolean;
begin
  if tg_op = 'DELETE' then
    if old.stock_applied and old.product_id is not null then
      update public.products set current_quantity = current_quantity + old.quantity where id = old.product_id;
    end if;
    return old;
  end if;
  select is_historical into v_hist from public.command_deliveries where id = new.delivery_id;
  new.stock_applied := not coalesce(v_hist, false) and new.product_id is not null;
  if new.stock_applied then
    update public.products set current_quantity = current_quantity - new.quantity where id = new.product_id;
  end if;
  return new;
end $$;
drop trigger if exists delivery_consumption_trg on public.command_delivery_consumptions;
create trigger delivery_consumption_trg before insert or delete on public.command_delivery_consumptions
  for each row execute function public.trg_delivery_consumption();

-- deleting a delivery note deletes its invoice (and vice-versa through the FK cascade)
create or replace function public.trg_delivery_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.sale_id is not null then
    delete from public.sales where id = old.sale_id;
  end if;
  perform public._recalc_command(old.command_id);
  return old;
end $$;
drop trigger if exists delivery_delete_trg on public.command_deliveries;
create trigger delivery_delete_trg after delete on public.command_deliveries
  for each row execute function public.trg_delivery_delete();

-- -----------------------------------------------------------------------------
--  PRODUCTION — raw materials leave the stock ; comptoir transfers
-- -----------------------------------------------------------------------------
create or replace function public.trg_production_used()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.stock_applied then
      update public.products set current_quantity = current_quantity + old.quantity_used where id = old.product_id;
    end if;
    return old;
  end if;
  new.stock_applied := coalesce(new.source_type, 'stock') = 'stock'
                       and new.product_id is not null
                       and exists (select 1 from public.products where id = new.product_id);
  if new.stock_applied then
    update public.products set current_quantity = current_quantity - new.quantity_used where id = new.product_id;
  end if;
  return new;
end $$;
drop trigger if exists production_used_trg on public.production_used_products;
create trigger production_used_trg before insert or delete on public.production_used_products
  for each row execute function public.trg_production_used();

create or replace function public.trg_comptoir_item()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.production_id is not null then
      update public.productions set sent_to_comptoir = greatest(0, sent_to_comptoir - old.initial_quantity)
      where id = old.production_id;
    end if;
    return old;
  end if;
  if new.initial_quantity = 0 then new.initial_quantity := new.quantity; end if;
  if new.production_id is not null then
    update public.productions set sent_to_comptoir = sent_to_comptoir + new.initial_quantity
    where id = new.production_id;
  end if;
  return new;
end $$;
drop trigger if exists comptoir_item_trg on public.comptoir_items;
create trigger comptoir_item_trg before insert or delete on public.comptoir_items
  for each row execute function public.trg_comptoir_item();

-- -----------------------------------------------------------------------------
--  PARTY PAYMENTS, REFUNDS, OLD DEBTS
-- -----------------------------------------------------------------------------
create or replace function public.trg_client_payment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public._caisse_clear('client_payments', old.id);
    update public.clients set credit_amount = credit_amount - old.credit_part where id = old.client_id;
    return old;
  end if;
  if tg_op = 'INSERT' and new.credit_part <> 0 then   -- restore from recycle bin
    update public.clients set credit_amount = credit_amount + new.credit_part where id = new.client_id;
  end if;
  perform public._caisse_set('client_payments', new.id, 'deposit', new.amount, new.date,
    'Versement client ' || coalesce(new.client_name, ''), 'Versement client');
  return new;
end $$;
drop trigger if exists client_payment_trg on public.client_payments;
create trigger client_payment_trg after insert or update or delete on public.client_payments
  for each row execute function public.trg_client_payment();

create or replace function public.trg_supplier_payment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public._caisse_clear('supplier_payments', old.id);
    update public.suppliers set credit_amount = credit_amount - old.credit_part where id = old.supplier_id;
    return old;
  end if;
  if tg_op = 'INSERT' and new.credit_part <> 0 then
    update public.suppliers set credit_amount = credit_amount + new.credit_part where id = new.supplier_id;
  end if;
  perform public._caisse_set('supplier_payments', new.id, 'withdrawal', new.amount, new.date,
    'Règlement fournisseur ' || coalesce(new.supplier_name, ''), 'Règlement fournisseur');
  return new;
end $$;
drop trigger if exists supplier_payment_trg on public.supplier_payments;
create trigger supplier_payment_trg after insert or update or delete on public.supplier_payments
  for each row execute function public.trg_supplier_payment();

create or replace function public.trg_party_refund()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    perform public._caisse_clear('party_credit_refunds', old.id);
    if old.party_type = 'client' then
      update public.clients set credit_amount = credit_amount + old.amount where id = old.party_id;
    else
      update public.suppliers set credit_amount = credit_amount + old.amount where id = old.party_id;
    end if;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    if new.party_type = 'client' then
      update public.clients set credit_amount = credit_amount - new.amount where id = new.party_id;
      perform public._caisse_set('party_credit_refunds', new.id, 'withdrawal', new.amount, new.date,
        'Excédent rendu au client ' || coalesce(new.party_name, ''), 'Remboursement');
    else
      update public.suppliers set credit_amount = credit_amount - new.amount where id = new.party_id;
      perform public._caisse_set('party_credit_refunds', new.id, 'deposit', new.amount, new.date,
        'Excédent récupéré fournisseur ' || coalesce(new.party_name, ''), 'Remboursement');
    end if;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists party_refund_trg on public.party_credit_refunds;
create trigger party_refund_trg after insert or update or delete on public.party_credit_refunds
  for each row execute function public.trg_party_refund();

create or replace function public.trg_old_debt_alloc()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public._recalc_old_debt(coalesce(new.old_debt_id, old.old_debt_id));
  return null;
end $$;
drop trigger if exists old_debt_alloc_trg on public.party_old_debt_allocations;
create trigger old_debt_alloc_trg after insert or update or delete on public.party_old_debt_allocations
  for each row execute function public.trg_old_debt_alloc();

create or replace function public.trg_old_debt_self()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.rest_amount := greatest(0, new.amount - new.paid_amount);
  return new;
end $$;
drop trigger if exists old_debt_self_trg on public.party_old_debts;
create trigger old_debt_self_trg before insert or update on public.party_old_debts
  for each row execute function public.trg_old_debt_self();

-- legacy client debts
create or replace function public.trg_client_debt_versement()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(new.debt_id, old.debt_id); v_paid numeric;
begin
  if tg_op = 'DELETE' then
    perform public._caisse_clear('client_debt_versements', old.id);
  else
    perform public._caisse_set('client_debt_versements', new.id, 'deposit', new.amount, new.date,
      'Versement dette ' || coalesce(new.client_name, ''), 'Versement client');
  end if;
  select coalesce(sum(amount), 0) into v_paid from public.client_debt_versements where debt_id = v_id;
  update public.client_debts set total_paid = v_paid, rest_amount = greatest(0, total_debt - v_paid) where id = v_id;
  return null;
end $$;
drop trigger if exists client_debt_versement_trg on public.client_debt_versements;
create trigger client_debt_versement_trg after insert or update or delete on public.client_debt_versements
  for each row execute function public.trg_client_debt_versement();

-- -----------------------------------------------------------------------------
--  EXPENSES & WORKERS → caisse
-- -----------------------------------------------------------------------------
create or replace function public.trg_expense()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then perform public._caisse_clear('expenses', old.id); return old; end if;
  perform public._caisse_set('expenses', new.id, 'withdrawal', new.amount, new.date,
    'Dépense : ' || new.name, coalesce(new.category_name, 'Dépense'));
  return new;
end $$;
drop trigger if exists expense_trg on public.expenses;
create trigger expense_trg after insert or update or delete on public.expenses
  for each row execute function public.trg_expense();

create or replace function public.trg_worker_money()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if tg_op = 'DELETE' then perform public._caisse_clear(tg_table_name, old.id); return old; end if;
  select full_name into v_name from public.workers where id = new.worker_id;
  perform public._caisse_set(tg_table_name, new.id, 'withdrawal', new.amount, new.date,
    case tg_table_name when 'worker_acomptes' then 'Acompte employé ' else 'Paiement employé ' end || coalesce(v_name, ''),
    case tg_table_name when 'worker_acomptes' then 'Acompte' else 'Salaire' end);
  return new;
end $$;
drop trigger if exists worker_acompte_trg on public.worker_acomptes;
create trigger worker_acompte_trg after insert or update or delete on public.worker_acomptes
  for each row execute function public.trg_worker_money();
drop trigger if exists worker_payment_trg on public.worker_payments;
create trigger worker_payment_trg after insert or update or delete on public.worker_payments
  for each row execute function public.trg_worker_money();

create or replace function public.trg_worker_payment_unmark()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.worker_overtimes set is_paid = false, paid_at = null, payment_id = null where payment_id = old.id;
  return old;
end $$;
drop trigger if exists worker_payment_unmark_trg on public.worker_payments;
create trigger worker_payment_unmark_trg before delete on public.worker_payments
  for each row execute function public.trg_worker_payment_unmark();

-- -----------------------------------------------------------------------------
--  RECYCLE BIN capture — only while recycle_delete() is running
-- -----------------------------------------------------------------------------
create or replace function public.trg_recycle_capture()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.recycle', true), '') <> 'on' then return old; end if;
  -- automatic caisse lines are rebuilt by their source document on restore
  if tg_table_name = 'caisse_transactions' and (to_jsonb(old) ->> 'ref_table') is not null then return old; end if;
  insert into public.recycle_bin (tx_id, table_name, row_id, data)
  values (txid_current(), tg_table_name, (to_jsonb(old) ->> 'id'), to_jsonb(old));
  return old;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'products','marques','categories','units','suppliers','clients','purchases','purchase_lines','purchase_payments',
    'sales','sale_lines','sale_payments','commands','command_items','command_payments','command_adjustments',
    'command_adjustment_lines','command_deliveries','command_delivery_items','command_delivery_consumptions',
    'productions','production_used_products','production_categories','fiche_technics','fiche_technic_lines',
    'fiche_categories','comptoir_items','destructions','client_payments','supplier_payments','party_old_debts',
    'party_old_debt_allocations','party_credit_refunds','client_debts','client_debt_versements','workers',
    'worker_acomptes','worker_absences','worker_payments','worker_overtimes','roles','expenses',
    'expense_categories','purchase_orders','purchase_order_items','caisse_transactions','caisse_categories',
    'caisse_reports','document_titles']
  loop
    execute format('drop trigger if exists zz_recycle on public.%I', t);
    execute format('create trigger zz_recycle after delete on public.%I for each row execute function public.trg_recycle_capture()', t);
  end loop;
end $$;
-- =============================================================================
--  RPC — AUTH, ACCOUNTS, PERMISSIONS
-- =============================================================================

-- Creates a confirmed e-mail/password user directly in auth.users + auth.identities.
create or replace function public._create_auth_user(p_email text, p_password text, p_meta jsonb)
returns uuid language plpgsql security definer set search_path = public, auth, extensions as $$
declare v_id uuid := gen_random_uuid(); v_email text := lower(trim(p_email));
begin
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'Cet utilisateur existe déjà (%)', v_email;
  end if;
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, reauthentication_token, phone_change, phone_change_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    crypt(p_password, gen_salt('bf')), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    coalesce(p_meta, '{}'::jsonb), now(), now(),
    '', '', '', '', '', '', '', ''
  );
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text,
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
          'email', now(), now(), now());
  return v_id;
end $$;

create or replace function public.admin_account_exists()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where role = 'admin')
$$;

-- Login page « Créer un compte Administrateur » — only while no admin exists.
create or replace function public.create_admin_account(p_name text, p_username text, p_email text, p_password text)
returns uuid language plpgsql security definer set search_path = public, auth, extensions as $$
declare v_id uuid;
begin
  if exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'Un compte administrateur existe déjà';
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'Le mot de passe doit contenir au moins 6 caractères';
  end if;
  if exists (select 1 from public.profiles where lower(username) = lower(trim(p_username))) then
    raise exception 'Cet utilisateur existe déjà';
  end if;
  v_id := public._create_auth_user(p_email, p_password,
            jsonb_build_object('full_name', p_name, 'username', p_username, 'role', 'admin'));
  insert into public.profiles (id, full_name, username, email, role, permissions)
  values (v_id, p_name, trim(p_username), lower(trim(p_email)), 'admin', '{}'::jsonb);
  return v_id;
end $$;

-- Username → e-mail for the login form (callable before sign-in).
create or replace function public.resolve_login_email(p_identifier text)
returns text language sql stable security definer set search_path = public as $$
  select email from public.profiles
  where lower(username) = lower(trim(p_identifier)) or lower(email) = lower(trim(p_identifier))
  limit 1
$$;

-- /workers — creates (or re-keys) the login of an employee.
create or replace function public.admin_create_worker_account(
  p_worker_id uuid, p_email text, p_password text, p_username text default null)
returns uuid language plpgsql security definer set search_path = public, auth, extensions as $$
declare w public.workers; v_uid uuid; v_email text := lower(trim(p_email));
        v_user text := coalesce(nullif(trim(p_username), ''), split_part(lower(trim(p_email)), '@', 1));
begin
  perform public.require_perm(array['workers:create','workers:edit']);
  select * into w from public.workers where id = p_worker_id;
  if not found then raise exception 'Employé introuvable'; end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'Le mot de passe doit contenir au moins 6 caractères';
  end if;

  select id into v_uid from public.profiles where worker_id = p_worker_id limit 1;
  if v_uid is null and w.auth_user_id is not null then v_uid := w.auth_user_id; end if;

  if v_uid is not null and exists (select 1 from auth.users where id = v_uid) then
    update auth.users set email = v_email, encrypted_password = crypt(p_password, gen_salt('bf')),
           email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
     where id = v_uid;
    update auth.identities set identity_data = identity_data || jsonb_build_object('email', v_email)
     where user_id = v_uid and provider = 'email';
  else
    if exists (select 1 from public.profiles where lower(username) = lower(v_user)) then
      raise exception 'Ce nom d''utilisateur existe déjà';
    end if;
    v_uid := public._create_auth_user(v_email, p_password,
               jsonb_build_object('full_name', w.full_name, 'username', v_user, 'role', 'worker'));
  end if;

  insert into public.profiles (id, full_name, username, email, role, permissions, worker_id)
  values (v_uid, w.full_name, v_user, v_email, 'worker', w.permissions, w.id)
  on conflict (id) do update set full_name = excluded.full_name, username = excluded.username,
    email = excluded.email, permissions = excluded.permissions, worker_id = excluded.worker_id, is_active = true;

  update public.workers set has_account = true, email = v_email, username = v_user, auth_user_id = v_uid
  where id = p_worker_id;
  return v_uid;
end $$;

-- Permission matrix of an employee: { "sales": {"view":true,"create":true,…}, … }
create or replace function public.set_worker_permissions(p_worker_id uuid, p_permissions jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  -- only the administrator decides what an employee may see / do
  if not public.is_admin() then
    raise exception 'Seul l''administrateur peut modifier les permissions';
  end if;
  update public.workers set permissions = coalesce(p_permissions, '{}'::jsonb) where id = p_worker_id;
  update public.profiles set permissions = coalesce(p_permissions, '{}'::jsonb) where worker_id = p_worker_id;
  return coalesce(p_permissions, '{}'::jsonb);
end $$;

-- deleting a worker disables his login
create or replace function public.trg_worker_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set is_active = false, permissions = '{}'::jsonb where worker_id = old.id;
  return old;
end $$;
-- a non-admin (even with workers:edit) can never grant permissions
create or replace function public.trg_worker_perm_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.permissions := '{}'::jsonb;
    else
      new.permissions := old.permissions;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists worker_perm_guard on public.workers;
create trigger worker_perm_guard before insert or update on public.workers
  for each row execute function public.trg_worker_perm_guard();

drop trigger if exists worker_delete_trg on public.workers;
create trigger worker_delete_trg before delete on public.workers
  for each row execute function public.trg_worker_delete();

-- =============================================================================
--  RPC — PURCHASES
-- =============================================================================
create or replace function public._insert_purchase_lines(p_purchase uuid, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare l jsonb; v_pid uuid;
begin
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_pid := nullif(l->>'product_id', '')::uuid;
    if v_pid is not null and not exists (select 1 from public.products where id = v_pid) then v_pid := null; end if;
    insert into public.purchase_lines (purchase_id, product_id, product_name, quantity, purchase_price,
      min_alert_quantity, unit_enabled, unit, expiration_enabled, expiration_date)
    values (p_purchase, v_pid, coalesce(l->>'product_name', ''), coalesce((l->>'quantity')::numeric, 0),
      coalesce((l->>'purchase_price')::numeric, 0), (l->>'min_alert_quantity')::numeric,
      coalesce((l->>'unit_enabled')::boolean, false), l->>'unit',
      coalesce((l->>'expiration_enabled')::boolean, false), nullif(l->>'expiration_date', '')::date);
  end loop;
end $$;

create or replace function public._purchase_set_direct_paid(p_id uuid, p_amount numeric, p_date date)
returns void language plpgsql security definer set search_path = public as $$
declare v_other numeric; v_total numeric;
begin
  delete from public.purchase_payments where purchase_id = p_id and origin is null;
  select coalesce(sum(amount), 0) into v_other from public.purchase_payments where purchase_id = p_id;
  select total_amount into v_total from public.purchases where id = p_id;
  if least(coalesce(p_amount, 0), v_total) - v_other > 0.004 then
    insert into public.purchase_payments (purchase_id, date, amount, description)
    values (p_id, coalesce(p_date, current_date), round(least(p_amount, v_total) - v_other, 2), 'Règlement à l''achat');
  end if;
end $$;

create or replace function public.create_purchase(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.purchases;
begin
  perform public.require_perm(array['purchase:create']);
  insert into public.purchases (supplier_id, date, driver_plate, bon_number, is_historical, total_amount)
  values (nullif(p_payload->>'supplier_id', '')::uuid, coalesce(nullif(p_payload->>'date', '')::date, current_date),
          p_payload->>'driver_plate', p_payload->>'bon_number',
          coalesce((p_payload->>'is_historical')::boolean, false), coalesce((p_payload->>'total_amount')::numeric, 0))
  returning * into v;
  perform public._insert_purchase_lines(v.id, p_payload->'products');
  perform public._recalc_purchase(v.id);
  perform public._purchase_set_direct_paid(v.id, coalesce((p_payload->>'paid_amount')::numeric, 0), v.date);
  select * into v from public.purchases where id = v.id;
  return to_jsonb(v);
end $$;

create or replace function public.update_purchase(p_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.purchases; v_lines jsonb; v_hist_changed boolean;
begin
  perform public.require_perm(array['purchase:edit']);
  select * into v from public.purchases where id = p_id;
  if not found then raise exception 'Facture d''achat introuvable'; end if;
  v_hist_changed := p_payload->>'is_historical' is not null
                    and (p_payload->>'is_historical')::boolean <> v.is_historical;

  -- lines to (re)write: the new ones, or the current ones when only « ancien achat » flips
  if p_payload ? 'products' and jsonb_typeof(p_payload->'products') = 'array' then
    v_lines := p_payload->'products';
  elsif v_hist_changed then
    select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) into v_lines from public.purchase_lines l where purchase_id = p_id;
  end if;
  if v_lines is not null then delete from public.purchase_lines where purchase_id = p_id; end if;

  update public.purchases set
    supplier_id   = coalesce(nullif(p_payload->>'supplier_id', '')::uuid, supplier_id),
    date          = coalesce(nullif(p_payload->>'date', '')::date, date),
    bon_number    = coalesce(p_payload->>'bon_number', bon_number),
    driver_plate  = coalesce(p_payload->>'driver_plate', driver_plate),
    is_historical = coalesce((p_payload->>'is_historical')::boolean, is_historical),
    note          = coalesce(p_payload->>'note', note)
  where id = p_id returning * into v;

  if v_lines is not null then perform public._insert_purchase_lines(p_id, v_lines); end if;
  perform public._recalc_purchase(p_id);

  if p_payload->>'paid_amount' is not null then
    perform public._purchase_set_direct_paid(p_id, (p_payload->>'paid_amount')::numeric, v.date);
  elsif v_hist_changed then
    -- caisse lines follow the new « ancien achat » flag
    update public.purchase_payments set amount = amount where purchase_id = p_id;
  end if;
  select * into v from public.purchases where id = p_id;
  return to_jsonb(v);
end $$;

create or replace function public.pay_supplier_debt(p_purchase_id uuid, p_amount numeric, p_date date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.purchases; r public.purchase_payments;
begin
  perform public.require_perm(array['purchase:pay','suppliers:pay','purchase:edit']);
  select * into v from public.purchases where id = p_purchase_id;
  if not found then raise exception 'Facture introuvable'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Montant invalide'; end if;
  insert into public.purchase_payments (purchase_id, date, amount, description)
  values (p_purchase_id, coalesce(p_date, current_date), round(least(p_amount, greatest(v.rest_amount, 0.01)), 2), 'Règlement dette')
  returning * into r;
  return to_jsonb(r);
end $$;

-- =============================================================================
--  RPC — PRODUCTION / COMPTOIR / STOCK
-- =============================================================================
create or replace function public._create_production(p jsonb)
returns public.productions language plpgsql security definer set search_path = public as $$
declare v public.productions; u jsonb; v_cost numeric := 0; v_fiche uuid;
begin
  v_fiche := nullif(p->>'fiche_technic_id', '')::uuid;
  if v_fiche is not null and not exists (select 1 from public.fiche_technics where id = v_fiche) then v_fiche := null; end if;
  select coalesce(sum(coalesce((x->>'line_cost')::numeric, 0)), 0) into v_cost
    from jsonb_array_elements(coalesce(p->'used_products', '[]'::jsonb)) x;
  insert into public.productions (name, description, date, hour, fiche_technic_id, category_id, category_name,
    total_cost, output_quantity, unit_price, total_value, sell_by_unit, sell_unit,
    has_loss, expected_quantity, loss_quantity, loss_description, loss_value, origin,
    sale_id, sale_reference, line_key)
  values (coalesce(p->>'name', 'Production'), coalesce(p->>'description', ''),
    coalesce(nullif(p->>'date', '')::date, current_date),
    coalesce(p->>'hour', to_char(now() at time zone 'Africa/Algiers', 'HH24:MI')),
    v_fiche, nullif(p->>'category_id', '')::uuid, p->>'category_name',
    round(v_cost, 2), coalesce((p->>'output_quantity')::numeric, 0), coalesce((p->>'unit_price')::numeric, 0),
    round(coalesce((p->>'output_quantity')::numeric, 0) * coalesce((p->>'unit_price')::numeric, 0), 2),
    coalesce((p->>'sell_by_unit')::boolean, false), p->>'sell_unit',
    coalesce((p->>'has_loss')::boolean, false), (p->>'expected_quantity')::numeric,
    coalesce((p->>'loss_quantity')::numeric, 0), p->>'loss_description', coalesce((p->>'loss_value')::numeric, 0),
    case when p->>'origin' = 'pos' then 'pos' else 'manual' end,
    nullif(p->>'sale_id', '')::uuid, p->>'sale_reference', p->>'line_key')
  returning * into v;
  for u in select * from jsonb_array_elements(coalesce(p->'used_products', '[]'::jsonb)) loop
    insert into public.production_used_products (production_id, product_id, product_name, quantity_used,
      source_type, unit, unit_cost, line_cost)
    values (v.id, nullif(u->>'product_id', '')::uuid, coalesce(u->>'product_name', ''),
      coalesce((u->>'quantity_used')::numeric, 0), coalesce(u->>'source_type', 'stock'), u->>'unit',
      coalesce((u->>'unit_cost')::numeric, 0), coalesce((u->>'line_cost')::numeric, 0));
  end loop;
  return v;
end $$;

create or replace function public.create_production(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.require_perm(array['production:create','pos:create']);
  return to_jsonb(public._create_production(p_payload));
end $$;

create or replace function public._transfer_to_comptoir(p_production_id uuid, p_quantity numeric)
returns public.comptoir_items language plpgsql security definer set search_path = public as $$
declare pr public.productions; v public.comptoir_items;
begin
  select * into pr from public.productions where id = p_production_id;
  if not found then raise exception 'Production introuvable'; end if;
  if p_quantity <= 0 then raise exception 'Quantité invalide'; end if;
  if pr.sent_to_comptoir + p_quantity > pr.output_quantity + 0.0005 then
    raise exception 'La quantité dépasse le reste en stock de production';
  end if;
  insert into public.comptoir_items (production_id, product_name, description, quantity, initial_quantity,
    unit_price, date, category_id, category_name, sell_by_unit, unit)
  values (pr.id, pr.name, pr.description, p_quantity, p_quantity, pr.unit_price, current_date,
    pr.category_id, pr.category_name, pr.sell_by_unit, pr.sell_unit)
  returning * into v;
  return v;
end $$;

create or replace function public.transfer_production_to_comptoir(p_production_id uuid, p_quantity numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.require_perm(array['production:edit','production:create','comptoir:create','pos:create']);
  return to_jsonb(public._transfer_to_comptoir(p_production_id, p_quantity));
end $$;

create or replace function public.destroy_comptoir_item(p_comptoir_id uuid, p_quantity numeric, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.comptoir_items; d public.destructions;
begin
  perform public.require_perm(array['comptoir:delete','comptoir:edit']);
  select * into c from public.comptoir_items where id = p_comptoir_id;
  if not found then raise exception 'Article introuvable'; end if;
  if p_quantity <= 0 or p_quantity > c.quantity + 0.0005 then raise exception 'Quantité invalide'; end if;
  update public.comptoir_items set quantity = quantity - p_quantity where id = c.id;
  insert into public.destructions (comptoir_id, product_name, quantity, value, reason, unit)
  values (c.id, c.product_name, p_quantity, round(p_quantity * c.unit_price, 2), coalesce(p_reason, ''), c.unit)
  returning * into d;
  return to_jsonb(d);
end $$;

create or replace function public.recover_destruction(p_destruction_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare d public.destructions;
begin
  perform public.require_perm(array['comptoir:edit','comptoir:delete']);
  select * into d from public.destructions where id = p_destruction_id;
  if not found then return; end if;
  if d.comptoir_id is not null then
    update public.comptoir_items set quantity = quantity + d.quantity where id = d.comptoir_id;
  end if;
  delete from public.destructions where id = d.id;
end $$;

create or replace function public.recover_destructions(p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare i uuid;
begin
  foreach i in array coalesce(p_ids, '{}') loop perform public.recover_destruction(i); end loop;
end $$;

create or replace function public.delete_destructions(p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_perm(array['comptoir:delete']);
  delete from public.destructions where id = any(coalesce(p_ids, '{}'));
end $$;

create or replace function public.adjust_stock(p_product_id uuid, p_quantity numeric, p_reason text default 'manual')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.products;
begin
  perform public.require_perm(array['stock:edit']);
  update public.products set current_quantity = current_quantity + coalesce(p_quantity, 0)
  where id = p_product_id returning * into v;
  return to_jsonb(v);
end $$;

-- Fiches techniques (recipes)
create or replace function public._fiche_json(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(f) || jsonb_build_object('fiche_technic_lines',
         coalesce((select jsonb_agg(to_jsonb(l)) from public.fiche_technic_lines l where l.fiche_technic_id = f.id), '[]'::jsonb))
  from public.fiche_technics f where f.id = p_id
$$;

create or replace function public._write_fiche(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare u jsonb;
begin
  update public.fiche_technics set
    name = coalesce(p->>'name', name), category_id = nullif(p->>'category_id', '')::uuid,
    category_name = p->>'category_name', description = coalesce(p->>'description', ''),
    sell_by_unit = coalesce((p->>'sell_by_unit')::boolean, false), sell_unit = p->>'sell_unit',
    usable_in_production = coalesce((p->>'usable_in_production')::boolean, false), product_unit = p->>'product_unit',
    output_quantity = coalesce((p->>'output_quantity')::numeric, 1), unit_price = coalesce((p->>'unit_price')::numeric, 0),
    total_cost = coalesce((p->>'total_cost')::numeric, 0), cost_per_unit = coalesce((p->>'cost_per_unit')::numeric, 0),
    total_value = coalesce((p->>'total_value')::numeric, 0), gains_per_unit = coalesce((p->>'gains_per_unit')::numeric, 0),
    total_gains = coalesce((p->>'total_gains')::numeric, 0)
  where id = p_id;
  delete from public.fiche_technic_lines where fiche_technic_id = p_id;
  for u in select * from jsonb_array_elements(coalesce(p->'used_products', '[]'::jsonb)) loop
    insert into public.fiche_technic_lines (fiche_technic_id, product_id, product_name, quantity_used,
      source_type, unit, unit_cost, line_cost)
    values (p_id, nullif(u->>'product_id', '')::uuid, coalesce(u->>'product_name', ''),
      coalesce((u->>'quantity_used')::numeric, 0), coalesce(u->>'source_type', 'stock'), u->>'unit',
      coalesce((u->>'unit_cost')::numeric, 0), coalesce((u->>'line_cost')::numeric, 0));
  end loop;
end $$;

create or replace function public.create_fiche_technic(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.require_perm(array['production:create']);
  insert into public.fiche_technics (name) values (coalesce(p_payload->>'name', 'Fiche')) returning id into v_id;
  perform public._write_fiche(v_id, p_payload);
  return public._fiche_json(v_id);
end $$;

create or replace function public.update_fiche_technic(p_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.require_perm(array['production:edit']);
  perform public._write_fiche(p_id, p_payload);
  return public._fiche_json(p_id);
end $$;

create or replace function public.upsert_fiche_category(p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.fiche_categories;
begin
  perform public.require_perm(array['production:create','production:edit']);
  select * into v from public.fiche_categories where lower(name) = lower(trim(p_name));
  if not found then insert into public.fiche_categories (name) values (trim(p_name)) returning * into v; end if;
  return to_jsonb(v);
end $$;
-- =============================================================================
--  RPC — SALES (POS, old sales, TVA)
-- =============================================================================
create or replace function public._insert_sale_lines(p_sale uuid, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare l jsonb; v_prod uuid; v_comp uuid; v_fiche uuid; v_pr uuid; v_ci uuid;
begin
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_prod := nullif(l->>'product_id', '')::uuid;
    v_comp := nullif(l->>'comptoir_id', '')::uuid;
    v_fiche := nullif(l->>'fiche_technic_id', '')::uuid;
    v_pr := nullif(l->>'production_id', '')::uuid;
    v_ci := nullif(l->>'command_item_id', '')::uuid;
    if v_prod is not null and not exists (select 1 from public.products where id = v_prod) then v_prod := null; end if;
    if v_comp is not null and not exists (select 1 from public.comptoir_items where id = v_comp) then v_comp := null; end if;
    if v_fiche is not null and not exists (select 1 from public.fiche_technics where id = v_fiche) then v_fiche := null; end if;
    if v_pr is not null and not exists (select 1 from public.productions where id = v_pr) then v_pr := null; end if;
    insert into public.sale_lines (sale_id, product_id, comptoir_id, fiche_technic_id, production_id, command_item_id,
      line_key, product_name, quantity, selling_price, base_price, sell_by_unit, unit)
    values (p_sale, v_prod, v_comp, v_fiche, v_pr, v_ci, l->>'line_key', coalesce(l->>'product_name', ''),
      coalesce((l->>'quantity')::numeric, 0), coalesce((l->>'selling_price')::numeric, 0),
      (l->>'base_price')::numeric, coalesce((l->>'sell_by_unit')::boolean, false), l->>'unit');
  end loop;
end $$;

-- Replaces the cash part of a sale's payments so that the total paid = p_amount.
create or replace function public._sale_set_direct_paid(p_id uuid, p_amount numeric, p_date date)
returns void language plpgsql security definer set search_path = public as $$
declare v_other numeric; v_final numeric;
begin
  delete from public.sale_payments where sale_id = p_id and origin is null;
  select coalesce(sum(amount), 0) into v_other from public.sale_payments where sale_id = p_id;
  select final_amount into v_final from public.sales where id = p_id;
  if least(coalesce(p_amount, 0), v_final) - v_other > 0.004 then
    insert into public.sale_payments (sale_id, date, amount, description)
    values (p_id, coalesce(p_date, current_date), round(least(p_amount, v_final) - v_other, 2), 'Paiement à la vente');
  end if;
end $$;

create or replace function public._create_sale(p jsonb)
returns public.sales language plpgsql security definer set search_path = public as $$
declare v public.sales; v_client uuid;
begin
  v_client := nullif(p->>'client_id', '')::uuid;
  if v_client is not null and not exists (select 1 from public.clients where id = v_client) then v_client := null; end if;
  insert into public.sales (client_id, date, bon_number, is_historical, tva_enabled, tva_rate,
    reduction, total_amount, delivery_id, command_id)
  values (v_client, coalesce(nullif(p->>'date', '')::date, current_date), nullif(p->>'bon_number', ''),
    coalesce((p->>'is_historical')::boolean, false), coalesce((p->>'tva_enabled')::boolean, false),
    case when coalesce((p->>'tva_enabled')::boolean, false) then coalesce((p->>'tva_rate')::numeric, 19) else 0 end,
    coalesce((p->>'reduction')::numeric, 0), coalesce((p->>'total_amount')::numeric, 0),
    nullif(p->>'delivery_id', '')::uuid, nullif(p->>'command_id', '')::uuid)
  returning * into v;
  perform public._insert_sale_lines(v.id, p->'products');
  perform public._recalc_sale(v.id);
  perform public._sale_set_direct_paid(v.id, coalesce((p->>'paid_amount')::numeric, 0), v.date);
  select * into v from public.sales where id = v.id;
  return v;
end $$;

create or replace function public.create_sale(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.require_perm(array['pos:create','sales:create']);
  return to_jsonb(public._create_sale(p_payload));
end $$;

-- POS: produce every fiche-technique line, put it on the comptoir, then sell it.
create or replace function public.create_sale_with_productions(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pr jsonb; v_prod public.productions; v_item public.comptoir_items; v_map jsonb := '{}'::jsonb;
        v_lines jsonb := '[]'::jsonb; l jsonb; v_sale public.sales; v_key text;
begin
  perform public.require_perm(array['pos:create','sales:create']);
  if not coalesce((p_payload->>'is_historical')::boolean, false) then
    for pr in select * from jsonb_array_elements(coalesce(p_payload->'productions', '[]'::jsonb)) loop
      v_prod := public._create_production(pr || jsonb_build_object('date', p_payload->>'date', 'origin', 'pos'));
      if v_prod.output_quantity > 0 then
        v_item := public._transfer_to_comptoir(v_prod.id, v_prod.output_quantity);
        v_map := v_map || jsonb_build_object(pr->>'line_key',
                   jsonb_build_object('comptoir_id', v_item.id, 'production_id', v_prod.id));
      end if;
    end loop;
  end if;
  for l in select * from jsonb_array_elements(coalesce(p_payload->'products', '[]'::jsonb)) loop
    v_key := l->>'line_key';
    if v_key is not null and v_map ? v_key then
      l := l || jsonb_build_object('comptoir_id', v_map->v_key->>'comptoir_id',
                                   'production_id', v_map->v_key->>'production_id', 'product_id', null);
    end if;
    v_lines := v_lines || jsonb_build_array(l);
  end loop;
  v_sale := public._create_sale(p_payload || jsonb_build_object('products', v_lines));
  update public.productions set sale_id = v_sale.id, sale_reference = v_sale.reference
  where id in (select (value->>'production_id')::uuid from jsonb_each(v_map));
  return to_jsonb(v_sale);
end $$;

-- Safety net: launches the productions of a POS sale that has none (idempotent).
create or replace function public.repair_pos_sale_productions(p_payload jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_sale public.sales; pr jsonb; v_prod public.productions; n int := 0;
begin
  perform public.require_perm(array['pos:create','sales:create']);
  select * into v_sale from public.sales where id = (p_payload->>'sale_id')::uuid;
  if not found or v_sale.is_historical then return 0; end if;
  for pr in select * from jsonb_array_elements(coalesce(p_payload->'productions', '[]'::jsonb)) loop
    if exists (select 1 from public.productions where sale_id = v_sale.id
               and coalesce(line_key, '') = coalesce(pr->>'line_key', '')) then continue; end if;
    v_prod := public._create_production(pr || jsonb_build_object('date', v_sale.date, 'origin', 'pos',
                'sale_id', v_sale.id, 'sale_reference', v_sale.reference));
    update public.productions set sent_to_comptoir = output_quantity where id = v_prod.id;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public._apply_sale_header(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v public.sales;
begin
  update public.sales set
    date      = coalesce(nullif(p->>'date', '')::date, date),
    reduction = coalesce((p->>'reduction')::numeric, reduction),
    note      = coalesce(p->>'note', note),
    tva_enabled = case when p ? 'tva_enabled' then coalesce((p->>'tva_enabled')::boolean, false) else tva_enabled end,
    tva_rate    = case when p ? 'tva_enabled' then
                    case when coalesce((p->>'tva_enabled')::boolean, false) then coalesce((p->>'tva_rate')::numeric, 19) else 0 end
                  else tva_rate end
  where id = p_id returning * into v;
  if v.delivery_id is not null and nullif(p->>'date', '') is not null then
    update public.command_deliveries set date = v.date where id = v.delivery_id;
  end if;
  perform public._recalc_sale(p_id);
  if p->>'paid_amount' is not null then
    perform public._sale_set_direct_paid(p_id, (p->>'paid_amount')::numeric, v.date);
  end if;
end $$;

create or replace function public.update_sale(p_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.require_perm(array['sales:edit','pos:edit']);
  perform public._apply_sale_header(p_id, p_payload);
  return (select to_jsonb(s) from public.sales s where id = p_id);
end $$;

create or replace function public.update_sale_lines(p_sale_id uuid, p_lines jsonb, p_header jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l jsonb;
begin
  perform public.require_perm(array['sales:edit','pos:edit']);
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    if coalesce((l->>'quantity')::numeric, 0) <= 0 then
      delete from public.sale_lines where id = (l->>'id')::uuid and sale_id = p_sale_id;
    else
      update public.sale_lines set
        quantity = (l->>'quantity')::numeric,
        selling_price = coalesce((l->>'selling_price')::numeric, selling_price),
        product_name = coalesce(l->>'product_name', product_name)
      where id = (l->>'id')::uuid and sale_id = p_sale_id;
    end if;
  end loop;
  perform public._apply_sale_header(p_sale_id, coalesce(p_header, '{}'::jsonb));
  return (select to_jsonb(s) from public.sales s where id = p_sale_id);
end $$;

create or replace function public.pay_sale_debt(p_sale_id uuid, p_amount numeric, p_date date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.sales; r public.sale_payments;
begin
  perform public.require_perm(array['sales:pay','pos:pay','clients:pay','sales:edit']);
  select * into v from public.sales where id = p_sale_id;
  if not found then raise exception 'Vente introuvable'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Montant invalide'; end if;
  if v.rest_amount <= 0.004 then raise exception 'Cette vente est déjà réglée'; end if;
  insert into public.sale_payments (sale_id, date, amount, description)
  values (p_sale_id, coalesce(p_date, current_date), round(least(p_amount, v.rest_amount), 2), 'Règlement dette')
  returning * into r;
  return to_jsonb(r);
end $$;

-- =============================================================================
--  RPC — COMMANDS
-- =============================================================================
create or replace function public._write_command_items(p_command uuid, p_items jsonb)
returns boolean   -- false when a delivered line had to be kept
language plpgsql security definer set search_path = public as $$
declare it jsonb; v_id uuid; v_kept boolean := false; v_ids uuid[] := '{}'; v_pos int := 0; v_fiche uuid;
begin
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_id := nullif(it->>'id', '')::uuid;
    v_fiche := nullif(it->>'fiche_technic_id', '')::uuid;
    if v_fiche is not null and not exists (select 1 from public.fiche_technics where id = v_fiche) then v_fiche := null; end if;
    if v_id is not null and exists (select 1 from public.command_items where id = v_id and command_id = p_command) then
      update public.command_items set
        position = coalesce((it->>'position')::int, v_pos),
        product_id = nullif(it->>'product_id', '')::uuid, fiche_technic_id = v_fiche,
        product_name = coalesce(it->>'product_name', product_name),
        quantity = greatest(delivered_quantity + cancelled_quantity, coalesce((it->>'quantity')::numeric, quantity)),
        unit_price = coalesce((it->>'unit_price')::numeric, unit_price),
        sell_by_unit = coalesce((it->>'sell_by_unit')::boolean, false), sell_unit = it->>'sell_unit'
      where id = v_id;
    else
      insert into public.command_items (command_id, position, product_id, fiche_technic_id, product_name,
        quantity, unit_price, total_price, sell_by_unit, sell_unit)
      values (p_command, coalesce((it->>'position')::int, v_pos), nullif(it->>'product_id', '')::uuid, v_fiche,
        coalesce(it->>'product_name', ''), coalesce((it->>'quantity')::numeric, 0),
        coalesce((it->>'unit_price')::numeric, 0), coalesce((it->>'total_price')::numeric, 0),
        coalesce((it->>'sell_by_unit')::boolean, false), it->>'sell_unit')
      returning id into v_id;
    end if;
    v_ids := v_ids || v_id;
    v_pos := v_pos + 1;
  end loop;
  -- lines removed from the form: deleted unless something was already delivered
  if exists (select 1 from public.command_items where command_id = p_command and not (id = any(v_ids)) and delivered_quantity > 0) then
    v_kept := true;
  end if;
  delete from public.command_items where command_id = p_command and not (id = any(v_ids)) and delivered_quantity = 0;
  return not v_kept;
end $$;

create or replace function public.create_command(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.commands; v_client uuid;
begin
  perform public.require_perm(array['clients:create','pos:create']);
  v_client := nullif(p_payload->>'client_id', '')::uuid;
  if v_client is not null and not exists (select 1 from public.clients where id = v_client) then v_client := null; end if;
  insert into public.commands (client_id, client_name, client_phone, client_address, driver_name, driver_plate,
    receive_date, receive_hour, receive_minute, tva_enabled, tva_rate, advance_paid, notes, bon_number,
    is_historical, created_at)
  values (v_client, coalesce(p_payload->>'client_name', ''), p_payload->>'client_phone', p_payload->>'client_address',
    p_payload->>'driver_name', p_payload->>'driver_plate', nullif(p_payload->>'receive_date', '')::date,
    p_payload->>'receive_hour', p_payload->>'receive_minute',
    coalesce((p_payload->>'tva_enabled')::boolean, false),
    case when coalesce((p_payload->>'tva_enabled')::boolean, false) then coalesce((p_payload->>'tva_rate')::numeric, 19) else 0 end,
    coalesce((p_payload->>'advance_paid')::numeric, 0), p_payload->>'notes', nullif(p_payload->>'bon_number', ''),
    coalesce((p_payload->>'is_historical')::boolean, false),
    coalesce(nullif(p_payload->>'created_at', '')::timestamptz, now()))
  returning * into v;
  perform public._write_command_items(v.id, p_payload->'items');
  perform public._recalc_command(v.id);
  select * into v from public.commands where id = v.id;
  return to_jsonb(v);
end $$;

create or replace function public.update_command(p_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.commands; v_replaced boolean := true; d record;
begin
  perform public.require_perm(array['clients:edit']);
  select * into v from public.commands where id = p_id;
  if not found then raise exception 'Commande introuvable'; end if;
  update public.commands set
    client_id      = case when p_payload ? 'client_id' then nullif(p_payload->>'client_id', '')::uuid else client_id end,
    client_name    = coalesce(p_payload->>'client_name', client_name),
    client_phone   = case when p_payload ? 'client_phone' then p_payload->>'client_phone' else client_phone end,
    client_address = case when p_payload ? 'client_address' then p_payload->>'client_address' else client_address end,
    driver_name    = case when p_payload ? 'driver_name' then p_payload->>'driver_name' else driver_name end,
    driver_plate   = case when p_payload ? 'driver_plate' then p_payload->>'driver_plate' else driver_plate end,
    receive_date   = case when p_payload ? 'receive_date' then nullif(p_payload->>'receive_date', '')::date else receive_date end,
    receive_hour   = coalesce(p_payload->>'receive_hour', receive_hour),
    receive_minute = coalesce(p_payload->>'receive_minute', receive_minute),
    notes          = case when p_payload ? 'notes' then p_payload->>'notes' else notes end,
    bon_number     = case when p_payload ? 'bon_number' then p_payload->>'bon_number' else bon_number end,
    tva_enabled    = case when p_payload ? 'tva_enabled' then coalesce((p_payload->>'tva_enabled')::boolean, false) else tva_enabled end,
    tva_rate       = case when p_payload ? 'tva_enabled' then
                       case when coalesce((p_payload->>'tva_enabled')::boolean, false) then coalesce((p_payload->>'tva_rate')::numeric, 19) else 0 end
                     else tva_rate end,
    advance_paid   = coalesce((p_payload->>'advance_paid')::numeric, advance_paid),
    is_historical  = coalesce((p_payload->>'is_historical')::boolean, is_historical),
    created_at     = coalesce(nullif(p_payload->>'created_at', '')::timestamptz, created_at)
  where id = p_id;
  if p_payload ? 'items' and jsonb_typeof(p_payload->'items') = 'array' then
    v_replaced := public._write_command_items(p_id, p_payload->'items');
  end if;
  perform public._recalc_command(p_id);
  -- delivery invoices follow the corrected unit prices
  for d in select sale_id from public.command_deliveries where command_id = p_id and sale_id is not null loop
    update public.sale_lines sl set selling_price = ci.unit_price, product_name = ci.product_name
      from public.command_items ci where sl.sale_id = d.sale_id and sl.command_item_id = ci.id;
    update public.sales set client_id = (select client_id from public.commands where id = p_id) where id = d.sale_id;
    perform public._recalc_sale(d.sale_id);
  end loop;
  return jsonb_build_object('id', p_id, 'lines_replaced', v_replaced);
end $$;

create or replace function public.pay_command(p_command_id uuid, p_amount numeric, p_date date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.command_payments;
begin
  perform public.require_perm(array['clients:pay','clients:edit']);
  if coalesce(p_amount, 0) <= 0 then raise exception 'Montant invalide'; end if;
  insert into public.command_payments (command_id, amount, date)
  values (p_command_id, round(p_amount, 2), coalesce(p_date, current_date)) returning * into r;
  return to_jsonb(r);
end $$;

create or replace function public.update_command_payment(p_id uuid, p_amount numeric, p_date date default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.command_payments;
begin
  perform public.require_perm(array['clients:pay','clients:edit']);
  if coalesce(p_amount, 0) <= 0 then
    delete from public.command_payments where id = p_id returning * into r;
  else
    update public.command_payments set amount = round(p_amount, 2), date = coalesce(p_date, date),
      notes = coalesce(p_notes, notes) where id = p_id returning * into r;
  end if;
  return to_jsonb(r);
end $$;

create or replace function public.set_command_status(p_command_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.commands;
begin
  perform public.require_perm(array['clients:edit']);
  update public.commands set status = p_status where id = p_command_id returning * into v;
  return to_jsonb(v);
end $$;

create or replace function public._write_adjustment(p jsonb, p_type text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.commands; a public.command_adjustments; l jsonb; ci public.command_items; v_qty numeric;
        v_price numeric; v_item uuid; v_tq numeric := 0; v_ta numeric := 0;
begin
  select * into c from public.commands where id = (p->>'command_id')::uuid;
  if not found then raise exception 'Commande introuvable'; end if;
  insert into public.command_adjustments (command_id, command_reference, client_id, client_name, type, date, reason)
  values (c.id, c.reference, c.client_id, c.client_name, p_type,
          coalesce(nullif(p->>'date', '')::date, current_date), p->>'reason')
  returning * into a;
  for l in select * from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) loop
    v_qty := coalesce((l->>'quantity')::numeric, 0);
    if v_qty <= 0 then continue; end if;
    v_item := nullif(l->>'command_item_id', '')::uuid;
    select * into ci from public.command_items where id = v_item and command_id = c.id;
    if p_type = 'cancel' then
      if not found then continue; end if;
      v_qty := least(v_qty, greatest(0, ci.quantity - ci.delivered_quantity - ci.cancelled_quantity));
      if v_qty <= 0 then continue; end if;
      update public.command_items set cancelled_quantity = cancelled_quantity + v_qty where id = ci.id;
      v_price := ci.unit_price;
    else
      if found then
        update public.command_items set quantity = quantity + v_qty,
          unit_price = coalesce((l->>'unit_price')::numeric, unit_price) where id = ci.id;
        v_price := coalesce((l->>'unit_price')::numeric, ci.unit_price);
      else
        v_price := coalesce((l->>'unit_price')::numeric, 0);
        insert into public.command_items (command_id, position, product_name, quantity, unit_price, sell_unit)
        values (c.id, (select coalesce(max(position), -1) + 1 from public.command_items where command_id = c.id),
                coalesce(l->>'product_name', ''), v_qty, v_price, l->>'unit')
        returning id into v_item;
      end if;
    end if;
    insert into public.command_adjustment_lines (adjustment_id, command_item_id, product_name, quantity, unit_price, amount, unit)
    values (a.id, v_item, coalesce(l->>'product_name', ci.product_name, ''), v_qty, v_price, round(v_qty * v_price, 2), l->>'unit');
    v_tq := v_tq + v_qty; v_ta := v_ta + round(v_qty * v_price, 2);
  end loop;
  update public.command_adjustments set total_quantity = v_tq, total_amount = v_ta where id = a.id returning * into a;
  perform public._recalc_command(c.id);
  return to_jsonb(a);
end $$;

create or replace function public.cancel_command_remainder(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.require_perm(array['clients:edit']);
  return public._write_adjustment(p_payload, 'cancel');
end $$;

create or replace function public.increase_command(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.require_perm(array['clients:edit']);
  return public._write_adjustment(p_payload, 'increase');
end $$;

create or replace function public.delete_command_adjustment(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a public.command_adjustments; l record;
begin
  perform public.require_perm(array['clients:edit','clients:delete']);
  select * into a from public.command_adjustments where id = p_id;
  if not found then return; end if;
  for l in select * from public.command_adjustment_lines where adjustment_id = p_id loop
    if l.command_item_id is null then continue; end if;
    if a.type = 'cancel' then
      update public.command_items set cancelled_quantity = greatest(0, cancelled_quantity - l.quantity) where id = l.command_item_id;
    else
      update public.command_items set quantity = greatest(delivered_quantity + cancelled_quantity, quantity - l.quantity)
      where id = l.command_item_id;
    end if;
  end loop;
  delete from public.command_adjustments where id = p_id;
  perform public._recalc_command(a.command_id);
end $$;

-- =============================================================================
--  RPC — DELIVERIES (bon de livraison = vente)
-- =============================================================================
-- Builds items, raw-material consumption, the invoice (sale) and its payments.
create or replace function public._build_delivery(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare d public.command_deliveries; c public.commands; it jsonb; ci public.command_items; fl record;
        v_qty numeric; v_lines jsonb := '[]'::jsonb; v_sale public.sales; v_fiche public.fiche_technics;
        v_adv_avail numeric; v_adv numeric; v_cash numeric;
begin
  select * into d from public.command_deliveries where id = p_id;
  select * into c from public.commands where id = d.command_id;

  for it in select * from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) loop
    v_qty := coalesce((it->>'quantity')::numeric, 0);
    if v_qty <= 0 then continue; end if;
    select * into ci from public.command_items where id = nullif(it->>'command_item_id', '')::uuid and command_id = c.id;
    insert into public.command_delivery_items (delivery_id, command_item_id, product_name, quantity, sell_unit)
    values (p_id, ci.id, coalesce(it->>'product_name', ci.product_name, ''), v_qty, coalesce(it->>'sell_unit', ci.sell_unit));

    -- raw materials of the recipe leave the stock, proportionally to what is delivered
    if ci.fiche_technic_id is not null then
      select * into v_fiche from public.fiche_technics where id = ci.fiche_technic_id;
      for fl in select * from public.fiche_technic_lines
                where fiche_technic_id = ci.fiche_technic_id and coalesce(source_type, 'stock') = 'stock'
                  and product_id is not null and exists (select 1 from public.products where id = product_id) loop
        insert into public.command_delivery_consumptions (delivery_id, command_item_id, fiche_technic_id, product_id,
          product_name, unit, delivered_quantity, quantity, unit_cost, line_cost)
        values (p_id, ci.id, ci.fiche_technic_id, fl.product_id, fl.product_name, fl.unit, v_qty,
          round(fl.quantity_used / nullif(v_fiche.output_quantity, 0) * v_qty, 4), fl.unit_cost,
          round(fl.unit_cost * fl.quantity_used / nullif(v_fiche.output_quantity, 0) * v_qty, 2));
      end loop;
    end if;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_name', coalesce(it->>'product_name', ci.product_name, ''), 'quantity', v_qty,
      'selling_price', coalesce(ci.unit_price, 0), 'base_price', ci.unit_price,
      'fiche_technic_id', ci.fiche_technic_id, 'command_item_id', ci.id,
      'sell_by_unit', coalesce(ci.sell_by_unit, false), 'unit', coalesce(it->>'sell_unit', ci.sell_unit)));
  end loop;

  -- the invoice
  v_sale := public._create_sale(jsonb_build_object(
    'client_id', c.client_id, 'date', d.date, 'bon_number', coalesce(c.bon_number, d.reference),
    'is_historical', d.is_historical, 'tva_enabled', d.tva_enabled, 'tva_rate', d.tva_rate,
    'delivery_id', d.id, 'command_id', c.id, 'products', v_lines, 'paid_amount', 0));

  -- money: part of the command's advance (no caisse) + cash received now (caisse)
  select greatest(0, c.paid_amount - coalesce(sum(advance_applied), 0)) into v_adv_avail
    from public.command_deliveries where command_id = c.id and id <> p_id;
  v_adv := least(coalesce((p->>'advance_applied')::numeric, 0), v_adv_avail, v_sale.final_amount);
  if v_adv > 0.004 then
    insert into public.sale_payments (sale_id, date, amount, description, origin)
    values (v_sale.id, d.date, round(v_adv, 2), 'Acompte de la commande ' || c.reference, 'command_advance');
  end if;
  v_cash := least(coalesce((p->>'cash_paid')::numeric, 0), greatest(0, v_sale.final_amount - v_adv));
  if v_cash > 0.004 then
    insert into public.sale_payments (sale_id, date, amount, description)
    values (v_sale.id, d.date, round(v_cash, 2), 'Versement à la livraison ' || d.reference);
  end if;

  update public.command_deliveries set sale_id = v_sale.id, sale_reference = v_sale.reference where id = p_id;
  perform public._recalc_sale(v_sale.id);
  perform public._recalc_command(c.id);
end $$;

create or replace function public.create_command_delivery(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.commands; d public.command_deliveries; v_tva boolean; v_at timestamptz;
begin
  perform public.require_perm(array['clients:create','sales:create']);
  select * into c from public.commands where id = (p_payload->>'command_id')::uuid;
  if not found then raise exception 'Commande introuvable'; end if;
  v_tva := case when p_payload ? 'tva_enabled' then coalesce((p_payload->>'tva_enabled')::boolean, false) else c.tva_enabled end;
  v_at := coalesce(nullif(p_payload->>'delivered_at', '')::timestamptz, now());
  insert into public.command_deliveries (command_id, date, delivered_at, notes, driver_name, driver_plate, location,
    is_historical, tva_enabled, tva_rate)
  values (c.id, v_at::date, v_at, coalesce(p_payload->>'notes', ''),
    coalesce(p_payload->>'driver_name', c.driver_name), coalesce(p_payload->>'driver_plate', c.driver_plate),
    coalesce(p_payload->>'location', c.client_address), c.is_historical, v_tva,
    case when v_tva then coalesce((p_payload->>'tva_rate')::numeric, nullif(c.tva_rate, 0), 19) else 0 end)
  returning * into d;
  perform public._build_delivery(d.id, p_payload);
  select * into d from public.command_deliveries where id = d.id;
  return to_jsonb(d);
end $$;

create or replace function public.update_command_delivery(p_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.command_deliveries; c public.commands; v_tva boolean; v_sale uuid; v_at timestamptz;
begin
  perform public.require_perm(array['clients:edit','sales:edit']);
  select * into d from public.command_deliveries where id = p_id;
  if not found then raise exception 'Bon de livraison introuvable'; end if;
  select * into c from public.commands where id = d.command_id;
  -- undo: detach and drop the invoice, give back delivered quantities and raw materials
  v_sale := d.sale_id;
  update public.command_deliveries set sale_id = null where id = p_id;
  if v_sale is not null then delete from public.sales where id = v_sale; end if;
  delete from public.command_delivery_items where delivery_id = p_id;
  delete from public.command_delivery_consumptions where delivery_id = p_id;

  v_tva := case when p_payload ? 'tva_enabled' then coalesce((p_payload->>'tva_enabled')::boolean, false) else d.tva_enabled end;
  v_at := coalesce(nullif(p_payload->>'delivered_at', '')::timestamptz, d.delivered_at);
  update public.command_deliveries set
    delivered_at = v_at, date = v_at::date,
    notes = coalesce(p_payload->>'notes', notes),
    driver_name = case when p_payload ? 'driver_name' then p_payload->>'driver_name' else driver_name end,
    driver_plate = case when p_payload ? 'driver_plate' then p_payload->>'driver_plate' else driver_plate end,
    location = case when p_payload ? 'location' then p_payload->>'location' else location end,
    is_historical = c.is_historical, tva_enabled = v_tva,
    tva_rate = case when v_tva then coalesce((p_payload->>'tva_rate')::numeric, nullif(tva_rate, 0), 19) else 0 end
  where id = p_id;
  perform public._build_delivery(p_id, p_payload);
  select * into d from public.command_deliveries where id = p_id;
  return to_jsonb(d);
end $$;

create or replace function public.delete_command_delivery(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_perm(array['clients:delete','sales:delete']);
  delete from public.command_deliveries where id = p_id;
end $$;
-- =============================================================================
--  RPC — CLIENT / SUPPLIER PAYMENTS (oldest debt first, excess → acompte)
-- =============================================================================
create or replace function public._allocate_client_payment(p_payment_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pay public.client_payments; v_left numeric; od record; s record; v_use numeric;
begin
  select * into pay from public.client_payments where id = p_payment_id;
  v_left := pay.amount;
  -- 1. old debts (ardoise d'avant le logiciel)
  for od in select * from public.party_old_debts
            where party_type = 'client' and party_id = pay.client_id and rest_amount > 0.004
            order by date, created_at loop
    exit when v_left <= 0.004;
    v_use := least(v_left, od.rest_amount);
    insert into public.party_old_debt_allocations (old_debt_id, client_payment_id, amount) values (od.id, pay.id, round(v_use, 2));
    v_left := v_left - v_use;
  end loop;
  -- 2. unpaid sales & delivery invoices
  for s in select id, rest_amount from public.sales
           where client_id = pay.client_id and rest_amount > 0.004 order by date, created_at loop
    exit when v_left <= 0.004;
    v_use := least(v_left, s.rest_amount);
    insert into public.sale_payments (sale_id, date, amount, description, origin, client_payment_id)
    values (s.id, pay.date, round(v_use, 2), 'Versement client', 'client_payment', pay.id);
    v_left := v_left - v_use;
  end loop;
  -- 3. the rest becomes the client's acompte
  v_left := round(greatest(0, v_left), 2);
  update public.client_payments set credit_part = v_left where id = pay.id;
  update public.clients set credit_amount = credit_amount + v_left where id = pay.client_id;
end $$;

create or replace function public._unallocate_client_payment(p_payment_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pay public.client_payments;
begin
  select * into pay from public.client_payments where id = p_payment_id;
  delete from public.sale_payments where client_payment_id = p_payment_id;
  delete from public.party_old_debt_allocations where client_payment_id = p_payment_id;
  update public.clients set credit_amount = credit_amount - pay.credit_part where id = pay.client_id;
  update public.client_payments set credit_part = 0 where id = p_payment_id;
end $$;

create or replace function public._allocate_supplier_payment(p_payment_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pay public.supplier_payments; v_left numeric; od record; p record; v_use numeric;
begin
  select * into pay from public.supplier_payments where id = p_payment_id;
  v_left := pay.amount;
  for od in select * from public.party_old_debts
            where party_type = 'supplier' and party_id = pay.supplier_id and rest_amount > 0.004
            order by date, created_at loop
    exit when v_left <= 0.004;
    v_use := least(v_left, od.rest_amount);
    insert into public.party_old_debt_allocations (old_debt_id, supplier_payment_id, amount) values (od.id, pay.id, round(v_use, 2));
    v_left := v_left - v_use;
  end loop;
  for p in select id, rest_amount from public.purchases
           where supplier_id = pay.supplier_id and rest_amount > 0.004 order by date, created_at loop
    exit when v_left <= 0.004;
    v_use := least(v_left, p.rest_amount);
    insert into public.purchase_payments (purchase_id, date, amount, description, origin, supplier_payment_id)
    values (p.id, pay.date, round(v_use, 2), 'Règlement fournisseur', 'supplier_payment', pay.id);
    v_left := v_left - v_use;
  end loop;
  v_left := round(greatest(0, v_left), 2);
  update public.supplier_payments set credit_part = v_left where id = pay.id;
  update public.suppliers set credit_amount = credit_amount + v_left where id = pay.supplier_id;
end $$;

create or replace function public._unallocate_supplier_payment(p_payment_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pay public.supplier_payments;
begin
  select * into pay from public.supplier_payments where id = p_payment_id;
  delete from public.purchase_payments where supplier_payment_id = p_payment_id;
  delete from public.party_old_debt_allocations where supplier_payment_id = p_payment_id;
  update public.suppliers set credit_amount = credit_amount - pay.credit_part where id = pay.supplier_id;
  update public.supplier_payments set credit_part = 0 where id = p_payment_id;
end $$;

create or replace function public.pay_client(
  p_client_id uuid, p_amount numeric, p_paid_at timestamptz, p_notes text default '',
  p_method text default 'especes', p_cheque_number text default null,
  p_virement_number text default null, p_bank_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.client_payments;
begin
  perform public.require_perm(array['clients:pay','clients:edit']);
  if coalesce(p_amount, 0) <= 0 then raise exception 'Montant invalide'; end if;
  insert into public.client_payments (client_id, client_name, amount, date, paid_at, notes, method,
    cheque_number, virement_number, bank_name)
  values (p_client_id, (select name from public.clients where id = p_client_id), round(p_amount, 2),
    coalesce(p_paid_at, now())::date, coalesce(p_paid_at, now()), coalesce(p_notes, ''),
    coalesce(p_method, 'especes'), p_cheque_number, p_virement_number, p_bank_name)
  returning * into r;
  perform public._allocate_client_payment(r.id);
  select * into r from public.client_payments where id = r.id;
  return to_jsonb(r);
end $$;

create or replace function public.update_client_payment(
  p_id uuid, p_amount numeric, p_paid_at timestamptz default null, p_notes text default null,
  p_method text default null, p_cheque_number text default null,
  p_virement_number text default null, p_bank_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.client_payments;
begin
  perform public.require_perm(array['clients:pay','clients:edit']);
  perform public._unallocate_client_payment(p_id);
  update public.client_payments set
    amount = round(p_amount, 2),
    paid_at = coalesce(p_paid_at, paid_at), date = coalesce(p_paid_at::date, date),
    notes = coalesce(p_notes, notes), method = coalesce(p_method, method),
    cheque_number = coalesce(nullif(p_cheque_number, ''), case when p_cheque_number = '' then null else cheque_number end),
    virement_number = coalesce(nullif(p_virement_number, ''), case when p_virement_number = '' then null else virement_number end),
    bank_name = coalesce(nullif(p_bank_name, ''), case when p_bank_name = '' then null else bank_name end)
  where id = p_id returning * into r;
  perform public._allocate_client_payment(p_id);
  select * into r from public.client_payments where id = p_id;
  return to_jsonb(r);
end $$;

create or replace function public.delete_client_payment(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_perm(array['clients:delete','clients:pay']);
  delete from public.client_payments where id = p_id;   -- triggers reverse caisse, allocations, acompte
end $$;

create or replace function public.pay_supplier(
  p_supplier_id uuid, p_amount numeric, p_paid_at timestamptz, p_notes text default '',
  p_method text default 'especes', p_cheque_number text default null,
  p_virement_number text default null, p_bank_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.supplier_payments;
begin
  perform public.require_perm(array['suppliers:pay','suppliers:edit']);
  if coalesce(p_amount, 0) <= 0 then raise exception 'Montant invalide'; end if;
  insert into public.supplier_payments (supplier_id, supplier_name, amount, date, paid_at, notes, method,
    cheque_number, virement_number, bank_name)
  values (p_supplier_id, (select name from public.suppliers where id = p_supplier_id), round(p_amount, 2),
    coalesce(p_paid_at, now())::date, coalesce(p_paid_at, now()), coalesce(p_notes, ''),
    coalesce(p_method, 'especes'), p_cheque_number, p_virement_number, p_bank_name)
  returning * into r;
  perform public._allocate_supplier_payment(r.id);
  select * into r from public.supplier_payments where id = r.id;
  return to_jsonb(r);
end $$;

create or replace function public.update_supplier_payment(
  p_id uuid, p_amount numeric, p_paid_at timestamptz default null, p_notes text default null,
  p_method text default null, p_cheque_number text default null,
  p_virement_number text default null, p_bank_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.supplier_payments;
begin
  perform public.require_perm(array['suppliers:pay','suppliers:edit']);
  perform public._unallocate_supplier_payment(p_id);
  update public.supplier_payments set
    amount = round(p_amount, 2),
    paid_at = coalesce(p_paid_at, paid_at), date = coalesce(p_paid_at::date, date),
    notes = coalesce(p_notes, notes), method = coalesce(p_method, method),
    cheque_number = coalesce(nullif(p_cheque_number, ''), case when p_cheque_number = '' then null else cheque_number end),
    virement_number = coalesce(nullif(p_virement_number, ''), case when p_virement_number = '' then null else virement_number end),
    bank_name = coalesce(nullif(p_bank_name, ''), case when p_bank_name = '' then null else bank_name end)
  where id = p_id returning * into r;
  perform public._allocate_supplier_payment(p_id);
  select * into r from public.supplier_payments where id = p_id;
  return to_jsonb(r);
end $$;

create or replace function public.delete_supplier_payment(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_perm(array['suppliers:delete','suppliers:pay']);
  delete from public.supplier_payments where id = p_id;
end $$;

-- =============================================================================
--  RPC — OLD DEBTS, REFUNDS, ACOMPTE (credit) IMPUTATIONS
-- =============================================================================
create or replace function public._party_perm(p_type text, p_action text)
returns text[] language sql immutable as $$
  select array[(case when p_type = 'supplier' then 'suppliers' else 'clients' end) || ':' || p_action,
               (case when p_type = 'supplier' then 'suppliers' else 'clients' end) || ':pay']
$$;

create or replace function public.add_party_old_debt(p_party_type text, p_party_id uuid, p_amount numeric, p_date date, p_description text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.party_old_debts;
begin
  perform public.require_perm(public._party_perm(p_party_type, 'create'));
  insert into public.party_old_debts (party_type, party_id, party_name, amount, date, description)
  values (p_party_type, p_party_id,
    case when p_party_type = 'supplier' then (select name from public.suppliers where id = p_party_id)
         else (select name from public.clients where id = p_party_id) end,
    round(p_amount, 2), coalesce(p_date, current_date), coalesce(p_description, ''))
  returning * into r;
  return to_jsonb(r);
end $$;

create or replace function public.update_party_old_debt(p_id uuid, p_amount numeric, p_date date, p_description text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.party_old_debts;
begin
  select * into r from public.party_old_debts where id = p_id;
  perform public.require_perm(public._party_perm(r.party_type, 'edit'));
  update public.party_old_debts set amount = round(p_amount, 2), date = coalesce(p_date, date),
    description = coalesce(p_description, description) where id = p_id returning * into r;
  return to_jsonb(r);
end $$;

create or replace function public.delete_party_old_debt(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.party_old_debts;
begin
  select * into r from public.party_old_debts where id = p_id;
  if not found then return; end if;
  perform public.require_perm(public._party_perm(r.party_type, 'delete'));
  delete from public.party_old_debts where id = p_id;
end $$;

create or replace function public.refund_party_credit(
  p_party_type text, p_party_id uuid, p_amount numeric, p_refunded_at timestamptz, p_notes text default '',
  p_method text default 'especes', p_cheque_number text default null,
  p_virement_number text default null, p_bank_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.party_credit_refunds;
begin
  perform public.require_perm(public._party_perm(p_party_type, 'pay'));
  if coalesce(p_amount, 0) <= 0 then raise exception 'Montant invalide'; end if;
  insert into public.party_credit_refunds (party_type, party_id, party_name, amount, date, refunded_at, notes,
    method, cheque_number, virement_number, bank_name)
  values (p_party_type, p_party_id,
    case when p_party_type = 'supplier' then (select name from public.suppliers where id = p_party_id)
         else (select name from public.clients where id = p_party_id) end,
    round(p_amount, 2), coalesce(p_refunded_at, now())::date, coalesce(p_refunded_at, now()), coalesce(p_notes, ''),
    coalesce(p_method, 'especes'), p_cheque_number, p_virement_number, p_bank_name)
  returning * into r;
  return to_jsonb(r);
end $$;

create or replace function public.update_party_refund(
  p_id uuid, p_amount numeric, p_refunded_at timestamptz, p_notes text default '',
  p_method text default 'especes', p_cheque_number text default '',
  p_virement_number text default '', p_bank_name text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.party_credit_refunds;
begin
  select * into r from public.party_credit_refunds where id = p_id;
  perform public.require_perm(public._party_perm(r.party_type, 'edit'));
  update public.party_credit_refunds set amount = round(p_amount, 2),
    refunded_at = coalesce(p_refunded_at, refunded_at), date = coalesce(p_refunded_at::date, date),
    notes = coalesce(p_notes, ''), method = coalesce(p_method, 'especes'),
    cheque_number = nullif(p_cheque_number, ''), virement_number = nullif(p_virement_number, ''),
    bank_name = nullif(p_bank_name, '')
  where id = p_id returning * into r;
  return to_jsonb(r);
end $$;

create or replace function public.delete_party_refund(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.party_credit_refunds;
begin
  select * into r from public.party_credit_refunds where id = p_id;
  if not found then return; end if;
  perform public.require_perm(public._party_perm(r.party_type, 'delete'));
  delete from public.party_credit_refunds where id = p_id;
end $$;

create or replace function public.apply_credit_to_sale(p_sale_id uuid, p_amount numeric default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare s public.sales; v_credit numeric; v_use numeric;
begin
  perform public.require_perm(array['clients:pay','sales:pay','pos:create','sales:create']);
  select * into s from public.sales where id = p_sale_id;
  if not found or s.client_id is null then return 0; end if;
  select credit_amount into v_credit from public.clients where id = s.client_id for update;
  v_use := round(least(greatest(v_credit, 0), s.rest_amount, coalesce(p_amount, s.rest_amount)), 2);
  if v_use <= 0 then return 0; end if;
  insert into public.sale_payments (sale_id, date, amount, description, origin)
  values (s.id, current_date, v_use, 'Acompte du client', 'credit');
  return v_use;
end $$;

create or replace function public.apply_credit_to_command(p_command_id uuid, p_amount numeric default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare c public.commands; v_credit numeric; v_use numeric;
begin
  perform public.require_perm(array['clients:pay','clients:edit','clients:create']);
  select * into c from public.commands where id = p_command_id;
  if not found or c.client_id is null then return 0; end if;
  select credit_amount into v_credit from public.clients where id = c.client_id for update;
  v_use := round(least(greatest(v_credit, 0), c.rest_amount, coalesce(p_amount, c.rest_amount)), 2);
  if v_use <= 0 then return 0; end if;
  update public.clients set credit_amount = credit_amount - v_use where id = c.client_id;
  update public.commands set credit_applied = credit_applied + v_use where id = c.id;
  perform public._recalc_command(c.id);
  return v_use;
end $$;

create or replace function public.apply_credit_to_purchase(p_purchase_id uuid, p_amount numeric default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare p public.purchases; v_credit numeric; v_use numeric;
begin
  perform public.require_perm(array['suppliers:pay','purchase:pay','purchase:create']);
  select * into p from public.purchases where id = p_purchase_id;
  if not found or p.supplier_id is null then return 0; end if;
  select credit_amount into v_credit from public.suppliers where id = p.supplier_id for update;
  v_use := round(least(greatest(v_credit, 0), p.rest_amount, coalesce(p_amount, p.rest_amount)), 2);
  if v_use <= 0 then return 0; end if;
  insert into public.purchase_payments (purchase_id, date, amount, description, origin)
  values (p.id, current_date, v_use, 'Acompte du fournisseur', 'credit');
  return v_use;
end $$;

create or replace function public.cancel_credit_imputation(p_kind text, p_id uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_back numeric := 0; c public.commands;
begin
  perform public.require_perm(array['clients:pay','clients:edit']);
  if p_kind = 'sale' then
    select coalesce(sum(amount), 0) into v_back from public.sale_payments where sale_id = p_id and origin = 'credit';
    delete from public.sale_payments where sale_id = p_id and origin = 'credit';   -- trigger gives the credit back
  else
    select * into c from public.commands where id = p_id;
    v_back := coalesce(c.credit_applied, 0);
    update public.clients set credit_amount = credit_amount + v_back where id = c.client_id;
    update public.commands set credit_applied = 0 where id = p_id;
    perform public._recalc_command(p_id);
  end if;
  return v_back;
end $$;

-- Uses the party's acompte on its open documents (oldest first). Returns what is left.
create or replace function public.rebalance_party_credit(p_party_type text, p_party_id uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare d record; v_left numeric;
begin
  perform public.require_perm(public._party_perm(p_party_type, 'edit'));
  if p_party_type = 'supplier' then
    for d in select id from public.purchases where supplier_id = p_party_id and rest_amount > 0.004 order by date, created_at loop
      exit when (select credit_amount from public.suppliers where id = p_party_id) <= 0.004;
      perform public.apply_credit_to_purchase(d.id, null);
    end loop;
    select credit_amount into v_left from public.suppliers where id = p_party_id;
  else
    for d in select id from public.sales where client_id = p_party_id and rest_amount > 0.004 order by date, created_at loop
      exit when (select credit_amount from public.clients where id = p_party_id) <= 0.004;
      perform public.apply_credit_to_sale(d.id, null);
    end loop;
    select credit_amount into v_left from public.clients where id = p_party_id;
  end if;
  return coalesce(v_left, 0);
end $$;

-- « Recalculer le compte » : every document of the client is recomputed from its rows.
create or replace function public.rebuild_client_account(p_client_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  perform public.require_perm(array['clients:edit']);
  for r in select id from public.commands where client_id = p_client_id loop perform public._recalc_command(r.id); end loop;
  for r in select id from public.sales where client_id = p_client_id loop perform public._recalc_sale(r.id); end loop;
  for r in select id from public.party_old_debts where party_type = 'client' and party_id = p_client_id loop
    perform public._recalc_old_debt(r.id);
  end loop;
  return jsonb_build_object('reimpute', false);
end $$;

-- Walk-in client shared by the POS.
create or replace function public.get_or_create_passager()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.clients;
begin
  perform public.require_perm(array['pos:create','sales:create','clients:create']);
  select * into v from public.clients where lower(name) like 'client passager%' order by created_at limit 1;
  if not found then insert into public.clients (name) values ('Client Passager') returning * into v; end if;
  return to_jsonb(v);
end $$;

-- Legacy « dettes clients »
create or replace function public.add_client_debt(p_client_id uuid, p_total_debt numeric, p_date date, p_description text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.client_debts; c public.clients;
begin
  perform public.require_perm(array['clients:create']);
  select * into c from public.clients where id = p_client_id;
  insert into public.client_debts (client_id, client_name, client_phone, total_debt, rest_amount, date, description)
  values (p_client_id, coalesce(c.name, ''), c.phone, round(p_total_debt, 2), round(p_total_debt, 2),
          coalesce(p_date, current_date), coalesce(p_description, ''))
  returning * into r;
  return to_jsonb(r);
end $$;

create or replace function public.add_client_debt_versement(p_debt_id uuid, p_amount numeric, p_date date, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.client_debt_versements; d public.client_debts;
begin
  perform public.require_perm(array['clients:pay']);
  select * into d from public.client_debts where id = p_debt_id;
  if not found then raise exception 'Dette introuvable'; end if;
  insert into public.client_debt_versements (debt_id, client_id, client_name, amount, date, notes)
  values (d.id, d.client_id, d.client_name, round(p_amount, 2), coalesce(p_date, current_date), p_notes)
  returning * into r;
  return to_jsonb(r);
end $$;

create or replace function public.delete_client_debt_versement(p_versement_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_perm(array['clients:delete','clients:pay']);
  delete from public.client_debt_versements where id = p_versement_id;
end $$;

-- =============================================================================
--  RPC — WORKERS
-- =============================================================================
create or replace function public.pay_worker_salary(p_worker_id uuid, p_amount numeric, p_period text default null,
  p_date date default null, p_description text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.worker_payments;
begin
  perform public.require_perm(array['workers:pay','workers:create']);
  insert into public.worker_payments (worker_id, date, period, amount, description, kind)
  values (p_worker_id, coalesce(p_date, current_date), coalesce(p_period, ''), round(p_amount, 2), coalesce(p_description, ''), 'salary')
  returning * into r;
  return to_jsonb(r);
end $$;

create or replace function public.add_worker_acompte(p_worker_id uuid, p_amount numeric, p_date date default null, p_description text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.worker_acomptes;
begin
  perform public.require_perm(array['workers:pay','workers:create']);
  insert into public.worker_acomptes (worker_id, date, amount, description)
  values (p_worker_id, coalesce(p_date, current_date), round(p_amount, 2), coalesce(p_description, ''))
  returning * into r;
  return to_jsonb(r);
end $$;

create or replace function public.add_worker_overtime(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.worker_overtimes;
begin
  perform public.require_perm(array['workers:create','workers:edit']);
  insert into public.worker_overtimes (worker_id, date, work_end_hour, work_end_minute, overtime_end_hour,
    overtime_end_minute, hours, hourly_rate, amount, description)
  values ((p_payload->>'worker_id')::uuid, coalesce(nullif(p_payload->>'date', '')::date, current_date),
    coalesce((p_payload->>'work_end_hour')::int, 0), coalesce((p_payload->>'work_end_minute')::int, 0),
    coalesce((p_payload->>'overtime_end_hour')::int, 0), coalesce((p_payload->>'overtime_end_minute')::int, 0),
    coalesce((p_payload->>'hours')::numeric, 0), coalesce((p_payload->>'hourly_rate')::numeric, 0),
    coalesce((p_payload->>'amount')::numeric, 0), coalesce(p_payload->>'description', ''))
  returning * into r;
  return to_jsonb(r);
end $$;

create or replace function public.update_worker_overtime(p_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.worker_overtimes;
begin
  perform public.require_perm(array['workers:edit']);
  update public.worker_overtimes set
    date = coalesce(nullif(p_payload->>'date', '')::date, date),
    work_end_hour = coalesce((p_payload->>'work_end_hour')::int, work_end_hour),
    work_end_minute = coalesce((p_payload->>'work_end_minute')::int, work_end_minute),
    overtime_end_hour = coalesce((p_payload->>'overtime_end_hour')::int, overtime_end_hour),
    overtime_end_minute = coalesce((p_payload->>'overtime_end_minute')::int, overtime_end_minute),
    hours = coalesce((p_payload->>'hours')::numeric, hours),
    hourly_rate = coalesce((p_payload->>'hourly_rate')::numeric, hourly_rate),
    amount = coalesce((p_payload->>'amount')::numeric, amount),
    description = coalesce(p_payload->>'description', description)
  where id = p_id returning * into r;
  return to_jsonb(r);
end $$;

create or replace function public.delete_worker_overtime(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_perm(array['workers:delete','workers:edit']);
  delete from public.worker_overtimes where id = p_id;
end $$;

create or replace function public.pay_worker_overtimes(p_worker_id uuid, p_ids uuid[], p_date date default null, p_description text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_total numeric; r public.worker_payments;
begin
  perform public.require_perm(array['workers:pay']);
  select coalesce(sum(amount), 0) into v_total from public.worker_overtimes
  where worker_id = p_worker_id and id = any(p_ids) and not is_paid;
  if v_total <= 0 then raise exception 'Aucune heure supplémentaire à payer'; end if;
  insert into public.worker_payments (worker_id, date, period, amount, description, kind)
  values (p_worker_id, coalesce(p_date, current_date), 'Heures supplémentaires', round(v_total, 2),
          coalesce(nullif(p_description, ''), 'Paiement heures supplémentaires'), 'overtime')
  returning * into r;
  update public.worker_overtimes set is_paid = true, paid_at = coalesce(p_date, current_date), payment_id = r.id
  where worker_id = p_worker_id and id = any(p_ids) and not is_paid;
  return to_jsonb(r);
end $$;

-- =============================================================================
--  RPC — CAISSE, PURCHASE ORDERS
-- =============================================================================
create or replace function public.add_caisse_transaction(p_type text, p_amount numeric, p_description text,
  p_date date default null, p_category_id uuid default null, p_category_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.caisse_transactions;
begin
  perform public.require_perm(array['caisse:create']);
  insert into public.caisse_transactions (type, amount, date, description, category_id, category_name)
  values (p_type, round(p_amount, 2), coalesce(p_date, current_date), coalesce(p_description, ''), p_category_id, p_category_name)
  returning * into r;
  return to_jsonb(r);
end $$;

create or replace function public.caisse_balance()
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select initial_balance from public.caisse_settings limit 1), 0)
       + coalesce((select sum(case when type = 'deposit' then amount else -amount end) from public.caisse_transactions), 0)
$$;

create or replace function public.create_caisse_report(p_declared_amount numeric, p_description text,
  p_report_type text default 'day', p_date date default null, p_end_date date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.caisse_reports;
begin
  perform public.require_perm(array['caisse:create']);
  insert into public.caisse_reports (report_type, date, end_date, description, declared_amount)
  values (coalesce(p_report_type, 'day'), coalesce(p_date, current_date),
          case when p_report_type = 'period' then coalesce(p_end_date, p_date) end,
          coalesce(p_description, ''), round(coalesce(p_declared_amount, 0), 2))
  returning * into r;
  return to_jsonb(r);
end $$;

create or replace function public._write_order_items(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare i jsonb;
begin
  delete from public.purchase_order_items where order_id = p_id;
  for i in select * from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) loop
    insert into public.purchase_order_items (order_id, product_name, description, quantity, unit)
    values (p_id, coalesce(i->>'product_name', ''), coalesce(i->>'description', ''),
            coalesce((i->>'quantity')::numeric, 0), i->>'unit');
  end loop;
end $$;

create or replace function public.create_purchase_order(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.purchase_orders;
begin
  perform public.require_perm(array['expenses:create','purchase:create']);
  insert into public.purchase_orders (date, supplier_name, notes)
  values (coalesce(nullif(p_payload->>'date', '')::date, current_date), coalesce(p_payload->>'supplier_name', ''),
          coalesce(p_payload->>'notes', ''))
  returning * into r;
  perform public._write_order_items(r.id, p_payload);
  return to_jsonb(r);
end $$;

create or replace function public.update_purchase_order(p_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.purchase_orders;
begin
  perform public.require_perm(array['expenses:edit','purchase:edit']);
  update public.purchase_orders set date = coalesce(nullif(p_payload->>'date', '')::date, date),
    supplier_name = coalesce(p_payload->>'supplier_name', supplier_name), notes = coalesce(p_payload->>'notes', notes)
  where id = p_id returning * into r;
  perform public._write_order_items(p_id, p_payload);
  return to_jsonb(r);
end $$;

-- =============================================================================
--  RPC — RECYCLE BIN (Paramètres › Corbeille)
-- =============================================================================
create or replace function public._table_module(p_table text)
returns text language sql immutable as $$
  select case
    when p_table in ('products','marques','categories','units') then 'stock'
    when p_table in ('purchases','purchase_lines','purchase_payments') then 'purchase'
    when p_table in ('productions','production_categories','fiche_technics','fiche_categories') then 'production'
    when p_table in ('comptoir_items','destructions') then 'comptoir'
    when p_table in ('sales','sale_lines','sale_payments') then 'sales'
    when p_table in ('clients','commands','command_items','command_payments','command_deliveries','client_debts',
                     'client_payments','party_old_debts','party_credit_refunds','command_adjustments') then 'clients'
    when p_table in ('suppliers','supplier_payments') then 'suppliers'
    when p_table in ('workers','worker_acomptes','worker_absences','worker_payments','worker_overtimes','roles') then 'workers'
    when p_table in ('expenses','expense_categories','purchase_orders') then 'expenses'
    when p_table in ('caisse_transactions','caisse_categories','caisse_reports') then 'caisse'
    else 'settings' end
$$;

create or replace function public.recycle_delete(p_table text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_perm(array[public._table_module(p_table) || ':delete']);
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = p_table) then
    raise exception 'Table inconnue: %', p_table;
  end if;
  perform set_config('app.recycle', 'on', true);
  execute format('delete from public.%I where id = $1', p_table) using p_id;
  perform set_config('app.recycle', 'off', true);
end $$;

create or replace function public.recycle_bin_list()
returns setof public.recycle_bin language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_perm(array['settings:view']);
  return query select * from public.recycle_bin order by deleted_at desc, id;
end $$;

-- Re-inserts every row of a deletion (parents first, retried until FKs resolve).
create or replace function public.recycle_restore(p_tx_id bigint)
returns integer language plpgsql security definer set search_path = public as $$
declare r record; v_done int := 0; v_progress boolean := true; v_pending int;
begin
  perform public.require_perm(array['settings:edit','settings:view']);
  create temp table if not exists _restore_ok (id bigint primary key) on commit drop;
  set constraints public.sales_delivery_fk, public.command_deliveries_sale_id_fkey deferred;
  while v_progress loop
    v_progress := false;
    for r in select * from public.recycle_bin b where tx_id = p_tx_id
             and not exists (select 1 from _restore_ok o where o.id = b.id) order by id loop
      begin
        execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)
                        on conflict (id) do nothing', r.table_name, r.table_name) using r.data;
        insert into _restore_ok values (r.id);
        v_done := v_done + 1; v_progress := true;
      exception when foreign_key_violation then null;   -- parent not back yet: next pass
      end;
    end loop;
  end loop;
  select count(*) into v_pending from public.recycle_bin b where tx_id = p_tx_id
    and not exists (select 1 from _restore_ok o where o.id = b.id);
  if v_pending > 0 then raise exception 'Restauration impossible : % élément(s) dépendent de données supprimées', v_pending; end if;
  delete from public.recycle_bin where tx_id = p_tx_id;
  return v_done;
end $$;
-- =============================================================================
--  ROW LEVEL SECURITY
--  Admin: everything. Worker: only what profiles.permissions grants, per module
--  and per action (view / create / edit / delete / pay). A worker who can open
--  a screen can also READ the reference data that screen needs (e.g. the POS
--  reads clients and the comptoir) — but cannot write it without the right.
-- =============================================================================

create or replace function public.has_any_perm(p_modules text[], p_action text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.profiles p, unnest(p_modules) m
    where p.id = auth.uid() and p.is_active
      and coalesce((p.permissions -> m ->> p_action)::boolean, false))
$$;

do $$
declare
  rec record;
  r text[]; w text[];
begin
  for rec in
    select * from (values
      ('products',              '{stock,purchase,production,pos,comptoir,sales,clients,dashboard,reports}', '{stock,purchase}'),
      ('marques',               '{stock,purchase,production,pos,comptoir,sales,clients,dashboard,reports}', '{stock,purchase}'),
      ('categories',            '{stock,purchase,production,pos,comptoir,sales,clients,dashboard,reports}', '{stock,purchase}'),
      ('units',                 '{stock,purchase,production,pos,comptoir,sales,clients,dashboard,reports,expenses}', '{stock,purchase,production}'),
      ('suppliers',             '{suppliers,purchase,expenses,caisse,dashboard,reports}', '{suppliers,purchase}'),
      ('clients',               '{clients,pos,sales,caisse,comptoir,dashboard,reports}', '{clients,pos,sales}'),
      ('purchases',             '{purchase,suppliers,stock,caisse,dashboard,reports}', '{purchase}'),
      ('purchase_lines',        '{purchase,suppliers,stock,caisse,dashboard,reports}', '{purchase}'),
      ('purchase_payments',     '{purchase,suppliers,caisse,dashboard,reports}', '{purchase,suppliers}'),
      ('sales',                 '{sales,pos,clients,caisse,comptoir,production,dashboard,reports}', '{sales,pos}'),
      ('sale_lines',            '{sales,pos,clients,caisse,comptoir,production,dashboard,reports}', '{sales,pos}'),
      ('sale_payments',         '{sales,pos,clients,caisse,dashboard,reports}', '{sales,pos,clients}'),
      ('commands',              '{clients,sales,pos,caisse,production,stock,dashboard,reports}', '{clients}'),
      ('command_items',         '{clients,sales,pos,caisse,production,stock,dashboard,reports}', '{clients}'),
      ('command_payments',      '{clients,sales,caisse,dashboard,reports}', '{clients}'),
      ('command_adjustments',   '{clients,sales,caisse,dashboard,reports}', '{clients}'),
      ('command_adjustment_lines','{clients,sales,caisse,dashboard,reports}', '{clients}'),
      ('command_deliveries',    '{clients,sales,pos,caisse,production,stock,dashboard,reports}', '{clients,sales}'),
      ('command_delivery_items','{clients,sales,pos,caisse,production,stock,dashboard,reports}', '{clients,sales}'),
      ('command_delivery_consumptions','{clients,sales,caisse,production,stock,dashboard,reports}', '{clients,sales}'),
      ('productions',           '{production,pos,comptoir,stock,sales,clients,caisse,dashboard,reports}', '{production}'),
      ('production_used_products','{production,pos,comptoir,stock,sales,clients,caisse,dashboard,reports}', '{production}'),
      ('production_categories', '{production,pos,comptoir,stock,sales,clients,dashboard,reports}', '{production}'),
      ('fiche_technics',        '{production,pos,comptoir,stock,sales,clients,dashboard,reports}', '{production}'),
      ('fiche_technic_lines',   '{production,pos,comptoir,stock,sales,clients,dashboard,reports}', '{production}'),
      ('fiche_categories',      '{production,pos,comptoir,stock,sales,clients,dashboard,reports}', '{production}'),
      ('comptoir_items',        '{comptoir,pos,production,sales,caisse,dashboard,reports}', '{comptoir,production}'),
      ('destructions',          '{comptoir,pos,production,sales,caisse,dashboard,reports}', '{comptoir}'),
      ('client_payments',       '{clients,sales,caisse,dashboard,reports}', '{clients}'),
      ('supplier_payments',     '{suppliers,purchase,caisse,dashboard,reports}', '{suppliers}'),
      ('party_old_debts',       '{clients,suppliers,sales,purchase,caisse,dashboard,reports}', '{clients,suppliers}'),
      ('party_old_debt_allocations','{clients,suppliers,caisse,dashboard,reports}', '{clients,suppliers}'),
      ('party_credit_refunds',  '{clients,suppliers,caisse,dashboard,reports}', '{clients,suppliers}'),
      ('client_debts',          '{clients,caisse,dashboard,reports}', '{clients}'),
      ('client_debt_versements','{clients,caisse,dashboard,reports}', '{clients}'),
      ('workers',               '{workers,caisse,expenses,dashboard,reports}', '{workers}'),
      ('worker_acomptes',       '{workers,caisse,expenses,dashboard,reports}', '{workers}'),
      ('worker_absences',       '{workers,caisse,expenses,dashboard,reports}', '{workers}'),
      ('worker_payments',       '{workers,caisse,expenses,dashboard,reports}', '{workers}'),
      ('worker_overtimes',      '{workers,caisse,expenses,dashboard,reports}', '{workers}'),
      ('roles',                 '{workers,settings}', '{workers}'),
      ('expenses',              '{expenses,caisse,dashboard,reports}', '{expenses}'),
      ('expense_categories',    '{expenses,caisse,dashboard,reports}', '{expenses}'),
      ('purchase_orders',       '{expenses,purchase,suppliers,dashboard,reports}', '{expenses,purchase}'),
      ('purchase_order_items',  '{expenses,purchase,suppliers,dashboard,reports}', '{expenses,purchase}'),
      ('caisse_transactions',   '{caisse,dashboard,reports}', '{caisse}'),
      ('caisse_categories',     '{caisse,dashboard,reports}', '{caisse}'),
      ('caisse_reports',        '{caisse,dashboard,reports}', '{caisse}'),
      ('caisse_settings',       '{caisse,dashboard,reports}', '{caisse}'),
      ('recycle_bin',           '{settings}', '{settings}')
    ) as t(tbl, rd, wr)
  loop
    r := rec.rd::text[]; w := rec.wr::text[];
    execute format('alter table public.%I enable row level security', rec.tbl);
    execute format('drop policy if exists p_select on public.%I', rec.tbl);
    execute format('drop policy if exists p_insert on public.%I', rec.tbl);
    execute format('drop policy if exists p_update on public.%I', rec.tbl);
    execute format('drop policy if exists p_delete on public.%I', rec.tbl);
    execute format('create policy p_select on public.%I for select to authenticated using (public.can_view_any(%L::text[]))', rec.tbl, r);
    execute format('create policy p_insert on public.%I for insert to authenticated with check (public.has_any_perm(%L::text[], ''create''))', rec.tbl, w);
    execute format('create policy p_update on public.%I for update to authenticated using (public.has_any_perm(%L::text[], ''edit'')) with check (public.has_any_perm(%L::text[], ''edit''))', rec.tbl, w, w);
    execute format('create policy p_delete on public.%I for delete to authenticated using (public.has_any_perm(%L::text[], ''delete''))', rec.tbl, w);
  end loop;
end $$;

-- recycle bin is written only by triggers
drop policy if exists p_insert on public.recycle_bin;
drop policy if exists p_update on public.recycle_bin;

-- profiles: everyone reads his own row; only the admin reads / edits all
alter table public.profiles enable row level security;
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin() or public.has_perm('workers', 'view'));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());
-- a worker may rename himself but never change his role or permissions
create or replace function public.trg_profile_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() and auth.uid() is not null then
    new.role := old.role; new.permissions := old.permissions;
    new.worker_id := old.worker_id; new.is_active := old.is_active;
  end if;
  return new;
end $$;
drop trigger if exists profile_guard on public.profiles;
create trigger profile_guard before update on public.profiles
  for each row execute function public.trg_profile_guard();

-- store settings: readable before login (name + logo on the login page)
alter table public.store_settings enable row level security;
drop policy if exists store_select on public.store_settings;
drop policy if exists store_write on public.store_settings;
drop policy if exists store_update on public.store_settings;
create policy store_select on public.store_settings for select to anon, authenticated using (true);
create policy store_write on public.store_settings for insert to authenticated with check (public.has_perm('settings', 'edit'));
create policy store_update on public.store_settings for update to authenticated
  using (public.has_perm('settings', 'edit')) with check (public.has_perm('settings', 'edit'));

-- printing titles: shared by every logged-in user
alter table public.document_titles enable row level security;
drop policy if exists titles_all on public.document_titles;
create policy titles_all on public.document_titles for all to authenticated using (true) with check (true);

-- =============================================================================
--  GRANTS
-- =============================================================================
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant select on public.store_settings to anon;

-- Internal helpers (prefixed with _ ) and trigger functions are SECURITY DEFINER
-- without permission checks: they must never be callable through the API.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like '\_%' or p.proname like 'trg\_%')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- Login page: callable before authentication
grant execute on function public.admin_account_exists() to anon, authenticated;
grant execute on function public.create_admin_account(text, text, text, text) to anon, authenticated;
grant execute on function public.resolve_login_email(text) to anon, authenticated;

-- =============================================================================
--  REPORT VIEWS (security_invoker: they respect the caller's RLS)
-- =============================================================================
create or replace view public.v_stock_alerts with (security_invoker = true) as
  select id, name, current_quantity, min_alert_quantity, unit, expiration_date
  from public.products
  where current_quantity <= min_alert_quantity
     or (expiration_enabled and expiration_date is not null and expiration_date <= current_date + 30);

create or replace view public.v_sales_daily with (security_invoker = true) as
  select date, count(*) as sales_count, sum(total_amount) as total_ht, sum(tva_amount) as total_tva,
         sum(final_amount) as total_ttc, sum(paid_amount) as total_paid, sum(rest_amount) as total_rest
  from public.sales group by date order by date desc;

create or replace view public.v_reports_monthly with (security_invoker = true) as
  with m as (
    select date_trunc('month', date)::date as month, 'sales' as k, sum(final_amount) as v from public.sales group by 1
    union all select date_trunc('month', date)::date, 'purchases', sum(total_amount) from public.purchases group by 1
    union all select date_trunc('month', date)::date, 'expenses', sum(amount) from public.expenses group by 1
    union all select date_trunc('month', date)::date, 'salaries', sum(amount) from public.worker_payments group by 1
    union all select date_trunc('month', date)::date, 'production_cost', sum(total_cost) from public.productions group by 1
    union all select date_trunc('month', date)::date, 'destructions', sum(value) from public.destructions group by 1
  )
  select month,
    coalesce(sum(v) filter (where k = 'sales'), 0) as sales,
    coalesce(sum(v) filter (where k = 'purchases'), 0) as purchases,
    coalesce(sum(v) filter (where k = 'expenses'), 0) as expenses,
    coalesce(sum(v) filter (where k = 'salaries'), 0) as salaries,
    coalesce(sum(v) filter (where k = 'production_cost'), 0) as production_cost,
    coalesce(sum(v) filter (where k = 'destructions'), 0) as destructions
  from m group by month order by month desc;

create or replace view public.v_client_balances with (security_invoker = true) as
  select c.id, c.name, c.credit_amount,
    coalesce((select sum(final_amount) from public.sales s where s.client_id = c.id), 0) as billed,
    coalesce((select sum(paid_amount) from public.sales s where s.client_id = c.id), 0) as paid,
    coalesce((select sum(rest_amount) from public.sales s where s.client_id = c.id), 0)
      + coalesce((select sum(rest_amount) from public.party_old_debts o where o.party_type = 'client' and o.party_id = c.id), 0) as rest
  from public.clients c;

create or replace view public.v_supplier_balances with (security_invoker = true) as
  select s.id, s.name, s.credit_amount,
    coalesce((select sum(total_amount) from public.purchases p where p.supplier_id = s.id), 0) as billed,
    coalesce((select sum(paid_amount) from public.purchases p where p.supplier_id = s.id), 0) as paid,
    coalesce((select sum(rest_amount) from public.purchases p where p.supplier_id = s.id), 0)
      + coalesce((select sum(rest_amount) from public.party_old_debts o where o.party_type = 'supplier' and o.party_id = s.id), 0) as rest
  from public.suppliers s;

create or replace view public.v_worker_balances with (security_invoker = true) as
  select w.id, w.full_name, w.payment_amount,
    coalesce((select sum(amount) from public.worker_acomptes a where a.worker_id = w.id), 0) as acomptes,
    coalesce((select sum(cost) from public.worker_absences a where a.worker_id = w.id), 0) as absences,
    coalesce((select sum(amount) from public.worker_payments p where p.worker_id = w.id), 0) as paid,
    coalesce((select sum(amount) from public.worker_overtimes o where o.worker_id = w.id and not o.is_paid), 0) as overtime_due
  from public.workers w;

create or replace view public.v_comptoir_stats with (security_invoker = true) as
  select coalesce(category_name, 'Sans catégorie') as category, count(*) as items,
         sum(quantity) as quantity, sum(quantity * unit_price) as value
  from public.comptoir_items group by 1;

create or replace view public.v_production_profitability with (security_invoker = true) as
  select id, name, date, category_name, output_quantity, total_cost, total_value,
         total_value - total_cost - coalesce(loss_value, 0) as gains,
         case when output_quantity > 0 then round(total_cost / output_quantity, 4) end as cost_per_unit
  from public.productions;

create or replace view public.v_dashboard_kpis with (security_invoker = true) as
  select
    (select count(*) from public.products) as products_count,
    (select count(*) from public.v_stock_alerts) as stock_alerts,
    (select coalesce(sum(final_amount), 0) from public.sales where date = current_date) as sales_today,
    (select coalesce(sum(final_amount), 0) from public.sales where date_trunc('month', date) = date_trunc('month', current_date)) as sales_month,
    (select coalesce(sum(rest_amount), 0) from public.sales) as client_debts,
    (select coalesce(sum(rest_amount), 0) from public.purchases) as supplier_debts,
    (select coalesce(sum(quantity * unit_price), 0) from public.comptoir_items) as comptoir_value,
    public.caisse_balance() as caisse_balance;

grant select on public.v_stock_alerts, public.v_sales_daily, public.v_reports_monthly, public.v_client_balances,
  public.v_supplier_balances, public.v_worker_balances, public.v_comptoir_stats,
  public.v_production_profitability, public.v_dashboard_kpis to authenticated;

-- =============================================================================
--  STORAGE BUCKETS (images & documents)
--   store-assets   public   logo, stamps, website images     (write: settings / website)
--   product-images public   raw materials & paper products   (write: stock)
--   documents      private  scanned invoices / BL / receipts (any staff)
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('store-assets',   'store-assets',   true,  5242880,  array['image/png','image/jpeg','image/webp','image/svg+xml','image/gif']),
  ('product-images', 'product-images', true,  5242880,  array['image/png','image/jpeg','image/webp','image/gif']),
  ('documents',      'documents',      false, 20971520, array['image/png','image/jpeg','image/webp','application/pdf'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "papeterie public read" on storage.objects;
drop policy if exists "papeterie store-assets write" on storage.objects;
drop policy if exists "papeterie store-assets update" on storage.objects;
drop policy if exists "papeterie store-assets delete" on storage.objects;
drop policy if exists "papeterie product-images write" on storage.objects;
drop policy if exists "papeterie product-images update" on storage.objects;
drop policy if exists "papeterie product-images delete" on storage.objects;
drop policy if exists "papeterie documents read" on storage.objects;
drop policy if exists "papeterie documents write" on storage.objects;
drop policy if exists "papeterie documents delete" on storage.objects;

create policy "papeterie public read" on storage.objects for select to anon, authenticated
  using (bucket_id in ('store-assets', 'product-images'));

create policy "papeterie store-assets write" on storage.objects for insert to authenticated
  with check (bucket_id = 'store-assets' and public.has_any_perm(array['settings','website'], 'edit'));
create policy "papeterie store-assets update" on storage.objects for update to authenticated
  using (bucket_id = 'store-assets' and public.has_any_perm(array['settings','website'], 'edit'));
create policy "papeterie store-assets delete" on storage.objects for delete to authenticated
  using (bucket_id = 'store-assets' and public.has_any_perm(array['settings','website'], 'edit'));

create policy "papeterie product-images write" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and public.has_any_perm(array['stock','purchase','production'], 'create'));
create policy "papeterie product-images update" on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and public.has_any_perm(array['stock','purchase','production'], 'edit'));
create policy "papeterie product-images delete" on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and public.has_any_perm(array['stock'], 'delete'));

create policy "papeterie documents read" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and exists (select 1 from public.profiles where id = auth.uid() and is_active));
create policy "papeterie documents write" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and exists (select 1 from public.profiles where id = auth.uid() and is_active));
create policy "papeterie documents delete" on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.is_admin());

-- reload PostgREST schema cache
notify pgrst, 'reload schema';
-- =============================================================================
--  MISE À JOUR 2026-10 — LIVRAISONS, STOCK PRÊT, RÉCUPÉRATIONS,
--  FACTURES NON COMPTABILISÉES, IMAGES DES FICHES TECHNIQUES
-- -----------------------------------------------------------------------------
--  À exécuter UNE fois sur une base existante (SQL editor → Run). Le script peut
--  être relancé sans risque. Sur une installation neuve il est déjà inclus à la
--  fin de papeterie_supabase_full.sql.
--
--  Les fonctions redéfinies ici (create or replace) REMPLACENT celles des
--  parties 02 à 06 : _recalc_sale, trg_delivery_item, _build_delivery,
--  update_command_delivery, _write_fiche, _transfer_to_comptoir, _table_module.
--
--  STOCK PRÊT d'un produit (fiche technique) =
--      productions du produit (hors caisse) − envoyé au comptoir
--    − quantités livrées depuis le stock prêt
--    + quantités récupérées sur des bons de livraison
--
--  Une livraison prend d'abord dans le stock prêt ; ce qui manque est PRODUIT
--  automatiquement (production rattachée au bon, matières déduites du stock)
--  puis livré. Supprimer ou modifier le bon défait cette production.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1. COLONNES
-- -----------------------------------------------------------------------------
alter table public.fiche_technics add column if not exists image_url text;

alter table public.productions add column if not exists delivery_id uuid;
do $$ begin
  alter table public.productions add constraint productions_delivery_fk
    foreign key (delivery_id) references public.command_deliveries(id) on delete cascade;
exception when duplicate_object then null; end $$;
alter table public.productions drop constraint if exists productions_origin_check;
alter table public.productions add constraint productions_origin_check
  check (origin in ('manual','pos','delivery'));
create index if not exists productions_fiche_idx on public.productions (fiche_technic_id);
create index if not exists productions_delivery_idx on public.productions (delivery_id);

-- 'command' : bon créé depuis l'écran Commandes · 'livraison' : depuis l'écran Livraisons
alter table public.command_deliveries add column if not exists source text not null default 'command';

alter table public.command_delivery_items add column if not exists fiche_technic_id uuid;
alter table public.command_delivery_items add column if not exists ready_applied boolean not null default false;
alter table public.command_delivery_items add column if not exists from_ready numeric(14,3) not null default 0;
alter table public.command_delivery_items add column if not exists produced_quantity numeric(14,3) not null default 0;
alter table public.command_delivery_items add column if not exists unit_cost numeric(14,4) not null default 0;
alter table public.command_delivery_items add column if not exists cost_amount numeric(14,2) not null default 0;
create index if not exists cdi_fiche_idx on public.command_delivery_items (fiche_technic_id);
create index if not exists cdi_item_idx on public.command_delivery_items (command_item_id);

-- les lignes déjà livrées connaissent désormais leur produit
update public.command_delivery_items di set fiche_technic_id = ci.fiche_technic_id
  from public.command_items ci
 where di.command_item_id = ci.id and di.fiche_technic_id is null and ci.fiche_technic_id is not null;

-- part de l'encaissement d'une facture rendue au client après une récupération
alter table public.sales add column if not exists refunded_amount numeric(14,2) not null default 0;

-- -----------------------------------------------------------------------------
--  2. TABLES
-- -----------------------------------------------------------------------------
create sequence if not exists public.recovery_ref_seq;
create table if not exists public.delivery_recoveries (
  id uuid primary key default gen_random_uuid(),
  reference text not null default ('RET-' || lpad(nextval('public.recovery_ref_seq')::text, 6, '0')),
  delivery_id uuid not null references public.command_deliveries(id) on delete cascade,
  command_id uuid references public.commands(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  client_name text,
  date date not null default current_date,
  recovered_at timestamptz not null default now(),
  reason text default '',
  tva_enabled boolean not null default false,
  tva_rate numeric(6,2) not null default 0,
  total_ht numeric(14,2) not null default 0,
  tva_amount numeric(14,2) not null default 0,
  total_ttc numeric(14,2) not null default 0,
  excess_amount numeric(14,2) not null default 0,   -- argent payé que la facture n'appelle plus
  refund_amount numeric(14,2) not null default 0,   -- part rendue en espèces (sortie de caisse)
  refund_method text not null default 'especes',
  refund_id uuid references public.party_credit_refunds(id) on delete set null,
  is_historical boolean not null default false,
  created_at timestamptz not null default now(),
  created_by text default public.current_username()
);
create index if not exists recoveries_delivery_idx on public.delivery_recoveries (delivery_id);

create table if not exists public.delivery_recovery_items (
  id uuid primary key default gen_random_uuid(),
  recovery_id uuid not null references public.delivery_recoveries(id) on delete cascade,
  command_item_id uuid references public.command_items(id) on delete set null,
  fiche_technic_id uuid,
  product_name text not null,
  quantity numeric(14,3) not null default 0,
  unit_price numeric(14,2) not null default 0,
  amount numeric(14,2) not null default 0,
  unit text,
  ready_applied boolean not null default true,
  unit_cost numeric(14,4) not null default 0,
  cost_amount numeric(14,2) not null default 0
);
create index if not exists recovery_items_fiche_idx on public.delivery_recovery_items (fiche_technic_id);
create index if not exists recovery_items_item_idx on public.delivery_recovery_items (command_item_id);

-- Factures NON COMPTABILISÉES : documents imprimables, sans aucun effet
-- (ni stock, ni caisse, ni dette, ni rapport).
create sequence if not exists public.free_invoice_ref_seq;
create table if not exists public.free_invoices (
  id uuid primary key default gen_random_uuid(),
  reference text not null default ('FNC-' || lpad(nextval('public.free_invoice_ref_seq')::text, 6, '0')),
  doc_type text not null default 'facture' check (doc_type in ('facture','bon_livraison','proforma')),
  client_id uuid references public.clients(id) on delete set null,
  client_name text not null default '',
  client_phone text, client_address text,
  client_rc text, client_nif text, client_nis text, client_article text,
  date date not null default current_date,
  location text, driver_name text, driver_plate text,
  tva_enabled boolean not null default false,
  tva_rate numeric(6,2) not null default 0,
  reduction numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0,
  tva_amount numeric(14,2) not null default 0,
  final_amount numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  rest_amount numeric(14,2) not null default 0,
  payment_mode text,
  notes text default '',
  created_at timestamptz not null default now(),
  created_by text default public.current_username()
);
create table if not exists public.free_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.free_invoices(id) on delete cascade,
  position int not null default 0,
  fiche_technic_id uuid,
  product_name text not null,
  description text default '',
  quantity numeric(14,3) not null default 0,
  unit text,
  unit_price numeric(14,2) not null default 0,
  total_price numeric(14,2) not null default 0
);

-- -----------------------------------------------------------------------------
--  3. STOCK PRÊT & COÛT DE REVIENT D'UN PRODUIT
-- -----------------------------------------------------------------------------
create or replace function public.fiche_ready_quantity(p_fiche uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select round(
      coalesce((select sum(output_quantity - sent_to_comptoir) from public.productions
                 where fiche_technic_id = p_fiche and origin <> 'pos'), 0)
    - coalesce((select sum(quantity) from public.command_delivery_items
                 where fiche_technic_id = p_fiche and ready_applied), 0)
    + coalesce((select sum(ri.quantity) from public.delivery_recovery_items ri
                  join public.delivery_recoveries r on r.id = ri.recovery_id
                 where ri.fiche_technic_id = p_fiche and ri.ready_applied), 0), 3)
$$;

create or replace function public._fiche_unit_cost(p_fiche uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(
    (select sum(total_cost) / nullif(sum(output_quantity), 0)
       from public.productions where fiche_technic_id = p_fiche and output_quantity > 0),
    (select nullif(cost_per_unit, 0) from public.fiche_technics where id = p_fiche),
    (select total_cost / nullif(output_quantity, 0) from public.fiche_technics where id = p_fiche),
    0)
$$;

-- -----------------------------------------------------------------------------
--  4. QUANTITÉ LIVRÉE D'UNE LIGNE DE COMMANDE = livré − récupéré (recalculée)
-- -----------------------------------------------------------------------------
create or replace function public._recalc_item_delivered(p_item uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_item is null then return; end if;
  update public.command_items set delivered_quantity = greatest(0, round(
      coalesce((select sum(di.quantity) from public.command_delivery_items di where di.command_item_id = p_item), 0)
    - coalesce((select sum(ri.quantity) from public.delivery_recovery_items ri
                  join public.delivery_recoveries r on r.id = ri.recovery_id
                 where ri.command_item_id = p_item), 0), 3))
  where id = p_item;
end $$;

create or replace function public.trg_delivery_item()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op <> 'INSERT' then perform public._recalc_item_delivered(old.command_item_id); end if;
  if tg_op <> 'DELETE' then perform public._recalc_item_delivered(new.command_item_id); end if;
  return coalesce(new, old);
end $$;
drop trigger if exists delivery_item_trg on public.command_delivery_items;
create trigger delivery_item_trg after insert or update or delete on public.command_delivery_items
  for each row execute function public.trg_delivery_item();

-- -----------------------------------------------------------------------------
--  5. FACTURE D'UN BON : lignes = livré − récupéré ; argent rendu déduit
-- -----------------------------------------------------------------------------
create or replace function public._recalc_sale(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.sales; v_total numeric; v_base numeric; v_tva numeric; v_final numeric;
        v_paid numeric; v_alloc numeric; v_has_lines boolean;
begin
  if position(p_id::text in coalesce(current_setting('app.deleting_doc', true), '')) > 0 then return; end if;
  select * into s from public.sales where id = p_id;
  if not found then return; end if;
  select exists(select 1 from public.sale_lines where sale_id = p_id),
         coalesce(sum(quantity * selling_price), 0)
    into v_has_lines, v_total from public.sale_lines where sale_id = p_id;
  if not v_has_lines then v_total := s.total_amount; end if;
  v_base := greatest(0, round(v_total, 2) - coalesce(s.reduction, 0));
  v_tva := case when s.tva_enabled then round(v_base * s.tva_rate) / 100 else 0 end;
  v_final := round(v_base + v_tva, 2);
  select coalesce(sum(amount), 0), coalesce(sum(amount) filter (where origin = 'credit'), 0)
    into v_paid, v_alloc from public.sale_payments where sale_id = p_id;
  -- argent rendu au client après une récupération : il ne paie plus la facture
  v_paid := greatest(0, v_paid - least(coalesce(s.refunded_amount, 0), v_paid));
  update public.sales set
    total_amount = round(v_total, 2), tva_amount = v_tva, final_amount = v_final,
    paid_amount = v_paid, allocated_amount = v_alloc,
    rest_amount = greatest(0, v_final - v_paid),
    status = case when v_final - v_paid > 0.004 then 'debt' else 'paid' end
  where id = p_id;
  if s.delivery_id is not null then
    update public.command_deliveries d set
      total_ht = v_base, tva_amount = v_tva, total_ttc = v_final,
      tva_enabled = s.tva_enabled, tva_rate = s.tva_rate,
      advance_applied = coalesce((select sum(amount) from public.sale_payments where sale_id = p_id and origin = 'command_advance'), 0),
      cash_paid = coalesce((select sum(amount) from public.sale_payments where sale_id = p_id and origin is distinct from 'command_advance'), 0),
      paid_amount = v_paid, rest_amount = greatest(0, v_final - v_paid)
    where d.id = s.delivery_id;
  end if;
end $$;

create or replace function public._sync_delivery_sale(p_delivery uuid)
returns void language plpgsql security definer set search_path = public as $$
declare d public.command_deliveries; l record; v_qty numeric; v_ref numeric;
begin
  select * into d from public.command_deliveries where id = p_delivery;
  if not found or d.sale_id is null then return; end if;
  if not exists (select 1 from public.sales where id = d.sale_id) then return; end if;
  if position(d.sale_id::text in coalesce(current_setting('app.deleting_doc', true), '')) > 0 then return; end if;
  for l in select sl.id, sl.command_item_id, sl.quantity from public.sale_lines sl
            where sl.sale_id = d.sale_id and sl.command_item_id is not null loop
    v_qty := greatest(0, round(
        coalesce((select sum(quantity) from public.command_delivery_items
                   where delivery_id = d.id and command_item_id = l.command_item_id), 0)
      - coalesce((select sum(ri.quantity) from public.delivery_recovery_items ri
                    join public.delivery_recoveries r on r.id = ri.recovery_id
                   where r.delivery_id = d.id and ri.command_item_id = l.command_item_id), 0), 3));
    if abs(v_qty - l.quantity) > 0.0005 then
      update public.sale_lines set quantity = v_qty where id = l.id;
    end if;
  end loop;
  -- montant non plafonné : `_recalc_sale` le borne aux encaissements présents,
  -- quel que soit l'ordre dans lequel ils reviennent (corbeille)
  select coalesce(sum(excess_amount), 0) into v_ref from public.delivery_recoveries where delivery_id = d.id;
  update public.sales set refunded_amount = round(v_ref, 2) where id = d.sale_id;
  perform public._recalc_sale(d.sale_id);
end $$;

-- -----------------------------------------------------------------------------
--  6. PRODUCTION AUTOMATIQUE DU MANQUANT D'UNE LIVRAISON
-- -----------------------------------------------------------------------------
create or replace function public._auto_produce(p_fiche uuid, p_qty numeric, p_delivery uuid, p_date date, p_label text)
returns public.productions language plpgsql security definer set search_path = public as $$
declare f public.fiche_technics; v public.productions; fl record; v_lines jsonb := '[]'::jsonb;
        v_factor numeric; v_qty numeric; v_cost numeric; v_pid uuid; pr public.products;
begin
  select * into f from public.fiche_technics where id = p_fiche;
  if not found or coalesce(p_qty, 0) <= 0 then return null; end if;
  v_factor := p_qty / coalesce(nullif(f.output_quantity, 0), 1);
  for fl in select * from public.fiche_technic_lines where fiche_technic_id = p_fiche loop
    v_qty := round(coalesce(fl.quantity_used, 0) * v_factor, 4);
    continue when v_qty <= 0;
    v_pid := fl.product_id;
    v_cost := coalesce(fl.unit_cost, 0);
    if coalesce(fl.source_type, 'stock') = 'stock' then
      -- matière du stock : par identifiant, sinon par nom ; prix d'achat actuel
      select * into pr from public.products where id = fl.product_id;
      if not found then
        select * into pr from public.products
         where lower(trim(name)) = lower(trim(fl.product_name)) order by created_at limit 1;
      end if;
      if pr.id is not null then
        v_pid := pr.id;
        v_cost := coalesce(nullif(pr.purchase_price, 0), fl.unit_cost, 0);
      else
        v_pid := null;
      end if;
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_pid, 'product_name', fl.product_name, 'quantity_used', v_qty,
      'source_type', coalesce(fl.source_type, 'stock'), 'unit', fl.unit,
      'unit_cost', v_cost, 'line_cost', round(v_qty * v_cost, 2)));
  end loop;
  v := public._create_production(jsonb_build_object(
    'name', f.name,
    'description', 'Production automatique — ' || coalesce(p_label, 'livraison'),
    'date', coalesce(p_date, current_date),
    'fiche_technic_id', f.id,
    'category_id', f.category_id, 'category_name', f.category_name,
    'output_quantity', round(p_qty, 3), 'unit_price', coalesce(f.unit_price, 0),
    'sell_by_unit', coalesce(f.sell_by_unit, false), 'sell_unit', f.sell_unit,
    'used_products', v_lines));
  update public.productions set origin = 'delivery', delivery_id = p_delivery where id = v.id returning * into v;
  return v;
end $$;

-- -----------------------------------------------------------------------------
--  7. CONSTRUCTION D'UN BON DE LIVRAISON (stock prêt + production + facture)
-- -----------------------------------------------------------------------------
create or replace function public._build_delivery(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare d public.command_deliveries; c public.commands; it record; ci public.command_items; rv record;
        v_qty numeric; v_lines jsonb := '[]'::jsonb; v_sale public.sales; pay record;
        v_adv_avail numeric; v_adv numeric; v_cash numeric; v_over numeric;
        v_ready numeric; v_from_ready numeric; v_produced numeric; v_cost numeric; v_live boolean;
begin
  select * into d from public.command_deliveries where id = p_id;
  select * into c from public.commands where id = d.command_id;
  v_live := not coalesce(d.is_historical, false);

  -- une seule ligne par ligne de commande, dans l'ordre de saisie
  for it in
    select nullif(x->>'command_item_id', '')::uuid as item_id,
           coalesce(x->>'product_name', '') as product_name,
           max(x->>'sell_unit') as sell_unit,
           sum(coalesce((x->>'quantity')::numeric, 0)) as qty
      from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) with ordinality as t(x, n)
     group by 1, 2
     order by min(n)
  loop
    v_qty := round(coalesce(it.qty, 0), 3);
    continue when v_qty <= 0;
    select * into ci from public.command_items where id = it.item_id and command_id = c.id;

    -- le produit fini sort du STOCK PRÊT ; le manquant est produit maintenant
    v_from_ready := 0; v_produced := 0; v_cost := 0;
    if ci.fiche_technic_id is not null and v_live then
      v_ready := greatest(0, public.fiche_ready_quantity(ci.fiche_technic_id));
      v_from_ready := least(v_qty, v_ready);
      v_produced := round(v_qty - v_from_ready, 3);
      if v_produced > 0.0005 then
        perform public._auto_produce(ci.fiche_technic_id, v_produced, p_id, d.date, 'BL ' || d.reference);
      else
        v_produced := 0;
      end if;
      v_cost := public._fiche_unit_cost(ci.fiche_technic_id);
    end if;

    insert into public.command_delivery_items (delivery_id, command_item_id, product_name, quantity, sell_unit,
      fiche_technic_id, ready_applied, from_ready, produced_quantity, unit_cost, cost_amount)
    values (p_id, ci.id, coalesce(nullif(it.product_name, ''), ci.product_name, ''), v_qty,
      coalesce(it.sell_unit, ci.sell_unit), ci.fiche_technic_id,
      ci.fiche_technic_id is not null and v_live, v_from_ready, v_produced,
      round(coalesce(v_cost, 0), 4), round(coalesce(v_cost, 0) * v_qty, 2));

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_name', coalesce(nullif(it.product_name, ''), ci.product_name, ''), 'quantity', v_qty,
      'selling_price', coalesce(ci.unit_price, 0), 'base_price', ci.unit_price,
      'fiche_technic_id', ci.fiche_technic_id, 'command_item_id', ci.id,
      'sell_by_unit', coalesce(ci.sell_by_unit, false), 'unit', coalesce(it.sell_unit, ci.sell_unit)));
  end loop;

  -- la facture
  v_sale := public._create_sale(jsonb_build_object(
    'client_id', c.client_id, 'date', d.date, 'bon_number', coalesce(c.bon_number, d.reference),
    'is_historical', d.is_historical, 'tva_enabled', d.tva_enabled, 'tva_rate', d.tva_rate,
    'delivery_id', d.id, 'command_id', c.id, 'products', v_lines, 'paid_amount', 0));

  -- l'argent : acompte de la commande (pas de caisse) + encaissement à la remise (caisse)
  select greatest(0, c.paid_amount - coalesce(sum(advance_applied), 0)) into v_adv_avail
    from public.command_deliveries where command_id = c.id and id <> p_id;
  v_adv := least(coalesce((p->>'advance_applied')::numeric, 0), v_adv_avail, v_sale.final_amount);
  if v_adv > 0.004 then
    insert into public.sale_payments (sale_id, date, amount, description, origin)
    values (v_sale.id, d.date, round(v_adv, 2), 'Acompte de la commande ' || c.reference, 'command_advance');
  end if;
  v_cash := least(coalesce((p->>'cash_paid')::numeric, 0), greatest(0, v_sale.final_amount - greatest(v_adv, 0)));
  if v_cash > 0.004 then
    insert into public.sale_payments (sale_id, date, amount, description)
    values (v_sale.id, d.date, round(v_cash, 2), 'Versement à la livraison ' || d.reference);
  end if;

  update public.command_deliveries set sale_id = v_sale.id, sale_reference = v_sale.reference where id = p_id;

  -- les récupérations déjà faites sur ce bon restent appliquées à la facture refaite
  if exists (select 1 from public.delivery_recoveries where delivery_id = p_id) then
    for rv in select ri.command_item_id, sum(ri.quantity) as q
                from public.delivery_recovery_items ri
                join public.delivery_recoveries r on r.id = ri.recovery_id
               where r.delivery_id = p_id group by 1 loop
      if rv.q > coalesce((select sum(quantity) from public.command_delivery_items
                           where delivery_id = p_id and command_item_id is not distinct from rv.command_item_id), 0) + 0.0005 then
        raise exception 'Ce bon a des récupérations : chaque produit doit rester livré au moins pour la quantité déjà récupérée';
      end if;
    end loop;
    perform public._sync_delivery_sale(p_id);
    -- jamais plus encaissé que ce que le client garde : l'encaissement saisi est ramené
    select greatest(0, paid_amount - final_amount) into v_over from public.sales where id = v_sale.id;
    if v_over > 0.004 then
      for pay in select id, amount from public.sale_payments
                  where sale_id = v_sale.id and origin is null order by created_at desc loop
        exit when v_over <= 0.004;
        if pay.amount <= v_over + 0.004 then
          delete from public.sale_payments where id = pay.id;
          v_over := v_over - pay.amount;
        else
          update public.sale_payments set amount = round(pay.amount - v_over, 2) where id = pay.id;
          v_over := 0;
        end if;
      end loop;
      perform public._sync_delivery_sale(p_id);
    end if;
  end if;

  perform public._recalc_sale(v_sale.id);
  perform public._recalc_command(c.id);
end $$;

-- Avant de refaire la facture d'un bon : les versements du client qui la
-- payaient (« client_payment ») redeviennent son ACOMPTE au lieu de disparaître
-- avec elle ; l'écran les réimpute ensuite sur la nouvelle facture.
create or replace function public._release_sale_allocations(p_sale uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if p_sale is null then return; end if;
  for r in select sp.client_payment_id, sum(sp.amount) as a from public.sale_payments sp
            where sp.sale_id = p_sale and sp.origin = 'client_payment' and sp.client_payment_id is not null
            group by 1 loop
    update public.client_payments set credit_part = credit_part + r.a where id = r.client_payment_id;
    update public.clients set credit_amount = credit_amount + r.a
     where id = (select client_id from public.client_payments where id = r.client_payment_id);
  end loop;
end $$;

-- Modifier un bon depuis l'écran Commandes : tout est défait puis reconstruit.
create or replace function public.update_command_delivery(p_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.command_deliveries; c public.commands; v_tva boolean; v_sale uuid; v_at timestamptz;
begin
  perform public.require_perm(array['clients:edit','sales:edit']);
  select * into d from public.command_deliveries where id = p_id;
  if not found then raise exception 'Bon de livraison introuvable'; end if;
  select * into c from public.commands where id = d.command_id;
  -- défaire : facture, quantités livrées, matières et productions automatiques
  v_sale := d.sale_id;
  perform public._release_sale_allocations(v_sale);
  update public.command_deliveries set sale_id = null where id = p_id;
  if v_sale is not null then delete from public.sales where id = v_sale; end if;
  delete from public.command_delivery_items where delivery_id = p_id;
  delete from public.command_delivery_consumptions where delivery_id = p_id;
  delete from public.productions where delivery_id = p_id;

  v_tva := case when p_payload ? 'tva_enabled' then coalesce((p_payload->>'tva_enabled')::boolean, false) else d.tva_enabled end;
  v_at := coalesce(nullif(p_payload->>'delivered_at', '')::timestamptz, d.delivered_at);
  update public.command_deliveries set
    delivered_at = v_at, date = v_at::date,
    notes = coalesce(p_payload->>'notes', notes),
    driver_name = case when p_payload ? 'driver_name' then p_payload->>'driver_name' else driver_name end,
    driver_plate = case when p_payload ? 'driver_plate' then p_payload->>'driver_plate' else driver_plate end,
    location = case when p_payload ? 'location' then p_payload->>'location' else location end,
    is_historical = c.is_historical, tva_enabled = v_tva,
    tva_rate = case when v_tva then coalesce((p_payload->>'tva_rate')::numeric, nullif(tva_rate, 0), 19) else 0 end
  where id = p_id;
  perform public._build_delivery(p_id, p_payload);
  select * into d from public.command_deliveries where id = p_id;
  return to_jsonb(d);
end $$;

-- -----------------------------------------------------------------------------
--  8. ÉCRAN LIVRAISONS : client → produit → quantité
--     Les quantités sont imputées sur les commandes en cours du client, la plus
--     ancienne d'abord. Un bon par commande touchée.
-- -----------------------------------------------------------------------------
create or replace function public._allocate_client_lines(
  p_client uuid, p_lines jsonb, p_prefer_items uuid[] default '{}', p_prefer_command uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l record; r record; v_need numeric; v_take numeric; v_out jsonb := '[]'::jsonb;
begin
  for l in
    select nullif(x->>'fiche_technic_id', '')::uuid as fiche,
           case when nullif(x->>'fiche_technic_id', '') is null
                then lower(trim(coalesce(x->>'product_name', ''))) end as lname,
           max(coalesce(x->>'product_name', '')) as pname,
           sum(coalesce((x->>'quantity')::numeric, 0)) as qty
      from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality as t(x, n)
     group by 1, 2
     order by min(n)
  loop
    v_need := round(coalesce(l.qty, 0), 3);
    continue when v_need <= 0;
    for r in
      select ci.id, ci.command_id, ci.product_name, ci.sell_unit,
             greatest(0, ci.quantity - ci.cancelled_quantity - ci.delivered_quantity) as left_qty
        from public.command_items ci
        join public.commands cm on cm.id = ci.command_id
       where cm.client_id = p_client and cm.status <> 'cancelled' and not coalesce(cm.is_historical, false)
         and ((l.fiche is not null and (ci.fiche_technic_id = l.fiche
                or (ci.fiche_technic_id is null and lower(trim(ci.product_name)) = lower(trim(l.pname)))))
              or (l.fiche is null and lower(trim(ci.product_name)) = l.lname))
         and ci.quantity - ci.cancelled_quantity - ci.delivered_quantity > 0.0005
       order by (ci.id = any(coalesce(p_prefer_items, '{}'))) desc,
                (cm.id = p_prefer_command) desc nulls last,
                cm.created_at, cm.reference, ci.position
       for update of ci
    loop
      exit when v_need <= 0.0005;
      v_take := round(least(v_need, r.left_qty), 3);
      continue when v_take <= 0;
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'command_id', r.command_id, 'command_item_id', r.id, 'product_name', r.product_name,
        'sell_unit', r.sell_unit, 'quantity', v_take));
      v_need := v_need - v_take;
    end loop;
    if v_need > 0.0005 then
      raise exception 'La quantité de « % » dépasse le reste à livrer des commandes du client (excédent : %)',
        coalesce(nullif(l.pname, ''), (select name from public.fiche_technics where id = l.fiche), '?'), round(v_need, 3);
    end if;
  end loop;
  return v_out;
end $$;

create or replace function public.create_client_delivery(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_alloc jsonb; a jsonb; v_cmds uuid[] := '{}'; v_cmd uuid; c public.commands;
        d public.command_deliveries; v_at timestamptz; v_tva boolean; v_cash numeric; v_items jsonb;
        v_out jsonb := '[]'::jsonb; v_use_adv boolean;
begin
  perform public.require_perm(array['clients:create','sales:create']);
  v_client := nullif(p_payload->>'client_id', '')::uuid;
  if v_client is null or not exists (select 1 from public.clients where id = v_client) then
    raise exception 'Client introuvable';
  end if;
  v_alloc := public._allocate_client_lines(v_client, p_payload->'lines');
  if jsonb_array_length(v_alloc) = 0 then raise exception 'Saisissez au moins une quantité à livrer'; end if;
  for a in select * from jsonb_array_elements(v_alloc) loop
    v_cmd := (a->>'command_id')::uuid;
    if not (v_cmd = any(v_cmds)) then v_cmds := v_cmds || v_cmd; end if;
  end loop;

  v_at := coalesce(nullif(p_payload->>'delivered_at', '')::timestamptz, now());
  v_cash := greatest(0, coalesce((p_payload->>'cash_paid')::numeric, 0));
  v_use_adv := coalesce((p_payload->>'use_advance')::boolean, true);

  foreach v_cmd in array v_cmds loop
    select * into c from public.commands where id = v_cmd;
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_items
      from jsonb_array_elements(v_alloc) x where (x->>'command_id')::uuid = v_cmd;
    v_tva := case when p_payload ? 'tva_enabled' then coalesce((p_payload->>'tva_enabled')::boolean, false)
                  else c.tva_enabled end;
    insert into public.command_deliveries (command_id, date, delivered_at, notes, driver_name, driver_plate,
      location, is_historical, tva_enabled, tva_rate, source)
    values (c.id, v_at::date, v_at, coalesce(p_payload->>'notes', ''),
      coalesce(nullif(p_payload->>'driver_name', ''), c.driver_name),
      coalesce(nullif(p_payload->>'driver_plate', ''), c.driver_plate),
      coalesce(nullif(p_payload->>'location', ''), c.client_address),
      false, v_tva,
      case when v_tva then coalesce((p_payload->>'tva_rate')::numeric, nullif(c.tva_rate, 0), 19) else 0 end,
      'livraison')
    returning * into d;
    perform public._build_delivery(d.id, jsonb_build_object(
      'items', v_items,
      'advance_applied', case when v_use_adv then 999999999999 else 0 end,
      'cash_paid', v_cash));
    select * into d from public.command_deliveries where id = d.id;
    v_cash := greatest(0, v_cash - coalesce(d.cash_paid, 0));
    v_out := v_out || jsonb_build_array(to_jsonb(d));
  end loop;
  return v_out;
end $$;

create or replace function public.update_client_delivery(p_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.command_deliveries; c public.commands; v_client uuid; v_prev uuid[]; v_alloc jsonb;
        v_cmd uuid; v_old_cmd uuid; v_n int; v_sale uuid; v_tva boolean; v_at timestamptz;
begin
  perform public.require_perm(array['clients:edit','sales:edit']);
  select * into d from public.command_deliveries where id = p_id;
  if not found then raise exception 'Bon de livraison introuvable'; end if;
  if coalesce(d.is_historical, false) then
    raise exception 'Une ancienne livraison se modifie depuis l''écran Commandes';
  end if;
  select * into c from public.commands where id = d.command_id;
  v_old_cmd := d.command_id;
  v_client := coalesce(nullif(p_payload->>'client_id', '')::uuid, c.client_id);
  if v_client is null or not exists (select 1 from public.clients where id = v_client) then
    raise exception 'Client introuvable';
  end if;
  if v_client is distinct from c.client_id
     and exists (select 1 from public.delivery_recoveries where delivery_id = p_id) then
    raise exception 'Ce bon a des récupérations : son client ne peut plus être changé';
  end if;
  select coalesce(array_agg(command_item_id), '{}') into v_prev
    from public.command_delivery_items where delivery_id = p_id and command_item_id is not null;

  -- défaire : facture, quantités livrées, matières et productions automatiques
  v_sale := d.sale_id;
  perform public._release_sale_allocations(v_sale);
  update public.command_deliveries set sale_id = null where id = p_id;
  if v_sale is not null then delete from public.sales where id = v_sale; end if;
  delete from public.command_delivery_items where delivery_id = p_id;
  delete from public.command_delivery_consumptions where delivery_id = p_id;
  delete from public.productions where delivery_id = p_id;

  v_alloc := public._allocate_client_lines(v_client, p_payload->'lines', v_prev, d.command_id);
  if jsonb_array_length(v_alloc) = 0 then raise exception 'Saisissez au moins une quantité à livrer'; end if;
  select count(distinct x->>'command_id') into v_n from jsonb_array_elements(v_alloc) x;
  if v_n > 1 then
    raise exception 'Les quantités dépassent le reste d''une seule commande : enregistrez le surplus dans une nouvelle livraison';
  end if;
  v_cmd := (v_alloc->0->>'command_id')::uuid;
  select * into c from public.commands where id = v_cmd;

  v_tva := case when p_payload ? 'tva_enabled' then coalesce((p_payload->>'tva_enabled')::boolean, false) else d.tva_enabled end;
  v_at := coalesce(nullif(p_payload->>'delivered_at', '')::timestamptz, d.delivered_at);
  update public.command_deliveries set
    command_id = c.id, delivered_at = v_at, date = v_at::date,
    notes = coalesce(p_payload->>'notes', notes),
    driver_name = case when p_payload ? 'driver_name' then nullif(p_payload->>'driver_name', '') else driver_name end,
    driver_plate = case when p_payload ? 'driver_plate' then nullif(p_payload->>'driver_plate', '') else driver_plate end,
    location = case when p_payload ? 'location' then nullif(p_payload->>'location', '') else location end,
    tva_enabled = v_tva,
    tva_rate = case when v_tva
                    then coalesce((p_payload->>'tva_rate')::numeric, nullif(tva_rate, 0), nullif(c.tva_rate, 0), 19)
                    else 0 end
  where id = p_id;

  perform public._build_delivery(p_id, jsonb_build_object(
    'items', v_alloc,
    'advance_applied', case when coalesce((p_payload->>'use_advance')::boolean, true) then 999999999999 else 0 end,
    'cash_paid', greatest(0, coalesce((p_payload->>'cash_paid')::numeric, 0))));
  if v_old_cmd is distinct from c.id then perform public._recalc_command(v_old_cmd); end if;
  select * into d from public.command_deliveries where id = p_id;
  return to_jsonb(d);
end $$;

-- -----------------------------------------------------------------------------
--  9. RÉCUPÉRATION D'UN BON : la marchandise revient au stock prêt,
--     la facture baisse et l'argent payé en trop revient au client
-- -----------------------------------------------------------------------------
create or replace function public.trg_recovery_item()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_delivery uuid;
begin
  if tg_op <> 'INSERT' then perform public._recalc_item_delivered(old.command_item_id); end if;
  if tg_op <> 'DELETE' then perform public._recalc_item_delivered(new.command_item_id); end if;
  select delivery_id into v_delivery from public.delivery_recoveries
   where id = coalesce(new.recovery_id, old.recovery_id);
  if v_delivery is not null then perform public._sync_delivery_sale(v_delivery); end if;
  return coalesce(new, old);
end $$;
drop trigger if exists recovery_item_trg on public.delivery_recovery_items;
create trigger recovery_item_trg after insert or update or delete on public.delivery_recovery_items
  for each row execute function public.trg_recovery_item();

-- un remboursement annulé depuis la fiche client n'est plus rendu
create or replace function public.trg_delivery_recovery_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.refund_id is not null and new.refund_id is null then new.refund_amount := 0; end if;
  return new;
end $$;
drop trigger if exists delivery_recovery_before_trg on public.delivery_recoveries;
create trigger delivery_recovery_before_trg before update on public.delivery_recoveries
  for each row execute function public.trg_delivery_recovery_before();

-- l'argent libéré par la facture devient l'ACOMPTE du client (le remboursement
-- en espèces, s'il y en a un, le lui rend ensuite par une sortie de caisse)
create or replace function public.trg_delivery_recovery()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_old numeric := 0; v_new numeric := 0; v_client uuid;
begin
  if tg_op <> 'INSERT' then v_old := coalesce(old.excess_amount, 0); end if;
  if tg_op <> 'DELETE' then v_new := coalesce(new.excess_amount, 0); end if;
  v_client := case when tg_op = 'DELETE' then old.client_id else new.client_id end;
  if v_client is not null and abs(v_new - v_old) > 0.004 then
    update public.clients set credit_amount = credit_amount + (v_new - v_old) where id = v_client;
  end if;
  if tg_op = 'DELETE' then
    if old.refund_id is not null then
      delete from public.party_credit_refunds where id = old.refund_id;
    end if;
    perform public._sync_delivery_sale(old.delivery_id);
    return old;
  end if;
  perform public._sync_delivery_sale(new.delivery_id);
  return new;
end $$;
drop trigger if exists delivery_recovery_trg on public.delivery_recoveries;
create trigger delivery_recovery_trg after insert or update or delete on public.delivery_recoveries
  for each row execute function public.trg_delivery_recovery();

create or replace function public.create_delivery_recovery(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.command_deliveries; c public.commands; s public.sales; r public.delivery_recoveries;
        it jsonb; di record; v_q numeric; v_avail numeric; v_price numeric; v_fiche uuid; v_item uuid;
        v_ht numeric; v_tva numeric; v_ttc numeric; v_paid numeric; v_excess numeric := 0; v_refund numeric;
        v_at timestamptz; v_ref public.party_credit_refunds;
begin
  perform public.require_perm(array['clients:edit','sales:edit','clients:create']);
  select * into d from public.command_deliveries where id = nullif(p_payload->>'delivery_id', '')::uuid;
  if not found then raise exception 'Bon de livraison introuvable'; end if;
  select * into c from public.commands where id = d.command_id;
  v_at := coalesce(nullif(p_payload->>'recovered_at', '')::timestamptz, now());

  insert into public.delivery_recoveries (delivery_id, command_id, client_id, client_name, date, recovered_at,
    reason, tva_enabled, tva_rate, refund_method, is_historical)
  values (d.id, c.id, c.client_id, c.client_name, v_at::date, v_at, coalesce(p_payload->>'reason', ''),
    d.tva_enabled, d.tva_rate, coalesce(nullif(p_payload->>'refund_method', ''), 'especes'),
    coalesce(d.is_historical, false))
  returning * into r;

  for it in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) loop
    v_q := round(coalesce((it->>'quantity')::numeric, 0), 3);
    continue when v_q <= 0;
    v_item := nullif(it->>'command_item_id', '')::uuid;
    select max(x.product_name) as product_name, max(x.sell_unit) as sell_unit, sum(x.quantity) as qty,
           (array_agg(x.fiche_technic_id))[1] as fiche, max(x.unit_cost) as unit_cost
      into di
      from public.command_delivery_items x
     where x.delivery_id = d.id and x.command_item_id = v_item;
    if di.qty is null then raise exception 'Ce produit ne figure pas sur le bon %', d.reference; end if;
    v_avail := di.qty - coalesce((select sum(ri.quantity) from public.delivery_recovery_items ri
                                    join public.delivery_recoveries rr on rr.id = ri.recovery_id
                                   where rr.delivery_id = d.id and ri.command_item_id = v_item), 0);
    if v_q > v_avail + 0.0005 then
      raise exception 'Quantité à récupérer de « % » supérieure à la quantité livrée restante (% au plus)',
        di.product_name, round(v_avail, 3);
    end if;
    v_price := coalesce(
      (select selling_price from public.sale_lines where sale_id = d.sale_id and command_item_id = v_item limit 1),
      (select unit_price from public.command_items where id = v_item), 0);
    v_fiche := coalesce(di.fiche, (select fiche_technic_id from public.command_items where id = v_item));
    insert into public.delivery_recovery_items (recovery_id, command_item_id, fiche_technic_id, product_name,
      quantity, unit_price, amount, unit, ready_applied, unit_cost, cost_amount)
    values (r.id, v_item, v_fiche, di.product_name, v_q, v_price, round(v_q * v_price, 2), di.sell_unit,
      v_fiche is not null and not coalesce(d.is_historical, false),
      coalesce(di.unit_cost, 0), round(v_q * coalesce(di.unit_cost, 0), 2));
  end loop;

  select coalesce(sum(amount), 0) into v_ht from public.delivery_recovery_items where recovery_id = r.id;
  if v_ht <= 0 and not exists (select 1 from public.delivery_recovery_items where recovery_id = r.id) then
    raise exception 'Saisissez au moins une quantité à récupérer';
  end if;
  v_tva := case when r.tva_enabled then round(v_ht * r.tva_rate) / 100 else 0 end;
  v_ttc := round(v_ht + v_tva, 2);

  -- la facture vient d'être ramenée à la marchandise gardée par le client :
  -- ce qu'il avait payé au-delà lui revient
  select * into s from public.sales where id = d.sale_id;
  if found then
    select coalesce(sum(amount), 0) into v_paid from public.sale_payments where sale_id = s.id;
    v_paid := v_paid - least(coalesce(s.refunded_amount, 0), v_paid);
    v_excess := greatest(0, round(v_paid - s.final_amount, 2));
  end if;
  if coalesce(d.is_historical, false) then v_excess := 0; end if;

  update public.delivery_recoveries set total_ht = round(v_ht, 2), tva_amount = v_tva, total_ttc = v_ttc,
    excess_amount = v_excess
  where id = r.id;

  v_refund := case when coalesce(p_payload->>'refund_mode', 'cash') = 'cash'
                   then least(v_excess, greatest(0, coalesce((p_payload->>'refund_amount')::numeric, v_excess)))
                   else 0 end;
  if v_refund > 0.004 and c.client_id is not null then
    insert into public.party_credit_refunds (party_type, party_id, party_name, amount, date, refunded_at, notes, method)
    values ('client', c.client_id, c.client_name, round(v_refund, 2), v_at::date, v_at,
            'Remboursement — récupération ' || r.reference || ' (BL ' || d.reference || ')', r.refund_method)
    returning * into v_ref;
    update public.delivery_recoveries set refund_id = v_ref.id, refund_amount = v_ref.amount where id = r.id;
  end if;

  select * into r from public.delivery_recoveries where id = r.id;
  return to_jsonb(r);
end $$;

-- -----------------------------------------------------------------------------
--  10. FACTURES NON COMPTABILISÉES (aucun effet sur les données)
-- -----------------------------------------------------------------------------
create or replace function public.save_free_invoice(p_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.free_invoices; l jsonb; v_pos int := 0; v_ht numeric; v_base numeric; v_tva numeric;
        v_final numeric; v_paid numeric; v_rate numeric; v_on boolean; v_red numeric; v_q numeric; v_p numeric;
begin
  if p_id is null then
    perform public.require_perm(array['sales:create','clients:create']);
    insert into public.free_invoices (client_name) values ('') returning * into v;
  else
    perform public.require_perm(array['sales:edit','clients:edit']);
    select * into v from public.free_invoices where id = p_id;
    if not found then raise exception 'Facture introuvable'; end if;
  end if;

  delete from public.free_invoice_lines where invoice_id = v.id;
  for l in select * from jsonb_array_elements(coalesce(p_payload->'lines', '[]'::jsonb)) loop
    v_q := coalesce((l->>'quantity')::numeric, 0);
    v_p := coalesce((l->>'unit_price')::numeric, 0);
    continue when coalesce(trim(l->>'product_name'), '') = '' and v_q = 0;
    insert into public.free_invoice_lines (invoice_id, position, fiche_technic_id, product_name, description,
      quantity, unit, unit_price, total_price)
    values (v.id, v_pos, nullif(l->>'fiche_technic_id', '')::uuid, coalesce(l->>'product_name', ''),
      coalesce(l->>'description', ''), v_q, nullif(l->>'unit', ''), v_p, round(v_q * v_p, 2));
    v_pos := v_pos + 1;
  end loop;

  select coalesce(sum(total_price), 0) into v_ht from public.free_invoice_lines where invoice_id = v.id;
  v_on := coalesce((p_payload->>'tva_enabled')::boolean, false);
  v_rate := case when v_on then coalesce((p_payload->>'tva_rate')::numeric, 19) else 0 end;
  v_red := greatest(0, coalesce((p_payload->>'reduction')::numeric, 0));
  v_base := greatest(0, round(v_ht, 2) - v_red);
  v_tva := case when v_on then round(v_base * v_rate) / 100 else 0 end;
  v_final := round(v_base + v_tva, 2);
  v_paid := least(greatest(0, coalesce((p_payload->>'paid_amount')::numeric, 0)), v_final);

  update public.free_invoices set
    doc_type = coalesce(nullif(p_payload->>'doc_type', ''), 'facture'),
    client_id = case when nullif(p_payload->>'client_id', '') is not null
                      and exists (select 1 from public.clients where id = (p_payload->>'client_id')::uuid)
                     then (p_payload->>'client_id')::uuid end,
    client_name = coalesce(p_payload->>'client_name', ''),
    client_phone = nullif(p_payload->>'client_phone', ''),
    client_address = nullif(p_payload->>'client_address', ''),
    client_rc = nullif(p_payload->>'client_rc', ''),
    client_nif = nullif(p_payload->>'client_nif', ''),
    client_nis = nullif(p_payload->>'client_nis', ''),
    client_article = nullif(p_payload->>'client_article', ''),
    date = coalesce(nullif(p_payload->>'date', '')::date, date),
    location = nullif(p_payload->>'location', ''),
    driver_name = nullif(p_payload->>'driver_name', ''),
    driver_plate = nullif(p_payload->>'driver_plate', ''),
    tva_enabled = v_on, tva_rate = v_rate, reduction = v_red,
    total_amount = round(v_ht, 2), tva_amount = v_tva, final_amount = v_final,
    paid_amount = v_paid, rest_amount = greatest(0, v_final - v_paid),
    payment_mode = nullif(p_payload->>'payment_mode', ''),
    notes = coalesce(p_payload->>'notes', '')
  where id = v.id
  returning * into v;
  return to_jsonb(v);
end $$;

-- -----------------------------------------------------------------------------
--  11. FICHE TECHNIQUE : image du produit
-- -----------------------------------------------------------------------------
create or replace function public._write_fiche(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare u jsonb;
begin
  update public.fiche_technics set
    name = coalesce(p->>'name', name), category_id = nullif(p->>'category_id', '')::uuid,
    category_name = p->>'category_name', description = coalesce(p->>'description', ''),
    sell_by_unit = coalesce((p->>'sell_by_unit')::boolean, false), sell_unit = p->>'sell_unit',
    usable_in_production = coalesce((p->>'usable_in_production')::boolean, false), product_unit = p->>'product_unit',
    output_quantity = coalesce((p->>'output_quantity')::numeric, 1), unit_price = coalesce((p->>'unit_price')::numeric, 0),
    total_cost = coalesce((p->>'total_cost')::numeric, 0), cost_per_unit = coalesce((p->>'cost_per_unit')::numeric, 0),
    total_value = coalesce((p->>'total_value')::numeric, 0), gains_per_unit = coalesce((p->>'gains_per_unit')::numeric, 0),
    total_gains = coalesce((p->>'total_gains')::numeric, 0),
    image_url = case when p ? 'image_url' then nullif(p->>'image_url', '') else image_url end
  where id = p_id;
  delete from public.fiche_technic_lines where fiche_technic_id = p_id;
  for u in select * from jsonb_array_elements(coalesce(p->'used_products', '[]'::jsonb)) loop
    insert into public.fiche_technic_lines (fiche_technic_id, product_id, product_name, quantity_used,
      source_type, unit, unit_cost, line_cost)
    values (p_id, nullif(u->>'product_id', '')::uuid, coalesce(u->>'product_name', ''),
      coalesce((u->>'quantity_used')::numeric, 0), coalesce(u->>'source_type', 'stock'), u->>'unit',
      coalesce((u->>'unit_cost')::numeric, 0), coalesce((u->>'line_cost')::numeric, 0));
  end loop;
end $$;

-- Mettre au comptoir : jamais plus que le stock prêt (une partie a pu être livrée)
create or replace function public._transfer_to_comptoir(p_production_id uuid, p_quantity numeric)
returns public.comptoir_items language plpgsql security definer set search_path = public as $$
declare pr public.productions; v public.comptoir_items; v_ready numeric;
begin
  select * into pr from public.productions where id = p_production_id;
  if not found then raise exception 'Production introuvable'; end if;
  if p_quantity <= 0 then raise exception 'Quantité invalide'; end if;
  if pr.sent_to_comptoir + p_quantity > pr.output_quantity + 0.0005 then
    raise exception 'La quantité dépasse le reste en stock de production';
  end if;
  if pr.fiche_technic_id is not null and pr.origin <> 'pos' then
    v_ready := public.fiche_ready_quantity(pr.fiche_technic_id);
    if p_quantity > v_ready + 0.0005 then
      raise exception 'Stock prêt insuffisant : une partie de ce produit a déjà été livrée (prêt : %)', greatest(0, v_ready);
    end if;
  end if;
  insert into public.comptoir_items (production_id, product_name, description, quantity, initial_quantity,
    unit_price, date, category_id, category_name, sell_by_unit, unit)
  values (pr.id, pr.name, pr.description, p_quantity, p_quantity, pr.unit_price, current_date,
    pr.category_id, pr.category_name, pr.sell_by_unit, pr.sell_unit)
  returning * into v;
  return v;
end $$;

-- -----------------------------------------------------------------------------
--  12. CORBEILLE, SÉCURITÉ, DROITS
-- -----------------------------------------------------------------------------
create or replace function public._table_module(p_table text)
returns text language sql immutable as $$
  select case
    when p_table in ('products','marques','categories','units') then 'stock'
    when p_table in ('purchases','purchase_lines','purchase_payments') then 'purchase'
    when p_table in ('productions','production_categories','fiche_technics','fiche_categories') then 'production'
    when p_table in ('comptoir_items','destructions') then 'comptoir'
    when p_table in ('sales','sale_lines','sale_payments','free_invoices','free_invoice_lines') then 'sales'
    when p_table in ('clients','commands','command_items','command_payments','command_deliveries','client_debts',
                     'client_payments','party_old_debts','party_credit_refunds','command_adjustments',
                     'delivery_recoveries','delivery_recovery_items') then 'clients'
    when p_table in ('suppliers','supplier_payments') then 'suppliers'
    when p_table in ('workers','worker_acomptes','worker_absences','worker_payments','worker_overtimes','roles') then 'workers'
    when p_table in ('expenses','expense_categories','purchase_orders') then 'expenses'
    when p_table in ('caisse_transactions','caisse_categories','caisse_reports') then 'caisse'
    else 'settings' end
$$;

do $$
declare t text;
begin
  foreach t in array array['delivery_recoveries','delivery_recovery_items','free_invoices','free_invoice_lines'] loop
    execute format('drop trigger if exists zz_recycle on public.%I', t);
    execute format('create trigger zz_recycle after delete on public.%I for each row execute function public.trg_recycle_capture()', t);
  end loop;
end $$;

do $$
declare rec record; r text[]; w text[];
begin
  for rec in
    select * from (values
      ('delivery_recoveries',     '{clients,sales,pos,caisse,production,stock,dashboard,reports}', '{clients,sales}'),
      ('delivery_recovery_items', '{clients,sales,pos,caisse,production,stock,dashboard,reports}', '{clients,sales}'),
      ('free_invoices',           '{sales,clients,pos,dashboard,reports}', '{sales,clients}'),
      ('free_invoice_lines',      '{sales,clients,pos,dashboard,reports}', '{sales,clients}')
    ) as t(tbl, rd, wr)
  loop
    r := rec.rd::text[]; w := rec.wr::text[];
    execute format('alter table public.%I enable row level security', rec.tbl);
    execute format('drop policy if exists p_select on public.%I', rec.tbl);
    execute format('drop policy if exists p_insert on public.%I', rec.tbl);
    execute format('drop policy if exists p_update on public.%I', rec.tbl);
    execute format('drop policy if exists p_delete on public.%I', rec.tbl);
    execute format('create policy p_select on public.%I for select to authenticated using (public.can_view_any(%L::text[]))', rec.tbl, r);
    execute format('create policy p_insert on public.%I for insert to authenticated with check (public.has_any_perm(%L::text[], ''create''))', rec.tbl, w);
    execute format('create policy p_update on public.%I for update to authenticated using (public.has_any_perm(%L::text[], ''edit'')) with check (public.has_any_perm(%L::text[], ''edit''))', rec.tbl, w, w);
    execute format('create policy p_delete on public.%I for delete to authenticated using (public.has_any_perm(%L::text[], ''delete''))', rec.tbl, w);
  end loop;
end $$;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- les fonctions internes (_…) et de déclencheur (trg_…) restent hors de l'API
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like '\_%' or p.proname like 'trg\_%')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
grant execute on function public.fiche_ready_quantity(uuid) to authenticated;

-- -----------------------------------------------------------------------------
--  13. FACULTATIF — rattacher les productions manuelles EXISTANTES à leur fiche
-- -----------------------------------------------------------------------------
--  Les productions lancées AVANT cette mise à jour ne sont reliées à aucune
--  fiche technique : elles ne comptent donc pas dans le « stock prêt ». Si leur
--  reste (quantité produite − envoyé au comptoir) est réellement en attente de
--  livraison, retirez les deux tirets devant les lignes ci-dessous puis
--  relancez ce bloc. Sinon, laissez-le tel quel.
--
-- update public.productions p set fiche_technic_id = f.id
--   from public.fiche_technics f
--  where p.fiche_technic_id is null and p.origin = 'manual'
--    and lower(trim(p.name)) = lower(trim(f.name))
--    and (select count(*) from public.fiche_technics f2 where lower(trim(f2.name)) = lower(trim(f.name))) = 1;

notify pgrst, 'reload schema';


-- =============================================================================
--  08 — SITE WEB : offres, contacts, réglages, textes, commandes web,
--       comptes de connexion des clients
-- -----------------------------------------------------------------------------
--  À exécuter UNE FOIS sur une base existante (parties 01 → 07 déjà en place).
--  Le script est rejouable : chaque objet est créé « if not exists » ou remplacé.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1. COLONNES AJOUTÉES
-- -----------------------------------------------------------------------------
-- Présentation d'un produit (fiche technique) sur le site : nom, description,
-- prix et image propres au site (vides = ceux de la fiche) + masquage.
alter table public.fiche_technics add column if not exists web_name text;
alter table public.fiche_technics add column if not exists web_description text;
alter table public.fiche_technics add column if not exists web_price numeric(14,2);
alter table public.fiche_technics add column if not exists web_image_url text;
alter table public.fiche_technics add column if not exists web_hidden boolean not null default false;

-- Compte de connexion au site d'un client (ligne de auth.users, sans profil :
-- le client ne peut PAS ouvrir l'application de gestion).
alter table public.clients add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
alter table public.clients add column if not exists login_email text;
create unique index if not exists clients_auth_user_uidx on public.clients(auth_user_id) where auth_user_id is not null;

-- -----------------------------------------------------------------------------
--  2. TABLES
-- -----------------------------------------------------------------------------
create table if not exists public.website_settings (
  id boolean primary key default true check (id),
  site_name text default '',
  site_description text default '',
  about_text text default '',
  background_url text,
  favicon_url text,
  is_public boolean not null default true,
  facebook text, instagram text, tiktok text, whatsapp text,
  phone text, phone2 text, email text, address text,
  updated_at timestamptz default now()
);
insert into public.website_settings (id) values (true) on conflict do nothing;

create table if not exists public.website_texts (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  content text not null default '',
  location text not null default 'landing' check (location in ('landing','order','contacts','offers')),
  position int not null default 0,
  created_at timestamptz not null default now()
);

create sequence if not exists public.website_order_ref_seq;
create table if not exists public.website_orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null default ('WEB-' || lpad(nextval('public.website_order_ref_seq')::text, 6, '0')),
  client_id uuid references public.clients(id) on delete set null,          -- client connecté / affecté
  detected_client_id uuid references public.clients(id) on delete set null, -- trouvé par téléphone
  auth_user_id uuid,
  client_name text not null default '',
  client_phone text default '',
  client_address text default '',
  client_note text default '',
  rc text, nif text, nis text, article text,
  notes text default '',
  total_amount numeric(14,2) not null default 0,
  status text not null default 'pending' check (status in ('pending','accepted','cancelled')),
  command_id uuid references public.commands(id) on delete set null,
  cancel_reason text,
  accepted_at timestamptz,
  cancelled_at timestamptz,
  handled_by text,
  created_at timestamptz not null default now()
);
create index if not exists website_orders_client_idx on public.website_orders(client_id);
create index if not exists website_orders_status_idx on public.website_orders(status);

create table if not exists public.website_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.website_orders(id) on delete cascade,
  position int not null default 0,
  fiche_technic_id uuid references public.fiche_technics(id) on delete set null,
  product_name text not null,
  quantity numeric(14,3) not null default 0,
  unit_price numeric(14,2) not null default 0,
  total_price numeric(14,2) not null default 0,
  sell_unit text
);
create index if not exists website_order_items_order_idx on public.website_order_items(order_id);

-- -----------------------------------------------------------------------------
--  3. SÉCURITÉ (RLS)
-- -----------------------------------------------------------------------------
-- réglages + textes : lus par tout le monde (le site public), écrits par
-- l'administrateur ou un employé ayant le module « website ».
alter table public.website_settings enable row level security;
drop policy if exists ws_select on public.website_settings;
drop policy if exists ws_insert on public.website_settings;
drop policy if exists ws_update on public.website_settings;
create policy ws_select on public.website_settings for select to anon, authenticated using (true);
create policy ws_insert on public.website_settings for insert to authenticated
  with check (public.has_any_perm('{website,settings}'::text[], 'edit'));
create policy ws_update on public.website_settings for update to authenticated
  using (public.has_any_perm('{website,settings}'::text[], 'edit'))
  with check (public.has_any_perm('{website,settings}'::text[], 'edit'));

alter table public.website_texts enable row level security;
drop policy if exists wt_select on public.website_texts;
drop policy if exists wt_insert on public.website_texts;
drop policy if exists wt_update on public.website_texts;
drop policy if exists wt_delete on public.website_texts;
create policy wt_select on public.website_texts for select to anon, authenticated using (true);
create policy wt_insert on public.website_texts for insert to authenticated
  with check (public.has_any_perm('{website,settings}'::text[], 'create'));
create policy wt_update on public.website_texts for update to authenticated
  using (public.has_any_perm('{website,settings}'::text[], 'edit'))
  with check (public.has_any_perm('{website,settings}'::text[], 'edit'));
create policy wt_delete on public.website_texts for delete to authenticated
  using (public.has_any_perm('{website,settings}'::text[], 'delete'));

-- commandes web : le personnel (module website ou clients) les gère ; un client
-- connecté au site lit SES commandes. Création uniquement par website_place_order().
alter table public.website_orders enable row level security;
alter table public.website_order_items enable row level security;
drop policy if exists wo_select on public.website_orders;
drop policy if exists wo_update on public.website_orders;
drop policy if exists wo_delete on public.website_orders;
create policy wo_select on public.website_orders for select to authenticated
  using (public.can_view_any('{website,clients,dashboard,reports}'::text[]) or auth_user_id = auth.uid());
create policy wo_update on public.website_orders for update to authenticated
  using (public.has_any_perm('{website,clients}'::text[], 'edit'))
  with check (public.has_any_perm('{website,clients}'::text[], 'edit'));
create policy wo_delete on public.website_orders for delete to authenticated
  using (public.has_any_perm('{website,clients}'::text[], 'delete'));

drop policy if exists woi_select on public.website_order_items;
drop policy if exists woi_write on public.website_order_items;
create policy woi_select on public.website_order_items for select to authenticated
  using (exists (select 1 from public.website_orders o where o.id = order_id
                 and (public.can_view_any('{website,clients,dashboard,reports}'::text[]) or o.auth_user_id = auth.uid())));
create policy woi_write on public.website_order_items for all to authenticated
  using (public.has_any_perm('{website,clients}'::text[], 'edit'))
  with check (public.has_any_perm('{website,clients}'::text[], 'edit'));

grant select on public.website_settings, public.website_texts to anon;
grant select, insert, update, delete on public.website_settings, public.website_texts,
  public.website_orders, public.website_order_items to authenticated;
grant usage, select on sequence public.website_order_ref_seq to authenticated;

-- -----------------------------------------------------------------------------
--  4. FONCTIONS DU SITE (appelables sans connexion)
-- -----------------------------------------------------------------------------
create or replace function public._phone_digits(p text)
returns text language sql immutable as $$
  select right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 9)
$$;

/** Client lié au compte connecté (null pour un visiteur ou un employé). */
create or replace function public.website_current_client()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.clients where auth_user_id = auth.uid() and auth.uid() is not null limit 1
$$;

/** Client existant dont le téléphone correspond (9 derniers chiffres). */
create or replace function public._website_detect_client(p_phone text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.clients
  where length(public._phone_digits(p_phone)) >= 8
    and public._phone_digits(phone) = public._phone_digits(p_phone)
  order by created_at limit 1
$$;

/**
 * Tout ce que le site affiche, en un appel : réglages, société, textes,
 * catalogue et client connecté. Site privé : sans connexion, seuls les
 * réglages (nom, logo, fond) sont renvoyés pour la page de connexion.
 */
create or replace function public.website_public()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.website_settings; st public.store_settings; v_client uuid; v_staff boolean; v_open boolean;
begin
  select * into s from public.website_settings where id;
  select * into st from public.store_settings where id;
  v_client := public.website_current_client();
  v_staff := auth.uid() is not null and exists (select 1 from public.profiles where id = auth.uid());
  v_open := coalesce(s.is_public, true) or v_client is not null or v_staff;
  return jsonb_build_object(
    'settings', jsonb_build_object(
      'site_name', coalesce(nullif(s.site_name, ''), st.name, ''),
      'site_description', coalesce(nullif(s.site_description, ''), st.description, ''),
      'about_text', case when v_open then coalesce(s.about_text, '') else '' end,
      'background_url', s.background_url, 'favicon_url', s.favicon_url,
      'is_public', coalesce(s.is_public, true),
      'company_name', coalesce(st.name, ''), 'logo', st.logo,
      'facebook', s.facebook, 'instagram', s.instagram, 'tiktok', s.tiktok, 'whatsapp', s.whatsapp,
      'phone', coalesce(nullif(s.phone, ''), st.phone), 'phone2', s.phone2,
      'email', coalesce(nullif(s.email, ''), st.email),
      'address', coalesce(nullif(s.address, ''), st.address)
    ),
    'open', v_open,
    'texts', case when v_open then coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'content', t.content, 'location', t.location) order by t.position, t.created_at)
      from public.website_texts t), '[]'::jsonb) else '[]'::jsonb end,
    'products', case when v_open then coalesce((select jsonb_agg(jsonb_build_object(
        'id', f.id,
        'name', coalesce(nullif(f.web_name, ''), f.name),
        'description', coalesce(nullif(f.web_description, ''), f.description, ''),
        'price', coalesce(f.web_price, f.unit_price, 0),
        'image', coalesce(nullif(f.web_image_url, ''), nullif(f.image_url, '')),
        'category', coalesce(f.category_name, ''),
        'unit', coalesce(f.sell_unit, f.product_unit, '')) order by coalesce(nullif(f.web_name, ''), f.name))
      from public.fiche_technics f where not coalesce(f.web_hidden, false)), '[]'::jsonb) else '[]'::jsonb end,
    'client', case when v_client is null then null else (
      select jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'address', c.address, 'email', c.login_email)
      from public.clients c where c.id = v_client) end
  );
end $$;

/**
 * Passer une commande depuis le site. Les prix sont relus dans le catalogue
 * (jamais ceux envoyés par le navigateur).
 */
create or replace function public.website_place_order(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.website_settings; v_client uuid; c public.clients; o public.website_orders;
        it jsonb; f public.fiche_technics; v_q numeric; v_price numeric; v_pos int := 0; v_total numeric := 0;
begin
  select * into s from public.website_settings where id;
  v_client := public.website_current_client();
  if not coalesce(s.is_public, true) and v_client is null then
    raise exception 'Connectez-vous pour passer une commande';
  end if;
  if jsonb_array_length(coalesce(p_payload->'items', '[]'::jsonb)) = 0 then
    raise exception 'Le panier est vide';
  end if;

  if v_client is not null then
    select * into c from public.clients where id = v_client;
    insert into public.website_orders (client_id, auth_user_id, client_name, client_phone, client_address, notes)
    values (c.id, auth.uid(), c.name, coalesce(c.phone, ''), coalesce(nullif(p_payload->>'client_address', ''), c.address, ''),
            coalesce(p_payload->>'notes', ''))
    returning * into o;
  else
    if coalesce(trim(p_payload->>'client_name'), '') = '' or coalesce(trim(p_payload->>'client_phone'), '') = '' then
      raise exception 'Nom et téléphone obligatoires';
    end if;
    insert into public.website_orders (detected_client_id, client_name, client_phone, client_address, client_note,
      rc, nif, nis, article, notes)
    values (public._website_detect_client(p_payload->>'client_phone'),
      left(trim(p_payload->>'client_name'), 200), left(trim(p_payload->>'client_phone'), 40),
      left(coalesce(p_payload->>'client_address', ''), 400), left(coalesce(p_payload->>'client_note', ''), 1000),
      nullif(p_payload->>'rc', ''), nullif(p_payload->>'nif', ''), nullif(p_payload->>'nis', ''),
      nullif(p_payload->>'article', ''), left(coalesce(p_payload->>'notes', ''), 2000))
    returning * into o;
  end if;

  for it in select * from jsonb_array_elements(p_payload->'items') loop
    select * into f from public.fiche_technics where id = (it->>'id')::uuid and not coalesce(web_hidden, false);
    if not found then continue; end if;
    v_q := greatest(coalesce((it->>'quantity')::numeric, 0), 0);
    if v_q <= 0 then continue; end if;
    v_price := coalesce(f.web_price, f.unit_price, 0);
    insert into public.website_order_items (order_id, position, fiche_technic_id, product_name, quantity, unit_price, total_price, sell_unit)
    values (o.id, v_pos, f.id, coalesce(nullif(f.web_name, ''), f.name), v_q, v_price, round(v_q * v_price, 2),
            coalesce(f.sell_unit, f.product_unit));
    v_pos := v_pos + 1; v_total := v_total + round(v_q * v_price, 2);
  end loop;
  if v_pos = 0 then raise exception 'Aucun produit valide dans le panier'; end if;
  update public.website_orders set total_amount = v_total where id = o.id;
  return jsonb_build_object('id', o.id, 'reference', o.reference, 'total', v_total);
end $$;

/** Commandes du client connecté (page « Mes commandes » du site). */
create or replace function public.website_my_orders()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id, 'reference', o.reference, 'status', o.status, 'total', o.total_amount, 'created_at', o.created_at)
    order by o.created_at desc), '[]'::jsonb)
  from public.website_orders o
  where auth.uid() is not null and (o.auth_user_id = auth.uid() or o.client_id = public.website_current_client())
$$;

-- -----------------------------------------------------------------------------
--  5. FONCTIONS DE GESTION (application)
-- -----------------------------------------------------------------------------
/** Crée ou modifie l'accès au site d'un client (mot de passe vide = inchangé). */
create or replace function public.admin_set_client_account(p_client_id uuid, p_email text, p_password text default null)
returns uuid language plpgsql security definer set search_path = public, auth, extensions as $$
declare c public.clients; v_uid uuid; v_email text := lower(trim(p_email));
begin
  perform public.require_perm(array['clients:create','clients:edit','website:edit']);
  select * into c from public.clients where id = p_client_id;
  if not found then raise exception 'Client introuvable'; end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail invalide'; end if;
  if exists (select 1 from auth.users where lower(email) = v_email and id is distinct from c.auth_user_id) then
    raise exception 'Cet e-mail est déjà utilisé par un autre compte';
  end if;

  if c.auth_user_id is not null and exists (select 1 from auth.users where id = c.auth_user_id) then
    v_uid := c.auth_user_id;
    update auth.users set email = v_email,
           encrypted_password = case when coalesce(p_password, '') <> '' then crypt(p_password, gen_salt('bf')) else encrypted_password end,
           email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
     where id = v_uid;
    update auth.identities set identity_data = identity_data || jsonb_build_object('email', v_email)
     where user_id = v_uid and provider = 'email';
    if coalesce(p_password, '') <> '' and length(p_password) < 6 then
      raise exception 'Le mot de passe doit contenir au moins 6 caractères';
    end if;
  else
    if length(coalesce(p_password, '')) < 6 then
      raise exception 'Le mot de passe doit contenir au moins 6 caractères';
    end if;
    v_uid := public._create_auth_user(v_email, p_password,
               jsonb_build_object('full_name', c.name, 'role', 'client', 'client_id', c.id));
  end if;
  update public.clients set auth_user_id = v_uid, login_email = v_email where id = p_client_id;
  return v_uid;
end $$;

/** Supprime l'accès au site d'un client (le client lui-même est conservé). */
create or replace function public.admin_remove_client_account(p_client_id uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid;
begin
  perform public.require_perm(array['clients:edit','website:edit']);
  select auth_user_id into v_uid from public.clients where id = p_client_id;
  update public.clients set auth_user_id = null, login_email = null where id = p_client_id;
  if v_uid is not null and not exists (select 1 from public.profiles where id = v_uid) then
    delete from auth.users where id = v_uid;
  end if;
end $$;

/** Modifie une commande web en attente (client + lignes). */
create or replace function public.website_update_order(p_id uuid, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare o public.website_orders; it jsonb; v_pos int := 0; v_total numeric := 0; v_q numeric; v_p numeric;
begin
  perform public.require_perm(array['website:edit','clients:edit']);
  select * into o from public.website_orders where id = p_id;
  if not found then raise exception 'Commande introuvable'; end if;
  if o.status <> 'pending' then raise exception 'Seule une commande en attente peut être modifiée'; end if;
  update public.website_orders set
    client_id = nullif(p_payload->>'client_id', '')::uuid,
    client_name = coalesce(p_payload->>'client_name', client_name),
    client_phone = coalesce(p_payload->>'client_phone', client_phone),
    client_address = coalesce(p_payload->>'client_address', client_address),
    client_note = coalesce(p_payload->>'client_note', client_note),
    rc = nullif(p_payload->>'rc', ''), nif = nullif(p_payload->>'nif', ''),
    nis = nullif(p_payload->>'nis', ''), article = nullif(p_payload->>'article', ''),
    notes = coalesce(p_payload->>'notes', notes),
    detected_client_id = public._website_detect_client(coalesce(p_payload->>'client_phone', client_phone))
  where id = p_id;
  if p_payload ? 'items' then
    delete from public.website_order_items where order_id = p_id;
    for it in select * from jsonb_array_elements(p_payload->'items') loop
      v_q := coalesce((it->>'quantity')::numeric, 0); v_p := coalesce((it->>'unit_price')::numeric, 0);
      if v_q <= 0 then continue; end if;
      insert into public.website_order_items (order_id, position, fiche_technic_id, product_name, quantity, unit_price, total_price, sell_unit)
      values (p_id, v_pos, nullif(it->>'fiche_technic_id', '')::uuid, it->>'product_name', v_q, v_p, round(v_q * v_p, 2), it->>'sell_unit');
      v_pos := v_pos + 1; v_total := v_total + round(v_q * v_p, 2);
    end loop;
    if v_pos = 0 then raise exception 'La commande doit contenir au moins un produit'; end if;
    update public.website_orders set total_amount = v_total where id = p_id;
  end if;
end $$;

/**
 * ACCEPTER : la commande web devient une commande normale (écran Commandes),
 * donc s'ajoute aux totaux commandés par produit. Le client est, dans l'ordre :
 * celui choisi, celui du compte connecté, celui détecté par téléphone, sinon
 * il est CRÉÉ automatiquement.
 */
create or replace function public.website_accept_order(p_id uuid, p_client_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.website_orders; c public.clients; v_client uuid; v_cmd jsonb; v_created boolean := false;
begin
  perform public.require_perm(array['website:edit','clients:create']);
  select * into o from public.website_orders where id = p_id for update;
  if not found then raise exception 'Commande introuvable'; end if;
  if o.status <> 'pending' then raise exception 'Cette commande a déjà été traitée'; end if;

  v_client := coalesce(p_client_id, o.client_id, o.detected_client_id, public._website_detect_client(o.client_phone));
  if v_client is not null and not exists (select 1 from public.clients where id = v_client) then v_client := null; end if;
  if v_client is null then
    insert into public.clients (name, phone, address, note, rc, nif, nis, article)
    values (o.client_name, o.client_phone, o.client_address, coalesce(nullif(o.client_note, ''), 'Créé depuis le site web'),
            o.rc, o.nif, o.nis, o.article)
    returning id into v_client;
    v_created := true;
  end if;
  select * into c from public.clients where id = v_client;

  v_cmd := public.create_command(jsonb_build_object(
    'client_id', c.id, 'client_name', c.name, 'client_phone', coalesce(nullif(c.phone, ''), o.client_phone),
    'client_address', coalesce(nullif(o.client_address, ''), c.address),
    'advance_paid', 0, 'tva_enabled', false,
    'notes', trim(both ' ' from 'Commande web ' || o.reference || ' ' || coalesce(o.notes, '')),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'position', i.position, 'fiche_technic_id', i.fiche_technic_id, 'product_id', i.fiche_technic_id,
        'product_name', i.product_name, 'quantity', i.quantity, 'unit_price', i.unit_price,
        'total_price', i.total_price, 'sell_by_unit', i.sell_unit is not null, 'sell_unit', i.sell_unit)
        order by i.position), '[]'::jsonb)
      from public.website_order_items i where i.order_id = o.id)
  ));

  update public.website_orders set status = 'accepted', client_id = v_client, accepted_at = now(),
    command_id = (v_cmd->>'id')::uuid, handled_by = public.current_username()
  where id = p_id;
  return jsonb_build_object('command', v_cmd, 'client_id', v_client, 'client_created', v_created);
end $$;

/** ANNULER : la commande reste dans l'historique du client avec son motif. */
create or replace function public.website_cancel_order(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o public.website_orders;
begin
  perform public.require_perm(array['website:edit','clients:edit']);
  select * into o from public.website_orders where id = p_id for update;
  if not found then raise exception 'Commande introuvable'; end if;
  if o.status = 'accepted' then raise exception 'Commande déjà acceptée : annulez-la depuis l''écran Commandes'; end if;
  update public.website_orders set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason,
    client_id = coalesce(client_id, detected_client_id), handled_by = public.current_username()
  where id = p_id;
end $$;

/** Présentation d'un produit sur le site (nom, description, prix, image, masqué). */
create or replace function public.website_update_product(p_id uuid, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_perm(array['website:edit','production:edit']);
  update public.fiche_technics set
    web_name = case when p_payload ? 'web_name' then nullif(trim(p_payload->>'web_name'), '') else web_name end,
    web_description = case when p_payload ? 'web_description' then nullif(p_payload->>'web_description', '') else web_description end,
    web_price = case when p_payload ? 'web_price' then nullif(p_payload->>'web_price', '')::numeric else web_price end,
    web_image_url = case when p_payload ? 'web_image_url' then nullif(p_payload->>'web_image_url', '') else web_image_url end,
    web_hidden = case when p_payload ? 'web_hidden' then coalesce((p_payload->>'web_hidden')::boolean, false) else web_hidden end
  where id = p_id;
  if not found then raise exception 'Produit introuvable'; end if;
end $$;

grant execute on function public.website_public() to anon, authenticated;
grant execute on function public.website_place_order(jsonb) to anon, authenticated;
grant execute on function public.website_my_orders() to authenticated;
grant execute on function public.website_current_client() to anon, authenticated;
grant execute on function public.admin_set_client_account(uuid, text, text) to authenticated;
grant execute on function public.admin_remove_client_account(uuid) to authenticated;
grant execute on function public.website_update_order(uuid, jsonb) to authenticated;
grant execute on function public.website_accept_order(uuid, uuid) to authenticated;
grant execute on function public.website_cancel_order(uuid, text) to authenticated;
grant execute on function public.website_update_product(uuid, jsonb) to authenticated;
revoke execute on function public._website_detect_client(text) from public, anon, authenticated;

-- Le module « website » apparaît dans la matrice des permissions des employés ;
-- l'administrateur y a accès d'office (is_admin()).

notify pgrst, 'reload schema';


-- =============================================================================
--  09 — RETOURS D'ACHAT · NUMÉROTATION DES FACTURES ET DES BONS · LIVRAISON
--       DIRECTE (CLIENT PASSAGER / HORS COMMANDE)
-- -----------------------------------------------------------------------------
--  À exécuter APRÈS les parties 01 → 08 (ré-exécutable sans risque).
--
--  1. Numérotation imprimée :
--       · factures de vente  : 1/2026, 2/2026 … — repart à 1 chaque année ;
--       · bons de livraison  : 1, 2, 3 … — repart à 1 chaque mois.
--  2. Livraison directe : l'écran Livraisons accepte le client passager et les
--     quantités hors commande (une commande est créée automatiquement).
--  3. Retours d'achat : la marchandise achetée est rendue au fournisseur — le
--     stock diminue, la facture d'achat baisse et l'argent déjà payé revient en
--     caisse.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1. NUMÉROTATION
-- -----------------------------------------------------------------------------
alter table public.sales add column if not exists invoice_number int;
alter table public.sales add column if not exists invoice_year int;
alter table public.command_deliveries add column if not exists bl_number int;
alter table public.command_deliveries add column if not exists bl_year int;
alter table public.command_deliveries add column if not exists bl_month int;
create index if not exists sales_invoice_no_idx on public.sales (invoice_year, invoice_number);
create index if not exists deliveries_bl_no_idx on public.command_deliveries (bl_year, bl_month, bl_number);

create or replace function public.trg_sale_invoice_number()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.invoice_number is null then
    new.invoice_year := extract(year from coalesce(new.date, current_date))::int;
    perform pg_advisory_xact_lock(hashtext('sale_invoice_no'), new.invoice_year);
    select coalesce(max(invoice_number), 0) + 1 into new.invoice_number
      from public.sales where invoice_year = new.invoice_year;
  end if;
  return new;
end $$;
drop trigger if exists sale_invoice_number_trg on public.sales;
create trigger sale_invoice_number_trg before insert on public.sales
  for each row execute function public.trg_sale_invoice_number();

create or replace function public.trg_delivery_bl_number()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_d date;
begin
  if new.bl_number is null then
    v_d := coalesce(new.date, new.delivered_at::date, current_date);
    new.bl_year := extract(year from v_d)::int;
    new.bl_month := extract(month from v_d)::int;
    perform pg_advisory_xact_lock(hashtext('delivery_bl_no'), new.bl_year * 100 + new.bl_month);
    select coalesce(max(bl_number), 0) + 1 into new.bl_number
      from public.command_deliveries where bl_year = new.bl_year and bl_month = new.bl_month;
  end if;
  return new;
end $$;
drop trigger if exists delivery_bl_number_trg on public.command_deliveries;
create trigger delivery_bl_number_trg before insert on public.command_deliveries
  for each row execute function public.trg_delivery_bl_number();

-- numéros des documents EXISTANTS, dans l'ordre chronologique
with n as (
  select id, extract(year from date)::int as y,
         row_number() over (partition by extract(year from date) order by date, created_at, reference) as rn
    from public.sales where invoice_number is null
), base as (
  select invoice_year as y, max(invoice_number) as m from public.sales
   where invoice_number is not null group by invoice_year
)
update public.sales s set invoice_year = n.y, invoice_number = n.rn + coalesce(b.m, 0)
  from n left join base b on b.y = n.y
 where s.id = n.id;

with n as (
  select id, extract(year from date)::int as y, extract(month from date)::int as m,
         row_number() over (partition by extract(year from date), extract(month from date)
                            order by date, delivered_at, created_at, reference) as rn
    from public.command_deliveries where bl_number is null
), base as (
  select bl_year as y, bl_month as m, max(bl_number) as mx from public.command_deliveries
   where bl_number is not null group by bl_year, bl_month
)
update public.command_deliveries d set bl_year = n.y, bl_month = n.m, bl_number = n.rn + coalesce(b.mx, 0)
  from n left join base b on b.y = n.y and b.m = n.m
 where d.id = n.id;

-- -----------------------------------------------------------------------------
--  2. LIVRAISON DIRECTE — client passager / quantités hors commande
-- -----------------------------------------------------------------------------
--  `direct_lines` : [{fiche_technic_id, product_name, quantity, unit_price,
--  sell_by_unit, sell_unit}] — une commande est créée pour ces quantités puis
--  livrée dans la foulée, comme n'importe quelle autre commande.
create or replace function public.create_client_delivery(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_alloc jsonb := '[]'::jsonb; a jsonb; v_cmds uuid[] := '{}'; v_cmd uuid; c public.commands;
        d public.command_deliveries; v_at timestamptz; v_tva boolean; v_cash numeric; v_items jsonb;
        v_out jsonb := '[]'::jsonb; v_use_adv boolean; v_direct jsonb; cl public.clients;
        v_new uuid; it record; v_direct_tva boolean;
begin
  perform public.require_perm(array['clients:create','sales:create']);
  v_client := nullif(p_payload->>'client_id', '')::uuid;
  select * into cl from public.clients where id = v_client;
  if v_client is null or not found then
    raise exception 'Client introuvable';
  end if;
  v_at := coalesce(nullif(p_payload->>'delivered_at', '')::timestamptz, now());

  if exists (select 1 from jsonb_array_elements(coalesce(p_payload->'lines', '[]'::jsonb)) x
              where coalesce((x->>'quantity')::numeric, 0) > 0) then
    v_alloc := public._allocate_client_lines(v_client, p_payload->'lines');
  end if;

  -- quantités hors commande : nouvelle commande, livrée immédiatement
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_direct
    from jsonb_array_elements(coalesce(p_payload->'direct_lines', '[]'::jsonb)) x
   where coalesce((x->>'quantity')::numeric, 0) > 0;
  if jsonb_array_length(v_direct) > 0 then
    v_direct_tva := coalesce((p_payload->>'tva_enabled')::boolean, false);
    insert into public.commands (client_id, client_name, client_phone, client_address, driver_name, driver_plate,
      tva_enabled, tva_rate, advance_paid, notes, created_at)
    values (v_client, cl.name, cl.phone, coalesce(nullif(p_payload->>'location', ''), cl.address),
      nullif(p_payload->>'driver_name', ''), nullif(p_payload->>'driver_plate', ''),
      v_direct_tva, case when v_direct_tva then coalesce((p_payload->>'tva_rate')::numeric, 19) else 0 end,
      0, 'Commande directe — livraison', v_at)
    returning id into v_new;
    perform public._write_command_items(v_new, (
      select jsonb_agg(jsonb_build_object(
        'fiche_technic_id', x->>'fiche_technic_id', 'product_name', x->>'product_name',
        'quantity', (x->>'quantity')::numeric, 'unit_price', coalesce((x->>'unit_price')::numeric, 0),
        'total_price', round((x->>'quantity')::numeric * coalesce((x->>'unit_price')::numeric, 0), 2),
        'sell_by_unit', coalesce((x->>'sell_by_unit')::boolean, false), 'sell_unit', x->>'sell_unit'))
      from jsonb_array_elements(v_direct) x));
    perform public._recalc_command(v_new);
    for it in select id, product_name, sell_unit, quantity from public.command_items
               where command_id = v_new order by position loop
      v_alloc := v_alloc || jsonb_build_array(jsonb_build_object(
        'command_id', v_new, 'command_item_id', it.id, 'product_name', it.product_name,
        'sell_unit', it.sell_unit, 'quantity', it.quantity));
    end loop;
  end if;

  if jsonb_array_length(v_alloc) = 0 then raise exception 'Saisissez au moins une quantité à livrer'; end if;
  for a in select * from jsonb_array_elements(v_alloc) loop
    v_cmd := (a->>'command_id')::uuid;
    if not (v_cmd = any(v_cmds)) then v_cmds := v_cmds || v_cmd; end if;
  end loop;

  v_cash := greatest(0, coalesce((p_payload->>'cash_paid')::numeric, 0));
  v_use_adv := coalesce((p_payload->>'use_advance')::boolean, true);

  foreach v_cmd in array v_cmds loop
    select * into c from public.commands where id = v_cmd;
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_items
      from jsonb_array_elements(v_alloc) x where (x->>'command_id')::uuid = v_cmd;
    v_tva := case when p_payload ? 'tva_enabled' then coalesce((p_payload->>'tva_enabled')::boolean, false)
                  else c.tva_enabled end;
    insert into public.command_deliveries (command_id, date, delivered_at, notes, driver_name, driver_plate,
      location, is_historical, tva_enabled, tva_rate, source)
    values (c.id, v_at::date, v_at, coalesce(p_payload->>'notes', ''),
      coalesce(nullif(p_payload->>'driver_name', ''), c.driver_name),
      coalesce(nullif(p_payload->>'driver_plate', ''), c.driver_plate),
      coalesce(nullif(p_payload->>'location', ''), c.client_address),
      false, v_tva,
      case when v_tva then coalesce((p_payload->>'tva_rate')::numeric, nullif(c.tva_rate, 0), 19) else 0 end,
      'livraison')
    returning * into d;
    perform public._build_delivery(d.id, jsonb_build_object(
      'items', v_items,
      'advance_applied', case when v_use_adv then 999999999999 else 0 end,
      'cash_paid', v_cash));
    select * into d from public.command_deliveries where id = d.id;
    v_cash := greatest(0, v_cash - coalesce(d.cash_paid, 0));
    v_out := v_out || jsonb_build_array(to_jsonb(d));
  end loop;
  return v_out;
end $$;

-- -----------------------------------------------------------------------------
--  3. RETOURS D'ACHAT
-- -----------------------------------------------------------------------------
create sequence if not exists public.purchase_return_ref_seq;
create table if not exists public.purchase_returns (
  id uuid primary key default gen_random_uuid(),
  reference text not null default ('RA-' || lpad(nextval('public.purchase_return_ref_seq')::text, 6, '0')),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  date date not null default current_date,
  reason text default '',
  total_amount numeric(14,2) not null default 0,   -- valeur de la marchandise rendue
  refund_amount numeric(14,2) not null default 0,  -- argent rendu par le fournisseur (entre en caisse)
  created_at timestamptz not null default now(),
  created_by text default public.current_username()
);
create index if not exists purchase_returns_purchase_idx on public.purchase_returns (purchase_id);
create index if not exists purchase_returns_supplier_idx on public.purchase_returns (supplier_id);

create table if not exists public.purchase_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.purchase_returns(id) on delete cascade,
  purchase_line_id uuid references public.purchase_lines(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity numeric(14,3) not null default 0,
  unit_price numeric(14,2) not null default 0,
  amount numeric(14,2) not null default 0,
  unit text,
  stock_applied boolean not null default false
);
create index if not exists purchase_return_items_return_idx on public.purchase_return_items (return_id);

-- la facture d'achat déduit la marchandise rendue, et l'argent remboursé
create or replace function public._recalc_purchase(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_total numeric; v_paid numeric; v_alloc numeric; v_has boolean; p public.purchases;
        v_ret numeric := 0; v_refund numeric := 0;
begin
  if position(p_id::text in coalesce(current_setting('app.deleting_doc', true), '')) > 0 then return; end if;
  select * into p from public.purchases where id = p_id;
  if not found then return; end if;
  select exists(select 1 from public.purchase_lines where purchase_id = p_id),
         coalesce(sum(quantity * purchase_price), 0)
    into v_has, v_total from public.purchase_lines where purchase_id = p_id;
  if to_regclass('public.purchase_returns') is not null then
    select coalesce(sum(total_amount), 0), coalesce(sum(refund_amount), 0)
      into v_ret, v_refund from public.purchase_returns where purchase_id = p_id;
  end if;
  if not v_has then v_total := p.total_amount + v_ret; end if;
  v_total := greatest(0, v_total - v_ret);
  select coalesce(sum(amount), 0), coalesce(sum(amount) filter (where origin = 'credit'), 0)
    into v_paid, v_alloc from public.purchase_payments where purchase_id = p_id;
  v_paid := greatest(0, v_paid - v_refund);
  update public.purchases set
    total_amount = round(v_total, 2), paid_amount = v_paid, allocated_amount = v_alloc,
    rest_amount = greatest(0, round(v_total, 2) - v_paid)
  where id = p_id;
end $$;

-- stock : la marchandise rendue sort du stock (sauf ancien achat)
create or replace function public.trg_purchase_return_item_stock()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_hist boolean;
begin
  if tg_op in ('UPDATE','DELETE') and old.stock_applied and old.product_id is not null then
    update public.products set
      current_quantity = current_quantity + old.quantity,
      principal_quantity = principal_quantity + old.quantity
    where id = old.product_id;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    select p.is_historical into v_hist
      from public.purchase_returns r join public.purchases p on p.id = r.purchase_id
     where r.id = new.return_id;
    new.stock_applied := (not coalesce(v_hist, false)) and new.product_id is not null;
    if new.stock_applied then
      update public.products set
        current_quantity = current_quantity - new.quantity,
        principal_quantity = greatest(0, principal_quantity - new.quantity)
      where id = new.product_id;
    end if;
    return new;
  end if;
  return old;
end $$;
drop trigger if exists purchase_return_item_stock on public.purchase_return_items;
create trigger purchase_return_item_stock before insert or update or delete on public.purchase_return_items
  for each row execute function public.trg_purchase_return_item_stock();

-- caisse : l'argent rendu par le fournisseur est une ENTRÉE
create or replace function public.trg_purchase_return()
returns trigger language plpgsql security definer set search_path = public as $$
declare p public.purchases;
begin
  if tg_op = 'DELETE' then
    perform public._caisse_clear('purchase_returns', old.id);
    perform public._recalc_purchase(old.purchase_id);
    return old;
  end if;
  select * into p from public.purchases where id = new.purchase_id;
  if not coalesce(p.is_historical, false) then
    perform public._caisse_set('purchase_returns', new.id, 'deposit', new.refund_amount, new.date,
      'Retour achat ' || new.reference || ' (' || coalesce(p.reference, '') || ')', 'Achat');
  else
    perform public._caisse_clear('purchase_returns', new.id);
  end if;
  perform public._recalc_purchase(new.purchase_id);
  return new;
end $$;
drop trigger if exists purchase_return_trg on public.purchase_returns;
create trigger purchase_return_trg after insert or update or delete on public.purchase_returns
  for each row execute function public.trg_purchase_return();

-- payload : {purchase_id, date, reason, items: [{purchase_line_id, quantity}]}
create or replace function public.create_purchase_return(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.purchases; r public.purchase_returns; x jsonb; l public.purchase_lines;
        v_qty numeric; v_done numeric; v_total numeric := 0; v_lines numeric; v_paid numeric;
        v_refunded numeric; v_returned numeric; v_refund numeric;
begin
  perform public.require_perm(array['purchase:create','purchase:edit']);
  select * into p from public.purchases where id = nullif(p_payload->>'purchase_id', '')::uuid for update;
  if not found then raise exception 'Facture d''achat introuvable'; end if;

  insert into public.purchase_returns (purchase_id, supplier_id, date, reason)
  values (p.id, p.supplier_id, coalesce(nullif(p_payload->>'date', '')::date, current_date),
          coalesce(p_payload->>'reason', ''))
  returning * into r;

  for x in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) loop
    v_qty := round(coalesce((x->>'quantity')::numeric, 0), 3);
    continue when v_qty <= 0;
    select * into l from public.purchase_lines
     where id = nullif(x->>'purchase_line_id', '')::uuid and purchase_id = p.id;
    if not found then raise exception 'Ligne d''achat introuvable'; end if;
    select coalesce(sum(ri.quantity), 0) into v_done from public.purchase_return_items ri
     where ri.purchase_line_id = l.id;
    if v_qty > l.quantity - v_done + 0.0005 then
      raise exception 'Retour de « % » : % dépasse la quantité achetée non encore rendue (%)',
        l.product_name, v_qty, round(l.quantity - v_done, 3);
    end if;
    insert into public.purchase_return_items (return_id, purchase_line_id, product_id, product_name,
      quantity, unit_price, amount, unit)
    values (r.id, l.id, l.product_id, l.product_name, v_qty, l.purchase_price,
      round(v_qty * l.purchase_price, 2), case when l.unit_enabled then l.unit end);
    v_total := v_total + round(v_qty * l.purchase_price, 2);
  end loop;
  if v_total <= 0 then raise exception 'Saisissez au moins une quantité à rendre'; end if;

  -- argent récupéré : ce qui a été payé AU-DELÀ du nouveau total de la facture
  select coalesce(sum(quantity * purchase_price), 0) into v_lines from public.purchase_lines where purchase_id = p.id;
  select coalesce(sum(amount), 0) into v_paid from public.purchase_payments where purchase_id = p.id;
  select coalesce(sum(refund_amount), 0), coalesce(sum(total_amount), 0) into v_refunded, v_returned
    from public.purchase_returns where purchase_id = p.id and id <> r.id;
  v_refund := greatest(0, least(v_total, (v_paid - v_refunded) - (v_lines - v_returned - v_total)));

  update public.purchase_returns set total_amount = v_total, refund_amount = round(v_refund, 2)
   where id = r.id returning * into r;
  return to_jsonb(r);
end $$;
grant execute on function public.create_purchase_return(jsonb) to authenticated;

-- module des tables (droits, corbeille, journal)
create or replace function public._table_module(p_table text)
returns text language sql immutable as $$
  select case
    when p_table in ('products','marques','categories','units') then 'stock'
    when p_table in ('purchases','purchase_lines','purchase_payments','purchase_returns','purchase_return_items') then 'purchase'
    when p_table in ('productions','production_categories','fiche_technics','fiche_categories') then 'production'
    when p_table in ('comptoir_items','destructions') then 'comptoir'
    when p_table in ('sales','sale_lines','sale_payments','free_invoices','free_invoice_lines') then 'sales'
    when p_table in ('clients','commands','command_items','command_payments','command_deliveries','client_debts',
                     'client_payments','party_old_debts','party_credit_refunds','command_adjustments',
                     'delivery_recoveries','delivery_recovery_items') then 'clients'
    when p_table in ('suppliers','supplier_payments') then 'suppliers'
    when p_table in ('workers','worker_acomptes','worker_absences','worker_payments','worker_overtimes','roles') then 'workers'
    when p_table in ('expenses','expense_categories','purchase_orders') then 'expenses'
    when p_table in ('caisse_transactions','caisse_categories','caisse_reports') then 'caisse'
    else 'settings' end
$$;

do $$
declare t text;
begin
  foreach t in array array['purchase_returns','purchase_return_items'] loop
    execute format('drop trigger if exists zz_recycle on public.%I', t);
    execute format('create trigger zz_recycle after delete on public.%I for each row execute function public.trg_recycle_capture()', t);
  end loop;
end $$;

do $$
declare rec record; r text[]; w text[];
begin
  for rec in
    select * from (values
      ('purchase_returns',      '{purchase,suppliers,stock,caisse,dashboard,reports}', '{purchase,suppliers}'),
      ('purchase_return_items', '{purchase,suppliers,stock,caisse,dashboard,reports}', '{purchase,suppliers}')
    ) as t(tbl, rd, wr)
  loop
    r := rec.rd::text[]; w := rec.wr::text[];
    execute format('alter table public.%I enable row level security', rec.tbl);
    execute format('drop policy if exists p_select on public.%I', rec.tbl);
    execute format('drop policy if exists p_insert on public.%I', rec.tbl);
    execute format('drop policy if exists p_update on public.%I', rec.tbl);
    execute format('drop policy if exists p_delete on public.%I', rec.tbl);
    execute format('create policy p_select on public.%I for select to authenticated using (public.can_view_any(%L::text[]))', rec.tbl, r);
    execute format('create policy p_insert on public.%I for insert to authenticated with check (public.has_any_perm(%L::text[], ''create''))', rec.tbl, w);
    execute format('create policy p_update on public.%I for update to authenticated using (public.has_any_perm(%L::text[], ''edit'')) with check (public.has_any_perm(%L::text[], ''edit''))', rec.tbl, w, w);
    execute format('create policy p_delete on public.%I for delete to authenticated using (public.has_any_perm(%L::text[], ''delete''))', rec.tbl, w);
  end loop;
end $$;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like '\_%' or p.proname like 'trg\_%')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
--  4. EN-TÊTE DES DOCUMENTS — coordonnées de l'entreprise
-- -----------------------------------------------------------------------------
update public.store_settings set
  name           = 'SARL ADEL LIL WARAK',
  description    = 'FABRICATION ET TRANSFORMATION DU PAPIER',
  email          = 'adel16papier@gmail.com',
  phone          = '0552217369',
  nif            = '001735072796182',
  nis            = '001735370031843',
  article        = '35370037144',
  rc             = '35/000727961B17',
  activity_place = 'CITE BEN DANOUN SECT07 GPL31KHEMIS ELKHECHNA BOUMERDES',
  address        = '35000 HAI BENDANOUN CLASSE 07 GP 31 KHEMIS EL KHECHNA BOUMERDES',
  city           = coalesce(nullif(trim(city), ''), 'BOUMERDES'),
  updated_at     = now()
where id;

-- -----------------------------------------------------------------------------
--  N° DES CLIENTS (01, 02 …) — voir aussi 11_client_numbers.sql
-- -----------------------------------------------------------------------------
alter table public.clients add column if not exists client_no integer;

create sequence if not exists public.clients_client_no_seq owned by public.clients.client_no;

-- numérote les clients qui n'ont pas encore de N°, à la suite des N° existants
with base as (select coalesce(max(client_no), 0) as m from public.clients),
ranked as (
  select id, row_number() over (order by created_at, id) as rn
  from public.clients where client_no is null
)
update public.clients c set client_no = base.m + ranked.rn
from ranked, base where c.id = ranked.id;

select setval('public.clients_client_no_seq',
              greatest((select coalesce(max(client_no), 0) from public.clients), 1),
              (select count(*) > 0 from public.clients where client_no is not null));

alter table public.clients alter column client_no set default nextval('public.clients_client_no_seq');
create unique index if not exists clients_client_no_key on public.clients (client_no);

notify pgrst, 'reload schema';
