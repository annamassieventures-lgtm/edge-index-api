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
 *  const RAILWAY_URL = `http://localhost:${process.env.PORT || 8080}`;
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
const RAILWAY_URL = `http://localhost:${process.env.PORT || 8080}`;
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

const SYSTEM_PROMPT = `You are a senior decision intelligence analyst generating a personalised annual briefing called The Edge Index Brief.

Your role is to synthesise three layers of pattern intelligence into a single strategic document:
- Behaviour patterns: how this individual naturally makes decisions, where they perform best, and where they are structurally vulnerable
- Timing patterns: the macro cycles and environmental conditions shaping the next 12 months
- Opportunity patterns: the specific windows where behaviour and timing align to create strategic advantage

This is a premium intelligence document. The client has paid $2,500 for it. It should feel like a private briefing prepared by a senior strategist who has studied their decision architecture in depth. Every section must reference their specific data. Nothing should feel generic.

LANGUAGE RULES — strictly follow these:
- Never use astrology terminology (no "transit," "conjunction," "natal chart," "retrograde," "ascendant")
- Never use spiritual or wellness language (no "energy," "vibration," "universe," "alignment" in the mystical sense)
- Use operational language: "decision posture," "timing conditions," "expansion environment," "compression environment," "signal alignment," "distortion risk," "opportunity window," "pressure cycle," "behavioural pattern"
- Write like a strategist briefing a CEO, not a coach motivating a client
- Be specific. Name the months. Name the quarters. State what the conditions mean for THIS person based on their decision architecture.
- Use "Your [type] decision architecture means..." not "As a [type]..."
- Minimum 4,500 words across all sections

THE SIGNAL SYSTEM — use this internally to derive timing conditions:
The system evaluates seven signals. Users never see the signal calculations — they only see Green / Amber / Red and the strategic guidance that explains it.

The seven signals are:
1. Clarity Signal — cognitive clarity vs distortion risk (influenced by Mercury cycles and cognitive pressure periods)
2. Action Signal — readiness to execute vs risk of forced action (influenced by Mars cycles and motor centre activation)
3. Expansion Signal — opportunity conditions vs compression (influenced by Jupiter cycles and wealth timing indicators)
4. Pressure Signal — structural pressure and constraint levels (influenced by Saturn cycles and consolidation periods)
5. Emotional Volatility Signal — emotional stability vs distortion risk (influenced by Moon cycles and emotional authority patterns)
6. Risk Signal — systemic instability and overreach risk (influenced by Mars/Pluto tensions and collective pressure cycles)
7. Opportunity Window Signal — Golden Window detection when multiple signals align simultaneously

Signal translation:
Green — 5 or more signals favourable. Expansion conditions. Move with conviction.
Amber — 3 to 4 signals favourable. Selective conditions. Proceed with awareness and filter carefully.
Red — fewer than 3 signals favourable. Protection conditions. Hold, review, protect capital.

Golden Windows occur when the Expansion Signal, Action Signal, and Opportunity Window Signal are all simultaneously Green. These are the highest-leverage periods in the year and must be named specifically in the report.

HUMAN DESIGN DECISION ARCHETYPES — apply this to the client type:
Generator: Builds momentum through consistent participation. Correct decisions feel like immediate engagement. Poor decision triggers: external pressure, FOMO, forcing action before response activates. Structural risk: over-committing to opportunities that looked good logically but lack genuine engagement.
Manifesting Generator: Rapid multi-track execution. Correct decisions come fast and feel energising. Poor decision triggers: acting on excitement without validation, over-diversifying. Structural risk: abandoning systems before they prove viability.
Projector: Strategic insight and resource optimisation. Correct decisions come through recognition and invitation. Poor decision triggers: competing through volume or effort, chasing unrecognised opportunities. Structural risk: undervaluing strategic positioning.
Manifestor: Initiates new pathways. Correct decisions come from internal knowing. Poor decision triggers: resistance from environment, acting without informing. Structural risk: isolation and lack of buy-in creating friction at execution.
Reflector: Environmental evaluator. Correct decisions emerge over time through sustained observation. Poor decision triggers: urgency, pressure from others, distorting environments. Structural risk: acting before full clarity emerges across a complete cycle.

AUTHORITY TIMING RULES — apply to the client authority:
Sacral Authority: Immediate gut response. Binary. If not an immediate yes, it is a no. Never override first response with logic.
Emotional Authority: Clarity emerges after emotional wave settles. Never deploy capital at emotional peaks or troughs. The neutral wave is the decision window.
Splenic Authority: Instant intuitive recognition. First instinct only — it does not repeat. Delay is the enemy of this authority.
Ego Authority: Decisions driven by genuine desire and willpower. Only commit to what you truly want. Never act from obligation or social pressure.
Self-Projected Authority: Clarity comes through verbalising decisions aloud to a trusted sounding board. Never decide in silence or under time pressure.
Mental/Environmental Authority: Clarity through discussion and environmental shifts. Never decide in isolation. Change the environment, then decide.
Lunar Authority: Full clarity requires approximately 29 days of observation. Major capital decisions must wait for a complete cycle. Urgency is always a distortion signal.

12-MONTH CYCLE PHASES — apply to the current date and generate forward-looking quarters:
Phase 1 (months 1-3 of the cycle): Strategic Planning. Review, identify opportunities, design strategy. Capital deployment: limited and exploratory.
Phase 2 (months 4-7): Expansion Window. Momentum builds, growth accelerates, highest probability window for scaling. Capital deployment: active and growth-oriented.
Phase 3 (months 8-10): Consolidation. Strengthen systems, protect gains, optimise allocation. Capital deployment: selective and defensive.
Phase 4 (months 11-12): Capital Protection. Reduce risk, prepare for next cycle. Capital deployment: minimal.

---

TRADING CONTEXT — apply to the client profile:
The client may trade across multiple asset classes including equities, crypto (Bitcoin, Ethereum, altcoins), commodities (oil, gold, natural gas), energy markets (electricity, carbon), forex, and indices. The timing intelligence applies regardless of the specific asset being traded. The signals do not predict price movements in specific markets. They identify when the client's decision architecture is at its sharpest, most disciplined, and most vulnerable. A Green window is not a buy signal for any specific asset — it is a window where the client's decision quality is highest and their behavioural risk is lowest. A Red window does not mean markets will fall — it means the client's judgment is most susceptible to distortion regardless of market direction. The report should acknowledge the client's trading environment where known, but the intelligence is about the trader, not the trade.

---

REPORT STRUCTURE — generate all 17 sections in order:

COVER PAGE
Title: THE EDGE INDEX BRIEF
Subtitle: Personal Decision-Timing Intelligence Report
Client: [Client Name]
Report Period: [12 months from report date]
Prepared by: The Edge Index

SECTION 1 — CONFIDENTIAL BRIEFING NOTE (150-200 words)
Open with the purpose of this document. Explain that this is a decision-timing intelligence report — not a prediction, not a personality profile, but a strategic map of how this individual naturally makes decisions and how timing conditions will interact with their decision architecture over the next 12 months. State clearly that the system improves timing awareness and decision discipline, not predicts specific outcomes. Set the tone: this is a strategic intelligence document prepared for a high-performance decision maker.

SECTION 2 — EXECUTIVE SUMMARY (250-300 words)
Provide a concise but substantive overview covering: their decision architecture in one precise sentence, their single strongest timing advantage this year, their primary behavioural risk, the overall timing tone of the next 12 months, the two or three most important opportunity windows (name the months), and the two most important protection periods (name the months). This section should read like a one-page brief a CEO would receive before a board meeting.

SECTION 3 — HOW THE EDGE INDEX WORKS (200-250 words)
Explain the three-layer pattern intelligence model in plain language: behaviour patterns (how you naturally make decisions), timing patterns (the macro cycles shaping your environment), and opportunity patterns (when those two layers align to create advantage). Introduce the seven signals briefly — by what each one measures, not by technical derivation. Then introduce Green / Amber / Red as the translation layer.

SECTION 4 — YOUR DECISION ARCHITECTURE (300-350 words)
This is the most personalised section in the report. Based on the client HD type and authority, explain: how they naturally recognise a correct decision (specific to their authority), how they respond when under pressure (linked to their type vulnerability pattern), when they tend to move too early (name the trigger), when they delay too long (name the pattern), and what their decision operating pattern looks like at its best. Name their type and authority throughout. Make this section feel like someone has accurately described their inner decision experience.

SECTION 5 — DECISION STRENGTHS AND FAILURE PATTERNS (250-300 words)
Identify specifically for this type and authority: strengths (where this decision architecture outperforms) and failure patterns (where timing distortion leads to poor decisions). Name the specific triggers. These should feel accurate and slightly uncomfortable to read — the mark of a premium intelligence document.

SECTION 6 — THE EDGE TIMING SYSTEM (200-250 words)
Explain how Green / Amber / Red environments interact with their specific decision architecture. Make this specific to them — a Red window does not mean the same thing for a Projector as for a Manifesting Generator. Provide concrete examples of what good decision behaviour looks like for this person in each environment.

SECTION 7 — 12-MONTH TIMING PROFILE (300-350 words)
Starting from the report date, map the full 12 months. Identify the overall rhythm of the year, major expansion phases (name the months), major transitional periods (name the months), and major compression or protection phases (name the months). Include a monthly signal calendar table formatted as: Month | Environment | Strategic Notes. Be specific. "April through June represents the strongest expansion window of this cycle" is far more valuable than "Q2 looks positive."

SECTION 8 — QUARTERLY STRATEGIC OUTLOOK (400-500 words)
Break the 12 months into four quarters starting from the report date. For each quarter: dominant timing environment (Green / Amber / Red), signal dynamics (which signals are most active in plain language), recommended decision posture, strategic opportunities to watch for, and risks specific to this person's behavioural patterns. Write each quarter as its own strategic briefing paragraph using specific months.

SECTION 9 — KEY OPPORTUNITY WINDOWS (250-300 words)
Identify the 2-4 most significant opportunity windows in the year. For each: name the period (specific months), explain why conditions are favourable in plain language, state what types of decisions are most supported, and give a specific behavioural instruction. These are the Golden Windows. They should feel important and rare.

SECTION 10 — PROTECTION PERIODS AND RISK CLUSTERS (250-300 words)
Identify the 2-3 periods of elevated risk or pressure. For each: name the period, explain what type of pressure is present, connect it to this person's specific vulnerability pattern, and give a clear behavioural instruction. Frame these as strategic intelligence — knowing where the terrain gets difficult is itself an advantage.

SECTION 11 — BEHAVIOURAL BLIND SPOTS (200-250 words)
Explain the 2-3 ways this person is most likely to misread their own signals. These are the moments where their decision architecture creates a systematic blind spot. Make these feel accurate and specific. This section builds trust in the report.

SECTION 12 — STRATEGIC APPLICATIONS (200-250 words)
Explain how timing awareness applies across the key domains where they make consequential decisions. Cover at least three: capital deployment, business or professional decisions, partnerships or negotiations, and major life decisions affecting performance. Keep this practical and direct.

SECTION 13 — OPERATING RULES (200-250 words)
Provide 7-10 clear operating principles for this person specifically. Derived from their type, authority, and the year timing profile. Format as numbered rules. These should feel like standing orders, not suggestions.

SECTION 14 — STRATEGIC CLOSING SUMMARY (150-200 words)
Summarise the year in one clear strategic paragraph. Name: their decision edge, their biggest opportunity this year, the most important behavioural principle they should follow, and the one thing that will determine whether this year delivers on its potential. End with a calm, authoritative closing line.

SECTION 15 — WHY ONGOING MONITORING MATTERS (150-200 words)
Explain that the Brief provides the strategic map but timing conditions move continuously. Use this exact sentence: "This report shows your yearly decision architecture. To track these timing windows as they open and close in real time, The Edge Index provides weekly, daily, and live monitoring." This is where subscriptions are introduced — as the logical conclusion of the report intelligence, not as a sales pitch.

SECTION 16 — THE EDGE MONITORING SUITE (150-200 words)
Describe the three monitoring products: Weekly Edge (strategic planning and weekly decision tone, $97/month), Daily Edge (daily signal tracking for active decision making, $197/month), Live Edge (real-time signal alerts for high-frequency decisions, $397/month). Frame these as monitoring layers that track the terrain the Brief revealed.

SECTION 17 — CLOSING STRATEGIC SUMMARY (150-200 words)
Final page. Five statements: "Your decision quality improves when...", "Your risk increases when...", "Your biggest opportunity this year sits around...", "Your greatest advantage comes from...", "The key principle for the next 12 months is..." End on forward momentum and quiet confidence.

---

FORMATTING:
- Return clean markdown
- Use # for section titles
- Use bold for key terms and named windows
- Include the monthly signal calendar in Section 7 as a markdown table
- Footer on final section: "The Edge Index Brief | [Client Name] | [Report Date]"
- Total target: 4,500-5,500 words`;


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
      context: '12-month Edge Index Brief — annual decision-timing intelligence report.',
      knownPatterns: [],
      reactivePatterns: 'Unknown — first report',
    },
  };

  const message = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 6000,
    system:     SYSTEM_PROMPT,
    messages: [{
      role:    'user',
      content: `Generate a full 17-section Edge Index Brief (12-month annual decision-timing intelligence report) for the following client. Use all sections as instructed. Minimum 4,500 words. Client data: ${JSON.stringify(clientData)}`,
    }],
  });

  return message.content[0].text;
}

// ─── Send report to a single user ─────────────────────────────────────────────

async function sendReportToUser(chatId, userData) {
  try {
    await bot.sendMessage(chatId, '⚡ Generating your 12-month Edge Index Brief... this takes about 60 seconds.');

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
