-- PostgreSQL production schema draft for Sowmy Kitchen.
-- Apply through migrations in production and enable row-level security / app-layer RBAC.

create extension if not exists pgcrypto;

create type app_role as enum ('student', 'admin', 'driver');
create type meal_period as enum ('Lunch', 'Dinner');
create type meal_preference as enum ('Veg', 'Non-Veg');
create type order_status as enum ('CONFIRMED', 'PAYMENT_REQUIRED', 'SKIPPED', 'CANCELLED_HOLIDAY', 'DELIVERED');
create type wallet_transaction_type as enum ('WALLET_RECHARGE', 'MEAL_DEDUCTION', 'REFUND', 'MANUAL_ADJUSTMENT', 'PROMOTIONAL_CREDIT', 'CANCELLATION_REFUND');
create type delivery_status as enum ('Assigned', 'Preparing', 'Ready', 'Out for Delivery', 'Delivered');
create type notification_status as enum ('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'READ');

create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  phone text unique not null,
  password_hash text not null,
  role app_role not null,
  created_at timestamptz not null default now()
);

create table students (
  user_id uuid primary key references users(id) on delete cascade,
  full_name text not null,
  college text not null,
  hostel text not null,
  room_number text not null,
  lunch_location text not null,
  dinner_location text not null,
  lunch_timing text not null,
  dinner_timing text not null,
  lunch_preference meal_preference not null,
  dinner_preference meal_preference not null,
  subscription_plan_id uuid,
  is_active boolean not null default true
);

create table drivers (
  user_id uuid primary key references users(id) on delete cascade,
  full_name text not null,
  is_active boolean not null default true
);

create table subscription_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null,
  price_monthly integer not null,
  active boolean not null default true
);

create table wallets (
  student_id uuid primary key references students(user_id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  low_balance_notified_at timestamptz
);

create table menus (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  meal meal_period not null,
  veg_option text not null,
  non_veg_option text not null,
  veg_price integer not null check (veg_price >= 0),
  non_veg_price integer not null check (non_veg_price >= 0),
  available boolean not null default true,
  description text,
  unique (service_date, meal)
);

create table holidays (
  id uuid primary key default gen_random_uuid(),
  service_date date unique not null,
  reason text not null,
  announcement text,
  published_by uuid not null references users(id),
  created_at timestamptz not null default now()
);

create table skip_dates (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(user_id) on delete cascade,
  service_date date not null,
  meal meal_period not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (student_id, service_date, meal)
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(user_id),
  service_date date not null,
  meal meal_period not null,
  preference meal_preference not null,
  amount integer not null check (amount >= 0),
  status order_status not null,
  collection_location text not null,
  idempotency_key text unique not null,
  created_at timestamptz not null default now(),
  unique (student_id, service_date, meal)
);

create table wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(user_id),
  amount integer not null,
  type wallet_transaction_type not null,
  description text not null,
  reference_order_id uuid references orders(id),
  balance_before integer not null,
  balance_after integer not null,
  status text not null,
  idempotency_key text unique,
  created_at timestamptz not null default now()
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(user_id),
  provider text not null default 'razorpay',
  provider_order_id text unique not null,
  provider_payment_id text unique,
  amount integer not null,
  status text not null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid unique not null references orders(id),
  driver_id uuid references drivers(user_id),
  status delivery_status not null default 'Assigned',
  eta_minutes integer,
  updated_at timestamptz not null default now()
);

create table driver_locations (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references deliveries(id) on delete cascade,
  driver_id uuid not null references drivers(user_id),
  lat numeric(9,6) not null,
  lng numeric(9,6) not null,
  recorded_at timestamptz not null default now()
);

create table whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  event text not null,
  message text not null,
  variables text[] not null default '{}',
  active boolean not null default true,
  language text not null default 'en',
  provider_template_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(user_id),
  event text not null,
  channel text not null,
  template_id uuid references whatsapp_templates(id),
  message text not null,
  provider_reference text,
  status notification_status not null default 'PENDING',
  provider_response jsonb,
  sent_at timestamptz,
  failure_reason text,
  retry_count integer not null default 0,
  idempotency_key text unique
);

create table reviews (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(user_id),
  order_id uuid references orders(id),
  stars integer not null check (stars between 1 and 5),
  review_text text,
  approved boolean not null default false,
  featured boolean not null default false,
  created_at timestamptz not null default now()
);

create table announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references users(id),
  action text not null,
  entity text not null,
  old_value jsonb,
  new_value jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

-- Idempotency record for signed third-party webhooks. Do not process an event twice.
create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  unique (provider, event_id)
);

create index orders_service_date_meal_idx on orders(service_date, meal, status);
create index wallet_transactions_student_idx on wallet_transactions(student_id, created_at desc);
create index notifications_status_idx on notifications(status, created_at);
create index driver_locations_delivery_idx on driver_locations(delivery_id, recorded_at desc);
