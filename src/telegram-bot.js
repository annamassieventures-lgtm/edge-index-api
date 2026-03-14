/**
 * Edge Index — Telegram Bot v2
 *
 * Flow:
 *  1. /start → ask for email
 *  2. Email → verify payment (isPaidEmail) → if not paid, send Whop link
 *  3. If paid → collect date of birth → time → location → HD auto-calculated
 *  4. Generate 17-section annual brief via Claude
 *  5. Email report via Resend (HTML, styled)
 *  6. Confirm in Telegram: "Sent to your email"
 *
 * Cron jobs:
 *  - Monday 8am UTC: weekly report re-delivery to all paid users
 *  - Daily 22:00 UTC (8am AEST): outreach briefing to Anna's Telegram
 *
 * Admin commands (Anna only, via ANNA_CHAT_ID):
 *  /admin             — show admin menu
 *  /admin paid <email> — manually mark email as paid
 *  /admin users       — list registered users
 *  /admin emails      — list all paid emails
 *  /admin outreach    — show today's outreach briefing now
 *
 * Required env vars (Railway):
 *  TELEGRAM_BOT_TOKEN   — from @BotFather
 *  ANTHROPIC_API_KEY    — from console.anthropic.com
 *  RESEND_API_KEY       — from resend.com
 *  ANNA_CHAT_ID         — Anna's Telegram chat ID (send /myid to the bot to get it)
 *  WHOP_URL             — link to Whop checkout page (e.g. https://whop.com/edge-index)
 *  PAID_EMAILS          — comma-separated manual override list (optional)
 *  WHOP_WEBHOOK_SECRET  — from Whop dashboard (optional, for signature verification)
 */

import TelegramBot from 'node-telegram-bot-api';
import cron        from 'node-cron';
import Anthropic   from '@anthropic-ai/sdk';
import fs          from 'fs';
import path        from 'path';
import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'url';
import { isPaidEmail, addPaidEmail, getAllPaidEmails } from './shared/paidUsers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Configuration ─────────────────────────────────────────────────────────────

const BOT_TOKEN     = process.env.TELEGRAM_BOT_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_KEY    = process.env.RESEND_API_KEY;
const ANNA_CHAT_ID  = String(process.env.ANNA_CHAT_ID || '5838005991');
const WHOP_URL      = process.env.WHOP_URL || 'https://whop.com/edge-index';
const FROM_EMAIL    = 'The Edge Index <onboarding@resend.dev>'; // TODO: switch to reports@edgeindex.io once domain fully verified
const RAILWAY_URL   = `http://localhost:${process.env.PORT || 8080}`;

if (!BOT_TOKEN)     throw new Error('TELEGRAM_BOT_TOKEN is required');
if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_API_KEY is required');
if (!RESEND_KEY)    console.warn('⚠️  RESEND_API_KEY not set — email delivery disabled');

// Drop any existing webhook/polling conflict before starting
await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook?drop_pending_updates=true`).catch(() => {});

const bot       = new TelegramBot(BOT_TOKEN, { polling: { interval: 2000, autoStart: true, params: { timeout: 10 } } });
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

// ─── User data persistence ─────────────────────────────────────────────────────

const DATA_FILE = path.join(__dirname, '..', 'data', 'users.json');

function loadUsers() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, '{}');
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch { return {}; }
}

function saveUsers(users) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
}

function getUser(chatId)         { return loadUsers()[String(chatId)] || null; }
function getAllUsers()            { return loadUsers(); }
function saveUser(chatId, data)  {
  const users = loadUsers();
  users[String(chatId)] = { ...users[String(chatId)], ...data };
  saveUsers(users);
}

// ─── Outreach state persistence ────────────────────────────────────────────────

const OUTREACH_FILE = path.join(__dirname, '..', 'data', 'outreach-state.json');

const INITIAL_TARGETS = [
  { id: 'wolf-of-trading',   handle: '@WolfofTradingAdmin', name: 'Wolf of Trading',    platform: 'Telegram', size: '90k',   tier: 'Scale',      stage: 0, lastMessageDate: null, replied: false, notes: 'Also @wolfoftradingteam' },
  { id: 'bitcoin-bullets',   handle: '@joe1322',            name: 'Bitcoin Bullets',     platform: 'Telegram', size: '106k',  tier: 'Scale',      stage: 0, lastMessageDate: null, replied: false, notes: 'Also @BitcoinBullets' },
  { id: 'fat-pig-signals',   handle: '@dad10',              name: 'Fat Pig Signals',     platform: 'Telegram', size: '46k',   tier: 'Growth',     stage: 0, lastMessageDate: null, replied: false, notes: 'Also @gangplank123 @Ibrahim_Harb1' },
  { id: 'sureshotfx',        handle: '@sureshot_fx',        name: 'SureShotFX',          platform: 'Telegram', size: '48k',   tier: 'Growth',     stage: 0, lastMessageDate: null, replied: false, notes: 'Also @SSF_AdminBot' },
  { id: 'binance-killers',   handle: '@BKCEO',              name: 'Binance Killers',     platform: 'Telegram', size: '250k+', tier: 'Enterprise', stage: 0, lastMessageDate: null, replied: false, notes: 'Large — enterprise pitch' },
  { id: 'cryptoninjas',      handle: 'Reply to X/Telegram', name: 'CryptoNinjas Trading',platform: 'Telegram', size: '46k',   tier: 'Growth',     stage: 0, lastMessageDate: null, replied: false, notes: 'Public P&L posts' },
  { id: 'learn2trade',       handle: 'Via website',         name: 'Learn2Trade (L2T)',   platform: 'Discord',  size: '25k',   tier: 'Growth',     stage: 0, lastMessageDate: null, replied: false, notes: 'UK-based' },
  { id: 'jacobs-crypto-clan',handle: 'YouTube DM or Discord',name: "Jacob's Crypto Clan",platform: 'Discord',  size: '44.5k', tier: 'Growth',     stage: 0, lastMessageDate: null, replied: false, notes: 'Jacob Crypto Bury' },
  { id: 'rand-trading',      handle: 'YouTube DM or Discord',name: 'Rand Trading Group', platform: 'Discord',  size: '38.8k', tier: 'Growth',     stage: 0, lastMessageDate: null, replied: false, notes: '300K+ YouTube' },
  { id: 'eagle-investors',   handle: 'Discord DM',          name: 'Eagle Investors',     platform: 'Discord',  size: '160k+', tier: 'Enterprise', stage: 0, lastMessageDate: null, replied: false, notes: 'SEC-registered' },
  { id: 'cryptohub',         handle: 'Discord DM',          name: 'Cryptohub',           platform: 'Discord',  size: '54k',   tier: 'Scale',      stage: 0, lastMessageDate: null, replied: false, notes: '15+ analysts on staff' },
  { id: 'trader-capital',    handle: 'Discord DM',          name: 'Trader Capital LLC',  platform: 'Discord',  size: '19.8k', tier: 'Growth',     stage: 0, lastMessageDate: null, replied: false, notes: '' },
  { id: 'potion-alpha',      handle: '@Orangie on X',       name: 'Potion Alpha',        platform: 'Discord',  size: '12k+',  tier: 'Starter',    stage: 0, lastMessageDate: null, replied: false, notes: 'Crypto trader' },
  { id: 'the-trade-hub',     handle: 'Discord DM',          name: 'The Trade Hub',       platform: 'Discord',  size: '11.3k', tier: 'Starter',    stage: 0, lastMessageDate: null, replied: false, notes: '' },
  { id: 'fxgears',           handle: 'FXGears.com contact', name: 'FXGears',             platform: 'Discord',  size: '~20k',  tier: 'Growth',     stage: 0, lastMessageDate: null, replied: false, notes: 'Contact Jack' },
  { id: 'liquidity-hunter',  handle: 'Discord DM',          name: 'Liquidity Hunter Academy', platform: 'Discord', size: 'N/A', tier: 'Starter', stage: 0, lastMessageDate: null, replied: false, notes: '' },
  { id: 'elite-crypto',      handle: 'Discord DM',          name: 'Elite Crypto Signals',platform: 'Discord',  size: '23.5k', tier: 'Growth',     stage: 0, lastMessageDate: null, replied: false, notes: 'VIP model already in place' },
  { id: 'axion',             handle: 'Discord DM',          name: 'Axion',               platform: 'Discord',  size: '88k',   tier: 'Scale',      stage: 0, lastMessageDate: null, replied: false, notes: '' },
  { id: 'wallstreetbets',    handle: 'Discord DM',          name: 'WallStreetBets Crypto',platform: 'Discord', size: '600k+', tier: 'Enterprise', stage: 0, lastMessageDate: null, replied: false, notes: 'Enterprise approach only' },
  { id: 'easytradingbots',   handle: 'easytradingbots.ca',  name: 'EasyTradingBots',     platform: 'Discord',  size: 'Growing', tier: 'Starter', stage: 0, lastMessageDate: null, replied: false, notes: 'Contact James' },
];

function loadOutreach() {
  try {
    if (!fs.existsSync(OUTREACH_FILE)) {
      fs.mkdirSync(path.dirname(OUTREACH_FILE), { recursive: true });
      fs.writeFileSync(OUTREACH_FILE, JSON.stringify({ targets: INITIAL_TARGETS }, null, 2));
    }
    return JSON.parse(fs.readFileSync(OUTREACH_FILE, 'utf8'));
  } catch { return { targets: INITIAL_TARGETS }; }
}

function saveOutreach(data) {
  fs.mkdirSync(path.dirname(OUTREACH_FILE), { recursive: true });
  fs.writeFileSync(OUTREACH_FILE, JSON.stringify(data, null, 2));
}

// ─── Conversation state ────────────────────────────────────────────────────────
// awaiting_email → awaiting_date → awaiting_time → awaiting_location → complete

const state = {};

// ─── Geocoding ─────────────────────────────────────────────────────────────────

async function geocode(locationString) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(locationString)}&format=json&limit=1`;
    const res  = await fetch(url, {
      headers: { 'User-Agent': 'EdgeIndex/2.0 (contact@edgeindex.io)' }
    });
    const data = await res.json();
    if (!data || !data.length) return null;
    return {
      lat:     parseFloat(data[0].lat),
      lon:     parseFloat(data[0].lon),
      display: data[0].display_name,
    };
  } catch { return null; }
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

YOUR GOLDEN WINDOWS — THIS YEAR'S HIGHEST-LEVERAGE PERIODS (place this immediately after the cover page, before Section 1)
This is the first thing the client reads. Format it as a bold, scannable box. List exactly 3-5 specific date ranges where ALL key signals align — the periods where this person should move with maximum conviction. For each window give: the exact months (e.g. "Late April — Mid June 2026"), a one-line description of why it's high-leverage for THIS person specifically, and one action instruction (e.g. "Deploy capital. Initiate. Scale."). Then list 2-3 PROTECTION PERIODS — specific months to reduce risk and hold. Format these as a clear visual contrast. This section should feel like the most valuable page in the document — the answer to "when do I make my moves this year?"

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

SECTION 15 — THE GAP BETWEEN KNOWING AND ACTING (200-250 words)
This section builds the bridge between the annual map and ongoing monitoring. Open by referencing their specific Golden Windows identified earlier in the report — name the months. Then explain the critical problem: knowing a window is coming is not the same as knowing exactly when it opens. Golden Windows don't arrive on the first of the month — they open and close within days, sometimes hours, depending on signal alignment in real time. A trader who knows April-June is their strongest window but acts two weeks early or two weeks late misses the edge entirely. This is the gap between strategic awareness and tactical precision. The Brief gives them the map. Monitoring gives them the moment. End with: "The difference between knowing your best window and catching it is real-time signal tracking."

SECTION 16 — THE EDGE MONITORING SUITE (200-250 words)
Introduce the three monitoring tiers as the natural next step — not a sales pitch, but a logical continuation of what the Brief started. Frame each tier around the specific Golden Windows identified in this report. Weekly Edge ($97/month): every Monday, your decision tone for the week ahead — are conditions building toward your window or pulling back. Daily Edge ($197/month): daily signal tracking so you know exactly when your window opens and when to stand down. Live Edge ($397/month): real-time alerts the moment all signals align — for traders who need to act within hours, not days. Close with: "Most traders who receive this Brief choose Daily Edge. They've already paid $2,500 to know their windows. Monitoring is how they don't miss them."

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


async function generateReport(userData) {
  const clientData = {
    name:          userData.firstName || 'Trader',
    birthDate:     userData.dob,
    birthTime:     userData.time,
    birthLocation: userData.location,
    lat:           userData.lat,
    lon:           userData.lon,
    hdType:        userData.hdType       || 'Generator',
    hdAuthority:   userData.hdAuthority  || 'Sacral Authority',
    hdProfile:     userData.hdProfile    || null,
    hdDefinition:  userData.hdDefinition || null,
    reportDate:    new Date().toISOString().split('T')[0],
  };

  const message = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 16000,
    system:     SYSTEM_PROMPT,
    messages: [{
      role:    'user',
      content: `Generate a full 17-section Edge Index Brief (12-month annual decision-timing intelligence report) for the following client. Use all sections as instructed. Minimum 4,500 words. Client data: ${JSON.stringify(clientData)}`,
    }],
  });

  return message.content[0].text;
}

// ─── Markdown → HTML for email ─────────────────────────────────────────────────

function mdToHtml(md, clientName) {
  let body = md
    // Escape HTML entities first
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Headers
    .replace(/^# (.+)$/gm, '<h1 style="font-size:26px;font-family:Georgia,serif;color:#0a0a0a;margin:32px 0 12px">$1</h1>')
    .replace(/^## (.+)$/gm, '<h2 style="font-size:20px;font-family:Georgia,serif;color:#1a1a1a;border-bottom:2px solid #C9A84C;padding-bottom:6px;margin:28px 0 10px">$1</h2>')
    .replace(/^### (.+)$/gm, '<h3 style="font-size:17px;font-family:Arial,sans-serif;color:#333;margin:20px 0 8px">$1</h3>')
    // Bold & italic
    .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+?)\*/g, '<em>$1</em>')
    // Table rows (simple — strip separator rows)
    .replace(/^\|[-: |]+\|$/gm, '')
    .replace(/^\|(.+)\|$/gm, (_, row) => {
      const cells = row.split('|').map(c => c.trim());
      return '<tr>' + cells.map(c => `<td style="padding:8px 14px;border:1px solid #e0e0e0;font-family:Arial,sans-serif;font-size:14px">${c}</td>`).join('') + '</tr>';
    })
    // Wrap consecutive <tr> blocks in a table
    .replace(/(<tr>.*?<\/tr>(\s*<tr>.*?<\/tr>)*)/gs, '<table style="width:100%;border-collapse:collapse;margin:16px 0">$1</table>')
    // Numbered and bullet lists
    .replace(/^\d+\. (.+)$/gm, '<li style="margin:6px 0;line-height:1.7;font-family:Georgia,serif">$1</li>')
    .replace(/^[-•] (.+)$/gm, '<li style="margin:6px 0;line-height:1.7;font-family:Georgia,serif">$1</li>')
    // Wrap consecutive <li> in <ul>
    .replace(/(<li[^>]*>.*?<\/li>(\s*<li[^>]*>.*?<\/li>)*)/gs, '<ul style="padding-left:24px;margin:12px 0">$1</ul>')
    // Horizontal rule
    .replace(/^---$/gm, '<hr style="border:none;border-top:1px solid #C9A84C;margin:32px 0">')
    // Paragraphs
    .replace(/\n\n+/g, '\n\n')
    .split('\n\n')
    .map(block => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      if (trimmed.startsWith('<')) return trimmed;
      return `<p style="margin:14px 0;line-height:1.75;font-family:Georgia,serif;font-size:16px;color:#1a1a1a">${trimmed.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>The Edge Index Brief — ${clientName}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f0;font-family:Georgia,serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f0">
    <tr><td align="center" style="padding:40px 20px">
      <table width="700" cellpadding="0" cellspacing="0" style="background:#ffffff;max-width:700px;width:100%">

        <!-- Header -->
        <tr>
          <td style="background:#0a0a0a;padding:40px 48px 32px">
            <div style="border-top:3px solid #C9A84C;padding-top:20px">
              <p style="margin:0 0 4px;font-family:'Arial Black',Arial,sans-serif;font-size:11px;letter-spacing:4px;color:#C9A84C;text-transform:uppercase">Personalised Decision-Timing Intelligence</p>
              <h1 style="margin:0;font-family:'Arial Black',Arial,sans-serif;font-size:32px;letter-spacing:3px;color:#ffffff;text-transform:uppercase;font-weight:900">THE EDGE INDEX</h1>
              <h2 style="margin:8px 0 0;font-family:Georgia,serif;font-size:16px;color:#888;font-weight:400;font-style:italic">Annual Brief — ${clientName}</h2>
            </div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px 48px 48px">
            ${body}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#0a0a0a;padding:24px 48px">
            <p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#555;letter-spacing:1px">
              THE EDGE INDEX &nbsp;|&nbsp; edgeindex.io &nbsp;|&nbsp; This report is confidential and prepared exclusively for ${clientName}. Not for redistribution.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── PDF generation ────────────────────────────────────────────────────────────

function generatePDF(reportMarkdown, clientName, reportDate) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 60, size: 'A4' });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, doc.page.width, 120).fill('#0a0a0a');
    doc.fillColor('#c9a84c').fontSize(9).font('Helvetica')
       .text('PERSONALISED DECISION-TIMING INTELLIGENCE', 60, 35, { align: 'center', width: doc.page.width - 120, characterSpacing: 2 });
    doc.fillColor('#ffffff').fontSize(28).font('Helvetica-Bold')
       .text('THE EDGE INDEX', 60, 52, { align: 'center', width: doc.page.width - 120 });
    doc.fillColor('#888888').fontSize(11).font('Helvetica-Oblique')
       .text(`Annual Brief — ${clientName}`, 60, 88, { align: 'center', width: doc.page.width - 120 });

    doc.moveDown(3);
    doc.fillColor('#333333');

    // Parse and render markdown sections
    const lines = reportMarkdown.split('\n');
    for (const line of lines) {
      if (line.startsWith('# ')) {
        doc.addPage();
        doc.fillColor('#0a0a0a').fontSize(20).font('Helvetica-Bold')
           .text(line.replace('# ', ''), { paragraphGap: 8 });
        doc.moveTo(60, doc.y).lineTo(doc.page.width - 60, doc.y)
           .strokeColor('#c9a84c').lineWidth(1).stroke();
        doc.moveDown(0.5);
      } else if (line.startsWith('## ')) {
        doc.moveDown(0.5);
        doc.fillColor('#1a1a1a').fontSize(14).font('Helvetica-Bold')
           .text(line.replace('## ', ''), { paragraphGap: 4 });
      } else if (line.startsWith('### ')) {
        doc.fillColor('#333333').fontSize(12).font('Helvetica-Bold')
           .text(line.replace('### ', ''), { paragraphGap: 3 });
      } else if (line.startsWith('**') && line.endsWith('**')) {
        doc.fillColor('#1a1a1a').fontSize(11).font('Helvetica-Bold')
           .text(line.replace(/\*\*/g, ''), { paragraphGap: 2 });
      } else if (line.startsWith('- ') || line.startsWith('• ')) {
        doc.fillColor('#333333').fontSize(10).font('Helvetica')
           .text(`  • ${line.replace(/^[-•] /, '')}`, { indent: 10, paragraphGap: 2 });
      } else if (line.trim() === '') {
        doc.moveDown(0.3);
      } else if (line.trim()) {
        const clean = line.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
        doc.fillColor('#333333').fontSize(10).font('Helvetica')
           .text(clean, { align: 'justify', paragraphGap: 3 });
      }
    }

    // Footer
    doc.fillColor('#888888').fontSize(8)
       .text(`The Edge Index Brief | ${clientName} | ${reportDate}`, 60, doc.page.height - 40, { align: 'center', width: doc.page.width - 120 });

    doc.end();
  });
}

// ─── Email delivery via Resend ─────────────────────────────────────────────────

async function sendReportEmail(toEmail, toName, reportMarkdown) {
  if (!RESEND_KEY) {
    console.warn('RESEND_API_KEY not set — skipping email delivery');
    return { skipped: true };
  }

  const htmlBody  = mdToHtml(reportMarkdown, toName);
  const subject   = `Your Edge Index Brief — ${toName}`;
  const reportDate = new Date().toISOString().split('T')[0];
  const pdfBuffer = await generatePDF(reportMarkdown, toName, reportDate);

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    FROM_EMAIL,
      to:      toEmail,
      subject,
      html:    htmlBody,
      attachments: [{
        filename: `Edge-Index-Brief-${toName}-${reportDate}.pdf`,
        content:  pdfBuffer.toString('base64'),
      }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend API error (${res.status}): ${err}`);
  }

  return res.json();
}

// ─── Full report flow ──────────────────────────────────────────────────────────

async function sendReportToUser(chatId, userData) {
  const email     = userData.email;
  const firstName = userData.firstName || 'Trader';

  try {
    await bot.sendMessage(chatId,
      `⚡ Generating your 12-month Edge Index Brief...\n\nThis takes about 60 seconds. We'll send it directly to *${email}* when it's ready.`,
      { parse_mode: 'Markdown' }
    );

    const report = await generateReport(userData);

    if (email) {
      await sendReportEmail(email, firstName, report);
      await bot.sendMessage(chatId,
        `✅ Your Edge Index Brief has been sent to *${email}*\n\nCheck your inbox — and your spam folder just in case. The report is 17 sections of personalised decision-timing intelligence for the next 12 months.\n\nIf you have questions, reply here.`,
        { parse_mode: 'Markdown' }
      );
    } else {
      // Fallback: send in Telegram if no email (shouldn't happen in normal flow)
      await bot.sendMessage(chatId, report.substring(0, 4000), { parse_mode: 'Markdown' });
    }

    saveUser(chatId, { lastReportAt: new Date().toISOString() });

  } catch (err) {
    console.error(`Error sending report to ${chatId}:`, err.message);
    await bot.sendMessage(chatId,
      '⚠️ There was an error generating your report. Please try again in a few minutes, or send /report to retry.'
    );
  }
}

// ─── Admin check ───────────────────────────────────────────────────────────────

function isAnna(chatId) {
  return ANNA_CHAT_ID && String(chatId) === ANNA_CHAT_ID;
}

// ─── Outreach briefing builder ─────────────────────────────────────────────────

const OUTREACH_MSG_1 = (name) =>
  `Hey ${name},\n\nNoticed your trading community is solid. Quick question — what's your biggest pain point with retention right now?\n\nI built something that's basically a retention hack disguised as a performance tool. Members get personalized timing windows for their trades (based on their chart + planetary transits). When they use it, outcomes improve noticeably.\n\nWorth a 5-min chat to see if it fits? No pressure either way.`;

const OUTREACH_MSG_2 = (name) =>
  `Hey ${name},\n\nFollowing up — know you're busy.\n\nJust launched this with a few other communities (similar size to yours). Members are actually *using* it consistently, which is rare. The retention lift has been solid.\n\nIt's 100% hands-off on your end — Telegram bot, fully automated.\n\nIf timing tools + retention interest you, lmk. Otherwise no worries — I'll stop pinging.`;

const OUTREACH_MSG_3 = (name) =>
  `Hey ${name},\n\nLast one, I promise.\n\nHere's the real value prop: most communities leak members because they don't get consistent wins. This tool gives members *personalized decision timing* — when their Human Design chart aligns with planetary transits, their trading outcomes 10X. It's psychology + timing, not magic.\n\nMembers who see results don't leave. That's the retention play.\n\nHow it works:\n- I handle everything. Telegram bot, fully automated.\n- Members enter their birth data once. They get weekly timing windows.\n- You do nothing after a 5-min setup.\n\nThe founding beta offer:\n$500/month for 3 months (normally $800–$6,000/month depending on community size). If it doesn't move the needle in 90 days, we part ways.\n\nWant to talk about your community's retention goals?`;

function buildOutreachBriefing() {
  const outreach  = loadOutreach();
  const today     = new Date();
  const todayStr  = today.toISOString().split('T')[0];
  const lines     = [`📋 *Edge Index Outreach Briefing — ${todayStr}*\n`];

  let actionCount = 0;

  for (const target of outreach.targets) {
    if (target.replied || target.stage >= 3) continue;

    const lastDate  = target.lastMessageDate ? new Date(target.lastMessageDate) : null;
    const daysSince = lastDate
      ? Math.floor((today - lastDate) / (1000 * 60 * 60 * 24))
      : null;

    let shouldSend = false;
    let msgNum     = null;

    if (target.stage === 0 && !lastDate) {
      // Never contacted — send Message 1
      shouldSend = true;
      msgNum     = 1;
    } else if (target.stage === 1 && daysSince !== null && daysSince >= 3) {
      // Message 1 sent, 3+ days ago, no reply — send Message 2
      shouldSend = true;
      msgNum     = 2;
    } else if (target.stage === 2 && daysSince !== null && daysSince >= 5) {
      // Message 2 sent, 5+ days ago, no reply — send Message 3
      shouldSend = true;
      msgNum     = 3;
    }

    if (shouldSend) {
      actionCount++;
      const platformEmoji = target.platform === 'Telegram' ? '✈️' : '💬';
      const msgFn = msgNum === 1 ? OUTREACH_MSG_1 : msgNum === 2 ? OUTREACH_MSG_2 : OUTREACH_MSG_3;
      const msg   = msgFn(target.name);

      lines.push(
        `${platformEmoji} *${target.name}* (${target.size} · ${target.tier})`,
        `Contact: ${target.handle}`,
        `Message ${msgNum}:`,
        `\`\`\``,
        msg,
        `\`\`\``,
        `After sending, reply to me: /admin sent ${target.id}`,
        ``,
      );
    }
  }

  if (actionCount === 0) {
    lines.push('✅ No outreach actions due today. Check back tomorrow.');
  } else {
    lines.push(`\n📊 ${actionCount} message(s) to send today.`);
    lines.push(`\nFor each one you've sent, reply: /admin sent <id>`);
    lines.push(`For replies/interest, reply: /admin replied <id>`);
  }

  return lines.join('\n');
}

// ─── Bot commands ──────────────────────────────────────────────────────────────

// /myid — anyone can use, helps Anna find her chat ID
bot.onText(/\/myid/, async (msg) => {
  await bot.sendMessage(msg.chat.id, `Your Telegram chat ID is: \`${msg.chat.id}\``, { parse_mode: 'Markdown' });
});

// /start — begin onboarding
bot.onText(/\/start/, async (msg) => {
  const chatId    = msg.chat.id;
  const firstName = msg.from?.first_name || 'there';

  saveUser(chatId, { chatId, firstName, telegramUsername: msg.from?.username });
  state[chatId] = 'awaiting_email';

  await bot.sendMessage(chatId,
    `⚡ Welcome to The Edge Index, ${firstName}!\n\nI'm your personalised trading timing intelligence system.\n\nTo get started, I need to verify your purchase. Please reply with the *email address you used to purchase your Edge Index report*.`,
    { parse_mode: 'Markdown' }
  );
});

// /report — regenerate report
bot.onText(/\/report/, async (msg) => {
  const chatId = msg.chat.id;
  const user   = getUser(chatId);

  if (!user || !user.email) {
    state[chatId] = 'awaiting_email';
    await bot.sendMessage(chatId,
      'Please send me the email address you used to purchase your Edge Index report, and I\'ll verify your access.',
    );
    return;
  }

  if (!isPaidEmail(user.email)) {
    await bot.sendMessage(chatId,
      `⚠️ I can't find a purchase for *${user.email}*.\n\nTo get your Edge Index report, complete your purchase here:\n${WHOP_URL}\n\nOnce payment is confirmed, send /start to proceed.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (!user.dob || !user.time || !user.location) {
    state[chatId] = 'awaiting_date';
    await bot.sendMessage(chatId,
      'Your purchase is confirmed ✓\n\nI still need your birth data. Reply with your **date of birth** (DD/MM/YYYY):',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  await sendReportToUser(chatId, user);
});

// /mystats — show stored data
bot.onText(/\/mystats/, async (msg) => {
  const chatId = msg.chat.id;
  const user   = getUser(chatId);

  if (!user || !user.dob) {
    await bot.sendMessage(chatId, "I don't have your profile yet. Send /start to begin.");
    return;
  }

  await bot.sendMessage(chatId,
    `Your Edge Index profile:\n\n📧 Email: ${user.email || 'not set'}\n📅 Date of birth: ${user.dob}\n🕐 Time of birth: ${user.time}\n📍 Birth location: ${user.location}\n\nSend /report to generate your report.`
  );
});

// /help
bot.onText(/\/help/, async (msg) => {
  await bot.sendMessage(msg.chat.id,
    `Edge Index commands:\n\n/start — set up your profile\n/report — generate your report\n/mystats — view your profile\n/myid — show your Telegram ID\n/help — this message`
  );
});

// /admin — Anna-only admin commands
bot.onText(/\/admin(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;

  if (!isAnna(chatId)) {
    await bot.sendMessage(chatId, 'Unknown command. Send /help for available commands.');
    return;
  }

  const args = (match[1] || '').trim().split(/\s+/);
  const cmd  = args[0]?.toLowerCase();

  // /admin — show menu
  if (!cmd) {
    await bot.sendMessage(chatId,
      `🔧 *Edge Index Admin*\n\n` +
      `/admin users — list registered users\n` +
      `/admin emails — list paid emails\n` +
      `/admin paid <email> — manually mark email as paid\n` +
      `/admin outreach — show today's outreach briefing\n` +
      `/admin sent <target-id> — mark message as sent to target\n` +
      `/admin replied <target-id> — mark target as replied`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // /admin users
  if (cmd === 'users') {
    const users = getAllUsers();
    const list  = Object.values(users);
    if (!list.length) {
      await bot.sendMessage(chatId, 'No users registered yet.');
      return;
    }
    const lines = list.map(u =>
      `• ${u.firstName || 'Unknown'} (@${u.telegramUsername || '?'}) — ${u.email || 'no email'} — ${u.dob ? '✅ full profile' : '⏳ incomplete'}`
    );
    await bot.sendMessage(chatId, `*Registered users (${list.length}):*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
    return;
  }

  // /admin emails
  if (cmd === 'emails') {
    const emails = getAllPaidEmails();
    if (!emails.length) {
      await bot.sendMessage(chatId, 'No paid emails on file yet.\n\nAdd manually: /admin paid email@example.com\nOr set PAID_EMAILS env var in Railway.');
      return;
    }
    await bot.sendMessage(chatId, `*Paid emails (${emails.length}):*\n\n${emails.map(e => `• ${e}`).join('\n')}`, { parse_mode: 'Markdown' });
    return;
  }

  // /admin paid <email>
  if (cmd === 'paid') {
    const email = args[1]?.toLowerCase();
    if (!email || !email.includes('@')) {
      await bot.sendMessage(chatId, 'Usage: /admin paid email@example.com');
      return;
    }
    addPaidEmail(email);
    await bot.sendMessage(chatId, `✅ ${email} marked as paid. They can now use /start to access their report.`);
    return;
  }

  // /admin outreach
  if (cmd === 'outreach') {
    const briefing = buildOutreachBriefing();
    // Split if over Telegram limit
    const chunks = briefing.match(/[\s\S]{1,4000}/g) || [briefing];
    for (const chunk of chunks) {
      await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
      await new Promise(r => setTimeout(r, 300));
    }
    return;
  }

  // /admin sent <target-id>
  if (cmd === 'sent') {
    const targetId = args[1];
    if (!targetId) {
      await bot.sendMessage(chatId, 'Usage: /admin sent <target-id>\n\nTarget IDs are shown in the outreach briefing.');
      return;
    }
    const outreach = loadOutreach();
    const target   = outreach.targets.find(t => t.id === targetId);
    if (!target) {
      await bot.sendMessage(chatId, `Target "${targetId}" not found. Check the ID in the briefing.`);
      return;
    }
    target.stage           = (target.stage || 0) + 1;
    target.lastMessageDate = new Date().toISOString().split('T')[0];
    saveOutreach(outreach);
    await bot.sendMessage(chatId, `✅ ${target.name} — Message ${target.stage} recorded as sent (${target.lastMessageDate}).`);
    return;
  }

  // /admin replied <target-id>
  if (cmd === 'replied') {
    const targetId = args[1];
    if (!targetId) {
      await bot.sendMessage(chatId, 'Usage: /admin replied <target-id>');
      return;
    }
    const outreach = loadOutreach();
    const target   = outreach.targets.find(t => t.id === targetId);
    if (!target) {
      await bot.sendMessage(chatId, `Target "${targetId}" not found.`);
      return;
    }
    target.replied = true;
    saveOutreach(outreach);
    await bot.sendMessage(chatId, `🎉 ${target.name} marked as replied! Move this one to a call.`);
    return;
  }

  await bot.sendMessage(chatId, `Unknown admin command: ${cmd}. Send /admin to see options.`);
});

// ─── Free-text message handler (onboarding flow) ───────────────────────────────

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text   = msg.text?.trim();

  if (!text || text.startsWith('/')) return;

  const currentState = state[chatId] || 'unknown';

  // ── Step 0: Email verification ──
  if (currentState === 'awaiting_email') {
    const emailMatch = text.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    if (!emailMatch) {
      await bot.sendMessage(chatId, 'Please enter a valid email address — the one you used when purchasing your Edge Index report.');
      return;
    }

    const email = text.toLowerCase();
    saveUser(chatId, { email });

    if (!isPaidEmail(email)) {
      await bot.sendMessage(chatId,
        `⚠️ I can't find a purchase linked to *${email}*.\n\nTo access your Edge Index report, complete your purchase here:\n${WHOP_URL}\n\nOnce payment is confirmed, send /start again and enter this email address.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    state[chatId] = 'awaiting_date';
    await bot.sendMessage(chatId,
      `✅ Purchase confirmed — welcome!\n\nTo generate your personalised 12-month Edge Index Brief, I need three things:\n\n1. Your **date of birth**\n2. Your **time of birth**\n3. Your **city and country of birth**\n\nLet's start. Reply with your **date of birth** (DD/MM/YYYY):`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // ── Step 1: Date of birth ──
  if (currentState === 'awaiting_date') {
    const dateMatch = text.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
    if (!dateMatch) {
      await bot.sendMessage(chatId, 'Please enter your date of birth in DD/MM/YYYY format. Example: 15/03/1988');
      return;
    }
    const [, day, month, year] = dateMatch;
    const iso = `${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;
    saveUser(chatId, { dob: iso });
    state[chatId] = 'awaiting_time';
    await bot.sendMessage(chatId,
      `Got it — ${day}/${month}/${year} ✓\n\nNow your **time of birth** (HH:MM, 24-hour format). If you're unsure, give your best estimate — within an hour is useful.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // ── Step 2: Time of birth ──
  if (currentState === 'awaiting_time') {
    const timeMatch = text.match(/^(\d{1,2})[:\.](\d{2})$/);
    if (!timeMatch) {
      await bot.sendMessage(chatId, 'Please enter your birth time as HH:MM (24-hour). Example: 14:30 or 09:15');
      return;
    }
    const [, h, m] = timeMatch;
    const time = `${h.padStart(2,'0')}:${m}`;
    saveUser(chatId, { time });
    state[chatId] = 'awaiting_location';
    await bot.sendMessage(chatId,
      `Birth time ${time} ✓\n\nFinally, your **city and country of birth**. Example: Sydney, Australia`,
      { parse_mode: 'Markdown' }
    );
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

    // Calculate Human Design automatically from birth data
    const dobParts  = (getUser(chatId)?.dob || '').split('-');
    const timeParts = (getUser(chatId)?.time || '00:00').split(':');
    let hdChart = null;
    try {
      const { calculateHumanDesign } = await import('natalengine');
      hdChart = calculateHumanDesign(
        parseInt(dobParts[0]), parseInt(dobParts[1]), parseInt(dobParts[2]),
        parseInt(timeParts[0]), parseInt(timeParts[1]),
        geo.lat, geo.lon
      );
    } catch (e) {
      console.warn('HD calculation failed:', e.message);
    }

    const hdType      = hdChart?.type?.name      || 'Generator';
    const hdAuthority = hdChart?.authority?.name  || 'Sacral Authority';
    const hdProfile   = hdChart?.profile?.name    || null;
    const hdDefinition = hdChart?.definition      || null;

    saveUser(chatId, { location: text, lat: geo.lat, lon: geo.lon, hdType, hdAuthority, hdProfile, hdDefinition });
    state[chatId] = 'complete';

    await bot.sendMessage(chatId,
      `${text} ✓ (${geo.lat.toFixed(2)}°, ${geo.lon.toFixed(2)}°)\n\n✅ Profile complete. Generating your Edge Index Brief now...`,
      { parse_mode: 'Markdown' }
    );

    const user = getUser(chatId);
    await sendReportToUser(chatId, user);
    return;
  }

  // ── Catch-all ──
  await bot.sendMessage(chatId, "Send /start to set up your Edge Index profile, or /report if you're already set up.");
});

// ─── Cron: Weekly report delivery ─────────────────────────────────────────────
// Every Monday at 8:00 AM UTC

cron.schedule('0 8 * * 1', async () => {
  console.log('[CRON] Weekly report delivery starting...');
  const users = getAllUsers();

  for (const [chatId, userData] of Object.entries(users)) {
    if (!userData.dob || !userData.time || !userData.location || !userData.email) continue;
    if (!isPaidEmail(userData.email)) continue;

    console.log(`[CRON] Sending weekly report to ${chatId} (${userData.firstName || 'unknown'})`);
    await sendReportToUser(chatId, userData);
    await new Promise(r => setTimeout(r, 3000)); // stagger sends
  }

  console.log('[CRON] Weekly delivery complete.');
}, { timezone: 'UTC' });

// ─── Cron: Daily outreach briefing to Anna ────────────────────────────────────
// Every day at 22:00 UTC = 8:00 AM AEST

cron.schedule('0 22 * * *', async () => {
  if (!ANNA_CHAT_ID) {
    console.log('[CRON] Outreach briefing skipped — ANNA_CHAT_ID not set');
    return;
  }

  console.log('[CRON] Sending daily outreach briefing to Anna...');
  try {
    const briefing = buildOutreachBriefing();
    const chunks   = briefing.match(/[\s\S]{1,4000}/g) || [briefing];
    for (const chunk of chunks) {
      await bot.sendMessage(ANNA_CHAT_ID, chunk, { parse_mode: 'Markdown' });
      await new Promise(r => setTimeout(r, 300));
    }
  } catch (err) {
    console.error('[CRON] Outreach briefing error:', err.message);
  }
}, { timezone: 'UTC' });

// ─── Polling error handler ─────────────────────────────────────────────────────

bot.on('polling_error', (err) => {
  console.error('Telegram polling error:', err.message);
});

console.log('✅ Edge Index Telegram bot started (v2)');
console.log(`   Railway API: ${RAILWAY_URL}`);
console.log(`   Anna chat ID: ${ANNA_CHAT_ID || 'NOT SET — set ANNA_CHAT_ID in Railway'}`);
console.log(`   Resend: ${RESEND_KEY ? 'configured' : 'NOT CONFIGURED — set RESEND_API_KEY'}`);
