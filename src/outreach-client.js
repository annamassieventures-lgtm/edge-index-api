// ─── outreach-client.js ────────────────────────────────────────────────────
// gramjs MTProto client for sending outreach DMs from Anna's personal account.
// Auth flow:
//   1. /admin tgauth start   → requests OTP via Telegram
//   2. /admin tgauth <code>  → completes auth, saves session string
// After auth, TELEGRAM_SESSION env var persists the session across redeploys.

import { TelegramClient }  from 'telegram';
import { Api }             from 'telegram';
import { StringSession }   from 'telegram/sessions/index.js';
import { NewMessage }      from 'telegram/events/index.js';
import path                from 'path';
import fs                  from 'fs';
import { fileURLToPath }   from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_ID   = 38833025;
const API_HASH = 'f33a4fa1b3fad3a68c585556c6cf5358';
const PHONE    = '+61438703922';

const SESSION_FILE  = path.join(__dirname, '..', 'data', 'telegram-session.txt');
const HASH_FILE     = path.join(__dirname, '..', 'data', 'tg-pending-hash.txt');

// ─── Session persistence ────────────────────────────────────────────────────

function loadSession() {
  // Prefer env var (survives Railway redeploys)
  if (process.env.TELEGRAM_SESSION) return process.env.TELEGRAM_SESSION;
  // Fall back to file
  if (fs.existsSync(SESSION_FILE)) return fs.readFileSync(SESSION_FILE, 'utf8').trim();
  return '';
}

function saveSession(sessionString) {
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  fs.writeFileSync(SESSION_FILE, sessionString);
  console.log('[OUTREACH] Session saved to file. Add TELEGRAM_SESSION to Railway env vars.');
}

// ─── Client singleton ───────────────────────────────────────────────────────

let client        = null;
let pendingHash   = null; // phoneCodeHash during OTP flow
let authClient    = null; // kept alive between requestOtp and verifyOtp
let replyCallback = null; // called when a target replies

export async function initOutreachClient(onReply) {
  replyCallback = onReply;

  const sessionString = loadSession();
  if (!sessionString) {
    console.log('[OUTREACH] No session found — run /admin tgauth start to authenticate.');
    return false;
  }

  try {
    client = new TelegramClient(new StringSession(sessionString), API_ID, API_HASH, {
      connectionRetries: 5,
    });

    await client.connect();
    console.log('[OUTREACH] Telegram client connected.');

    // Listen for incoming messages from outreach targets
    client.addEventHandler(handleIncomingMessage, new NewMessage({}));

    return true;
  } catch (err) {
    console.error('[OUTREACH] Failed to connect:', err.message);
    client = null;
    return false;
  }
}

// ─── Auth flow ──────────────────────────────────────────────────────────────

export async function requestOtp() {
  // Keep authClient alive so the same connection is used for verifyOtp
  authClient = new TelegramClient(new StringSession(''), API_ID, API_HASH, {
    connectionRetries: 3,
  });
  await authClient.connect();

  const result = await authClient.sendCode({ apiId: API_ID, apiHash: API_HASH }, PHONE);
  pendingHash = result.phoneCodeHash;

  // Also persist hash to file as backup
  fs.mkdirSync(path.dirname(HASH_FILE), { recursive: true });
  fs.writeFileSync(HASH_FILE, pendingHash);

  // Do NOT disconnect — keep alive for verifyOtp
  return true;
}

export async function verifyOtp(code) {
  // Recover hash
  if (!pendingHash) {
    if (fs.existsSync(HASH_FILE)) {
      pendingHash = fs.readFileSync(HASH_FILE, 'utf8').trim();
    } else {
      throw new Error('No pending OTP request found. Run /admin tgauth start first.');
    }
  }

  // Reuse authClient if still connected, otherwise reconnect
  if (!authClient || !authClient.connected) {
    authClient = new TelegramClient(new StringSession(''), API_ID, API_HASH, {
      connectionRetries: 3,
    });
    await authClient.connect();
  }

  try {
    await authClient.invoke(new Api.auth.SignIn({
      phoneNumber: PHONE,
      phoneCodeHash: pendingHash,
      phoneCode: code.trim(),
    }));
  } catch (err) {
    if (err.message.includes('SESSION_PASSWORD_NEEDED')) {
      throw new Error('2FA is enabled on this account. Disable 2FA in Telegram settings first, then retry.');
    }
    throw err;
  }

  const sessionString = authClient.session.save();
  saveSession(sessionString);

  // Promote authClient to the live outreach client
  client = authClient;
  authClient = null;
  client.addEventHandler(handleIncomingMessage, new NewMessage({}));

  pendingHash = null;
  if (fs.existsSync(HASH_FILE)) fs.unlinkSync(HASH_FILE);
  return sessionString;
}

// ─── Send message ───────────────────────────────────────────────────────────

export async function sendOutreachMessage(username, text) {
  if (!client) throw new Error('Outreach client not connected. Run /admin tgauth start.');

  // username can be @handle or just handle
  const target = username.startsWith('@') ? username.slice(1) : username;

  await client.sendMessage(target, { message: text });
  console.log(`[OUTREACH] Sent to @${target}`);
  return true;
}

export function isConnected() {
  return client !== null && client.connected;
}

// ─── Incoming message handler ────────────────────────────────────────────────

// Inline target loader to avoid circular dependency with outreach-sequencer.js
function loadTargetsForReplyDetection() {
  try {
    const file = path.join(__dirname, '..', 'data', 'outreach-state.json');
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf8')).targets || [];
  } catch { return []; }
}

async function handleIncomingMessage(event) {
  try {
    const message = event.message;
    if (!message || message.out) return; // skip outgoing

    const sender = await message.getSender();
    if (!sender) return;

    const senderUsername = sender.username ? `@${sender.username}` : null;
    if (!senderUsername) return;

    // Check if sender is one of our outreach targets
    const targets = loadTargetsForReplyDetection();
    const target = targets.find(t =>
      t.handle && t.handle.toLowerCase() === senderUsername.toLowerCase()
    );

    if (!target) return;

    console.log(`[OUTREACH] Reply from ${senderUsername}: ${message.text}`);

    if (replyCallback) {
      await replyCallback({
        targetId: target.id,
        targetName: target.name,
        handle: senderUsername,
        messageText: message.text,
        stage: target.stage,
      });
    }
  } catch (err) {
    console.error('[OUTREACH] Error handling incoming message:', err.message);
  }
}
