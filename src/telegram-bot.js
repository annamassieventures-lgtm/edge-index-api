/**
 * Edge Index — Telegram Bot
 *
 * Handles:
 *  - New user onboarding (collects birth data)
 *  - On-demand report generation (/report)
 *  - Weekly automated delivery (every Monday 8am UTC)
 *
 * Required environment variables (set in Railway or .env):
 *  TELEGRAM_BOT_TOKEN   — from @BotFather
 *  RAILWAY_API_URL      — your Railway API base URL, e.g. https://edge-index-api.up.railway.app
 *  ANTHROPIC_API_KEY    — from console.anthropic.com
 *
 * Install dependencies before running:
 *  npm install node-telegram-bot-api node-cron @anthropic-ai/sdk
 */

import TelegramBot from 'node-telegram-bot-api';
import cron from 'node-cron';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Configuration ────────────────────────────────────────────────────────────

const BOT_TOKEN     = process.env.TELEGRAM_BOT_TOKEN;
const RAILWAY_URL   = process.env.RAILWAY_API_URL || 'http://localhost:3000';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

if (!BOT_TOKEN)     throw new Error('TELEGRAM_BOT_TOKEN is required');
if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_API_KEY is required');

const bot       = new TelegramBot(BOT_TOKEN, { polling: true });
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

// ─── User data persistence ─────────────────────────────────────────────────────
// Stored as a JSON file. Replace with a database for production scale.

const DATA_FILE = path.join(__dirname, '..', 'data', 'users.json');

function loadUsers() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, '{}');
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveUsers(users) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
}

function getUser(chatId) {
  return loadUsers()[String(chatId)] || null;
}

function saveUser(chatId, data) {
  const users = loadUsers();
  users[String(chatId)] = { ...users[String(chatId)], ...data };
  saveUsers(users);
}

function getAllUsers() {
  return loadUsers();
}

// ─── Conversation state ────────────────────────────────────────────────────────
// Tracks what stage of onboarding each user is at

const state = {}; // { chatId: 'awaiting_date' | 'awaiting_time' | 'awaiting_location' | 'complete' }

// ─── Geocoding ─────────────────────────────────────────────────────────────────

async function geocode(locationString) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(locationString)}&format=json&limit=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'EdgeIndex/1.0 (contact@edgeindex.io)' }
    });
    const data = await res.json();
    if (!data || !data.length) return null;
    return {
      lat: parseFloat(data[0].lat),
      lon: parseFloat(data[0].lon),
      display: data[0].display_name,
    };
  } catch {
    return null;
  }
}

// ─── API calls to Railway ──────────────────────────────────────────────────────

async function getHumanDesignChart(userData) {
  const res = await fetch(`${RAILWAY_URL}/chart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      date_of_birth: userData.dob,           // "YYYY-MM-DD"
      birth_time:    userData.time,           // "HH:MM"
      birth_location: userData.location,
      lat:           userData.lat,
      lon:           userData.lon,
      timezone:      userData.timezone ?? 0, // default UTC if unknown
    }),
  });
  if (!res.ok) throw new Error(`Chart API error: ${res.status}`);
  return res.json();
}

async function getMoonData() {
  const now = new Date();
  const res = await fetch(`${RAILWAY_URL}/moon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      date: now.toISOString().split('T')[0],
      lat: 0,
      lon: 0,
    }),
  });
  if (!res.ok) throw new Error(`Moon API error: ${res.status}`);
  return res.json();
}

async function getPlanetaryHours() {
  const now = new Date();
  const res = await fetch(`${RAILWAY_URL}/hours`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      date: now.toISOString().split('T')[0],
      lat:  0,
      lon:  0,
    }),
  });
  if (!res.ok) throw new Error(`Hours API error: ${res.status}`);
  return res.json();
}

// ─── Claude report generation ──────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a specialized financial psychology analyst and astrological timing strategist, generating personalized "Edge Index" reports for professional traders, crypto investors, and high-stakes decision makers.

Your purpose is to synthesize Human Design chart psychology, current planetary transits, and behavioral patterns into actionable intelligence about when and how the client makes decisions — particularly around money, risk, and capital deployment.

This is NOT a wellness report. This is a performance analysis. Your language should be precise, direct, and data-forward. The client is paying for real insight into their decision-making vulnerabilities and optimal windows. Write as if you are a coach who understands the exact mechanisms of their self-sabotage.

Generate the report in 7 sections (800–1,200 words total):
1. EXECUTIVE SUMMARY — THE EDGE INDEX READING (120–150 words)
2. YOUR MONEY BLUEPRINT — THE PSYCHOLOGY LAYER (150–200 words)
3. THE DECISION AUTHORITY — YOUR TIMING FRAMEWORK (100–140 words)
4. YOUR OPTIMAL WINDOWS THIS WEEK (150–200 words) — include specific days, times, COHERENCE/REACTIVE/10X labels
5. THE 10X ALIGNMENT WINDOW (100–150 words) — the single most important moment this week
6. HIGH-RISK WINDOWS (80–120 words) — when NOT to trade, with specific days/times
7. WEEKLY ACTION PROTOCOL (80–120 words) — 5–7 explicit rules for this week

Tone: Direct. No softening. Use "You will" not "you might." Reference their chart elements specifically. Performance-framed. Actionable. Premium — language that feels rare and earned.

Close with: "This is your edge. Whether you use it is the only variable that matters."

Return as clean markdown. Include footer: "Edge Index Report · [Name] · [Date]"`;

async function generateReport(userData, chartData, moonData, hoursData) {
  const clientData = {
    client: {
      name:          userData.firstName || 'Trader',
      birthDate:     userData.dob,
      birthTime:     userData.time,
      birthLocation: userData.location,
    },
    humanDesign: {
      type:           chartData.human_design.type,
      profile:        chartData.human_design.profile?.join('/') || chartData.human_design.profile,
      authority:      chartData.human_design.authority,
      strategy:       chartData.human_design.strategy,
      definedCenters: chartData.human_design.defined_centers,
      undefinedCenters: chartData.human_design.undefined_centers,
      incarnationCross: chartData.human_design.incarnation_cross,
      channels:       chartData.human_design.channels,
    },
    currentAstrology: {
      reportDate:    new Date().toISOString().split('T')[0],
      moonPhase:     moonData.phase ?? moonData.moonPhase ?? 'Unknown',
      lunarDay:      moonData.lunarDay ?? moonData.lunar_day ?? null,
      sunSign:       moonData.sunSign ?? moonData.sun_sign ?? null,
      retrogrades:   moonData.retrogrades ?? [],
      planetaryHourGovernor: hoursData.currentHour?.planet ?? hoursData.current_hour?.planet ?? 'Unknown',
    },
    moneyBlueprint: {
      context: 'Weekly Edge Index report — no additional context provided.',
      knownPatterns: [],
      reactivePatterns: 'Unknown — first report',
    },
  };

  const message = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 2000,
    system:     SYSTEM_PROMPT,
    messages: [{
      role:    'user',
      content: `Generate an Edge Index report for the following client: ${JSON.stringify(clientData)}`,
    }],
  });

  return message.content[0].text;
}

// ─── Send report to a single user ─────────────────────────────────────────────

async function sendReportToUser(chatId, userData) {
  try {
    await bot.sendMessage(chatId, '⚡ Generating your Edge Index report... this takes about 30 seconds.');

    const [chartData, moonData, hoursData] = await Promise.all([
      getHumanDesignChart(userData),
      getMoonData(),
      getPlanetaryHours(),
    ]);

    const report = await generateReport(userData, chartData, moonData, hoursData);

    // Telegram has a 4096 char limit per message — split if needed
    if (report.length <= 4000) {
      await bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });
    } else {
      const chunks = report.match(/[\s\S]{1,4000}/g) || [report];
      for (const chunk of chunks) {
        await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
        await new Promise(r => setTimeout(r, 500)); // small delay between chunks
      }
    }

    // Update last report timestamp
    saveUser(chatId, { lastReportAt: new Date().toISOString() });

  } catch (err) {
    console.error(`Error sending report to ${chatId}:`, err.message);
    await bot.sendMessage(chatId, '⚠️ There was an error generating your report. Please try again in a few minutes, or reply /report to retry.');
  }
}

// ─── Bot message handlers ──────────────────────────────────────────────────────

// /start — welcome message
bot.onText(/\/start/, async (msg) => {
  const chatId    = msg.chat.id;
  const firstName = msg.from?.first_name || 'there';

  saveUser(chatId, { chatId, firstName, telegramUsername: msg.from?.username });
  state[chatId] = 'awaiting_date';

  await bot.sendMessage(chatId, `Welcome to The Edge Index ⚡

I'm your personalised trading timing intelligence system.

To generate your Edge Index report, I need three things:

1. Your **date of birth** (DD/MM/YYYY)
2. Your **time of birth** (HH:MM — approximate is fine)
3. Your **city and country of birth**

Reply with your **date of birth** to begin.`, { parse_mode: 'Markdown' });
});

// /report — generate report on demand
bot.onText(/\/report/, async (msg) => {
  const chatId = msg.chat.id;
  const user   = getUser(chatId);

  if (!user || !user.dob || !user.time || !user.location) {
    state[chatId] = 'awaiting_date';
    await bot.sendMessage(chatId, "I don't have your birth data yet. Let's set that up first.\n\nReply with your **date of birth** (DD/MM/YYYY):", { parse_mode: 'Markdown' });
    return;
  }

  await sendReportToUser(chatId, user);
});

// /mystats — show stored birth data
bot.onText(/\/mystats/, async (msg) => {
  const chatId = msg.chat.id;
  const user   = getUser(chatId);

  if (!user || !user.dob) {
    await bot.sendMessage(chatId, "I don't have your data yet. Send /start to begin.");
    return;
  }

  await bot.sendMessage(chatId, `Your Edge Index profile:\n\n📅 Date of birth: ${user.dob}\n🕐 Time of birth: ${user.time}\n📍 Birth location: ${user.location}\n\nSend /report to generate your current week's report.`);
});

// /help
bot.onText(/\/help/, async (msg) => {
  await bot.sendMessage(msg.chat.id, `Edge Index commands:

/start — set up your profile
/report — generate your weekly report now
/mystats — view your stored birth data
/help — show this message

Your weekly report is automatically sent every Monday morning.`);
});

// Handle free-text messages (onboarding flow)
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text   = msg.text?.trim();

  // Ignore commands (already handled above)
  if (!text || text.startsWith('/')) return;

  const currentState = state[chatId] || 'unknown';

  // ── Step 1: Date of birth ──
  if (currentState === 'awaiting_date') {
    // Accepts DD/MM/YYYY
    const dateMatch = text.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
    if (!dateMatch) {
      await bot.sendMessage(chatId, "Please enter your date of birth in DD/MM/YYYY format. Example: 15/03/1988");
      return;
    }
    const [, day, month, year] = dateMatch;
    const iso = `${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;
    saveUser(chatId, { dob: iso });
    state[chatId] = 'awaiting_time';
    await bot.sendMessage(chatId, `Got it — ${day}/${month}/${year} ✓\n\nNow your **time of birth** (HH:MM, 24-hour format). If you're not sure, give your best estimate — even within an hour is useful.`, { parse_mode: 'Markdown' });
    return;
  }

  // ── Step 2: Time of birth ──
  if (currentState === 'awaiting_time') {
    const timeMatch = text.match(/^(\d{1,2})[:\.](\d{2})$/);
    if (!timeMatch) {
      await bot.sendMessage(chatId, "Please enter your birth time as HH:MM (24-hour format). Example: 14:30 or 09:15");
      return;
    }
    const [, h, m] = timeMatch;
    const time = `${h.padStart(2,'0')}:${m}`;
    saveUser(chatId, { time });
    state[chatId] = 'awaiting_location';
    await bot.sendMessage(chatId, `Birth time ${time} ✓\n\nFinally, your **city and country of birth**. Example: Sydney, Australia`, { parse_mode: 'Markdown' });
    return;
  }

  // ── Step 3: Birth location ──
  if (currentState === 'awaiting_location') {
    await bot.sendMessage(chatId, `Looking up ${text}...`);

    const geo = await geocode(text);

    if (!geo) {
      await bot.sendMessage(chatId, `I couldn't find that location. Try being more specific — for example: "Sydney, Australia" or "London, UK"`);
      return;
    }

    saveUser(chatId, {
      location: text,
      lat:      geo.lat,
      lon:      geo.lon,
    });

    state[chatId] = 'complete';

    await bot.sendMessage(chatId, `${text} ✓ (${geo.lat.toFixed(2)}°, ${geo.lon.toFixed(2)}°)\n\n✅ Profile complete. Generating your first Edge Index report now...`, { parse_mode: 'Markdown' });

    const user = getUser(chatId);
    await sendReportToUser(chatId, user);
    return;
  }

  // ── Unknown state — prompt restart ──
  await bot.sendMessage(chatId, "Send /start to set up your Edge Index profile, or /report if you're already set up.");
});

// ─── Weekly automated delivery ─────────────────────────────────────────────────
// Every Monday at 8:00 AM UTC

cron.schedule('0 8 * * 1', async () => {
  console.log('Running weekly Edge Index report delivery...');
  const users = getAllUsers();

  for (const [chatId, userData] of Object.entries(users)) {
    if (!userData.dob || !userData.time || !userData.location) continue;
    console.log(`Sending weekly report to ${chatId} (${userData.firstName || 'unknown'})`);
    await sendReportToUser(chatId, userData);
    // Stagger sends — 3 seconds between each user to avoid rate limits
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log('Weekly delivery complete.');
}, {
  timezone: 'UTC',
});

// ─── Polling error handler ─────────────────────────────────────────────────────

bot.on('polling_error', (err) => {
  console.error('Telegram polling error:', err.message);
});

console.log('Edge Index Telegram bot started.');
console.log('Railway API:', RAILWAY_URL);
