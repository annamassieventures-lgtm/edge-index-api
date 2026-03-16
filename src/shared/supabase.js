/**
 * Edge Index — Supabase Client
 * Persistent cloud database replacing ephemeral Railway JSON files.
 * Set SUPABASE_URL and SUPABASE_KEY in Railway environment variables.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ctbavocliktktttdlaxr.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_KEY) {
  console.warn('⚠️  SUPABASE_KEY not set — database persistence disabled, falling back to JSON files.');
}

export const supabase = SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

export const dbEnabled = !!supabase;
