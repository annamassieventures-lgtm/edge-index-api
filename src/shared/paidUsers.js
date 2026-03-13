/**
 * Edge Index — Paid User Registry
 *
 * Checks whether an email address has a paid subscription.
 * Sources (both checked):
 *   1. PAID_EMAILS env var — comma-separated, manually managed by Anna in Railway
 *   2. data/paid-emails.json — populated by Whop webhook on payment events
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAID_FILE = path.join(__dirname, '..', '..', 'data', 'paid-emails.json');

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

/**
 * Check if an email address has paid access.
 * Case-insensitive. Checks env var + JSON file.
 */
export function isPaidEmail(email) {
  if (!email) return false;
  const normalised = email.toLowerCase().trim();

  // Check Railway env var override (comma-separated)
  const envEmails = (process.env.PAID_EMAILS || '')
    .split(',')
    .map(e => e.toLowerCase().trim())
    .filter(Boolean);
  if (envEmails.includes(normalised)) return true;

  // Check JSON file (populated by Whop webhook)
  const fileEmails = loadPaidEmailsFromFile().map(e => e.toLowerCase().trim());
  return fileEmails.includes(normalised);
}

/**
 * Register an email as paid (appended to JSON file).
 * Called by the Whop webhook handler.
 */
export function addPaidEmail(email) {
  if (!email) return;
  const normalised = email.toLowerCase().trim();
  const list = loadPaidEmailsFromFile();
  if (!list.map(e => e.toLowerCase().trim()).includes(normalised)) {
    list.push(normalised);
    savePaidEmailsToFile(list);
    console.log(`✅ Paid email added: ${normalised}`);
  }
}

/**
 * Get all paid emails from both sources (for admin listing).
 */
export function getAllPaidEmails() {
  const fromFile = loadPaidEmailsFromFile().map(e => e.toLowerCase().trim());
  const fromEnv  = (process.env.PAID_EMAILS || '')
    .split(',')
    .map(e => e.toLowerCase().trim())
    .filter(Boolean);
  return [...new Set([...fromFile, ...fromEnv])];
}
