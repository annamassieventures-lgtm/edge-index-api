/**
 * Edge Index — Paid User Registry
 *
 * Checks whether an email address has a paid subscription.
 * Sources checked in order:
 *   1. PAID_EMAILS env var — comma-separated, manually managed in Railway
 *   2. Supabase paid_emails table — populated by Whop webhook (primary persistent store)
 *   3. data/paid-emails.json — local fallback if Supabase unavailable
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase, dbEnabled } from './supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAID_FILE = path.join(__dirname, '..', '..', 'data', 'paid-emails.json');

// ── JSON file fallback ─────────────────────────────────────────────────────

function loadPaidEmailsFromFile() {
  try {
    if (!fs.existsSync(PAID_FILE)) {
      fs.mkdirSync(path.dirname(PAID_FILE), { recursive: true });
      fs.writeFileSync(PAID_FILE, '[]');
    }
    return JSON.parse(fs.readFileSync(PAID_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function savePaidEmailsToFile(list) {
  fs.mkdirSync(path.dirname(PAID_FILE), { recursive: true });
  fs.writeFileSync(PAID_FILE, JSON.stringify(list, null, 2));
}

// ── Check if email is paid ─────────────────────────────────────────────────

export async function isPaidEmail(email) {
  if (!email) return false;
  const normalised = email.toLowerCase().trim();

  // 1. Check Railway env var override
  const envEmails = (process.env.PAID_EMAILS || '')
    .split(',')
    .map(e => e.toLowerCase().trim())
    .filter(Boolean);
  if (envEmails.includes(normalised)) return true;

  // 2. Check Supabase
  if (dbEnabled) {
    try {
      const { data, error } = await supabase
        .from('paid_emails')
        .select('email')
        .ilike('email', normalised)
        .maybeSingle();
      if (!error && data) return true;
    } catch (err) {
      console.error('Supabase isPaidEmail error:', err.message);
    }
  }

  // 3. Fallback to JSON file
  const fileEmails = loadPaidEmailsFromFile().map(e => e.toLowerCase().trim());
  return fileEmails.includes(normalised);
}

// ── Add paid email ─────────────────────────────────────────────────────────

export async function addPaidEmail(email, source = 'whop') {
  if (!email) return;
  const normalised = email.toLowerCase().trim();

  // Write to Supabase
  if (dbEnabled) {
    try {
      const { error } = await supabase
        .from('paid_emails')
        .upsert({ email: normalised, source }, { onConflict: 'email' });
      if (error) throw error;
      console.log(`✅ Supabase paid email saved: ${normalised}`);
    } catch (err) {
      console.error('Supabase addPaidEmail error:', err.message);
    }
  }

  // Always write to JSON file as backup
  const list = loadPaidEmailsFromFile();
  if (!list.map(e => e.toLowerCase().trim()).includes(normalised)) {
    list.push(normalised);
    savePaidEmailsToFile(list);
    console.log(`✅ JSON paid email saved: ${normalised}`);
  }
}

// ── Get all paid emails (admin) ────────────────────────────────────────────

export async function getAllPaidEmails() {
  const fromEnv = (process.env.PAID_EMAILS || '')
    .split(',')
    .map(e => e.toLowerCase().trim())
    .filter(Boolean);

  let fromDb = [];
  if (dbEnabled) {
    try {
      const { data, error } = await supabase
        .from('paid_emails')
        .select('email')
        .order('created_at', { ascending: false });
      if (!error && data) fromDb = data.map(r => r.email.toLowerCase().trim());
    } catch (err) {
      console.error('Supabase getAllPaidEmails error:', err.message);
    }
  }

  const fromFile = loadPaidEmailsFromFile().map(e => e.toLowerCase().trim());
  return [...new Set([...fromEnv, ...fromDb, ...fromFile])];
}
