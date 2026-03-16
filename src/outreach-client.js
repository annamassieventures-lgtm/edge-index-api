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
// Uses gramjs start() which holds ONE connection open and waits for the code.
// requestOtp() starts the flow and pauses at the phoneCode callback.
// verifyOtp(code) resolves that callback, completing auth on the same connection.

let pendingCodeResolver = null;
let pendingAuthPromise  = null;

export async function requestOtp() {
  // Clean up any previous attempt
  if (authClient) { try { await authClient.disconnect(); } catch {} }

  authClient = new TelegramClient(new StringSession(''), API_ID, API_HASH, {
    connectionRetries: 5,
  });

  // start() runs in background — it will pause waiting for phoneCode promise
  pendingAuthPromise = authClient.start({
    phoneNumber: async () => PHONE,
    phoneCode:   () => new Promise((resolve) => { pendingCodeResolver = resolve; }),
    onError:     (err) => { console.error('[OUTREACH] Auth error:', err.message); },
  });

  return true;
}

export async function verifyOtp(code) {
  if (!pendingCodeResolver) {
    throw new Error('No pending OTP request. Run /admin tgauth start first.');
  }

  // Unblock the start() flow with the code
  pendingCodeResolver(code.trim());
  pendingCodeResolver = null;

  // Wait for start() to finish authenticating
  await pendingAuthPromise;
  pendingAuthPromise = null;

  const sessionString = authClient.session.save();
  saveSession(sessionString);

  // Promote to live outreach client
  client    = authClient;
  authClient = null;
  client.addEventHandler(handleIncomingMessage, new NewMessage({}));

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
