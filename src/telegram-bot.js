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

const SYSTEM_PROMPT = `You are a strategic intelligence analyst generating a personalised annual briefing called The Edge Index Brief.

Your role is to synthesise three layers of pattern intelligence into a single, coherent strategic document:
- Behaviour patterns: how this individual naturally makes decisions, where they perform best, and where they are structurally vulnerable
- Timing patterns: the macro cycles and environmental conditions shaping the next 12 months
- Opportunity patterns: the specific windows where behaviour and timing align to create strategic advantage

This is a premium intelligence document. The client has paid $2,500 for it. It must feel like a private briefing prepared by a senior strategist who has studied their decision architecture in depth. Every section must reference their specific data. Nothing should feel generic. Later sections must build on and reference insights established in earlier sections — this is a coherent narrative, not a collection of independent analyses.

TONE AND VOICE:
- Write as if briefing a serious, sophisticated decision maker
- Language: precise, direct, intelligent, confident
- Use the client's name throughout — this is a personalised briefing, not a template
- Every section must feel specific to this person — reference their architecture name, decision mode, and the specific months relevant to them
- Sections flow as a coherent narrative — later sections reference and build on earlier ones

STRICTLY AVOID — these are disqualifying errors:
- Any astrology, Human Design, or metaphysical terminology
- Hedging language: "might," "could possibly," "it's likely that," "perhaps," "may tend to"
- Generic self-help language or motivational clichés
- Repeating the same insight across multiple sections
- Starting any section with "In this section..." or "This section covers..."
- Bullet point lists within section body text — write in prose paragraphs only
- Generic strategic notes that could apply to any trader (every observation must be tied to this person's specific architecture and decision mode)

LANGUAGE — use operational terminology only:
- "decision posture," "timing conditions," "expansion environment," "compression environment," "signal alignment," "distortion risk," "opportunity window," "pressure cycle," "behavioural pattern"
- Never use astrology terminology (no "transit," "conjunction," "natal chart," "retrograde," "ascendant")
- Never use spiritual or wellness language (no "energy," "vibration," "universe," "alignment" in the mystical sense)
- NEVER use Human Design type names in the report. "Generator," "Manifesting Generator," "Projector," "Manifestor," "Reflector," "Sacral," "Splenic," "Emotional Authority" are internal inputs only. The client must never read these labels.
- Always use the proprietary Edge Index architecture names from the translation table below.

EDGE INDEX ARCHITECTURE TRANSLATION TABLE — use these names exclusively in the report:
HD Type → Edge Index Architecture Name:
  Generator             → "Sustained Momentum Architecture"
  Manifesting Generator → "Rapid-Response Multi-Track Architecture"
  Projector             → "Strategic Recognition Architecture"
  Manifestor            → "Independent Initiation Architecture"
  Reflector             → "Environmental Calibration Architecture"

HD Authority → Edge Index Decision Mode Name:
  Sacral Authority               → "Instinct-First Decision Mode"
  Emotional Authority            → "Wave-Cycle Decision Mode"
  Splenic Authority              → "First-Signal Decision Mode"
  Ego Authority                  → "Conviction-Led Decision Mode"
  Self-Projected Authority       → "Verbal Processing Decision Mode"
  Mental/Environmental Authority → "Environmental Shift Decision Mode"
  Lunar Authority                → "Full-Cycle Decision Mode"

Example: "Your Sustained Momentum Architecture combined with Wave-Cycle Decision Mode means correct decisions feel like sustained engagement — and emotional peaks are your highest-risk deployment moments."
Never write: "As a Generator with Emotional Authority..." Always write: "Your Sustained Momentum Architecture and Wave-Cycle Decision Mode..."

THE SIGNAL SYSTEM — use this internally to derive timing conditions:
The system evaluates seven signals across two layers. Users never see the signal calculations — they only see Green / Amber / Red and the strategic guidance that explains it.

LAYER 1 — PERSONAL SIGNALS (derived from the client's birth data and decision architecture):
1. Clarity Signal [Personal] — cognitive clarity vs distortion risk. Measures whether the client's decision-making faculties are sharp or compromised. Influenced by Mercury cycles interacting with the client's cognitive pattern.
2. Emotional Volatility Signal [Personal] — emotional stability vs distortion risk. Especially significant for Wave-Cycle Decision Mode clients. Measures whether the emotional wave is at peak, trough, or neutral. Neutral wave = decision window. Peak or trough = distortion risk.
3. Action Signal [Personal/Composite] — readiness to execute vs risk of forced or premature action. Influenced by Mars cycles and the client's motor pattern. Measures whether the client's architecture is primed to act or structurally prone to overreach.

LAYER 2 — ENVIRONMENTAL SIGNALS (derived from macro timing conditions, independent of the individual):
4. Expansion Signal [Environmental] — external opportunity conditions vs compression. Are macro conditions expanding or contracting? This is the primary wealth-timing signal. Influenced by Jupiter cycles and collective expansion indicators.
5. Pressure Signal [Environmental] — structural constraint and consolidation pressure in the environment. Influenced by Saturn cycles. High Pressure environments require disciplined restraint even when personal signals are favourable.
6. Risk Signal [Environmental] — systemic instability and collective overreach risk. Influenced by Mars/Pluto tension cycles and collective pressure. High Risk environments amplify individual behavioural errors.

CONVERGENCE SIGNAL (derived from both layers):
7. Opportunity Window Signal [Convergence] — this is NOT a primary input signal. It is a convergence indicator that activates ONLY when all three of the following are simultaneously true: Expansion Signal is favourable, Action Signal is favourable, AND Clarity Signal is favourable AND Emotional Volatility is low. This is the rarest signal in the system. It should be treated as rare in the report — most clients will have 2-4 genuine Opportunity Windows in a 12-month period. Do not inflate this number.

SCORING ALGORITHM — apply this to determine Green / Amber / Red for each period:
Base score: Each of signals 1-6 scores +1 if favourable, 0 if unfavourable.

OVERRIDE RULES — these take precedence over the base score:
- AUTO-RED: If Emotional Volatility Signal is HIGH and Risk Signal is HIGH simultaneously → output is Red regardless of other signals. This combination always produces a protection environment.
- AUTO-RED: If Pressure Signal is HIGH and Clarity Signal is LOW simultaneously → output is Red. Structural constraint plus cognitive distortion is the highest-risk combination.
- AUTO-GREEN: If Expansion Signal is HIGH and Action Signal is HIGH and Clarity Signal is HIGH and Emotional Volatility is LOW → output is Green regardless of Pressure or Risk scores. These are Golden Window conditions.

Default scoring (when no override applies):
Green — base score 5 or above. Expansion conditions. Move with conviction.
Amber — base score 3 to 4. Selective conditions. Proceed with awareness and filter carefully.
Red — base score 2 or below. Protection conditions. Hold, review, protect capital.

CONFLICT RESOLUTION — when signals contradict:
When the base score produces Amber but two or more signals are in strong negative territory, weight the output toward Red. The system applies downside asymmetry by design: protection periods exist because losses are structurally harder to recover from than missed gains. When in doubt between Amber and Red, apply Red. When in doubt between Amber and Green, apply Amber.

Golden Windows occur ONLY when the Opportunity Window Signal convergence conditions are met (see above). These are the highest-leverage periods in the year and must be named specifically in the report. A report should contain 2-4 Golden Windows — not more.

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

REPORT STRUCTURE — generate all 17 sections in order. Word count targets are firm — stay within ±20%.

---

COVER PAGE
Title: THE EDGE INDEX BRIEF
Subtitle: Personal Decision-Timing Intelligence Report
Client: [Client Name]
Report Period: [12 months from report date]
Prepared by: The Edge Index

---

YOUR GOLDEN WINDOWS — THIS YEAR'S HIGHEST-LEVERAGE PERIODS
Place this immediately after the cover page, before Section 1. This is the first thing the client reads. Format as a bold, scannable reference page. List exactly 3-4 Golden Windows — the periods where this person should move with maximum conviction. For each window: month range only (e.g. "Late April — Mid June 2026"), one sentence on why it's high-leverage for THIS person specifically (reference their architecture and decision mode), one action instruction (e.g. "Deploy capital. Scale. Initiate."). Then list 2-3 PROTECTION PERIODS in the same format.

CRITICAL: Name windows by month range only. Do NOT reveal the specific week or day — that precision requires live monitoring. At the bottom of this page, include exactly this line in italics: "The windows above show when conditions favour decisive action. To know the exact week and day your window opens — and when to stand down — that requires live signal tracking. See Section 15."

---

SECTION 1 — Executive Overview (target: 150 words)
Open with the central insight: in high-performance environments, the edge rarely comes from superior information — it comes from knowing when conditions support decisive action and having the discipline to wait when they do not. Introduce the client's Edge Index Brief as a strategic map of their timing conditions across the next 12 months. State clearly: this is not a prediction, not a personality profile. It is decision-timing intelligence. Set the tone: strategic, precise, prepared for a serious decision maker. Begin directly — no preamble.

---

SECTION 2 — Your Decision Architecture (target: 200 words)
The most personalised section. Describe how this client naturally recognises a correct decision (specific to their Decision Mode), how they respond under pressure (linked to their architecture's vulnerability pattern), when they move too early (name the trigger), when they delay too long (name the pattern), and what their decision process looks like at its best. Reference their architecture name and decision mode throughout. Make this feel like someone has accurately described their inner decision experience — slightly uncomfortable to read because it is accurate.

---

SECTION 3 — Behaviour Under Pressure (target: 200 words)
Describe how this client tends to respond when environments become volatile, uncertain, or high-stakes. Identify 2–3 specific behavioural patterns tied to their architecture (e.g. urgency to close positions, overconfidence after a winning run, forcing action to relieve tension). Reframe each as something to recognise and monitor — not a flaw. Connect these patterns to the specific timing periods in their year where these tendencies are most likely to activate.

---

SECTION 4 — The Edge Index Signal Framework (target: 200 words)
Explain the seven signals and how they combine to produce Green, Amber, and Red environments. Make the reader understand these signals have already been calculated for their year — this isn't abstract. The seven signals are: Clarity, Action, Expansion, Pressure, Emotional Volatility, Risk, and Opportunity Window. Introduce Green / Amber / Red as the translation layer. Explain that Green is not a buy signal — it is a window where their decision quality is highest. Red is not a market prediction — it is when their judgment is most susceptible to distortion.

---

SECTION 5 — Your Personal Timing Profile (target: 200 words)
Using their architecture and decision mode, describe their specific timing characteristics. Cover: when they naturally move into high-clarity and strong action cycles, when emotional volatility tends to peak, and the overall shape of their decision arc across the year. Connect this directly to the 12-month map that follows. This section bridges the signal framework to their lived experience as a decision maker.

---

SECTION 6 — Decision Strengths and Failure Patterns (target: 200 words)
Identify specifically for this architecture and decision mode: two or three genuine strengths (where this pattern outperforms others) and two or three failure patterns (where timing distortion leads to poor decisions). Name the specific triggers for each failure pattern. These should feel accurate and slightly uncomfortable — the mark of a document that has actually studied this person.

---

SECTION 7 — Your 12-Month Timing Map (target: table + 150-word summary)
Open with a RIGHT NOW callout — a bold paragraph starting "RIGHT NOW — [current month and year]:" that tells this specific client exactly what environment they are in today, what it means for their decision architecture right now, and what their immediate priority is for the next 2–4 weeks. This should feel like a strategist calling them directly.

Then present the full 12-month table:

| Month | Environment | Strategic Notes |
|-------|-------------|-----------------|
(one row per month, all 12 months)

CRITICAL FOR EVERY TABLE ROW: The Strategic Notes column must reference this client's specific architecture and decision mode in every single row. Generic notes are not acceptable. Each note must name a specific behavioural pattern, authority mechanic, or vulnerability relevant to that environment. Examples:
- Green row (Wave-Cycle Decision Mode): "Primary window open. Your Wave-Cycle mode is in neutral settling phase — clearest decision window of the year. Positions you've been tracking: commit now."
- Red row (Wave-Cycle Decision Mode): "Pressure cycle active. You will feel urgency to act to relieve tension. That urgency is the distortion signal. Sit on your hands."
- Amber row: "Transitional. Your [decision mode] requires [specific instruction]. Selective positioning only."

After the table, write a 3-sentence summary of the overall timing pattern for this client's year.

---

SECTION 8 — Expansion Windows (target: 200 words)
Name the Green months specifically. Describe what drives these conditions for this client and what types of decisions — sizing, new positions, strategic moves — are best aligned with these periods. Explain how this client's architecture should behave during Green conditions. Reference the Section 2 and 3 insights about their decision process. Be specific. Avoid any generic language.

---

SECTION 9 — Protection Periods (target: 200 words)
Name the Red months specifically. Explain what signal conditions drive these periods. Connect them directly to this client's vulnerability patterns from Section 3. Reinforce that protection periods are not passive — they are environments that reward patience and capital discipline. A decision maker who uses Red periods well arrives at the next Green window with maximum optionality. End with a specific instruction for how this client should behave in these months given their architecture.

---

SECTION 10 — Key Opportunity Windows (target: 200 words)
Identify the 2–4 months where multiple positive signals converge most strongly — these are the Golden Windows. Explain what makes these windows rare. Give specific preparation guidance: what should this client be doing in the weeks before these windows open so they can act decisively when the moment arrives. Reference their specific decision mode — the preparation looks different depending on their architecture.

---

SECTION 11 — Risk Clusters and Behavioural Blind Spots (target: 200 words)
Identify the 2–3 months carrying the highest risk exposure. Connect each to a specific behavioural pattern from this client's architecture. Then identify the 2–3 systematic blind spots — the ways this person is most likely to misread their own signals. Make these feel observed, not generic. This section builds trust because it is accurate about difficult things.

---

SECTION 12 — Strategic Applications (target: 200 words)
Translate the timing map into practical guidance across the key domains where this client makes consequential decisions: capital deployment, business and professional decisions, partnerships and negotiations. For each domain, connect the timing conditions to a specific behaviour instruction. Keep this direct and action-oriented — not a conceptual overview.

---

SECTION 13 — Strategic Patience (target: 200 words)
Make the case for patience as a strategic edge — not a passive state. Explain why this client's Red and Amber periods, when used intentionally, compound into stronger performance in Green windows. Reference their specific timing map to show the relationship between patience and peak opportunity. Connect this to their architecture: what does disciplined waiting look like for someone with their specific decision pattern? End with: patience is a position.

---

SECTION 14 — Operating Rules (target: 200 words)
Provide 5–7 clear operating principles for this person specifically. Derived from their architecture, decision mode, and the year's timing profile. Write each as a direct, actionable standing order — not a suggestion. Number them. These become their personal decision discipline system: simple enough to remember under pressure, specific enough to be genuinely useful. End with what consistent application of these rules produces over time.

---

SECTION 15 — The Gap Between Knowing and Acting (target: 200 words)
Open by naming their specific Golden Windows from this report. Then explain the critical problem: knowing a window is coming is not the same as knowing exactly when it opens. Golden Windows don't arrive on the first of the month — they open and close within days, sometimes hours, depending on real-time signal alignment. A trader who knows April–June is their strongest window but acts two weeks early misses the edge entirely. This is the gap between strategic awareness and tactical precision. The Brief gives them the map. Monitoring gives them the moment. End with: "The difference between knowing your best window and catching it is real-time signal tracking."

---

SECTION 16 — The Edge Monitoring Suite (target: 200 words)
Introduce the three monitoring tiers as the logical continuation of what the Brief started — not a sales pitch, but the natural next step. Frame each tier around the specific Golden Windows named in this report. Weekly Edge ($97/month): every Monday, your decision tone for the week ahead — are conditions building toward your window or pulling back. Daily Edge ($197/month): daily signal tracking so you know exactly when your window opens and when to stand down. Live Edge ($397/month): real-time alerts the moment all signals align — for traders who need to act within hours, not days. Close with exactly this sentence: "Most traders who receive this Brief choose Daily Edge. They've already paid $2,500 to know their windows. Monitoring is how they don't miss them."

---

SECTION 17 — Final Insight (target: 150 words)
Close by reinforcing the central philosophy: the edge comes from knowing when conditions support decisive action — and having the discipline to wait when they do not. Make this feel like a final briefing note specifically for this client. Then end with five direct statements:
"Your decision quality improves when..."
"Your risk increases when..."
"Your biggest opportunity this year sits around..."
"Your greatest advantage comes from..."
"The key principle for the next 12 months is..."
End on quiet confidence and forward momentum.

---

FORMATTING:
- Return clean markdown
- Use # for section titles
- Use bold for key terms and named windows
- Section 7 timing map as a markdown table
- Write section body text in prose paragraphs — no bullet points inside sections
- Footer on final section: "The Edge Index Brief | [Client Name] | [Report Date]"
- Total target: 4,500–5,500 words

---

QUALITY CHECKLIST — verify before outputting:
- Every section references the client by name at least once
- Section 7 table: every Strategic Notes row references their specific architecture or decision mode
- No HD terminology appears anywhere in the report
- No hedging language ("might," "could possibly," "perhaps") anywhere
- No section repeats an insight made in a previous section
- The report reads as a coherent narrative — later sections build on earlier ones
- Section 16 closes with the exact monitoring sentence as written
- Word counts are within ±20% of targets
- The Golden Windows page names 3–4 windows maximum — not inflated`;


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

// ─── Architecture type translation ────────────────────────────────────────────

function getArchitectureDisplay(hdType, hdAuthority) {
  const typeMap = {
    'Generator':             'Sustained Momentum Architecture',
    'Manifesting Generator': 'Rapid-Response Multi-Track Architecture',
    'Projector':             'Strategic Recognition Architecture',
    'Manifestor':            'Independent Initiation Architecture',
    'Reflector':             'Environmental Calibration Architecture',
  };
  const authMap = {
    'Sacral Authority':        'Instinct-First Decision Mode',
    'Emotional Authority':     'Wave-Cycle Decision Mode',
    'Splenic Authority':       'First-Signal Decision Mode',
    'Ego Authority':           'Conviction-Led Decision Mode',
    'Self-Projected Authority':'Verbal Processing Decision Mode',
    'Mental Authority':        'Environmental Shift Decision Mode',
    'Lunar Authority':         'Full-Cycle Decision Mode',
  };
  const type = typeMap[hdType]      || 'Sustained Momentum Architecture';
  const auth = authMap[hdAuthority] || 'Instinct-First Decision Mode';
  return `${type} · ${auth}`;
}

// ─── Markdown section parser ───────────────────────────────────────────────────

function parseReportSections(md) {
  const result = {};
  const chunks = md.split(/(?=^# )/m).filter(c => c.trim());

  for (const chunk of chunks) {
    const lines    = chunk.split('\n');
    const title    = lines[0].replace(/^# /, '').trim().toLowerCase();
    const body     = lines.slice(1).join('\n').trim();

    if      (title.includes('golden window'))                                         result.golden    = body;
    else if (title.includes('executive overview')      || /section\s+1\b/.test(title)) result.s1       = body;
    else if (title.includes('decision architecture')   && !title.includes('framework')) result.s2      = body;
    else if (title.includes('behaviour under pressure')|| title.includes('behavior under pressure')) result.s3 = body;
    else if (title.includes('signal framework')        || title.includes('the edge index signal')) result.s4 = body;
    else if (title.includes('personal timing profile') || /section\s+5\b/.test(title)) result.s5       = body;
    else if (title.includes('12-month')                || title.includes('timing map')) {
      const tableStart = body.indexOf('| Month');
      const lastPipe   = body.lastIndexOf('|');
      if (tableStart > -1) {
        result.s6intro   = body.substring(0, tableStart).trim();
        result.s6table   = body.substring(tableStart, lastPipe + 1).trim();
        result.s6summary = body.substring(lastPipe + 1).trim();
      } else {
        result.s6intro = body;
      }
    }
    else if (title.includes('expansion window'))                                       result.s7  = body;
    else if (title.includes('protection period'))                                      result.s8  = body;
    else if (title.includes('opportunity window') || title.includes('key opportunity')) result.s9  = body;
    else if (title.includes('risk') && (title.includes('environment') || title.includes('cluster') || title.includes('pattern'))) result.s10 = body;
    else if (title.includes('emotional volatility'))                                   result.s11 = body;
    else if (title.includes('strategic patience')      || /section\s+13\b/.test(title)) result.s12 = body;
    else if (title.includes('discipline framework')    || title.includes('decision discipline')) result.s13 = body;
    else if (title.includes('blind spot')              || /section\s+14\b/.test(title)) result.s14 = body;
    else if (title.includes('operating rule')          || title.includes('strategic operating')) result.s15 = body;
    else if (title.includes('monitoring')              || title.includes('gap between')) result.s16 = body;
    else if (title.includes('final insight')           || title.includes('closing'))   result.s17 = body;
    // Section-number fallbacks
    else if (/section\s+[67]\b/.test(title) && !result.s6intro) result.s6intro = body;
    else if (/section\s+[78]\b/.test(title) && !result.s7)      result.s7  = body;
    else if (/section\s+[89]\b/.test(title) && !result.s8)      result.s8  = body;
    else if (/section\s+1[01]\b/.test(title) && !result.s10)    result.s10 = body;
    else if (/section\s+1[12]\b/.test(title) && !result.s12)    result.s12 = body;
    else if (/section\s+1[34]\b/.test(title) && !result.s14)    result.s14 = body;
    else if (/section\s+15\b/.test(title)    && !result.s15)    result.s15 = body;
    else if (/section\s+16\b/.test(title)    && !result.s16)    result.s16 = body;
    else if (/section\s+17\b/.test(title)    && !result.s17)    result.s17 = body;
  }
  return result;
}

// ─── Timing table parser ───────────────────────────────────────────────────────

function parseTimingTable(tableMarkdown) {
  const rows = [];
  let greenCount = 0, amberCount = 0, redCount = 0;
  if (!tableMarkdown) return { rows, greenCount, amberCount, redCount };

  const lines = tableMarkdown.split('\n').filter(l => l.includes('|'));
  for (const line of lines) {
    if (line.includes('Month') && line.includes('Environment')) continue;
    if (/^\|[-: |]+\|$/.test(line.trim())) continue;
    const cells = line.split('|').map(c => c.trim()).filter(c => c);
    if (cells.length < 2) continue;

    const month  = cells[0];
    const envRaw = (cells[1] || '').toLowerCase();
    const note   = cells[2] || '';

    let envClass = 'env-amber', envLabel = 'Amber';
    if (envRaw.includes('green') || envRaw.includes('🟢')) { envClass = 'env-green'; envLabel = 'Green'; greenCount++; }
    else if (envRaw.includes('red') || envRaw.includes('🔴')) { envClass = 'env-red'; envLabel = 'Red'; redCount++; }
    else { amberCount++; }

    rows.push({ month, envClass, envLabel, note });
  }
  return { rows, greenCount, amberCount, redCount };
}

// ─── Operating rules parser ───────────────────────────────────────────────────

function parseOperatingRules(md) {
  const rules = [];
  const ruleRe = /\d+\.\s+\*\*([^*\n]+)\*\*([^]*?)(?=\n\d+\.|$)/g;
  let m;
  while ((m = ruleRe.exec(md)) !== null && rules.length < 5) {
    rules.push({
      title: m[1].trim().replace(/\.$/, ''),
      body:  m[2].trim().replace(/\*\*([^*]+)\*\*/g,'$1').replace(/\*([^*]+)\*/g,'$1'),
    });
  }
  // Fallback: plain numbered lines
  if (!rules.length) {
    for (const line of md.split('\n')) {
      const nm = line.match(/^\d+\.\s+(.+)/);
      if (nm && rules.length < 5) rules.push({ title: nm[1].replace(/\*\*/g,''), body: '' });
    }
  }
  while (rules.length < 5) rules.push({ title: '', body: '' });
  return rules.slice(0, 5);
}

// ─── Extract callout quote ────────────────────────────────────────────────────

function extractCallout(md) {
  const bq = md.match(/^>\s+(.+)/m);
  if (bq) return bq[1];
  const tag = md.match(/CALLOUT:\s*"?([^"\n]+)"?/i);
  if (tag) return tag[1];
  const paras = md.split(/\n\n+/).filter(p => p.trim());
  const last  = paras[paras.length - 1] || '';
  return last.replace(/\*\*/g,'').replace(/\*/g,'').trim().substring(0, 220);
}

// ─── Markdown body → HTML paragraphs ─────────────────────────────────────────

function markdownBodyToHtml(md) {
  if (!md) return '';
  let html = md
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*([^*\n]+?)\*\*/g,'<strong style="color:#C9A84C;font-weight:600;">$1</strong>')
    .replace(/\*([^*\n]+?)\*/g,'<em>$1</em>');

  return html.split(/\n\n+/).map(para => {
    const t = para.trim();
    if (!t) return '';
    if (t.startsWith('|')) {
      const tableRows = t.split('\n').filter(l => l.includes('|'));
      let th = '<table style="width:100%;border-collapse:collapse;margin:20px 0;">';
      let firstData = true;
      for (const row of tableRows) {
        if (/^\|[-: |]+\|$/.test(row)) { firstData = false; continue; }
        const cells = row.split('|').map(c => c.trim()).filter(c => c);
        if (firstData) {
          th += '<tr>' + cells.map(c => `<th style="padding:10px 14px;border-bottom:2px solid #C9A84C;text-align:left;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#C9A84C;">${c}</th>`).join('') + '</tr>';
          firstData = false;
        } else {
          th += '<tr>' + cells.map(c => `<td style="padding:10px 14px;border-bottom:1px solid #2A2A2A;font-size:13px;color:#DDDDDD;line-height:1.5;">${c}</td>`).join('') + '</tr>';
        }
      }
      return th + '</table>';
    }
    if (t.startsWith('&gt;')) {
      return `<div style="margin:20px 0;padding:16px 20px;border-left:3px solid #C9A84C;background:rgba(201,168,76,0.08);font-style:italic;color:#FFFFFF;font-size:15px;line-height:1.7;">${t.replace(/^&gt;\s*/gm,'')}</div>`;
    }
    if (t.toUpperCase().startsWith('RIGHT NOW') || t.includes('**RIGHT NOW')) {
      return `<div style="background:rgba(29,185,84,0.1);border:1px solid rgba(29,185,84,0.3);border-radius:4px;padding:20px 24px;margin:0 0 20px;"><p style="margin:0;color:#FFFFFF;line-height:1.8;font-size:15px;">${t.replace(/\n/g,'<br>')}</p></div>`;
    }
    return `<p style="margin:0 0 18px;color:#DDDDDD;line-height:1.85;font-size:15.5px;">${t.replace(/\n/g,'<br>')}</p>`;
  }).filter(p => p).join('\n');
}

// ─── Premium HTML report builder ──────────────────────────────────────────────

function mdToHtml(reportMarkdown, clientName, userData) {
  const sec    = parseReportSections(reportMarkdown);
  const timing = parseTimingTable(sec.s6table || '');
  const rules  = parseOperatingRules(sec.s15 || '');
  const arch   = getArchitectureDisplay(userData?.hdType, userData?.hdAuthority);
  const year   = new Date().getFullYear();

  const S = {};
  ['s1','s2','s3','s4','s5','s6intro','s6summary','s7','s8','s9','s10','s11','s12','s13','s14','s15','s16','s17'].forEach(k => {
    S[k] = markdownBodyToHtml(sec[k] || '');
  });

  const expCallout  = extractCallout(sec.s7  || '');
  const protCallout = extractCallout(sec.s8  || '');
  const patCallout  = extractCallout(sec.s12 || '');

  const timingRowsHtml = timing.rows.map(r => `
      <div style="display:grid;grid-template-columns:110px 1fr 2fr;gap:16px;align-items:center;padding:14px 20px;border-bottom:1px solid #2A2A2A;">
        <span style="font-size:13px;color:#FFFFFF;letter-spacing:0.05em;">${r.month}</span>
        <span style="${r.envClass === 'env-green' ? 'background:rgba(29,185,84,0.10);color:#1DB954;border:1px solid rgba(29,185,84,0.3);' : r.envClass === 'env-red' ? 'background:rgba(232,68,90,0.10);color:#E8445A;border:1px solid rgba(232,68,90,0.3);' : 'background:rgba(245,166,35,0.10);color:#F5A623;border:1px solid rgba(245,166,35,0.3);'}display:inline-flex;align-items:center;gap:6px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;padding:4px 10px;border-radius:3px;white-space:nowrap;"><span style="width:6px;height:6px;border-radius:50%;background:${r.envClass === 'env-green' ? '#1DB954' : r.envClass === 'env-red' ? '#E8445A' : '#F5A623'};flex-shrink:0;"></span>${r.envLabel}</span>
        <span style="font-size:13px;color:#9BA8C0;line-height:1.5;">${r.note}</span>
      </div>`).join('');

  const rulesHtml = rules.map((r, i) => `
      <div style="display:flex;gap:16px;align-items:flex-start;padding:18px 0;border-bottom:1px solid #2A2A2A;">
        <span style="font-family:Georgia,serif;font-size:22px;color:#C9A84C;opacity:0.5;line-height:1;min-width:28px;margin-top:2px;">0${i+1}</span>
        <div style="font-size:15px;color:#9BA8C0;line-height:1.7;">
          <span style="display:block;font-size:14px;color:#FFFFFF;letter-spacing:0.03em;margin-bottom:4px;font-family:Georgia,serif;font-style:italic;">${r.title}</span>
          ${r.body}
        </div>
      </div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>The Edge Index Brief — ${clientName}</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    html{font-size:16px}
    body{background:#000000;color:#FFFFFF;font-family:'Georgia','Times New Roman',serif;line-height:1.75;-webkit-font-smoothing:antialiased;margin:0;padding:0;}
    .wrap{max-width:760px;margin:0 auto;padding:0 24px}
    .section-body p{margin-bottom:18px;color:#E0E0E0;}
    .section-body p:last-child{margin-bottom:0}
    .report-section{padding:52px 0;border-bottom:1px solid #2A2A2A}
    .report-section:last-of-type{border-bottom:none}
    .section-title::after{content:'';display:block;width:40px;height:2px;background:#C9A84C;margin-top:16px}
    @media(max-width:600px){.tools-grid{grid-template-columns:1fr!important}.discipline-grid{grid-template-columns:1fr!important}.dual-cta{grid-template-columns:1fr!important}}
  </style>
</head>
<body bgcolor="#000000" style="background:#000000;margin:0;padding:0;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background-color:#000000;min-width:100%;">
<tr><td bgcolor="#000000" style="background-color:#000000;">

<!-- HEADER -->
<header style="background:#0A0A0A;border-bottom:1px solid #2A2A2A;padding:48px 0 40px;text-align:center;">
  <div style="max-width:760px;margin:0 auto;padding:0 24px;">
    <span style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.35em;text-transform:uppercase;color:#C9A84C;margin-bottom:28px;display:block;">The Edge Index</span>
    <h1 style="font-family:Georgia,serif;font-size:clamp(28px,5vw,42px);font-weight:normal;letter-spacing:-0.02em;color:#FFFFFF;line-height:1.2;margin-bottom:10px;">Strategic Timing Intelligence</h1>
    <p style="font-size:13px;letter-spacing:0.2em;text-transform:uppercase;color:#9BA8C0;margin-bottom:36px;">Decision Intelligence Brief — ${year}</p>
    <div style="display:inline-flex;align-items:center;gap:10px;background:rgba(201,168,76,0.12);border:1px solid rgba(201,168,76,0.3);border-radius:4px;padding:10px 20px;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;color:#E8C96A;">
      <span style="color:#9BA8C0;">Prepared for</span> ${clientName}
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;padding-top:28px;border-top:1px solid #2A2A2A;"><tr>
      <td width="33%" style="text-align:center;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#9BA8C0;padding:8px;"><strong style="display:block;font-family:Georgia,serif;font-size:15px;letter-spacing:0;color:#FFFFFF;margin-bottom:4px;font-weight:normal;">${year}–${year+1}</strong>Report Period</td>
      <td width="33%" style="text-align:center;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#9BA8C0;padding:8px;"><strong style="display:block;font-family:Georgia,serif;font-size:15px;letter-spacing:0;color:#FFFFFF;margin-bottom:4px;font-weight:normal;">17</strong>Sections</td>
      <td width="33%" style="text-align:center;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#9BA8C0;padding:8px;"><strong style="display:block;font-family:Georgia,serif;font-size:15px;letter-spacing:0;color:#FFFFFF;margin-bottom:4px;font-weight:normal;">${timing.greenCount} / ${timing.amberCount} / ${timing.redCount}</strong>Green · Amber · Red</td>
    </tr></table>
  </div>
</header>

<!-- SIGNAL BAR -->
<div style="background:#0A0A0A;border-bottom:1px solid #C9A84C;border-top:1px solid #C9A84C;padding:20px 0;">
  <div style="max-width:760px;margin:0 auto;padding:0 24px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#C9A84C;white-space:nowrap;padding-right:16px;">Active Signals</td>
      <td style="text-align:right;">
        ${['Clarity','Action','Expansion','Pressure','Emotional Volatility','Risk','Opportunity Window'].map(s => `<span style="display:inline-block;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;padding:4px 10px;margin:2px;border-radius:2px;background:rgba(201,168,76,0.1);color:#C9A84C;border:1px solid rgba(201,168,76,0.3);">${s}</span>`).join('')}
      </td>
    </tr></table>
  </div>
</div>

<!-- DELIVERY INTRO -->
<div style="background:#000000;border-bottom:1px solid #2A2A2A;padding:20px 0;">
  <div style="max-width:760px;margin:0 auto;padding:0 24px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font-size:13px;color:#CCCCCC;line-height:1.65;">Your Edge Index Brief is a complete decision timing intelligence system for <strong style="color:#C9A84C;">${year}</strong>. Most traders spend $3,000–$6,000 per year on tools that analyse the market — but never the decision maker.</td>
      <td width="120" style="text-align:right;padding-left:16px;white-space:nowrap;vertical-align:middle;">
        <span style="display:inline-block;background:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.3);border-radius:3px;padding:8px 12px;font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:#C9A84C;">&#9679; PDF attached</span>
      </td>
    </tr></table>
  </div>
</div>

<!-- TABLE OF CONTENTS -->
<div class="wrap">
  <div style="padding:48px 0;border-bottom:1px solid #2A2A2A;">
    <span style="font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:#C9A84C;margin-bottom:20px;display:block;">Contents</span>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      ${(()=>{const items=[['01','Executive Overview'],['02','Your Decision Architecture'],['03','Behaviour Under Pressure'],['04','The Signal Framework'],['05','Your Personal Timing Profile'],['06','Your 12-Month Timing Map'],['07','Expansion Windows'],['08','Protection Periods'],['09','Opportunity Windows'],['10','Risk Environment Patterns'],['11','Emotional Volatility Cycles'],['12','Strategic Patience'],['13','Decision Discipline Framework'],['14','Behavioural Blind Spots'],['15','Strategic Operating Rules'],['16','Monitoring Your Timing'],['17','Final Insight']];let rows='';for(let i=0;i<items.length;i+=2){const a=items[i],b=items[i+1];rows+=`<tr><td style="font-size:13px;color:#DDDDDD;padding:7px 16px 7px 0;border-bottom:1px solid #2A2A2A;width:50%;"><span style="font-size:10px;color:#C9A84C;letter-spacing:0.1em;margin-right:10px;">${a[0]}</span>${a[1]}</td><td style="font-size:13px;color:#DDDDDD;padding:7px 0 7px 16px;border-bottom:1px solid #2A2A2A;width:50%;">${b?`<span style="font-size:10px;color:#C9A84C;letter-spacing:0.1em;margin-right:10px;">${b[0]}</span>${b[1]}`:''}</td></tr>`;}return rows;})()}
    </table>
  </div>
</div>

<div style="height:1px;background:linear-gradient(90deg,transparent,#C9A84C,transparent);opacity:0.3;"></div>

<!-- MAIN REPORT -->
<main class="wrap">

  <!-- S1 -->
  <section class="report-section" style="padding:52px 0;border-bottom:1px solid #2A2A2A;">
    <span style="font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:#C9A84C;margin-bottom:10px;display:block;">Section 01</span>
    <h2 class="section-title" style="font-family:Georgia,serif;font-size:clamp(20px,3vw,26px);font-weight:normal;color:#FFFFFF;letter-spacing:-0.01em;margin-bottom:28px;line-height:1.3;">Executive Overview</h2>
    <div class="section-body" style="font-size:15.5px;line-height:1.85;color:#9BA8C0;">${S.s1}</div>
  </section>

  <!-- S2 -->
  <section class="report-section" style="padding:52px 0;border-bottom:1px solid #2A2A2A;">
    <span style="font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:#C9A84C;margin-bottom:10px;display:block;">Section 02</span>
    <h2 class="section-title" style="font-family:Georgia,serif;font-size:clamp(20px,3vw,26px);font-weight:normal;color:#FFFFFF;letter-spacing:-0.01em;margin-bottom:16px;line-height:1.3;">Your Decision Architecture</h2>
    <div style="display:inline-flex;align-items:center;gap:12px;background:rgba(201,168,76,0.12);border:1px solid rgba(201,168,76,0.2);border-radius:4px;padding:10px 18px;margin-bottom:26px;">
      <span style="font-size:9px;letter-spacing:0.3em;text-transform:uppercase;color:#9BA8C0;white-space:nowrap;">Decision Architecture</span>
      <span style="width:1px;height:14px;background:#263258;flex-shrink:0;"></span>
      <span style="font-family:Georgia,serif;font-size:14px;color:#E8C96A;font-style:italic;">${arch}</span>
    </div>
    <div class="section-body" style="font-size:15.5px;line-height:1.85;color:#9BA8C0;">${S.s2}</div>
  </section>

  <!-- S3 -->
  <section class="report-section" style="padding:52px 0;border-bottom:1px solid #2A2A2A;">
    <span style="font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:#C9A84C;margin-bottom:10px;display:block;">Section 03</span>
    <h2 class="section-title" style="font-family:Georgia,serif;font-size:clamp(20px,3vw,26px);font-weight:normal;color:#FFFFFF;letter-spacing:-0.01em;margin-bottom:28px;line-height:1.3;">Behaviour Under Pressure</h2>
    <div class="section-body" style="font-size:15.5px;line-height:1.85;color:#9BA8C0;">${S.s3}</div>
  </section>

  <!-- S4 -->
  <section class="report-section" style="padding:52px 0;border-bottom:1px solid #2A2A2A;">
    <span style="font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:#C9A84C;margin-bottom:10px;display:block;">Section 04</span>
    <h2 class="section-title" style="font-family:Georgia,serif;font-size:clamp(20px,3vw,26px);font-weight:normal;color:#FFFFFF;letter-spacing:-0.01em;margin-bottom:28px;line-height:1.3;">The Edge Index Signal Framework</h2>
    <div class="section-body" style="font-size:15.5px;line-height:1.85;color:#9BA8C0;">${S.s4}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:24px;">
      ${['Clarity','Action','Expansion','Pressure','Volatility','Risk','Opportunity Window'].map(s => `<span style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;padding:5px 12px;border-radius:3px;background:rgba(155,168,192,0.08);color:#9BA8C0;border:1px solid rgba(155,168,192,0.2);">${s}</span>`).join('')}
    </div>
  </section>

  <!-- S5 -->
  <section class="report-section" style="padding:52px 0;border-bottom:1px solid #2A2A2A;">
    <span style="font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:#C9A84C;margin-bottom:10px;display:block;">Section 05</span>
    <h2 class="section-title" style="font-family:Georgia,serif;font-size:clamp(20px,3vw,26px);font-weight:normal;color:#FFFFFF;letter-spacing:-0.01em;margin-bottom:28px;line-height:1.3;">Your Personal Timing Profile</h2>
    <div class="section-body" style="font-size:15.5px;line-height:1.85;color:#9BA8C0;">${S.s5}</div>
  </section>

  <!-- S6 — TIMING MAP -->
  <section class="report-section" style="padding:52px 0;border-bottom:1px solid #2A2A2A;">
    <span style="font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:#C9A84C;margin-bottom:10px;display:block;">Section 06</span>
    <h2 class="section-title" style="font-family:Georgia,serif;font-size:clamp(20px,3vw,26px);font-weight:normal;color:#FFFFFF;letter-spacing:-0.01em;margin-bottom:28px;line-height:1.3;">Your 12-Month Timing Map</h2>
    <div class="section-body" style="font-size:15.5px;line-height:1.85;color:#9BA8C0;">${S.s6intro}</div>
    <div style="margin-top:32px;border:1px solid #2A2A2A;border-radius:6px;overflow:hidden;">
      <div style="background:#0D0D0D;padding:14px 20px;display:grid;grid-template-columns:110px 1fr 2fr;gap:16px;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#9BA8C0;border-bottom:1px solid #2A2A2A;">
        <span>Month</span><span>Environment</span><span>Key Conditions</span>
      </div>
      ${timingRowsHtml || '<div style="padding:20px;color:#9BA8C0;font-size:13px;">Timing data not available</div>'}
    </div>
    <div class="section-body" style="font-size:15.5px;line-height:1.85;color:#9BA8C0;margin-top:28px;">${S.s6summary}</div>
  </section>

  <!-- S7 -->
  <section class="report-section" style="padding:52px 0;border-bottom:1px solid #2A2A2A;">
    <span style="font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:#C9A84C;margin-bottom:10px;display:block;">Section 07</span>
    <h2 class="section-title" style="font-family:Georgia,serif;font-size:clamp(20px,3vw,26px);font-weight:normal;color:#FFFFFF;letter-spacing:-0.01em;margin-bottom:28px;line-height:1.3;">Expansion Windows</h2>
    <div class="section-body" style="font-size:15.5px;line-height:1.85;color:#9BA8C0;">${S.s7}</div>
    ${expCallout ? `<div style="margin:28px 0;padding:24px 28px;border-left:3px solid #1DB954;background:rgba(29,185,84,0.10);border-radius:0 4px 4px 0;"><p style="font-size:15px;color:#FFFFFF;line-height:1.7;margin:0;font-style:italic;">${expCallout}</p></div>` : ''}
  </section>

  <!-- S8 -->
  <section class="report-section" style="padding:52px 0;border-bottom:1px solid #2A2A2A;">
    <span style="font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:#C9A84C;margin-bottom:10px;display:block;">Section 08</span>
    <h2 class="section-title" style="font-family:Georgia,serif;font-size:clamp(20px,3vw,26px);font-weight:normal;color:#FFFFFF;letter-spacing:-0.01em;margin-bottom:28px;line-height:1.3;">Protection Periods</h2>
    <div class="section-body" style="font-size:15.5px;line-height:1.85;color:#9BA8C0;">${S.s8}</div>
    ${protCallout ? `<div style="margin:28px 0;padding:24px 28px;border-left:3px solid #E8445A;background:rgba(232,68,90,0.10);border-radius:0 4px 4px 0;"><p style="font-size:15px;color:#FFFFFF;line-height:1.7;margin:0;font-style:italic;">${protCallout}</p></div>` : ''}
  </section>

  <!-- S9 -->
  <section class="report-section" style="padding:52px 0;border-bottom:1px solid #2A2A2A;">
    <span style="font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:#C9A84C;margin-bottom:10px;display:block;">Section 09</span>
    <h2 class="section-title" style="font-family:Georgia,serif;font-size:clamp(20px,3vw,26px);font-weight:normal;color:#FFFFFF;letter-spacing:-0.01em;margin-bottom:28px;line-height:1.3;">Opportunity Windows</h2>
    <div class="section-body" style="font-size:15.5px;line-height:1.85;color:#9BA8C0;">${S.s9}</div>
  </section>

  <!-- S10 -->
  <section class="report-section" style="padding:52px 0;border-bottom:1px solid #2A2A2A;">
    <span style="font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:#C9A84C;margin-bottom:10px;display:block;">Section 10</span>
    <h2 class="section-title" style="font-family:Georgia,serif;font-size:clamp(20px,3vw,26px);font-weight:normal;color:#FFFFFF;letter-spacing:-0.01em;margin-bottom:28px;line-height:1.3;">Risk Environment Patterns</h2>
    <div class="section-body" style="font-size:15.5px;line-height:1.85;color:#9BA8C0;">${S.s10}</div>
  </section>

  <!-- S11 -->
  <section class="report-section" style="padding:52px 0;border-bottom:1px solid #2A2A2A;">
    <span style="font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:#C9A84C;margin-bottom:10px;display:block;">Section 11</span>
    <h2 class="section-title" style="font-family:Georgia,serif;font-size:clamp(20px,3vw,26px);font-weight:normal;color:#FFFFFF;letter-spacing:-0.01em;margin-bottom:28px;line-height:1.3;">Emotional Volatility Cycles</h2>
    <div class="section-body" style="font-size:15.5px;line-height:1.85;color:#9BA8C0;">${S.s11 || S.s10}</div>
  </section>

  <!-- S12 -->
  <section class="report-section" style="padding:52px 0;border-bottom:1px solid #2A2A2A;">
    <span style="font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:#C9A84C;margin-bottom:10px;display:block;">Section 12</span>
    <h2 class="section-title" style="font-family:Georgia,serif;font-size:clamp(20px,3vw,26px);font-weight:normal;color:#FFFFFF;letter-spacing:-0.01em;margin-bottom:28px;line-height:1.3;">Strategic Patience</h2>
    <div class="section-body" style="font-size:15.5px;line-height:1.85;color:#9BA8C0;">${S.s12}</div>
    ${patCallout ? `<div style="margin:28px 0;padding:24px 28px;border-left:3px solid #C9A84C;background:rgba(201,168,76,0.12);border-radius:0 4px 4px 0;"><p style="font-size:15px;color:#FFFFFF;line-height:1.7;margin:0;font-style:italic;">${patCallout}</p></div>` : ''}
  </section>

  <!-- S13 — DISCIPLINE FRAMEWORK -->
  <section class="report-section" style="padding:52px 0;border-bottom:1px solid #2A2A2A;">
    <span style="font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:#C9A84C;margin-bottom:10px;display:block;">Section 13</span>
    <h2 class="section-title" style="font-family:Georgia,serif;font-size:clamp(20px,3vw,26px);font-weight:normal;color:#FFFFFF;letter-spacing:-0.01em;margin-bottom:28px;line-height:1.3;">Decision Discipline Framework</h2>
    <div class="section-body" style="font-size:15.5px;line-height:1.85;color:#9BA8C0;">${S.s13}</div>
    <div class="discipline-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:28px;">
      <div style="background:rgba(29,185,84,0.10);border:1px solid rgba(29,185,84,0.25);border-radius:6px;padding:24px 20px;text-align:center;">
        <div style="font-size:10px;letter-spacing:0.25em;text-transform:uppercase;margin-bottom:12px;color:#1DB954;">Green — Expansion</div>
        <div style="font-family:Georgia,serif;font-size:16px;color:#FFFFFF;margin-bottom:10px;line-height:1.3;">Act Decisively</div>
        <div style="font-size:12px;color:#9BA8C0;line-height:1.5;">Prioritise high-conviction moves. Size up. Trust the conditions.</div>
      </div>
      <div style="background:rgba(245,166,35,0.10);border:1px solid rgba(245,166,35,0.25);border-radius:6px;padding:24px 20px;text-align:center;">
        <div style="font-size:10px;letter-spacing:0.25em;text-transform:uppercase;margin-bottom:12px;color:#F5A623;">Amber — Selective</div>
        <div style="font-family:Georgia,serif;font-size:16px;color:#FFFFFF;margin-bottom:10px;line-height:1.3;">Act with Precision</div>
        <div style="font-size:12px;color:#9BA8C0;line-height:1.5;">Raise entry criteria. Smaller size. Tighter discipline.</div>
      </div>
      <div style="background:rgba(232,68,90,0.10);border:1px solid rgba(232,68,90,0.25);border-radius:6px;padding:24px 20px;text-align:center;">
        <div style="font-size:10px;letter-spacing:0.25em;text-transform:uppercase;margin-bottom:12px;color:#E8445A;">Red — Protection</div>
        <div style="font-family:Georgia,serif;font-size:16px;color:#FFFFFF;margin-bottom:10px;line-height:1.3;">Protect Capital</div>
        <div style="font-size:12px;color:#9BA8C0;line-height:1.5;">Reduce exposure. Wait for the next window. Patience is a position.</div>
      </div>
    </div>
  </section>

  <!-- S14 -->
  <section class="report-section" style="padding:52px 0;border-bottom:1px solid #2A2A2A;">
    <span style="font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:#C9A84C;margin-bottom:10px;display:block;">Section 14</span>
    <h2 class="section-title" style="font-family:Georgia,serif;font-size:clamp(20px,3vw,26px);font-weight:normal;color:#FFFFFF;letter-spacing:-0.01em;margin-bottom:28px;line-height:1.3;">Behavioural Blind Spots</h2>
    <div class="section-body" style="font-size:15.5px;line-height:1.85;color:#9BA8C0;">${S.s14}</div>
  </section>

  <!-- S15 — OPERATING RULES -->
  <section class="report-section" style="padding:52px 0;border-bottom:1px solid #2A2A2A;">
    <span style="font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:#C9A84C;margin-bottom:10px;display:block;">Section 15</span>
    <h2 class="section-title" style="font-family:Georgia,serif;font-size:clamp(20px,3vw,26px);font-weight:normal;color:#FFFFFF;letter-spacing:-0.01em;margin-bottom:28px;line-height:1.3;">Strategic Operating Rules</h2>
    <div style="margin-top:24px;">${rulesHtml}</div>
  </section>

  <!-- S16 — MONITORING -->
  <section class="report-section" style="padding:52px 0;border-bottom:1px solid #2A2A2A;">
    <span style="font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:#C9A84C;margin-bottom:10px;display:block;">Section 16</span>
    <h2 class="section-title" style="font-family:Georgia,serif;font-size:clamp(20px,3vw,26px);font-weight:normal;color:#FFFFFF;letter-spacing:-0.01em;margin-bottom:28px;line-height:1.3;">Monitoring Your Timing</h2>
    <div class="section-body" style="font-size:15.5px;line-height:1.85;color:#9BA8C0;">${S.s16}</div>
    <div class="tools-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:32px;">
      ${[['◎','Weekly Edge','Every Week','Weekly signal review and environment assessment for the week ahead. $97/month'],['◉','Daily Edge','Every Day','Daily timing conditions and decision guidance delivered each morning. $197/month'],['●','Live Edge','Real-Time','Live signal monitoring as timing conditions shift throughout the day. $397/month']].map(([icon,name,freq,desc]) => `
      <div style="background:#0D0D0D;border:1px solid #2A2A2A;border-radius:6px;padding:28px 22px;text-align:center;">
        <div style="width:40px;height:40px;border-radius:50%;background:rgba(201,168,76,0.12);border:1px solid rgba(201,168,76,0.25);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:16px;">${icon}</div>
        <div style="font-family:Georgia,serif;font-size:15px;color:#FFFFFF;margin-bottom:8px;">${name}</div>
        <div style="font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#C9A84C;margin-bottom:12px;">${freq}</div>
        <div style="font-size:12.5px;color:#9BA8C0;line-height:1.6;">${desc}</div>
      </div>`).join('')}
    </div>
    <div style="margin:32px 0 0;padding:24px 28px;border-left:3px solid #C9A84C;background:rgba(201,168,76,0.12);border-radius:0 4px 4px 0;">
      <p style="font-size:15px;color:#FFFFFF;line-height:1.7;margin:0;font-style:italic;">Most traders who receive this Brief choose Daily Edge. They've already paid $2,500 to know their windows. Monitoring is how they don't miss them.</p>
    </div>
  </section>

</main>

<!-- CTA -->
<div style="background:#0A0A0A;border-top:1px solid #2A2A2A;border-bottom:1px solid #2A2A2A;padding:56px 0;text-align:center;margin-top:16px;">
  <div style="max-width:660px;margin:0 auto;padding:0 24px;">
    <p style="font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:#C9A84C;margin-bottom:16px;">Continue Your Edge</p>
    <h2 style="font-family:Georgia,serif;font-size:clamp(22px,4vw,30px);font-weight:normal;color:#FFFFFF;line-height:1.3;margin-bottom:16px;">Track your timing signals in real time</h2>
    <p style="font-size:14px;color:#9BA8C0;line-height:1.7;margin-bottom:32px;">Your yearly map is the strategic foundation. Timing conditions shift week to week and day to day within that structure.</p>
    <div class="dual-cta" style="display:grid;grid-template-columns:1fr 1fr;border:1px solid #2A2A2A;border-radius:6px;overflow:hidden;max-width:600px;margin:0 auto;">
      <div style="padding:32px 28px;text-align:center;background:#0D0D0D;border-right:1px solid #2A2A2A;">
        <span style="font-size:9px;letter-spacing:0.3em;text-transform:uppercase;margin-bottom:10px;display:block;color:#1DB954;">For Individual Traders</span>
        <div style="font-family:Georgia,serif;font-size:16px;font-weight:normal;color:#FFFFFF;line-height:1.35;margin-bottom:10px;">Weekly, Daily &amp; Live Monitoring</div>
        <p style="font-size:12px;color:#9BA8C0;line-height:1.6;margin-bottom:22px;">Stay aligned with your timing windows as they open and close throughout ${year}.</p>
        <a href="https://edgeindex.io/monitoring" style="display:inline-block;background:#C9A84C;color:#000000;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;padding:11px 22px;border-radius:3px;text-decoration:none;font-family:Georgia,serif;font-weight:bold;">Explore Monitoring →</a>
      </div>
      <div style="padding:32px 28px;text-align:center;background:#0A0A0A;">
        <span style="font-size:9px;letter-spacing:0.3em;text-transform:uppercase;margin-bottom:10px;display:block;color:#C9A84C;">For Community Operators</span>
        <div style="font-family:Georgia,serif;font-size:16px;font-weight:normal;color:#FFFFFF;line-height:1.35;margin-bottom:10px;">Community Licensing</div>
        <p style="font-size:12px;color:#9BA8C0;line-height:1.6;margin-bottom:22px;">Add the Edge Index Brief to your community as a premium timing intelligence product.</p>
        <a href="https://edgeindex.io/community" style="display:inline-block;background:transparent;color:#C9A84C;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;padding:10px 22px;border-radius:3px;text-decoration:none;font-family:Georgia,serif;border:1px solid rgba(201,168,76,0.35);">Learn About Licensing →</a>
      </div>
    </div>
  </div>
</div>

<!-- S17 — FINAL INSIGHT -->
<div class="wrap">
  <div style="padding:64px 0 72px;text-align:center;">
    <span style="font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:#C9A84C;display:block;margin-bottom:12px;">Section 17</span>
    <p style="font-family:Georgia;font-size:clamp(14px,2vw,16px);letter-spacing:0.12em;text-transform:uppercase;color:#9BA8C0;margin:0 0 40px;">Final Insight</p>
    <p style="font-family:Georgia,serif;font-size:clamp(18px,3vw,24px);color:#FFFFFF;font-style:italic;line-height:1.6;max-width:580px;margin:0 auto 32px;">"In high-performance environments, the edge rarely comes from superior information alone. It comes from knowing when conditions support decisive action — and having the discipline to wait when they do not."</p>
    <div style="width:60px;height:1px;background:#C9A84C;margin:32px auto;opacity:0.5;"></div>
    <div style="font-size:14.5px;color:#9BA8C0;line-height:1.8;max-width:520px;margin:0 auto;">${S.s17}</div>
    <div style="width:60px;height:1px;background:#C9A84C;margin:32px auto;opacity:0.5;"></div>
    <p style="font-size:12px;letter-spacing:0.2em;text-transform:uppercase;color:#C9A84C;margin-top:8px;">The Edge Index — ${year}</p>
  </div>
</div>

<!-- FOOTER -->
<footer style="background:#0A0A0A;border-top:1px solid #2A2A2A;padding:36px 0;">
  <div style="max-width:760px;margin:0 auto;padding:0 24px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;">
    <span style="font-size:11px;letter-spacing:0.25em;text-transform:uppercase;color:#C9A84C;">The Edge Index</span>
    <p style="font-size:11.5px;color:#9BA8C0;line-height:1.6;">This report was prepared exclusively for ${clientName}.<br/>Strategic Timing Intelligence &amp; Decision Psychology.<br/>edgeindex.io</p>
    <p style="font-size:11.5px;color:#9BA8C0;line-height:1.6;text-align:right;">&copy; ${year} The Edge Index.<br/>All rights reserved.</p>
  </div>
</footer>

</td></tr></table>
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

async function sendReportEmail(toEmail, toName, reportMarkdown, userData = {}) {
  if (!RESEND_KEY) {
    console.warn('RESEND_API_KEY not set — skipping email delivery');
    return { skipped: true };
  }

  const htmlBody  = mdToHtml(reportMarkdown, toName, userData);
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
      await sendReportEmail(email, firstName, report, userData);
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
  `Hey ${name},\n\nNoticed your trading community is solid. Quick question — what's your biggest pain point with retention right now?\n\nI built a decision-timing intelligence tool that's basically a retention engine disguised as a performance tool. Members get a personalised annual timing brief — their highest-leverage windows to act, and their highest-risk periods to stand down. When they use it, decision quality improves noticeably.\n\nWorth a 5-min chat to see if it fits? No pressure either way.`;

const OUTREACH_MSG_2 = (name) =>
  `Hey ${name},\n\nFollowing up — know you're busy.\n\nJust launched this with a few other communities (similar size to yours). Members are actually *using* it consistently, which is rare. The retention lift has been solid.\n\nIt's 100% hands-off on your end — Telegram bot, fully automated.\n\nIf decision-timing tools + retention interest you, lmk. Otherwise no worries — I'll stop pinging.`;

const OUTREACH_MSG_3 = (name) =>
  `Hey ${name},\n\nLast one, I promise.\n\nHere's the real value prop: most communities leak members because they don't get consistent results. This tool gives members *personalised decision-timing intelligence* — a 17-section annual brief that maps exactly when their decision quality is sharpest and when they're most exposed to behavioural errors. It's behavioural psychology + timing cycles, engineered into a strategic document.\n\nMembers who see results don't leave. That's the retention play.\n\nHow it works:\n- I handle everything. Telegram bot, fully automated.\n- Members enter their birth data once. They receive their personalised annual brief.\n- You do nothing after a 5-min setup.\n\nThe founding beta offer:\n$500/month for 3 months (normally $800–$6,000/month depending on community size). If it doesn't move the needle in 90 days, we part ways.\n\nWant to talk about your community's retention goals?`;

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
