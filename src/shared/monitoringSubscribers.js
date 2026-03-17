/**
 * Edge Index — Monitoring Subscriber Registry
 *
 * Manages subscribers to Weekly / Daily / Live Edge tiers.
 * Persists to data/monitoring-subscribers.json (Railway ephemeral —
 * back up via MONITORING_SUBSCRIBERS env var on each change).
 *
 * Tiers:
 *   weekly ($97/month)  — Monday morning signal update
 *   daily  ($197/month) — Daily morning briefing
 *   live   ($397/month) — Real-time alerts on signal convergence
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'monitoring-subscribers.json');

// ─── Load / Save ──────────────────────────────────────────────────────────────

export function loadSubscribers() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[monitoring] Failed to load subscribers:', e.message);
  }
  return { subscribers: [] };
}

export function saveSubscribers(data) {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[monitoring] Failed to save subscribers:', e.message);
  }
}

// ─── Subscriber Management ────────────────────────────────────────────────────

/**
 * Add or upgrade a monitoring subscriber.
 * @param {object} sub - { email, telegramChatId, tier, hdType, hdAuthority, hdProfile, hdDefinition, name, tradeType, dob, time, location, lat, lon }
 */
export function addSubscriber(sub) {
  const data = loadSubscribers();
  const existing = data.subscribers.findIndex(s => s.email === sub.email);
  const record = {
    email:          sub.email,
    telegramChatId: sub.telegramChatId || null,
    tier:           sub.tier || 'weekly',       // weekly | daily | live
    name:           sub.name || 'Subscriber',
    hdType:         sub.hdType || 'Generator',
    hdAuthority:    sub.hdAuthority || 'Sacral Authority',
    hdProfile:      sub.hdProfile || null,
    hdDefinition:   sub.hdDefinition || null,
    tradeType:      sub.tradeType || 'general trading',
    dob:            sub.dob || null,
    time:           sub.time || null,
    location:       sub.location || null,
    lat:            sub.lat || null,
    lon:            sub.lon || null,
    startDate:      sub.startDate || new Date().toISOString().split('T')[0],
    active:         true,
    lastDelivery:   null,
  };
  if (existing >= 0) {
    data.subscribers[existing] = { ...data.subscribers[existing], ...record };
  } else {
    data.subscribers.push(record);
  }
  saveSubscribers(data);
  return record;
}

export function removeSubscriber(email) {
  const data = loadSubscribers();
  const sub = data.subscribers.find(s => s.email === email);
  if (sub) {
    sub.active = false;
    saveSubscribers(data);
    return true;
  }
  return false;
}

export function getAllSubscribers() {
  return loadSubscribers().subscribers.filter(s => s.active);
}

export function getSubscribersByTier(tier) {
  // weekly tier gets weekly updates
  // daily tier gets both weekly + daily updates
  // live tier gets all updates
  const all = getAllSubscribers();
  if (tier === 'weekly') return all.filter(s => ['weekly', 'daily', 'live'].includes(s.tier));
  if (tier === 'daily')  return all.filter(s => ['daily', 'live'].includes(s.tier));
  if (tier === 'live')   return all.filter(s => s.tier === 'live');
  return [];
}

export function getSubscriberByEmail(email) {
  return getAllSubscribers().find(s => s.email === email) || null;
}

export function getSubscriberCount() {
  const all = getAllSubscribers();
  return {
    total:  all.length,
    weekly: all.filter(s => s.tier === 'weekly').length,
    daily:  all.filter(s => s.tier === 'daily').length,
    live:   all.filter(s => s.tier === 'live').length,
    mrr:    all.reduce((sum, s) => {
      const prices = { weekly: 97, daily: 197, live: 397 };
      return sum + (prices[s.tier] || 0);
    }, 0),
  };
}

// ─── Persistence backup ────────────────────────────────────────────────────────
// On startup, restore from MONITORING_SUBSCRIBERS env var if file is missing

export function restoreFromEnv() {
  if (fs.existsSync(DATA_FILE)) return;
  const envData = process.env.MONITORING_SUBSCRIBERS;
  if (!envData) return;
  try {
    const parsed = JSON.parse(envData);
    saveSubscribers(parsed);
    console.log('[monitoring] Restored subscribers from env var.');
  } catch (e) {
    console.error('[monitoring] Failed to restore from env:', e.message);
  }
}
