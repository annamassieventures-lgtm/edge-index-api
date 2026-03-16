-- ============================================================
-- Edge Index — Supabase Database Setup
-- Run this in your Supabase SQL Editor (once only)
-- Dashboard → SQL Editor → New Query → paste → Run
-- ============================================================

-- PAID EMAILS
create table if not exists paid_emails (
  id          uuid primary key default gen_random_uuid(),
  email       text unique not null,
  source      text default 'whop',
  created_at  timestamptz default now()
);

-- USERS (Telegram bot profiles)
create table if not exists users (
  id                   uuid primary key default gen_random_uuid(),
  telegram_id          text unique not null,
  email                text,
  trade_type           text,
  dob                  text,
  birth_time           text,
  birth_location       text,
  lat                  numeric,
  lng                  numeric,
  report_generated_at  timestamptz,
  report_delivered_at  timestamptz,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);

-- REPORTS (delivery log)
create table if not exists reports (
  id               uuid primary key default gen_random_uuid(),
  telegram_id      text not null,
  email            text,
  delivered_at     timestamptz default now(),
  delivery_status  text default 'delivered'
);

-- OUTREACH TARGETS (20 communities)
create table if not exists outreach_targets (
  id                text primary key,
  name              text,
  platform          text,
  size              text,
  contact           text,
  stage             integer default 0,
  last_contact_at   timestamptz,
  replied           boolean default false,
  notes             text,
  created_at        timestamptz default now()
);

-- ============================================================
-- INDEXES for performance
-- ============================================================
create index if not exists idx_paid_emails_email       on paid_emails(email);
create index if not exists idx_users_telegram_id       on users(telegram_id);
create index if not exists idx_users_email             on users(email);
create index if not exists idx_reports_telegram_id     on reports(telegram_id);
create index if not exists idx_outreach_stage          on outreach_targets(stage);

-- ============================================================
-- DONE. Tables are ready.
-- ============================================================
