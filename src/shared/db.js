/**
 * Edge Index — Database helpers
 * Handles persistent storage of users, reports, and outreach state via Supabase.
 * Falls back gracefully if Supabase is unavailable.
 */

import { supabase, dbEnabled } from './supabase.js';

// ── USERS ──────────────────────────────────────────────────────────────────

/**
 * Upsert a user record in Supabase.
 * Call this whenever a user's data changes in the bot.
 */
export async function saveUserToDb(telegramId, data) {
  if (!dbEnabled) return;
  try {
    const { error } = await supabase
      .from('users')
      .upsert({
        telegram_id: String(telegramId),
        ...data,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'telegram_id' });
    if (error) throw error;
  } catch (err) {
    console.error('Supabase saveUserToDb error:', err.message);
  }
}

/**
 * Get a user record from Supabase.
 */
export async function getUserFromDb(telegramId) {
  if (!dbEnabled) return null;
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', String(telegramId))
      .maybeSingle();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Supabase getUserFromDb error:', err.message);
    return null;
  }
}

/**
 * Get all users (admin).
 */
export async function getAllUsersFromDb() {
  if (!dbEnabled) return [];
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Supabase getAllUsersFromDb error:', err.message);
    return [];
  }
}

// ── REPORTS ────────────────────────────────────────────────────────────────

/**
 * Log a report delivery event.
 */
export async function logReportDelivery(telegramId, email) {
  if (!dbEnabled) return;
  try {
    const { error } = await supabase
      .from('reports')
      .insert({
        telegram_id: String(telegramId),
        email,
        delivered_at: new Date().toISOString(),
        delivery_status: 'delivered',
      });
    if (error) throw error;
    console.log(`📊 Report delivery logged for ${email}`);
  } catch (err) {
    console.error('Supabase logReportDelivery error:', err.message);
  }
}

/**
 * Get report history for a user.
 */
export async function getReportHistory(telegramId) {
  if (!dbEnabled) return [];
  try {
    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .eq('telegram_id', String(telegramId))
      .order('delivered_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Supabase getReportHistory error:', err.message);
    return [];
  }
}

// ── OUTREACH ───────────────────────────────────────────────────────────────

/**
 * Sync outreach targets to Supabase (run once on startup).
 */
export async function syncOutreachTargets(targets) {
  if (!dbEnabled || !targets?.length) return;
  try {
    const { error } = await supabase
      .from('outreach_targets')
      .upsert(targets, { onConflict: 'id' });
    if (error) throw error;
  } catch (err) {
    console.error('Supabase syncOutreachTargets error:', err.message);
  }
}

/**
 * Update outreach stage for a target.
 */
export async function updateOutreachStage(targetId, stage, notes = null) {
  if (!dbEnabled) return;
  try {
    const update = {
      stage,
      last_contact_at: new Date().toISOString(),
    };
    if (notes) update.notes = notes;
    const { error } = await supabase
      .from('outreach_targets')
      .update(update)
      .eq('id', targetId);
    if (error) throw error;
  } catch (err) {
    console.error('Supabase updateOutreachStage error:', err.message);
  }
}

/**
 * Mark a target as replied.
 */
export async function markOutreachReplied(targetId) {
  if (!dbEnabled) return;
  try {
    const { error } = await supabase
      .from('outreach_targets')
      .update({ replied: true, last_contact_at: new Date().toISOString() })
      .eq('id', targetId);
    if (error) throw error;
  } catch (err) {
    console.error('Supabase markOutreachReplied error:', err.message);
  }
}

/**
 * Get all outreach targets from Supabase.
 */
export async function getOutreachTargets() {
  if (!dbEnabled) return [];
  try {
    const { data, error } = await supabase
      .from('outreach_targets')
      .select('*')
      .order('stage', { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Supabase getOutreachTargets error:', err.message);
    return [];
  }
}
