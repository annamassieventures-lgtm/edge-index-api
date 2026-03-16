// One-time Telegram auth script — generates a session string for Railway
// Usage:
//   Step 1: node auth-telegram.mjs request
//   Step 2: node auth-telegram.mjs verify <OTP_CODE>

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import fs from 'fs';
import path from 'path';

const API_ID   = 38833025;
const API_HASH = 'f33a4fa1b3fad3a68c585556c6cf5358';
const PHONE    = '+61438703922';
const SESSION_FILE = path.join(process.cwd(), 'data', 'telegram-session.txt');

const [,, command, otpCode] = process.argv;

if (command === 'request') {
  // ── Phase 1: send OTP to Anna's phone ──
  const client = new TelegramClient(new StringSession(''), API_ID, API_HASH, {
    connectionRetries: 3,
  });

  await client.connect();

  const result = await client.sendCode({ apiId: API_ID, apiHash: API_HASH }, PHONE);
  const phoneCodeHash = result.phoneCodeHash;

  // Save hash so Phase 2 can use it
  fs.writeFileSync('/tmp/tg_phone_code_hash.txt', phoneCodeHash);

  console.log('✅ OTP sent to +61438703922 via Telegram.');
  console.log('Check your Telegram messages and run:');
  console.log('  node auth-telegram.mjs verify <CODE>');

  await client.disconnect();
  process.exit(0);
}

if (command === 'verify') {
  if (!otpCode) {
    console.error('Usage: node auth-telegram.mjs verify <OTP_CODE>');
    process.exit(1);
  }

  const phoneCodeHash = fs.readFileSync('/tmp/tg_phone_code_hash.txt', 'utf8').trim();

  const client = new TelegramClient(new StringSession(''), API_ID, API_HASH, {
    connectionRetries: 3,
  });

  await client.connect();

  await client.invoke({
    className: 'auth.SignIn',
    phoneNumber: PHONE,
    phoneCodeHash,
    phoneCode: otpCode,
  });

  const sessionString = client.session.save();

  // Save to file
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  fs.writeFileSync(SESSION_FILE, sessionString);

  console.log('\n✅ Authentication successful!');
  console.log('\n══ ADD THIS TO RAILWAY ENV VARS ══');
  console.log('Variable name: TELEGRAM_SESSION');
  console.log('Value:');
  console.log(sessionString);
  console.log('══════════════════════════════════\n');

  await client.disconnect();
  process.exit(0);
}

console.error('Usage:');
console.error('  node auth-telegram.mjs request');
console.error('  node auth-telegram.mjs verify <OTP_CODE>');
process.exit(1);
