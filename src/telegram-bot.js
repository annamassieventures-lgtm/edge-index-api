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
import { scoreLeadMessage } from './lead-scorer.js';
import { runLeadScan, getScannerStatus } from './twitter-scanner.js';
import { initOutreachClient, requestOtp, verifyOtp, isConnected } from './outreach-client.js';
import { runOutreachSequencer, draftSalesResponse, loadOutreach, saveOutreach } from './outreach-sequencer.js';
import { runWeeklyEdge, runDailyEdge, sendDay7Checkin, sendDay30Upsell } from './monitoring-engine.js';
import { addSubscriber, getSubscriberCount, getAllSubscribers, restoreFromEnv } from './shared/monitoringSubscribers.js';
import {
  loadOutreachData, getTarget, updateTarget, markReplied,
  sendColdEmail, sendFollowUp,
  runDailyFollowUpSweep, runDailyLicensingSweep,
  markReportReceived, getOutreachStats, getTierTargets, getReadyTargets,
  importFromCSV,
} from './community-outreach.js';

import {
  loadAiData, getAiTarget, markAiReplied,
  sendAiColdEmail, sendAiFollowUp, sendAffiliatePitch,
  runAiDailyFollowUpSweep, runAiAffiliatePitchSweep,
  markAiReportReceived, getAiStats, batchSendAiColdEmails,
} from './ai-affiliate-outreach.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Configuration ─────────────────────────────────────────────────────────────

const BOT_TOKEN     = process.env.TELEGRAM_BOT_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_KEY    = process.env.RESEND_API_KEY;
const ANNA_CHAT_ID  = String(process.env.ANNA_CHAT_ID || '5838005991');
const WHOP_URL      = process.env.WHOP_URL || 'https://whop.com/edge-index';
const FROM_EMAIL    = 'The Edge Index <reports@edgeindex.io>';
const RAILWAY_URL   = `http://localhost:${process.env.PORT || 8080}`;

if (!BOT_TOKEN)     throw new Error('TELEGRAM_BOT_TOKEN is required');
if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_API_KEY is required');
if (!RESEND_KEY)    console.warn('⚠️  RESEND_API_KEY not set — email delivery disabled');

// Drop any existing webhook/polling conflict before starting
await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook?drop_pending_updates=true`).catch(() => {});

const bot       = new TelegramBot(BOT_TOKEN, { polling: { interval: 2000, autoStart: true, params: { timeout: 10 } } });
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

// Restore monitoring subscribers from Railway env var backup on startup
restoreFromEnv();

// ─── Pending outreach reply drafts ─────────────────────────────────────────────
// Stores Claude-drafted replies awaiting Anna's approval
const pendingDrafts = new Map();

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

// loadOutreach / saveOutreach imported from outreach-sequencer.js
// (local versions removed to avoid duplicate declaration)

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

ABSOLUTE HARD RULE — PLANETARY NAMES ARE BANNED FROM OUTPUT:
The signal system uses planetary cycle data as its internal calculation engine. This is proprietary methodology and must NEVER appear in the client-facing report. The following words must never appear anywhere in the report output under any circumstances:
Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune, Pluto, Sun, Moon (as astrological bodies), retrograde, transit, conjunction, opposition, square, trine, sextile, natal, ascendant, eclipse.

These are internal calculation inputs only. The output uses Edge Index signal names exclusively:
- Mercury cycle → "Clarity Signal"
- Saturn cycle → "Pressure Signal"
- Mars cycle → "Action Signal"
- Jupiter cycle → "Expansion Signal"
- Mars/Pluto tension → "Risk Signal"
- Emotional wave → "Emotional Volatility Signal"

If you find yourself about to write a planet name in the report, stop and replace it with the corresponding Edge Index signal name. This rule has no exceptions. A report containing any planetary name is a failed output.

LANGUAGE — use operational terminology only:
- "decision posture," "timing conditions," "expansion environment," "compression environment," "signal alignment," "distortion risk," "opportunity window," "pressure cycle," "behavioural pattern"
- Never use astrology terminology (no "transit," "conjunction," "natal chart," "retrograde," "ascendant," and no planet names — see ABSOLUTE HARD RULE above)
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
Emotional Authority: Clarity emerges after emotional wave settles. Never commit to positions at emotional peaks or troughs — decision quality is lowest at both extremes. The neutral wave is the decision window.
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

IMPORTANT NOTICE — Place immediately after Cover Page, before Golden Windows
Format as a clearly separated page with the following text verbatim:

---
**IMPORTANT NOTICE**

This report is a decision psychology framework. It is not financial advice.

The Edge Index Brief applies principles from behavioural finance and cyclical pattern analysis to support self-awareness in trading decision-making. It does not predict market movements, recommend specific assets, or guarantee trading outcomes. All investment and trading decisions remain the sole responsibility of the reader.

The personalisation layer of this report is derived from your birth profile data, combined with macro cyclical analysis and established behavioural psychology principles. The seven signals described in this brief represent a pattern-recognition framework — not a scientific prediction of future psychological states.

Past patterns do not guarantee future performance. This brief is designed to support your awareness of personal decision risk — not to replace your own research, risk management process, or professional financial advice.

*The Edge Index Brief is a proprietary decision intelligence framework. Methodology is confidential.*

---

YOUR GOLDEN WINDOWS — THIS YEAR'S HIGHEST-LEVERAGE PERIODS
Place this immediately after the Important Notice page, before Section 1. This is the first thing the client reads after the disclaimer. Format as a bold, scannable reference page. List exactly 3-4 Golden Windows — the periods where signal alignment is strongest for this person's decision architecture. For each window: month range only (e.g. "Late April — Mid June 2026"), one sentence on why conditions favour clearer decision-making for THIS person specifically (reference their architecture and decision mode), one action instruction (e.g. "Conditions support decisive action. Scale. Initiate."). Then list 2-3 PROTECTION PERIODS in the same format.

NOTE: These windows represent periods of historically favourable signal alignment for this individual's decision profile. They are not guarantees of performance. Phrase them accordingly — as conditions that support action, not directives to trade.

CRITICAL: Name windows by month range only. Do NOT reveal the specific week or day — that precision requires live monitoring. At the bottom of this page, include exactly this line in italics: "The windows above show when conditions favour decisive action. To know the exact week and day your window opens — and when to stand down — that requires live signal tracking. See Section 15."

---

EXECUTIVE INTELLIGENCE SUMMARY — Place immediately after Golden Windows page (target: 1 structured page)
This is the most important page in the report. A serious buyer must be able to understand the entire brief in 60 seconds from this page alone. Format it as a structured intelligence panel — not prose. Use exactly these five fields:

PRIMARY EDGE: [One sentence — the client's strongest decision advantage, specific to their architecture and decision mode]
HIGHEST CONVICTION WINDOW: [Month range — e.g. "Late June – Late July 2026"]
PRIMARY PROTECTION PHASE: [Month range — e.g. "November – December 2026"]
CORE BEHAVIOURAL RISK: [One sentence — the specific pattern most likely to cost them capital, tied to their architecture]
OPERATING RULE FOR THE YEAR: [One sentence — the single most important principle for this person. E.g. "Prepare during Amber. Scale during Green. Protect during Red."]

Present these five fields in bold labels with concise, decisive values. No prose paragraphs on this page. After the five fields, include a single italicised sentence: "The sections that follow explain the architecture behind each of these conclusions."

---

SECTION 1 — Decision Performance Context (target: 150 words)
Open by establishing the core insight that makes the Edge Index relevant: most traders spend years refining strategy. But when you analyse performance across long cycles, something uncomfortable appears — decision quality fluctuates far more than strategy quality. The same strategy can produce large gains, small gains, or losses without changing at all. The difference is not the strategy. The difference is the decision environment of the trader using it. Present this as the framing for everything that follows. Then introduce the client's Edge Index Brief as the map of their decision environment across the next 12 months. State clearly: this is not a prediction of market prices, not a personality profile. It is decision-timing intelligence — a pattern-recognition framework built from the intersection of your individual behavioural profile and macro cyclical analysis. Include this exact sentence: "The Edge Index does not predict when markets move. It identifies when your judgment is sharpest — and when it is most at risk."

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
Identify the 2–4 months where multiple positive signals converge most strongly — these are the Golden Windows. Explain what makes these windows rare: they represent periods where personal clarity, readiness to act, and external expansion conditions align simultaneously — the combination most strongly associated with clear-headed, disciplined decision-making for this individual. Give specific preparation guidance: what should this client be doing in the weeks before these windows open so they can act decisively when the moment arrives. Reference their specific decision mode — the preparation looks different depending on their architecture. Frame these as periods to be prepared for and attentive to — not as automatic performance guarantees.

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

SECTION 16 — Monitoring the Edge (target: 200 words)
Open with this framing: this Brief maps the annual decision architecture. But timing windows do not open on a fixed date. They emerge when multiple signals converge. Knowing that a certain month is a high-conviction window is strategic intelligence. Knowing the exact week it opens — and the exact day conditions shift — requires live signal tracking. That is what the monitoring layer provides. Frame it clearly: the Brief is the architecture. Monitoring is the operational layer. They are designed to work together.

Then connect monitoring to the client's specific trading environment. If they trade crypto or Bitcoin: markets move 24/7 and windows can open and close within hours — daily or live monitoring is critical. If they trade stocks or equities: pre-market signal awareness every Monday gives a decisive edge over the week. If they trade forex: intraday volatility means daily signal updates are the minimum viable layer. If they trade commodities or energy: weekly structure is often sufficient but daily confirmation before major positions is advised. Adapt this framing to the client's actual trading focus.

Then introduce the three tiers:
Weekly Edge ($97/month): Your decision environment each week, delivered every Monday. Know whether to advance or hold before the week begins.
Daily Edge ($197/month): Daily signal tracking so you can see conditions building or pulling back in real time. The most popular tier.
Live Edge ($397/month): Immediate alerts the moment all signals align — for traders who act in hours, not days. Maximum precision.

Present the pricing factually — these are the tools that close the gap between the map and the moment. Close with exactly this sentence: "Most traders who receive this Brief choose Daily Edge. They've already paid $2,500 to know their windows. Monitoring is how they don't miss them."

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

SECTION STRUCTURE — apply to sections 2 through 13:
Each section must follow this four-part intelligence structure:
**Insight** — the core finding for this section (1-2 sentences, bold)
**What This Means** — analytical explanation in prose (2-3 paragraphs)
**Strategic Implication** — what this means for decisions (1 paragraph)
**Execution Guidance** — specific instruction for this client (1-2 sentences, direct)
This structure makes the document scannable for decision makers. They can read only the Insight and Execution Guidance lines across all sections and immediately understand the full brief.

BEHAVIOURAL INSIGHT PANELS — include 3-4 throughout the report:
At key moments in the report, insert a callout panel using this exact markdown format:
> **Behavioural Insight**
> [One observation that describes a specific pattern this client exhibits — written as if you have studied them personally. This should create a "that's exactly me" reaction. Connect it to their architecture and decision mode. End with the highest-leverage improvement available to them.]

Place these panels at natural pause points — after Section 2, after Section 6, after Section 9, and after Section 13. They must feel observed and precise, not generic.

FORMATTING:
- Return clean markdown
- Use # for section titles
- Use bold for key terms and named windows
- Section 7 timing map as a markdown table
- Write section body text in prose paragraphs — no bullet points inside sections
- Use > blockquote format for Behavioural Insight panels
- Footer on final section: "The Edge Index Brief | [Client Name] | [Report Date]"
- Total target: 4,500–5,500 words

---

QUALITY CHECKLIST — verify before outputting:
- Every section references the client by name at least once
- Section 7 table: every Strategic Notes row references their specific architecture or decision mode
- No HD terminology appears anywhere in the report
- ZERO planetary names appear anywhere in the report (Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune, Pluto) — scan every sentence before outputting
- No hedging language ("might," "could possibly," "perhaps") anywhere
- No section repeats an insight made in a previous section
- The report reads as a coherent narrative — later sections build on earlier ones
- Section 16 closes with the exact monitoring sentence as written
- Word counts are within ±20% of targets
- The Golden Windows page names 3–4 windows maximum — not inflated
- Important Notice (disclaimer) page appears immediately after Cover Page
- Section 1 includes the exact sentence: "The Edge Index does not predict when markets move. It identifies when your judgment is sharpest — and when it is most at risk."
- No language implies prediction of market prices or guaranteed trading outcomes
- Golden Windows and Section 10 are framed as conditions that support action — not directives or performance promises`;


async function generateReport(userData) {
  const now        = new Date();
  const reportDate = now.toISOString().split('T')[0];

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const startMonth = monthNames[now.getMonth()];
  const startYear  = now.getFullYear();
  const endDate    = new Date(now);
  endDate.setMonth(endDate.getMonth() + 11);
  const endMonth   = monthNames[endDate.getMonth()];
  const endYear    = endDate.getFullYear();

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
    tradeType:     userData.tradeType    || 'general trading',
    reportDate,
    reportPeriod:  `${startMonth} ${startYear} – ${endMonth} ${endYear}`,
    currentMonth:  `${startMonth} ${startYear}`,
  };

  const userPrompt =
`Generate a full 17-section Edge Index Brief for the following client.

TODAY'S DATE: ${reportDate}
REPORT PERIOD: ${clientData.reportPeriod} — use these exact months throughout the report.
CURRENT MONTH FOR "RIGHT NOW" CALLOUT IN SECTION 7: ${clientData.currentMonth}

CLIENT:
- Name: ${clientData.name}
- Date of birth: ${clientData.birthDate}
- Time of birth: ${clientData.birthTime}
- Location of birth: ${clientData.birthLocation} (lat: ${clientData.lat}, lon: ${clientData.lon})
- HD Type: ${clientData.hdType}
- HD Authority: ${clientData.hdAuthority}
- HD Profile: ${clientData.hdProfile || 'not provided'}
- HD Definition: ${clientData.hdDefinition || 'not provided'}
- Primary trading focus: ${clientData.tradeType}

REQUIREMENTS:
- Minimum 4,500 words. All 17 sections in full.
- Section 7 RIGHT NOW callout must open with "RIGHT NOW — ${clientData.currentMonth}:" and address what this client should be doing this month specifically.
- All Golden Windows, Protection Periods, and monthly table rows must use real named months from ${clientData.reportPeriod} — no placeholders.
- Every section must reference ${clientData.name} by name at least once.
- The client's trading focus (${clientData.tradeType}) must be woven into sections 7, 8, 9, 10, and 12 with specific references.
- Use Edge Index architecture names exclusively — no HD terminology anywhere in the output.`;

  const message = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 16000,
    system:     SYSTEM_PROMPT,
    messages: [{
      role:    'user',
      content: userPrompt,
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
    if (/^-{3,}$/.test(t)) return ''; // strip horizontal rules
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

// ─── Short delivery email (light theme) ───────────────────────────────────────
// The email is a concise delivery notice — the full report lives in the PDF.

function mdToHtml(reportMarkdown, clientName, userData) {
  const sec    = parseReportSections(reportMarkdown);
  const timing = parseTimingTable(sec.s6table || '');
  const year   = new Date().getFullYear();

  // 12-month visual bar
  const monthBarCells = timing.rows.length > 0
    ? timing.rows.map(r => {
        const bg = r.envClass === 'env-green' ? '#22C55E' : r.envClass === 'env-red' ? '#EF4444' : '#F59E0B';
        const label = r.month.length > 4 ? r.month.substring(0, 3) : r.month;
        return `<td style="padding:0 2px;text-align:center;vertical-align:top;"><div style="background:${bg};height:14px;border-radius:3px;margin-bottom:7px;"></div><div style="font-size:9px;color:#999999;font-family:Arial,sans-serif;">${label}</div></td>`;
      }).join('')
    : ['J','F','M','A','M','J','J','A','S','O','N','D'].map(m =>
        `<td style="padding:0 2px;text-align:center;vertical-align:top;"><div style="background:#E0E0E0;height:14px;border-radius:3px;margin-bottom:7px;"></div><div style="font-size:9px;color:#BBBBBB;font-family:Arial,sans-serif;">${m}</div></td>`
      ).join('');

  const greenMonths = timing.rows.filter(r => r.envClass === 'env-green').map(r => r.month);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Your Edge Index Brief — ${clientName}</title>
</head>
<body style="margin:0;padding:0;background:#EDECEA;font-family:Georgia,'Times New Roman',serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#EDECEA" style="background:#EDECEA;">
<tr><td align="center" style="padding:48px 20px;">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

  <!-- HEADER -->
  <tr><td bgcolor="#111111" style="background:#111111;padding:40px 48px;text-align:center;border-radius:6px 6px 0 0;">
    <div style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.35em;text-transform:uppercase;color:#C9A84C;margin-bottom:14px;">The Edge Index</div>
    <div style="font-family:Georgia,serif;font-size:26px;font-weight:normal;color:#FFFFFF;letter-spacing:-0.02em;margin-bottom:10px;">Your Brief is Ready</div>
    <div style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#888888;">Prepared for ${clientName} &nbsp;·&nbsp; ${year}</div>
  </td></tr>

  <!-- GOLD LINE -->
  <tr><td bgcolor="#C9A84C" style="background:#C9A84C;height:3px;padding:0;font-size:0;line-height:0;">&nbsp;</td></tr>

  <!-- BODY -->
  <tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;padding:48px 48px 40px;border-left:1px solid #E0DDD4;border-right:1px solid #E0DDD4;">

    <p style="font-size:17px;color:#1A1A1A;line-height:1.85;margin:0 0 18px;font-family:Georgia,serif;">Hello ${clientName},</p>
    <p style="font-size:15px;color:#333333;line-height:1.85;margin:0 0 16px;font-family:Georgia,serif;">Your Edge Index Brief is attached to this email as a PDF.</p>
    <p style="font-size:15px;color:#333333;line-height:1.85;margin:0 0 36px;font-family:Georgia,serif;">Begin with the <strong style="color:#1A1A1A;">Executive Overview</strong>, your <strong style="color:#1A1A1A;">Golden Windows</strong>, and your <strong style="color:#1A1A1A;">Protection Periods</strong>. These three pages give you the strategic structure for everything that follows.</p>

    <!-- DIVIDER -->
    <div style="border-top:1px solid #E8E5DC;margin:0 0 32px;font-size:0;">&nbsp;</div>

    <!-- 12-MONTH SNAPSHOT -->
    <div style="margin-bottom:32px;">
      <div style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:#9B8B5E;margin-bottom:18px;">Your 12-Month Snapshot</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr style="vertical-align:top;">${monthBarCells}</tr></table>
      <table cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;">
        <tr>
          <td><div style="width:10px;height:10px;background:#22C55E;border-radius:2px;display:inline-block;vertical-align:middle;margin-right:5px;"></div></td>
          <td style="font-size:11px;color:#555555;font-family:Arial,sans-serif;padding-right:20px;">Expansion — ${timing.greenCount} mo.</td>
          <td><div style="width:10px;height:10px;background:#F59E0B;border-radius:2px;display:inline-block;vertical-align:middle;margin-right:5px;"></div></td>
          <td style="font-size:11px;color:#555555;font-family:Arial,sans-serif;padding-right:20px;">Selective — ${timing.amberCount} mo.</td>
          <td><div style="width:10px;height:10px;background:#EF4444;border-radius:2px;display:inline-block;vertical-align:middle;margin-right:5px;"></div></td>
          <td style="font-size:11px;color:#555555;font-family:Arial,sans-serif;">Protection — ${timing.redCount} mo.</td>
        </tr>
      </table>
      ${greenMonths.length > 0 ? `<p style="font-size:12px;color:#555555;font-family:Arial,sans-serif;margin:12px 0 0;line-height:1.6;">Strongest windows: <strong style="color:#1A1A1A;">${greenMonths.join(', ')}</strong></p>` : ''}
    </div>

    <!-- DIVIDER -->
    <div style="border-top:1px solid #E8E5DC;margin:0 0 32px;font-size:0;">&nbsp;</div>

    <!-- MONITORING UPSELL -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td bgcolor="#111111" style="background:#111111;border-radius:4px;padding:32px 36px;text-align:center;">
      <div style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:#C9A84C;margin-bottom:14px;">Don't miss your windows</div>
      <p style="font-family:Georgia,serif;font-size:17px;color:#FFFFFF;line-height:1.55;margin:0 0 12px;font-style:italic;">Your annual map is the foundation.<br/>Timing shifts week to week within that structure.</p>
      <p style="font-size:13px;color:#AAAAAA;line-height:1.7;margin:0 0 24px;font-family:Arial,sans-serif;">Weekly Edge, Daily Edge, and Live monitoring alerts track the exact moment your conditions begin to shift — so you act in the window, not after it.</p>
      <a href="https://edgeindex.io" style="display:inline-block;background:#C9A84C;color:#000000;font-family:Arial,sans-serif;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;padding:13px 32px;border-radius:3px;text-decoration:none;font-weight:bold;">Explore Monitoring →</a>
    </td></tr>
    </table>

  </td></tr>

  <!-- FOOTER -->
  <tr><td bgcolor="#E4E2DA" style="background:#E4E2DA;padding:22px 48px;text-align:center;border:1px solid #D8D5CC;border-top:none;border-radius:0 0 6px 6px;">
    <p style="font-size:11px;color:#888888;margin:0;line-height:1.7;font-family:Arial,sans-serif;">Prepared exclusively for ${clientName} &nbsp;·&nbsp; &copy; ${year} The Edge Index &nbsp;·&nbsp; edgeindex.io</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}


// ─── PDF generation — Premium full report ─────────────────────────────────────

function generatePDF(reportMarkdown, clientName, reportDate, userData = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 60, size: 'A4', autoFirstPage: false });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W  = 595.28; // A4 width
    const H  = 841.89; // A4 height
    const M  = 60;     // margin
    const CW = W - M * 2; // content width = 475
    const year = new Date().getFullYear();

    // Parse structured data
    const sec    = parseReportSections(reportMarkdown);
    const timing = parseTimingTable(sec.s6table || '');
    const arch   = getArchitectureDisplay(userData?.hdType, userData?.hdAuthority);

    // Strip emoji helper
    const stripEmoji = s => s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27FF}\u{2300}-\u{23FF}\u{FE00}-\u{FEFF}\u{1F000}-\u{1FFFF}]/gu, '');

    // Clean markdown to plain text
    const cleanMd = s => stripEmoji(s || '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/^#{1,3}\s+/gm, '');

    let pageNum = 0;
    let isCoverPage = false;

    const addFooter = () => {
      if (isCoverPage) return;
      doc.save();
      doc.fillColor('#AAAAAA').fontSize(7.5).font('Helvetica')
         .text(`The Edge Index Brief  ·  ${clientName}  ·  ${reportDate}`, M, H - 34, { width: CW, align: 'center' });
      doc.restore();
    };

    const newPage = (darkBg = false) => {
      if (pageNum > 0) addFooter();
      doc.addPage();
      pageNum++;
      isCoverPage = darkBg;
      if (darkBg) {
        doc.rect(0, 0, W, H).fill('#0A0A0A');
      }
    };

    // ── COVER PAGE ────────────────────────────────────────────────────────────
    newPage(true);

    // Top gold bar
    doc.rect(0, 0, W, 5).fill('#C9A84C');

    // "THE EDGE INDEX" label
    doc.fillColor('#C9A84C').fontSize(9).font('Helvetica')
       .text('THE EDGE INDEX', M, 160, { align: 'center', width: CW, characterSpacing: 3 });

    // Main title
    doc.fillColor('#FFFFFF').fontSize(42).font('Helvetica-Bold')
       .text('Annual', M, 186, { align: 'center', width: CW });
    doc.fillColor('#FFFFFF').fontSize(42).font('Helvetica-Bold')
       .text('Decision-Timing', M, 236, { align: 'center', width: CW });
    doc.fillColor('#C9A84C').fontSize(42).font('Helvetica-Bold')
       .text('Brief', M, 286, { align: 'center', width: CW });

    // Gold divider
    doc.moveTo(W / 2 - 50, 344).lineTo(W / 2 + 50, 344)
       .strokeColor('#C9A84C').lineWidth(1).stroke();

    // Client name
    doc.fillColor('#FFFFFF').fontSize(22).font('Helvetica')
       .text(clientName, M, 360, { align: 'center', width: CW });

    // Architecture subtitle
    doc.fillColor('#888888').fontSize(10).font('Helvetica-Oblique')
       .text(arch, M, 392, { align: 'center', width: CW });

    // Year
    doc.fillColor('#C9A84C').fontSize(13).font('Helvetica')
       .text(String(year), M, 424, { align: 'center', width: CW, characterSpacing: 4 });

    // Stats bar
    const statsY = H - 180;
    doc.moveTo(M, statsY).lineTo(M + CW, statsY).strokeColor('#2A2A2A').lineWidth(1).stroke();

    const statItems = [
      { val: `${year}–${year+1}`, label: 'Report Period' },
      { val: '17',                label: 'Sections'      },
      { val: String(timing.greenCount || '—'), label: 'Green Windows' },
    ];
    const sw = CW / 3;
    statItems.forEach((s, i) => {
      doc.fillColor('#FFFFFF').fontSize(22).font('Helvetica-Bold')
         .text(s.val, M + i * sw, statsY + 20, { width: sw, align: 'center' });
      doc.fillColor('#888888').fontSize(8).font('Helvetica')
         .text(s.label.toUpperCase(), M + i * sw, statsY + 50, { width: sw, align: 'center', characterSpacing: 1 });
    });

    // Bottom gold bar
    doc.rect(0, H - 5, W, 5).fill('#C9A84C');

    // ── 12-MONTH VISUAL TIMELINE ──────────────────────────────────────────────
    newPage(false);

    doc.fillColor('#C9A84C').fontSize(9).font('Helvetica')
       .text('YOUR YEAR AT A GLANCE', M, 72, { characterSpacing: 2 });
    doc.fillColor('#0A0A0A').fontSize(24).font('Helvetica-Bold')
       .text('12-Month Timing Overview', M, 90, { width: CW });
    doc.moveTo(M, 120).lineTo(M + 70, 120).strokeColor('#C9A84C').lineWidth(2).stroke();

    if (timing.rows.length > 0) {
      const chartTop = 144;
      const blockW   = CW / Math.max(timing.rows.length, 12);
      const blockH   = 52;

      timing.rows.forEach((row, i) => {
        const bx    = M + i * blockW;
        const color = row.envClass === 'env-green' ? '#22C55E' : row.envClass === 'env-red' ? '#EF4444' : '#F59E0B';
        doc.rect(bx + 2, chartTop, blockW - 4, blockH).fill(color);
        // Month label
        const ml = (row.month.length > 4 ? row.month.substring(0, 3) : row.month);
        doc.fillColor('#333333').fontSize(7.5).font('Helvetica')
           .text(ml, bx + 2, chartTop + blockH + 5, { width: blockW - 4, align: 'center' });
      });

      // Legend
      const legY = chartTop + blockH + 24;
      const legItems = [
        { color: '#22C55E', label: `Expansion — ${timing.greenCount} months` },
        { color: '#F59E0B', label: `Selective — ${timing.amberCount} months`  },
        { color: '#EF4444', label: `Protection — ${timing.redCount} months`   },
      ];
      legItems.forEach((item, i) => {
        const lx = M + i * (CW / 3);
        doc.rect(lx, legY, 10, 10).fill(item.color);
        doc.fillColor('#333333').fontSize(9.5).font('Helvetica')
           .text(item.label, lx + 15, legY, { width: CW / 3 - 18 });
      });

      // Monthly detail table
      const tblY = legY + 32;
      doc.fillColor('#888888').fontSize(8).font('Helvetica')
         .text('MONTH', M, tblY, { width: 90 });
      doc.fillColor('#888888').fontSize(8).font('Helvetica')
         .text('ENVIRONMENT', M + 90, tblY, { width: 90 });
      doc.fillColor('#888888').fontSize(8).font('Helvetica')
         .text('KEY CONDITIONS', M + 180, tblY, { width: CW - 180 });
      doc.moveTo(M, tblY + 14).lineTo(M + CW, tblY + 14).strokeColor('#C9A84C').lineWidth(0.5).stroke();

      let rowY = tblY + 22;
      for (const row of timing.rows) {
        if (rowY > H - 80) { newPage(false); rowY = 80; }
        const color = row.envClass === 'env-green' ? '#22C55E' : row.envClass === 'env-red' ? '#EF4444' : '#F59E0B';
        doc.rect(M, rowY, 3, 14).fill(color);
        doc.fillColor('#1A1A1A').fontSize(9).font('Helvetica')
           .text(row.month, M + 7, rowY, { width: 83 });
        doc.fillColor(color).fontSize(9).font('Helvetica-Bold')
           .text(row.envLabel, M + 90, rowY, { width: 82 });
        const noteClean = cleanMd(row.note).substring(0, 220);
        doc.fillColor('#444444').fontSize(9).font('Helvetica')
           .text(noteClean, M + 180, rowY, { width: CW - 180, lineGap: 1 });
        const noteH = doc.heightOfString(noteClean, { width: CW - 180, fontSize: 9 });
        rowY += Math.max(20, noteH + 8);
        doc.moveTo(M, rowY - 1).lineTo(M + CW, rowY - 1).strokeColor('#E8E8E8').lineWidth(0.3).stroke();
      }
    } else {
      doc.fillColor('#888888').fontSize(11).font('Helvetica')
         .text('Timing data will appear here once the report is generated.', M, 160, { width: CW });
    }

    // ── GOLDEN WINDOWS ────────────────────────────────────────────────────────
    if (sec.golden) {
      newPage(true);

      // Dark header
      doc.fillColor('#C9A84C').fontSize(9).font('Helvetica')
         .text('YOUR HIGHEST-LEVERAGE PERIODS', M, 80, { align: 'center', width: CW, characterSpacing: 2 });
      doc.fillColor('#FFFFFF').fontSize(32).font('Helvetica-Bold')
         .text('Golden Windows', M, 104, { align: 'center', width: CW });
      doc.moveTo(W / 2 - 50, 148).lineTo(W / 2 + 50, 148)
         .strokeColor('#C9A84C').lineWidth(1).stroke();
      doc.fillColor('#888888').fontSize(10).font('Helvetica-Oblique')
         .text('The periods where conviction and conditions converge', M, 160, { align: 'center', width: CW });

      doc.rect(0, 188, W, 1).fill('#2A2A2A');

      let gy = 204;
      const goldenParas = cleanMd(sec.golden).split(/\n\n+/).filter(p => p.trim());
      for (const para of goldenParas) {
        const t = para.trim();
        if (!t) continue;
        if (gy > H - 100) { newPage(true); doc.rect(0, 0, W, H).fill('#0A0A0A'); gy = 80; }

        // Window title (short line, likely a month-range label)
        if (t.length < 70 && /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{4}|window|golden)/i.test(t)) {
          doc.rect(M, gy, CW, 38).fill('#1A1A1A');
          doc.rect(M, gy, 4, 38).fill('#C9A84C');
          doc.fillColor('#C9A84C').fontSize(13).font('Helvetica-Bold')
             .text(t, M + 14, gy + 10, { width: CW - 20 });
          gy += 48;
        } else if (t.startsWith('*') || t.toLowerCase().includes('the windows above')) {
          // Italic note
          doc.fillColor('#888888').fontSize(10).font('Helvetica-Oblique')
             .text(t.replace(/^\*+|\*+$/g, ''), M, gy, { width: CW, lineGap: 2 });
          gy = doc.y + 12;
        } else {
          doc.fillColor('#CCCCCC').fontSize(11).font('Helvetica')
             .text(t, M, gy, { width: CW, lineGap: 3 });
          gy = doc.y + 12;
        }
      }
    }

    // ── MAIN REPORT SECTIONS ──────────────────────────────────────────────────
    const sections = [
      { key: 's1',  num: '01', title: 'Executive Overview'              },
      { key: 's2',  num: '02', title: 'Your Decision Architecture'      },
      { key: 's3',  num: '03', title: 'Behaviour Under Pressure'        },
      { key: 's4',  num: '04', title: 'The Edge Index Signal Framework' },
      { key: 's5',  num: '05', title: 'Your Personal Timing Profile'    },
      { key: 's7',  num: '07', title: 'Expansion Windows'               },
      { key: 's8',  num: '08', title: 'Protection Periods'              },
      { key: 's9',  num: '09', title: 'Opportunity Windows'             },
      { key: 's10', num: '10', title: 'Risk Environment Patterns'       },
      { key: 's11', num: '11', title: 'Emotional Volatility Cycles'     },
      { key: 's12', num: '12', title: 'Strategic Patience'              },
      { key: 's13', num: '13', title: 'Decision Discipline Framework'   },
      { key: 's14', num: '14', title: 'Behavioural Blind Spots'         },
      { key: 's15', num: '15', title: 'Strategic Operating Rules'       },
    ];

    for (const s of sections) {
      const content = sec[s.key];
      if (!content) continue;

      newPage(false);

      // Gold section label
      doc.fillColor('#C9A84C').fontSize(8.5).font('Helvetica')
         .text(`SECTION ${s.num}`, M, 68, { characterSpacing: 2 });

      // Section title
      doc.fillColor('#0A0A0A').fontSize(22).font('Helvetica-Bold')
         .text(s.title, M, 84, { width: CW });

      // Gold underline
      const underY = doc.y + 6;
      doc.moveTo(M, underY).lineTo(M + 55, underY).strokeColor('#C9A84C').lineWidth(2).stroke();
      doc.y = underY + 20;

      // Render content
      const paras = cleanMd(content).split(/\n\n+/).filter(p => p.trim());
      for (const para of paras) {
        const t = para.trim();
        if (!t || /^-{3,}$/.test(t)) continue;
        if (doc.y > H - 90) { newPage(false); doc.y = 72; }

        if (/^RIGHT NOW/i.test(t)) {
          // Green callout box
          const bText = t.replace(/^RIGHT NOW[^:]*:\s*/i, '');
          const bh = Math.max(60, doc.heightOfString(bText, { width: CW - 28, fontSize: 10.5 }) + 38);
          const by = doc.y;
          doc.rect(M, by, CW, bh).fill('#F0FDF4');
          doc.rect(M, by, 4, bh).fill('#22C55E');
          doc.fillColor('#166534').fontSize(8).font('Helvetica-Bold')
             .text('RIGHT NOW', M + 12, by + 10, { characterSpacing: 1 });
          doc.fillColor('#1A3320').fontSize(10.5).font('Helvetica')
             .text(bText, M + 12, by + 24, { width: CW - 24, lineGap: 2 });
          doc.y = by + bh + 14;
        } else if (t.startsWith('> ')) {
          // Blockquote
          const qt = t.replace(/^> /, '');
          const bh = Math.max(40, doc.heightOfString(qt, { width: CW - 24, fontSize: 11 }) + 24);
          const by = doc.y;
          doc.rect(M, by, 3, bh).fill('#C9A84C');
          doc.rect(M + 3, by, CW - 3, bh).fill('#FFFBF0');
          doc.fillColor('#333333').fontSize(11).font('Helvetica-Oblique')
             .text(qt, M + 16, by + 12, { width: CW - 28, lineGap: 2 });
          doc.y = by + bh + 14;
        } else if (/^[-•]/.test(t)) {
          const lines = t.split('\n').filter(l => /^[-•]/.test(l.trim()));
          for (const line of lines) {
            if (doc.y > H - 60) { newPage(false); doc.y = 72; }
            doc.fillColor('#444444').fontSize(10.5).font('Helvetica')
               .text(`•  ${line.replace(/^[-•]\s*/, '')}`, M + 10, doc.y, { width: CW - 10, lineGap: 2 });
            doc.moveDown(0.3);
          }
          doc.moveDown(0.3);
        } else if (/^##/.test(t)) {
          doc.fillColor('#1A1A1A').fontSize(13).font('Helvetica-Bold')
             .text(t.replace(/^##\s*/, ''), M, doc.y, { width: CW });
          doc.moveDown(0.4);
        } else {
          doc.fillColor('#2A2A2A').fontSize(10.5).font('Helvetica')
             .text(t, M, doc.y, { width: CW, align: 'justify', lineGap: 3 });
          doc.moveDown(0.7);
        }
      }
    }

    // ── MONITORING UPSELL PAGE ────────────────────────────────────────────────
    newPage(true);

    // Top accent
    doc.rect(0, 0, W, 5).fill('#C9A84C');

    doc.fillColor('#C9A84C').fontSize(9).font('Helvetica')
       .text('SECTION 16', M, 72, { characterSpacing: 2 });
    doc.fillColor('#FFFFFF').fontSize(26).font('Helvetica-Bold')
       .text('Your Annual Map Is the Foundation.', M, 90, { width: CW });
    doc.fillColor('#C9A84C').fontSize(24).font('Helvetica-Bold')
       .text("Don't Miss Your Windows.", M, 122, { width: CW });

    doc.moveTo(M, 160).lineTo(M + CW, 160).strokeColor('#2A2A2A').lineWidth(1).stroke();

    doc.fillColor('#CCCCCC').fontSize(11).font('Helvetica')
       .text('Your brief shows when conditions favour decisive action across the next 12 months. But timing shifts week to week — and day to day — within that structure.', M, 178, { width: CW, lineGap: 3 });

    const afterFirstPara = doc.y + 10;
    doc.fillColor('#CCCCCC').fontSize(11).font('Helvetica')
       .text("Without live monitoring, you know your window is coming — but not exactly when it opens. That gap is where opportunities are missed.", M, afterFirstPara, { width: CW, lineGap: 3 });

    const afterSecondPara = doc.y + 10;
    doc.fillColor('#FFFFFF').fontSize(11).font('Helvetica-Bold')
       .text('The Edge Index monitoring suite bridges that gap.', M, afterSecondPara, { width: CW });

    // Three tier boxes
    const tierY  = doc.y + 24;
    const tierW  = (CW - 20) / 3;
    const tierH  = 158;
    const tiers  = [
      { name: 'Weekly Edge',  freq: 'Every Monday',  price: '$97/month',  desc: 'Weekly signal review and environment assessment for the week ahead.' },
      { name: 'Daily Edge',   freq: 'Every Morning', price: '$197/month', desc: 'Daily timing conditions and decision guidance delivered each morning.' },
      { name: 'Live Edge',    freq: 'Real-Time',     price: '$397/month', desc: 'Live signal monitoring as your timing conditions shift through the day.' },
    ];

    tiers.forEach((tier, i) => {
      const tx = M + i * (tierW + 10);
      doc.rect(tx, tierY, tierW, tierH).fill('#1A1A1A');
      doc.rect(tx, tierY, tierW, 4).fill('#C9A84C');
      doc.fillColor('#FFFFFF').fontSize(13).font('Helvetica-Bold')
         .text(tier.name, tx + 12, tierY + 18, { width: tierW - 24 });
      doc.fillColor('#C9A84C').fontSize(8).font('Helvetica')
         .text(tier.freq.toUpperCase(), tx + 12, tierY + 38, { width: tierW - 24, characterSpacing: 1 });
      doc.fillColor('#AAAAAA').fontSize(9.5).font('Helvetica')
         .text(tier.desc, tx + 12, tierY + 56, { width: tierW - 24, lineGap: 2 });
      doc.fillColor('#C9A84C').fontSize(15).font('Helvetica-Bold')
         .text(tier.price, tx + 12, tierY + tierH - 36, { width: tierW - 24 });
    });

    const afterTiers = tierY + tierH + 22;

    // Quote
    doc.fillColor('#888888').fontSize(10).font('Helvetica-Oblique')
       .text('"Most traders who receive this Brief choose Daily Edge. They\'ve already paid $2,500 to know their windows. Monitoring is how they don\'t miss them."', M, afterTiers, { width: CW, lineGap: 3, align: 'center' });

    const afterQuote = doc.y + 22;

    // CTA button
    const ctaW = 300;
    const ctaX = M + (CW - ctaW) / 2;
    doc.rect(ctaX, afterQuote, ctaW, 38).fill('#C9A84C');
    doc.fillColor('#000000').fontSize(10).font('Helvetica-Bold')
       .text('EXPLORE MONITORING AT EDGEINDEX.IO', ctaX, afterQuote + 12, { width: ctaW, align: 'center', characterSpacing: 0.5 });

    // ── SECTION 17 — FINAL INSIGHT ────────────────────────────────────────────
    newPage(false);

    doc.fillColor('#C9A84C').fontSize(8.5).font('Helvetica')
       .text('SECTION 17', M, 68, { characterSpacing: 2 });
    doc.fillColor('#0A0A0A').fontSize(22).font('Helvetica-Bold')
       .text('Final Insight', M, 84, { width: CW });

    const s17underY = doc.y + 6;
    doc.moveTo(M, s17underY).lineTo(M + 55, s17underY).strokeColor('#C9A84C').lineWidth(2).stroke();
    doc.y = s17underY + 22;

    if (sec.s17) {
      const s17text = cleanMd(sec.s17).trim();
      doc.fillColor('#2A2A2A').fontSize(11).font('Helvetica')
         .text(s17text, M, doc.y, { width: CW, align: 'justify', lineGap: 3 });
    }

    doc.moveDown(2);

    // Closing quote
    const qY = doc.y;
    doc.moveTo(M, qY).lineTo(M + CW, qY).strokeColor('#E0E0E0').lineWidth(0.5).stroke();
    doc.moveDown(1.2);
    doc.fillColor('#888888').fontSize(12).font('Helvetica-Oblique')
       .text('"In high-performance environments, the edge rarely comes from superior information alone. It comes from knowing when conditions support decisive action — and having the discipline to wait when they do not."', M, doc.y, { width: CW, align: 'center', lineGap: 4 });
    doc.moveDown(1.5);
    doc.fillColor('#C9A84C').fontSize(10).font('Helvetica')
       .text(`THE EDGE INDEX  ·  ${year}`, M, doc.y, { width: CW, align: 'center', characterSpacing: 2 });

    // Final page footer
    addFooter();

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
  const subject   = `Your Edge Index Brief is Ready`;
  const reportDate = new Date().toISOString().split('T')[0];
  const pdfBuffer = await generatePDF(reportMarkdown, toName, reportDate, userData);

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
      // Flag report received — triggers licensing sequence (trading) and affiliate pitch (AI)
      markReportReceived(email);
      markAiReportReceived(email);
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

// ─── AI Sales agent — personalised close by asset class ───────────────────────

function getPersonalisedClose(tradeType) {
  const t = (tradeType || '').toLowerCase();
  let assetLine = '';

  if (t.includes('crypto') || t.includes('bitcoin') || t.includes('btc')) {
    assetLine = `With crypto, sentiment shifts faster than any other market. Knowing when your judgement is sharpest — and when fear is most likely to make you exit early or hold too long — is the difference between compounding and giving back gains.`;
  } else if (t.includes('stock') || t.includes('share') || t.includes('equit')) {
    assetLine = `In stocks, the biggest losses rarely come from wrong analysis. They come from the right analysis executed at the wrong emotional moment. Panic selling at the bottom. Chasing at the top.`;
  } else if (t.includes('forex') || t.includes('fx') || t.includes('currency')) {
    assetLine = `Forex is unforgiving of emotional decisions — leverage amplifies every hesitation and every impulse. Knowing which days your clarity is highest, and which days distortion peaks, is a structural edge most forex traders never access.`;
  } else if (t.includes('commodit') || t.includes('oil') || t.includes('gas') || t.includes('energy')) {
    assetLine = `In commodities, macro shocks create intense emotional pressure. Knowing when your own judgement is clearest — and when emotion will override your read — separates disciplined traders from reactive ones.`;
  } else {
    assetLine = `Whatever you trade, the biggest losses rarely come from bad analysis. They come from the right analysis executed at the wrong emotional moment. Your decision cycle is predictable — and mappable.`;
  }

  const line1 = `That's what The Edge Index Brief does.\n\n${assetLine}\n\nIt's a 17-section personalised intelligence document built from your individual data — your highest-conviction windows, your protection periods, and the specific behavioural patterns most likely to cost you.`;

  const line2 = `Not a signal tool. A map of your decision environment for the next 12 months.\n\nOne payment. Yours for life.\n\n👉 https://edgeindex.io\n\nOnce you've completed your purchase, come back here and enter your email to access your brief.`;

  return { line1, line2 };
}

// ─── Outreach briefing builder ─────────────────────────────────────────────────

const OUTREACH_MSG_1 = (name, communityName) =>
  `Hi ${name},\n\nI built something that I think is genuinely useful for trading communities — and I wanted to reach out to ${communityName || 'your community'} specifically because of the calibre of your members.\n\nIt's called The Edge Index. Each member receives a personalised 17-section annual intelligence brief — mapping their individual decision-timing windows across the next 12 months. When to deploy capital. When to stand down. Where their decision quality is highest and where they're most exposed to behavioural errors.\n\nNot market signals. Not generic content. A personalised intelligence document — built from each member's individual data.\n\nI've seen communities use it as a premium benefit that meaningfully improves member results — which tends to solve the retention problem at the source.\n\nWould it be worth a quick conversation to see if it's a fit?`;

const OUTREACH_MSG_2 = (name, communityName) =>
  `Hi ${name},\n\nFollowing up on my message about The Edge Index.\n\nThe short version of why it's relevant for ${communityName || 'your community'}: most trading education gives members better strategy. The Edge Index gives them better decision-making — which is usually what's actually missing.\n\nMembers receive their own personalised annual brief. It tells them which months their decision architecture is sharpest, which periods carry the highest behavioural risk, and the exact pattern most likely to cost them capital. The intelligence is built from their individual data — it reads like a private briefing, not a report.\n\nFrom your end: fully automated, zero ongoing work after a 5-minute setup. Members access it through a private Telegram bot.\n\nHappy to share a sample brief if you'd like to see the quality of what members receive.\n\nLet me know if you want to talk through the details.`;

const OUTREACH_MSG_3 = (name, communityName) =>
  `Hi ${name},\n\nLast message — I'll keep it brief.\n\nThe retention problem in trading communities almost always comes down to the same thing: members who don't see consistent results don't stay. Better strategy content helps, but it doesn't solve the underlying issue — which is that most traders execute the right strategy at the wrong time.\n\nThe Edge Index solves that. Each member gets a personalised 17-section annual intelligence brief — mapping their individual decision windows and their highest-risk behavioural periods. When they use it, their decision quality improves because they stop acting at the wrong time. Members who improve their results don't leave.\n\nThe founding partnership terms for ${communityName || 'communities'} of your size:\n→ $500/month for the first 3 months (typically $2,500–$6,000/month at scale)\n→ I handle everything — bot infrastructure, brief generation, delivery\n→ Your members get their personal brief within 15 minutes of onboarding\n→ If it doesn't improve member engagement and retention within 90 days, we end it\n\nIf you're open to a 15-minute call, I'll show you a sample brief and walk through how it works. Otherwise — no worries, and appreciate your time.`;

function buildOutreachBriefing() {
  const outreach  = loadOutreach();
  const today     = new Date();
  const todayStr  = today.toISOString().split('T')[0];

  // Separate into action items and pipeline status
  const actionItems   = [];
  const pendingItems  = [];
  const repliedItems  = [];
  const completedItems = [];

  for (const target of outreach.targets) {
    if (target.replied) { repliedItems.push(target); continue; }
    if (target.stage >= 3) { completedItems.push(target); continue; }

    const lastDate  = target.lastMessageDate ? new Date(target.lastMessageDate) : null;
    const daysSince = lastDate
      ? Math.floor((today - lastDate) / (1000 * 60 * 60 * 24))
      : null;

    let shouldSend = false;
    let msgNum     = null;
    let daysUntil  = null;

    if (target.stage === 0 && !lastDate) {
      shouldSend = true;
      msgNum     = 1;
    } else if (target.stage === 1 && daysSince !== null) {
      if (daysSince >= 3) { shouldSend = true; msgNum = 2; }
      else daysUntil = 3 - daysSince;
    } else if (target.stage === 2 && daysSince !== null) {
      if (daysSince >= 5) { shouldSend = true; msgNum = 3; }
      else daysUntil = 5 - daysSince;
    }

    if (shouldSend) {
      actionItems.push({ target, msgNum });
    } else if (target.stage > 0 && !shouldSend) {
      pendingItems.push({ target, daysUntil });
    } else {
      pendingItems.push({ target, daysUntil: null });
    }
  }

  const lines = [`📋 *Edge Index Outreach — ${todayStr}*\n`];

  // ── TODAY'S ACTIONS ──
  if (actionItems.length === 0) {
    lines.push('✅ *No messages to send today.*\n');
  } else {
    lines.push(`🎯 *${actionItems.length} message(s) to send today:*\n`);

    for (const { target, msgNum } of actionItems) {
      const platformEmoji = target.platform === 'Telegram' ? '✈️' : '💬';
      const msgFn = msgNum === 1 ? OUTREACH_MSG_1 : msgNum === 2 ? OUTREACH_MSG_2 : OUTREACH_MSG_3;
      const msg   = msgFn(target.name, target.name);
      const tierLabel = target.tier === 'Enterprise' ? '⭐⭐⭐' : target.tier === 'Scale' ? '⭐⭐' : target.tier === 'Growth' ? '⭐' : '';

      lines.push(
        `${platformEmoji} *${target.name}* ${tierLabel}`,
        `├ Size: ${target.size} · Platform: ${target.platform}`,
        `├ Contact: \`${target.handle}\``,
        target.notes ? `├ Note: ${target.notes}` : null,
        `└ Send Message ${msgNum}:`,
        ``,
        `\`\`\``,
        msg,
        `\`\`\``,
        ``,
        `✔ After sending → /admin sent ${target.id}`,
        `💬 If they reply → /admin replied ${target.id}`,
        ``,
        `────────────────────────`,
        ``,
      ).filter(l => l !== null);
    }
  }

  // ── PIPELINE STATUS ──
  if (pendingItems.length > 0) {
    lines.push(`⏳ *Waiting / In Pipeline:*`);
    for (const { target, daysUntil } of pendingItems) {
      const stageLabel = target.stage === 0 ? 'Not started' : `M${target.stage} sent`;
      const waitLabel  = daysUntil ? ` — follow-up in ${daysUntil}d` : '';
      lines.push(`• ${target.name} (${target.size}) — ${stageLabel}${waitLabel}`);
    }
    lines.push('');
  }

  // ── REPLIES / INTERESTED ──
  if (repliedItems.length > 0) {
    lines.push(`🟢 *Replied / Interested (${repliedItems.length}):*`);
    for (const t of repliedItems) {
      lines.push(`• ${t.name} — ${t.notes || 'follow up'}`);
    }
    lines.push('');
  }

  // ── PIPELINE SUMMARY ──
  const total     = outreach.targets.length;
  const contacted = outreach.targets.filter(t => t.stage > 0).length;
  const replied   = repliedItems.length;
  const done      = completedItems.length;
  lines.push(`📊 *Pipeline: ${contacted}/${total} contacted · ${replied} replied · ${done} complete*`);

  return lines.filter(l => l !== null).join('\n');
}

// ─── Bot commands ──────────────────────────────────────────────────────────────

// /myid — anyone can use, helps Anna find her chat ID
bot.onText(/\/myid/, async (msg) => {
  await bot.sendMessage(msg.chat.id, `Your Telegram chat ID is: \`${msg.chat.id}\``, { parse_mode: 'Markdown' });
});

// /start — begin onboarding (opens with AI sales conversation for new users)
bot.onText(/\/start/, async (msg) => {
  const chatId    = msg.chat.id;
  const firstName = msg.from?.first_name || 'there';

  saveUser(chatId, { chatId, firstName, telegramUsername: msg.from?.username });

  // If already a paid user with complete profile, skip sales flow
  const user = getUser(chatId);
  if (user?.email && await isPaidEmail(user.email) && user.dob) {
    await bot.sendMessage(chatId,
      `Welcome back, ${firstName}! Your profile is already set up.\n\nSend /report to generate your latest Edge Index Brief.`
    );
    return;
  }

  // If already paid but no profile yet, go straight to onboarding
  if (user?.email && await isPaidEmail(user.email)) {
    state[chatId] = 'awaiting_date';
    await bot.sendMessage(chatId,
      `Welcome back, ${firstName}! Your purchase is confirmed.\n\nLet's complete your profile. Reply with your **date of birth** (DD/MM/YYYY):`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // New user — start sales conversation
  state[chatId] = 'sales_q1';
  await bot.sendMessage(chatId,
    `Welcome, ${firstName}.\n\nThis is The Edge Index — personalised decision-timing intelligence for serious traders.\n\nBefore I walk you through what's available, one quick question:\n\nWhat do you primarily trade?\n\n• Crypto & Bitcoin\n• Stocks & shares\n• Forex\n• Commodities (oil, gas, energy)\n• Something else`
  );
});

// /report — regenerate report
bot.onText(/\/report/, async (msg) => {
  const chatId = msg.chat.id;
  // Always refresh firstName from Telegram profile in case it was wiped by redeploy
  if (msg.from?.first_name) saveUser(chatId, { firstName: msg.from.first_name });
  const user   = getUser(chatId);

  if (!user || !user.email) {
    state[chatId] = 'awaiting_email';
    await bot.sendMessage(chatId,
      'Please send me the email address you used to purchase your Edge Index report, and I\'ll verify your access.',
    );
    return;
  }

  if (!await isPaidEmail(user.email)) {
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
      `*Reports*\n` +
      `/admin users — list registered users\n` +
      `/admin emails — list paid emails\n` +
      `/admin paid <email> — manually mark email as paid\n\n` +
      `*B2B Outreach — Automation*\n` +
      `/admin tgauth start — authenticate outreach client (first time)\n` +
      `/admin tgauth <code> — enter OTP to complete auth\n` +
      `/admin tgstatus — check if outreach client is connected\n` +
      `/admin tgsend <target-id> — manually trigger send to a target now\n` +
      `/admin approve <target-id> — send Claude's drafted reply\n\n` +
      `*B2B Outreach — Manual Tracking*\n` +
      `/admin outreach — show today's outreach briefing\n` +
      `/admin sent <target-id> — mark message as sent to target\n` +
      `/admin replied <target-id> — mark target as replied\n\n` +
      `*Lead Detection*\n` +
      `/admin score <trader post> — score a trader's message and get opener\n` +
      `/admin playbook — today's B2C lead generation guide\n\n` +
      `*Monitoring Subscriptions*\n` +
      `/admin monitors — list all monitoring subscribers + MRR\n` +
      `/admin monitor add <email> <tier> — add subscriber (weekly/daily/live)\n` +
      `/admin monitor remove <email> — deactivate subscriber\n\n` +
      `*Female Outreach (Automated Email)*\n` +
      `/admin fem status — pipeline overview + stats\n` +
      `/admin fem list <tier> — list targets by tier (1–6) + email status\n` +
      `/admin fem send <id> — send cold email to one target\n` +
      `/admin fem batch <tier> — send cold emails to all tier targets with emails\n` +
      `/admin fem followup <id> — manually trigger follow-up email\n` +
      `/admin fem pitch <id> — send licensing pitch (after they engage)\n` +
      `/admin fem replied <id> — mark as replied (stops follow-up sequence)\n` +
      `/admin fem dmsonly — list DM-only targets (no email, need manual contact)\n` +
      `/admin fem import — import targets from data/outreach-import.csv`,
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

  // /admin tgauth start  — request OTP to authenticate gramjs client
  // /admin tgauth <code> — verify OTP and save session
  if (cmd === 'tgauth') {
    const subArg = args[1];
    if (!subArg || subArg === 'start') {
      try {
        await bot.sendMessage(chatId, '📲 Requesting OTP from Telegram...');
        await requestOtp();
        await bot.sendMessage(chatId,
          '✅ OTP sent to your Telegram account (+61438703922).\n\n' +
          'Check your Telegram messages for the code, then send:\n' +
          '`/admin tgauth <code>`',
          { parse_mode: 'Markdown' }
        );
      } catch (err) {
        await bot.sendMessage(chatId, `❌ Auth request failed: ${err.message}`);
      }
      return;
    }

    // Treat subArg as the OTP code
    const otpCode = subArg;
    try {
      await bot.sendMessage(chatId, '🔐 Verifying OTP...');
      const sessionString = await verifyOtp(otpCode);
      await bot.sendMessage(chatId,
        '✅ *Telegram outreach client authenticated!*\n\n' +
        'Add this to Railway environment variables:\n' +
        '*Variable:* `TELEGRAM_SESSION`\n' +
        '*Value:* (see next message)',
        { parse_mode: 'Markdown' }
      );
      // Send session string in a separate message
      await bot.sendMessage(chatId, sessionString);
      await bot.sendMessage(chatId,
        '⚠️ Copy that session string to Railway → Variables → `TELEGRAM_SESSION`\n\n' +
        'Once saved, the outreach sequencer will start automatically on next deploy.',
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      await bot.sendMessage(chatId, `❌ Auth failed: ${err.message}`);
    }
    return;
  }

  // /admin tgstatus — show outreach client connection status
  if (cmd === 'tgstatus') {
    const connected = isConnected();
    await bot.sendMessage(chatId,
      connected
        ? '✅ Outreach client connected — auto-sequencer is active.'
        : '❌ Outreach client not connected.\n\nRun `/admin tgauth start` to authenticate.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // /admin tgsend <target-id> — manually trigger send to a specific target now
  if (cmd === 'tgsend') {
    const targetId = args[1];
    if (!targetId) {
      await bot.sendMessage(chatId, 'Usage: `/admin tgsend <target-id>`', { parse_mode: 'Markdown' });
      return;
    }
    const outreach = loadOutreach();
    const target = outreach.targets.find(t => t.id === targetId);
    if (!target) {
      await bot.sendMessage(chatId, `Target "${targetId}" not found.`);
      return;
    }
    await bot.sendMessage(chatId, `📤 Running sequencer for ${target.name}...`);
    try {
      const { sent, skipped } = await runOutreachSequencer();
      const sentTarget = sent.find(s => s.id === targetId);
      if (sentTarget) {
        await bot.sendMessage(chatId, `✅ Message ${sentTarget.stage} sent to ${target.name}.`);
      } else {
        const skip = skipped.find(s => s.id === targetId);
        await bot.sendMessage(chatId, `⏭ ${target.name} skipped: ${skip?.reason || 'unknown'}`);
      }
    } catch (err) {
      await bot.sendMessage(chatId, `❌ Error: ${err.message}`);
    }
    return;
  }

  // /admin approve <target-id> — send the pending Claude draft reply to target
  if (cmd === 'approve') {
    const targetId = args[1];
    if (!targetId) {
      await bot.sendMessage(chatId, 'Usage: `/admin approve <target-id>`', { parse_mode: 'Markdown' });
      return;
    }
    const draftKey = `pending_draft_${targetId}`;
    const draft = pendingDrafts.get(draftKey);
    if (!draft) {
      await bot.sendMessage(chatId, `No pending draft for "${targetId}".`);
      return;
    }
    try {
      const { sendOutreachMessage } = await import('./outreach-client.js');
      await sendOutreachMessage(draft.handle, draft.text + '\n\n— Anna\nThe Edge Index');
      pendingDrafts.delete(draftKey);
      await bot.sendMessage(chatId, `✅ Reply sent to ${draft.targetName}.`);
    } catch (err) {
      await bot.sendMessage(chatId, `❌ Failed to send: ${err.message}`);
    }
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

  // /admin scanner — Twitter scanner controls
  if (cmd === 'scanner') {
    const sub = args[1]?.toLowerCase();
    if (sub === 'now') {
      await bot.sendMessage(chatId, '🔍 Running manual Twitter scan now...');
      try {
        await runLeadScan(bot, chatId, false);
      } catch (err) {
        await bot.sendMessage(chatId, `Scanner error: ${err.message}`);
      }
      return;
    }
    // Show status
    const s = getScannerStatus();
    await bot.sendMessage(chatId,
      `🤖 *Twitter Lead Scanner*\n\n` +
      `Status: ${s.configured ? '🟢 Active' : '🔴 Not configured'}\n` +
      `${s.configured ? '' : 'Add TWITTER\\_BEARER\\_TOKEN to Railway to activate.\n\n'}` +
      `Scan interval: every ${s.interval} hours\n` +
      `Search queries: ${s.queries}\n` +
      `Minimum score: ${s.minScore}\n` +
      `Tweets seen (this session): ${s.seenCount}\n\n` +
      `*Commands:*\n` +
      `/admin scanner now — run a scan immediately`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // /admin score <trader message> — score a lead and return opener
  if (cmd === 'score') {
    const traderText = args.slice(1).join(' ');
    if (!traderText || traderText.length < 5) {
      await bot.sendMessage(chatId,
        `Usage: /admin score <paste the trader's post or message here>\n\nExample:\n/admin score gave back all my profits this week, emotional trading is destroying me`
      );
      return;
    }

    const result = scoreLeadMessage(traderText);

    let signalLines = '';
    if (result.hits.length) {
      signalLines = result.hits.map(h => `  • ${h.label} (+${h.score})`).join('\n');
    } else {
      signalLines = '  • No strong signals detected';
    }

    const fullOpener = result.total >= 5
      ? `${result.opener}${result.bridge}`
      : result.opener;

    await bot.sendMessage(chatId,
      `🎯 *Lead Score: ${result.total} — ${result.emoji} ${result.tier}*\n\n` +
      `*Signals detected:*\n${signalLines}\n\n` +
      `*Suggested opener:*\n\`\`\`\n${fullOpener}\n\`\`\``,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // /admin playbook — daily B2C lead scanning guide
  if (cmd === 'playbook') {
    const today = new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });

    const playbook = `📖 *Edge Index Lead Playbook — ${today}*\n\n` +
`🐦 *Twitter / X — 20 minutes*\nSearch these phrases (copy into X search):\n` +
`\`"gave back all my profits"\`\n` +
`\`"emotional trading" -buy -sell\`\n` +
`\`"trading psychology" -course -webinar\`\n` +
`\`"bad execution" trading\`\n` +
`\`"same strategy works sometimes" trading\`\n` +
`\`"volatility destroyed" trade\`\n` +
`\`"wrong time" trade loss\`\n\n` +
`For any post: copy it, paste to /admin score, get your opener. Reply to the original post or DM.\n\n` +
`────────────────────────\n\n` +
`💬 *Telegram — 10 minutes*\nGroups to check:\n` +
`• Crypto/trading discussion groups\n` +
`• Any group with a "psychology" or "mistakes" channel\n` +
`Look for: drawdown posts, "gave it back", "emotional trade", timing frustration\n` +
`Copy post → /admin score → reply privately with opener\n\n` +
`────────────────────────\n\n` +
`🎮 *Discord — 10 minutes*\nTarget channels:\n` +
`• #performance or #results channels in trading servers\n` +
`• #psychology channels\n` +
`• Any pinned "drawdown" or "losses" thread\n` +
`Same pattern: copy message → /admin score → DM with opener\n\n` +
`────────────────────────\n\n` +
`🏪 *Whop Communities — 5 minutes*\nCheck paid communities you have access to:\n` +
`Members already pay for trading information — highest conversion probability.\n` +
`Same detection process applies.\n\n` +
`────────────────────────\n\n` +
`📊 *Scoring reminder:*\n` +
`• 12+ = 🔥 High-probability buyer — prioritise\n` +
`• 8–11 = ⭐⭐ Strong lead — follow up same day\n` +
`• 5–7 = ⭐ Warm — open conversation, no pitch yet\n` +
`• Under 5 = awareness only — not worth cold pitch\n\n` +
`*Target: 3–5 qualifying conversations started today.*`;

    const chunks = playbook.match(/[\s\S]{1,4000}/g) || [playbook];
    for (const chunk of chunks) {
      await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
      await new Promise(r => setTimeout(r, 200));
    }
    return;
  }

  // /admin monitors — list all monitoring subscribers
  if (cmd === 'monitors') {
    const counts = getSubscriberCount();
    const all    = getAllSubscribers();
    if (!all.length) {
      await bot.sendMessage(chatId,
        `📊 *Monitoring Subscribers*\n\nNo active subscribers yet.\n\nAdd one: /admin monitor add <email> weekly`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
    const lines = all.map(s => `• ${s.name} (${s.email}) — *${s.tier}* · since ${s.startDate}`).join('\n');
    await bot.sendMessage(chatId,
      `📊 *Monitoring Subscribers — ${counts.total} active*\n\n` +
      `Weekly Edge: ${counts.weekly} @ $97 = $${counts.weekly * 97}/mo\n` +
      `Daily Edge:  ${counts.daily}  @ $197 = $${counts.daily * 197}/mo\n` +
      `Live Edge:   ${counts.live}   @ $397 = $${counts.live * 397}/mo\n` +
      `*Monitoring MRR: $${counts.mrr}/mo*\n\n` +
      `${lines}`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // /admin monitor add <email> <tier>  |  /admin monitor remove <email>
  if (cmd === 'monitor') {
    const sub = args[1]?.toLowerCase();

    if (sub === 'add') {
      const email = args[2];
      const tier  = (args[3] || 'weekly').toLowerCase();
      if (!email || !email.includes('@')) {
        await bot.sendMessage(chatId, 'Usage: /admin monitor add <email> <weekly|daily|live>');
        return;
      }
      if (!['weekly', 'daily', 'live'].includes(tier)) {
        await bot.sendMessage(chatId, 'Tier must be one of: weekly, daily, live');
        return;
      }
      // Look up user data for richer subscriber record
      const users     = getAllUsers();
      const userData  = Object.values(users).find(u => u.email === email) || {};
      const telegramId = Object.entries(users).find(([, u]) => u.email === email)?.[0] || null;

      const record = addSubscriber({
        email,
        telegramChatId: telegramId,
        tier,
        name:        userData.firstName || email.split('@')[0],
        hdType:      userData.hdType       || 'Generator',
        hdAuthority: userData.hdAuthority  || 'Emotional Authority',
        tradeType:   userData.tradeType    || 'general trading',
        dob:         userData.dob          || null,
        time:        userData.time         || null,
        location:    userData.location     || null,
        lat:         userData.lat          || null,
        lon:         userData.lon          || null,
      });

      const tierPrices = { weekly: 97, daily: 197, live: 397 };
      await bot.sendMessage(chatId,
        `✅ *Monitoring subscriber added*\n\n` +
        `${record.name} (${record.email})\n` +
        `Tier: *${tier}* — $${tierPrices[tier]}/month\n` +
        `First delivery: ${tier === 'weekly' ? 'next Monday 7am AEST' : 'tomorrow 6am AEST'}`,
        { parse_mode: 'Markdown' }
      );

      // Notify the subscriber if we have their Telegram
      if (telegramId) {
        const tierMessages = {
          weekly: `📊 *Weekly Edge activated*\n\nYou're now receiving personalised weekly signal updates every Monday morning.\n\nFirst briefing arrives Monday at 7am AEST.`,
          daily:  `📊 *Daily Edge activated*\n\nYou're now receiving personalised daily decision briefings every morning.\n\nFirst briefing arrives tomorrow at 6am AEST.`,
          live:   `📊 *Live Edge activated*\n\nYou're now receiving real-time alerts when your Golden Window opens.\n\nYou'll be notified the moment conditions converge.`,
        };
        await bot.sendMessage(telegramId, tierMessages[tier], { parse_mode: 'Markdown' });
      }
      return;
    }

    if (sub === 'remove') {
      const email = args[2];
      if (!email) {
        await bot.sendMessage(chatId, 'Usage: /admin monitor remove <email>');
        return;
      }
      const { removeSubscriber } = await import('./shared/monitoringSubscribers.js');
      const removed = removeSubscriber(email);
      if (removed) {
        await bot.sendMessage(chatId, `✅ ${email} removed from monitoring.`);
      } else {
        await bot.sendMessage(chatId, `No active subscriber found for ${email}.`);
      }
      return;
    }

    await bot.sendMessage(chatId, 'Usage:\n/admin monitor add <email> <weekly|daily|live>\n/admin monitor remove <email>');
    return;
  }

  // ─── /admin fem — Female community outreach commands ─────────────────────
  if (cmd === 'fem') {
    const sub = args[1]?.toLowerCase();

    // /admin fem status — overview
    if (!sub || sub === 'status') {
      const stats = getOutreachStats();
      const lines = [
        `⚡ *Community Outreach Pipeline*\n`,
        `Total targets: ${stats.total}`,
        `Have email: ${stats.hasEmail} | DM-only: ${stats.total - stats.hasEmail}`,
        ``,
        `*By gender:*`,
        `👩 Female: ${stats.byGender?.female || 0} | 👨 Male: ${stats.byGender?.male || 0} | 🤝 Mixed: ${stats.byGender?.mixed || 0}`,
        ``,
        `*By stage:*`,
        `🔵 Not started: ${stats.byStage[0] || 0}`,
        `📧 Cold sent: ${stats.byStage[1] || 0}`,
        `🔁 Follow-up sent: ${stats.byStage[2] || 0}`,
        `💰 Report received (licensing): ${stats.byStage[3] || 0}`,
        `✅ Replied: ${stats.replied}`,
        ``,
        `*By tier:*`,
        Object.entries(stats.byTier).sort(([a],[b]) => Number(a)-Number(b)).map(([t,c]) => `Tier ${t}: ${c}`).join(' | '),
        ``,
        `Fire Tier 1: /admin fem batch 1`,
        `Fire Tier 2: /admin fem batch 2`,
        `Add 1000 more: drop outreach-import.csv → /admin fem import`,
      ];
      await bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
      return;
    }

    // /admin fem list <tier>
    if (sub === 'list') {
      const tier = parseInt(args[2]);
      const targets = tier ? loadOutreachData().filter(t => t.tier === tier) : loadOutreachData();
      if (!targets.length) {
        await bot.sendMessage(chatId, `No targets found for tier ${tier || 'all'}.`);
        return;
      }
      const stageEmoji = { 0: '🔵', 1: '📧', 2: '🔁', 3: '💰' };
      const lines = targets.map(t =>
        `${stageEmoji[t.stage] || '?'} *${t.name}* — ${t.community}\n` +
        `   ${t.email ? `📩 ${t.email}` : `📱 DM: ${t.dmHandle}`} | ${t.niche}${t.replied ? ' ✅ replied' : ''}\n` +
        `   ID: \`${t.id}\``
      );
      const chunks = [];
      let chunk = `💜 *Tier ${tier || 'All'} Targets (${targets.length})*\n\n`;
      for (const line of lines) {
        if (chunk.length + line.length > 3800) { chunks.push(chunk); chunk = ''; }
        chunk += line + '\n\n';
      }
      chunks.push(chunk);
      for (const c of chunks) await bot.sendMessage(chatId, c.trim(), { parse_mode: 'Markdown' });
      return;
    }

    // /admin fem send <id> — send cold email to one target
    if (sub === 'send') {
      const id = args[2];
      if (!id) { await bot.sendMessage(chatId, 'Usage: /admin fem send <target-id>'); return; }
      try {
        const target = await sendColdEmail(id);
        await bot.sendMessage(chatId,
          `✅ Cold email sent to *${target.name}* (${target.email})\n\nFollow-up will auto-send in 3 days if no reply.`,
          { parse_mode: 'Markdown' }
        );
      } catch (e) {
        await bot.sendMessage(chatId, `❌ Error: ${e.message}`);
      }
      return;
    }

    // /admin fem batch <tier> — batch send to all tier targets with emails
    if (sub === 'batch') {
      const tier = parseInt(args[2]);
      if (!tier) { await bot.sendMessage(chatId, 'Usage: /admin fem batch <1|2|3|4|5|6>'); return; }
      const ready = getTierTargets(tier);
      if (!ready.length) {
        await bot.sendMessage(chatId, `No stage-0 email targets in tier ${tier}.`);
        return;
      }
      await bot.sendMessage(chatId,
        `📤 Sending cold emails to ${ready.length} tier ${tier} targets...\n\n` +
        ready.map(t => `• ${t.name} → ${t.email}`).join('\n')
      );
      let sent = 0; let failed = 0;
      for (const target of ready) {
        try {
          await sendColdEmail(target.id);
          sent++;
          await new Promise(r => setTimeout(r, 1500)); // 1.5s gap between sends
        } catch (e) {
          failed++;
          console.error(`Fem outreach batch error for ${target.id}:`, e.message);
        }
      }
      await bot.sendMessage(chatId,
        `✅ Batch complete — ${sent} sent, ${failed} failed.\n\nFollow-ups will auto-send in 3 days for no-replies.`
      );
      return;
    }

    // /admin fem followup <id>
    if (sub === 'followup') {
      const id = args[2];
      if (!id) { await bot.sendMessage(chatId, 'Usage: /admin fem followup <target-id>'); return; }
      try {
        const target = await sendFollowUp(id);
        await bot.sendMessage(chatId, `✅ Follow-up sent to *${target.name}* (${target.email})`, { parse_mode: 'Markdown' });
      } catch (e) {
        await bot.sendMessage(chatId, `❌ Error: ${e.message}`);
      }
      return;
    }

    // /admin fem pitch <id> — send licensing pitch
    if (sub === 'pitch') {
      const id = args[2];
      if (!id) { await bot.sendMessage(chatId, 'Usage: /admin fem pitch <target-id>'); return; }
      try {
        const target = await sendLicensingPitch(id);
        await bot.sendMessage(chatId, `💰 Licensing pitch sent to *${target.name}* (${target.email})`, { parse_mode: 'Markdown' });
      } catch (e) {
        await bot.sendMessage(chatId, `❌ Error: ${e.message}`);
      }
      return;
    }

    // /admin fem replied <id> — mark replied
    if (sub === 'replied') {
      const id = args[2];
      const notes = args.slice(3).join(' ');
      if (!id) { await bot.sendMessage(chatId, 'Usage: /admin fem replied <target-id> [notes]'); return; }
      const ok = markReplied(id, notes);
      if (ok) {
        const t = getTarget(id);
        await bot.sendMessage(chatId, `✅ *${t?.name}* marked as replied. Follow-up sequence stopped.${notes ? `\nNotes: ${notes}` : ''}`, { parse_mode: 'Markdown' });
      } else {
        await bot.sendMessage(chatId, `❌ Target not found: ${id}`);
      }
      return;
    }

    // /admin fem dmsonly — list DM-only targets (no email)
    if (sub === 'dmsonly') {
      const targets = loadOutreachData().filter(t => !t.email && t.stage === 0);
      if (!targets.length) { await bot.sendMessage(chatId, 'No DM-only targets remaining.'); return; }
      const lines = targets.map(t =>
        `• *${t.name}* (Tier ${t.tier}) — ${t.community}\n  Platform: ${t.platform} | Handle: ${t.dmHandle}`
      );
      const msg = `📱 *DM-Only Targets (${targets.length}) — Manual Contact Needed*\n\n` + lines.join('\n\n');
      if (msg.length > 4000) {
        await bot.sendMessage(chatId, msg.substring(0, 3900) + '\n\n_(truncated — use /admin fem list to see all)_', { parse_mode: 'Markdown' });
      } else {
        await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
      }
      return;
    }

    // /admin fem import — import targets from CSV at data/outreach-import.csv
    if (sub === 'import') {
      const csvPath = path.join(__dirname, '..', 'data', 'outreach-import.csv');
      try {
        const result = importFromCSV(csvPath);
        await bot.sendMessage(chatId,
          `✅ *Import complete*\n\nAdded: ${result.added}\nSkipped (duplicates): ${result.skipped}\nTotal in pipeline: ${result.total}\n\nDrop a new outreach-import.csv in /data/ and run this again to add more.`,
          { parse_mode: 'Markdown' }
        );
      } catch (e) {
        await bot.sendMessage(chatId,
          `❌ Import failed: ${e.message}\n\nCreate a CSV at \`data/outreach-import.csv\` with columns:\nid, name, community, tier, platform, audience, email, dmHandle, niche, gender`
        );
      }
      return;
    }

    await bot.sendMessage(chatId, 'Usage: /admin fem status | list <tier> | send <id> | batch <tier> | followup <id> | pitch <id> | replied <id> | dmsonly | import');
    return;
  }

  // ─── /admin ai — AI influencer affiliate commands ─────────────────────────
  if (cmd === 'ai') {
    const sub  = args[1]?.toLowerCase();
    const id   = args[2];
    const tier = parseInt(args[2]);

    // /admin ai status
    if (!sub || sub === 'status') {
      const s = getAiStats();
      await bot.sendMessage(chatId,
        `🤖 *AI Affiliate Pipeline*\n\n` +
        `Total targets: ${s.total} (${s.withEmail} with email)\n` +
        `Tier 1: ${s.tier1} | Tier 2: ${s.tier2}\n\n` +
        `Stage 0 (unsent): ${s.stage0}\n` +
        `Stage 1 (cold sent): ${s.stage1}\n` +
        `Stage 2 (follow-up sent): ${s.stage2}\n` +
        `Stage 3 (affiliate pitch sent): ${s.stage3}\n` +
        `Replied: ${s.replied}\n\n` +
        `Fire Tier 1: /admin ai batch 1\n` +
        `Fire Tier 2: /admin ai batch 2`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // /admin ai send <id>
    if (sub === 'send') {
      if (!id) { await bot.sendMessage(chatId, 'Usage: /admin ai send <target-id>'); return; }
      try {
        const t = await sendAiColdEmail(id);
        await bot.sendMessage(chatId, `✅ AI cold email sent to ${t.name} (${t.email})`);
      } catch(e) {
        await bot.sendMessage(chatId, `❌ Error: ${e.message}`);
      }
      return;
    }

    // /admin ai batch <tier>
    if (sub === 'batch') {
      if (!tier) { await bot.sendMessage(chatId, 'Usage: /admin ai batch <1|2>'); return; }
      await bot.sendMessage(chatId, `🚀 Sending AI cold emails to Tier ${tier}...`);
      try {
        const results = await batchSendAiColdEmails(tier);
        const sent    = results.filter(r => r.status === 'sent');
        const failed  = results.filter(r => r.status === 'failed');
        await bot.sendMessage(chatId,
          `✅ *AI Tier ${tier} batch complete*\n\nSent: ${sent.length}\nFailed: ${failed.length}` +
          (failed.length ? `\n\nFailed:\n${failed.map(r => `• ${r.name}: ${r.error}`).join('\n')}` : ''),
          { parse_mode: 'Markdown' }
        );
      } catch(e) {
        await bot.sendMessage(chatId, `❌ Batch error: ${e.message}`);
      }
      return;
    }

    // /admin ai pitch <id>
    if (sub === 'pitch') {
      if (!id) { await bot.sendMessage(chatId, 'Usage: /admin ai pitch <target-id>'); return; }
      try {
        const t = await sendAffiliatePitch(id);
        await bot.sendMessage(chatId, `✅ Affiliate pitch sent to ${t.name}`);
      } catch(e) {
        await bot.sendMessage(chatId, `❌ Error: ${e.message}`);
      }
      return;
    }

    // /admin ai replied <id>
    if (sub === 'replied') {
      if (!id) { await bot.sendMessage(chatId, 'Usage: /admin ai replied <target-id>'); return; }
      markAiReplied(id);
      await bot.sendMessage(chatId, `✅ Marked as replied: ${id}`);
      return;
    }

    // /admin ai list
    if (sub === 'list') {
      const targets = loadAiData();
      const tierFilter = tier || null;
      const list = tierFilter ? targets.filter(t => t.tier === tierFilter) : targets;
      const lines = list.map(t =>
        `${t.stage > 0 ? '✅' : '⬜'} [T${t.tier}] ${t.name} — ${t.email || `DM: ${t.dmHandle}`} — stage ${t.stage}`
      ).join('\n');
      const msg = `🤖 *AI Targets${tierFilter ? ` (Tier ${tierFilter})` : ''}*\n\n${lines}`;
      await bot.sendMessage(chatId, msg.substring(0, 3900), { parse_mode: 'Markdown' });
      return;
    }

    await bot.sendMessage(chatId, 'Usage: /admin ai status | list | send <id> | batch <tier> | pitch <id> | replied <id>');
    return;
  }

  await bot.sendMessage(chatId, `Unknown admin command: ${cmd}. Send /admin to see options.`);
});

// ─── Free-text message handler (onboarding flow) ───────────────────────────────

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text   = msg.text?.trim();

  if (!text || text.startsWith('/')) return;

  // ── OTP intercept: if Anna sends a 5-digit code while tgauth is pending ──
  if (isAnna(chatId) && /^\d{5}$/.test(text)) {
    const fs2 = fs;
    const hashFile = path.join(__dirname, '..', 'data', 'tg-pending-hash.txt');
    if (fs2.existsSync(hashFile)) {
      try {
        await bot.sendMessage(chatId, '🔐 Verifying OTP...');
        const sessionString = await verifyOtp(text);
        await bot.sendMessage(chatId,
          '✅ *Telegram outreach client authenticated!*\n\n' +
          'Add this to Railway → Variables:\n*Name:* `TELEGRAM_SESSION`\n*Value:* (next message)',
          { parse_mode: 'Markdown' }
        );
        await bot.sendMessage(chatId, sessionString);
        await bot.sendMessage(chatId,
          '⚠️ Copy that to Railway env vars, then redeploy. The outreach sequencer will activate automatically.',
          { parse_mode: 'Markdown' }
        );
      } catch (err) {
        await bot.sendMessage(chatId, `❌ Auth failed: ${err.message}`);
      }
      return;
    }
  }

  const currentState = state[chatId] || 'unknown';

  // ── Sales Q1: What do you trade? ──
  if (currentState === 'sales_q1') {
    saveUser(chatId, { tradeType: text });
    state[chatId] = 'sales_q2';
    await bot.sendMessage(chatId,
      `Got it.\n\nHave you ever noticed how the same strategy can work perfectly one week — and fail completely the next?\n\nSame setup. Same rules. Same analysis.\n\nHave you experienced that?`
    );
    return;
  }

  // ── Sales Q2: Pattern recognition moment ──
  if (currentState === 'sales_q2') {
    const lead = scoreLeadMessage(text);
    saveUser(chatId, { leadScore: lead.total, leadTier: lead.tier });
    state[chatId] = 'sales_q3';
    await bot.sendMessage(chatId,
      `Almost every serious trader has.\n\nThat inconsistency isn't random. It follows a pattern — specific to you.\n\nMost traders spend years refining their strategy. Almost none of them ever map the decision-maker running it.`
    );
    return;
  }

  // ── Sales Q3: Deliver personalised close → link ──
  if (currentState === 'sales_q3') {
    const user = getUser(chatId);
    const { line1, line2 } = getPersonalisedClose(user?.tradeType || text);
    state[chatId] = 'awaiting_email';
    await bot.sendMessage(chatId, line1);
    await new Promise(r => setTimeout(r, 1200));
    await bot.sendMessage(chatId, line2);
    return;
  }

  // ── Step 0: Email verification ──
  if (currentState === 'awaiting_email') {
    const emailMatch = text.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    if (!emailMatch) {
      await bot.sendMessage(chatId, 'Please enter a valid email address — the one you used when purchasing your Edge Index report.');
      return;
    }

    const email = text.toLowerCase();
    saveUser(chatId, { email });

    if (!await isPaidEmail(email)) {
      await bot.sendMessage(chatId,
        `⚠️ I can't find a purchase linked to *${email}*.\n\nTo access your Edge Index report, complete your purchase here:\n${WHOP_URL}\n\nOnce payment is confirmed, send /start again and enter this email address.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    state[chatId] = 'awaiting_date';
    await bot.sendMessage(chatId,
      `✅ Access confirmed — let's build your brief.\n\nDate of birth (DD/MM/YYYY):`,
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
      `${day}/${month}/${year} ✓\n\nTime of birth (HH:MM, 24-hour). Best estimate is fine if unsure:`,
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
      `${time} ✓\n\nCity and country of birth:`,
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

  // ── Catch-all — pull unknown-state users into sales flow ──
  state[chatId] = 'sales_q1';
  await bot.sendMessage(chatId,
    `Welcome to The Edge Index.\n\nLet me ask you one question before we go further:\n\nWhat do you primarily trade?\n\n• Crypto & Bitcoin\n• Stocks & shares\n• Forex\n• Commodities (oil, gas, energy)\n• Something else`
  );
});

// ─── Cron: Weekly report delivery ─────────────────────────────────────────────
// Every Monday at 8:00 AM UTC

cron.schedule('0 8 * * 1', async () => {
  console.log('[CRON] Weekly report delivery starting...');
  const users = getAllUsers();

  for (const [chatId, userData] of Object.entries(users)) {
    if (!userData.dob || !userData.time || !userData.location || !userData.email) continue;
    if (!await isPaidEmail(userData.email)) continue;

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

  console.log('[CRON] Sending daily CEO briefing to Anna...');
  try {
    // Revenue + subscriber snapshot
    const counts     = getSubscriberCount();
    const paidEmails = getAllPaidEmails();
    const users      = getAllUsers();
    const totalUsers = Object.values(users).filter(u => u.dob).length;
    const annualMrr  = paidEmails.length * 2500; // one-time treated as MRR indicator

    const revHeader =
      `💼 *Edge Index — Daily CEO Brief*\n` +
      `${new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}\n\n` +
      `*Revenue*\n` +
      `Annual Briefs delivered: ${totalUsers}\n` +
      `Monitoring subscribers: ${counts.total}\n` +
      `  └ Weekly Edge: ${counts.weekly} @ $97\n` +
      `  └ Daily Edge:  ${counts.daily}  @ $197\n` +
      `  └ Live Edge:   ${counts.live}   @ $397\n` +
      `Monitoring MRR: *$${counts.mrr}/mo*\n\n`;

    await bot.sendMessage(ANNA_CHAT_ID, revHeader, { parse_mode: 'Markdown' });
    await new Promise(r => setTimeout(r, 400));

    // Female outreach pipeline snapshot
    const femStats = getOutreachStats();
    const femSummary =
      `*Female Outreach Pipeline*\n` +
      `Not started: ${femStats.byStage[0] || 0} | Cold sent: ${femStats.byStage[1] || 0} | Follow-up: ${femStats.byStage[2] || 0} | Replied: ${femStats.replied}\n` +
      `Ready to email: ${(femStats.byStage[0] || 0)} targets\n` +
      `_Send Tier 1 batch: /admin fem batch 1_\n\n`;

    await bot.sendMessage(ANNA_CHAT_ID, femSummary, { parse_mode: 'Markdown' });
    await new Promise(r => setTimeout(r, 400));

    // B2B outreach pipeline briefing
    const briefing = buildOutreachBriefing();
    const chunks   = briefing.match(/[\s\S]{1,4000}/g) || [briefing];
    for (const chunk of chunks) {
      await bot.sendMessage(ANNA_CHAT_ID, chunk, { parse_mode: 'Markdown' });
      await new Promise(r => setTimeout(r, 300));
    }
  } catch (err) {
    console.error('[CRON] CEO briefing error:', err.message);
  }
}, { timezone: 'UTC' });

// ─── Cron: Daily female outreach follow-up sweep ─────────────────────────────
// Every day at 23:00 UTC = 9:00 AM AEST — sends follow-ups 3 days after cold emails

cron.schedule('0 23 * * *', async () => {
  console.log('[CRON] Female outreach sweep (follow-ups + licensing)...');
  try {
    // Follow-up sweep — 3 days after cold email
    const followUps = await runDailyFollowUpSweep();

    // Licensing sweep — 24hrs after they received their report
    const licensing = await runDailyLicensingSweep();

    const allResults = [...followUps, ...licensing];
    if (allResults.length === 0) return;

    if (ANNA_CHAT_ID) {
      const fuSent   = followUps.filter(r => r.status === 'sent');
      const pitches  = licensing.filter(r => r.status === 'pitch_sent');
      const nudges   = licensing.filter(r => r.status === 'nudge_sent');
      const errors   = allResults.filter(r => r.status === 'error');

      const lines = [
        fuSent.length  ? `📧 Follow-ups sent (${fuSent.length}):\n${fuSent.map(r => `  • ${r.target.name}`).join('\n')}` : null,
        pitches.length ? `💰 Licensing pitches sent (${pitches.length}):\n${pitches.map(r => `  • ${r.target.name}`).join('\n')}` : null,
        nudges.length  ? `🔔 Final nudges sent (${nudges.length}):\n${nudges.map(r => `  • ${r.target.name}`).join('\n')}` : null,
        errors.length  ? `⚠️ Errors (${errors.length}): ${errors.map(r => r.target.name).join(', ')}` : null,
      ].filter(Boolean).join('\n\n');

      await bot.sendMessage(ANNA_CHAT_ID,
        `💜 *Female Outreach — Daily Sweep*\n\n${lines}`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (err) {
    console.error('[CRON] Female outreach sweep error:', err.message);
  }
}, { timezone: 'UTC' });

// ─── Cron: Daily AI affiliate sweep ──────────────────────────────────────────
// Every day at 23:30 UTC — follow-ups + affiliate pitches for AI influencer track

cron.schedule('30 23 * * *', async () => {
  console.log('[CRON] AI affiliate sweep (follow-ups + pitches)...');
  try {
    const followUps = await runAiDailyFollowUpSweep();
    const pitches   = await runAiAffiliatePitchSweep();

    if (followUps.length === 0 && pitches.length === 0) return;

    if (ANNA_CHAT_ID) {
      const lines = [
        followUps.length ? `📧 AI follow-ups sent (${followUps.length}):\n${followUps.map(n => `  • ${n}`).join('\n')}` : null,
        pitches.length   ? `💰 AI affiliate pitches sent (${pitches.length}):\n${pitches.map(n => `  • ${n}`).join('\n')}` : null,
      ].filter(Boolean).join('\n\n');

      await bot.sendMessage(ANNA_CHAT_ID,
        `🤖 *AI Affiliate — Daily Sweep*\n\n${lines}`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (err) {
    console.error('[CRON] AI affiliate sweep error:', err.message);
  }
}, { timezone: 'UTC' });

// ─── Outreach: startup init ────────────────────────────────────────────────────

async function handleOutreachReply(replyData) {
  if (!ANNA_CHAT_ID) return;

  const { targetId, targetName, handle, messageText, stage } = replyData;

  // Notify Anna immediately
  await bot.sendMessage(ANNA_CHAT_ID,
    `💬 *Reply from ${targetName}* (${handle})\n\n"${messageText}"\n\n_Drafting response..._`,
    { parse_mode: 'Markdown' }
  );

  // Draft a Claude response
  try {
    const draft = await draftSalesResponse(replyData, anthropic);

    // Store for approval
    pendingDrafts.set(`pending_draft_${targetId}`, {
      targetId, targetName, handle, text: draft,
    });

    await bot.sendMessage(ANNA_CHAT_ID,
      `📝 *Suggested reply:*\n\n${draft}\n\n— Anna\nThe Edge Index\n\n` +
      `✅ Send it: \`/admin approve ${targetId}\`\n` +
      `✏️ Edit first, then approve if happy.`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    await bot.sendMessage(ANNA_CHAT_ID, `⚠️ Couldn't draft reply: ${err.message}`);
  }
}

// Init outreach client on startup (non-blocking)
initOutreachClient(handleOutreachReply).then(connected => {
  if (connected) {
    console.log('[OUTREACH] Auto-sequencer ready.');
  } else {
    console.log('[OUTREACH] No session — run /admin tgauth start to activate.');
  }
}).catch(err => {
  console.error('[OUTREACH] Init error:', err.message);
});

// ─── Cron: Daily outreach sequencer — 22:30 UTC (8:30am AEST) ─────────────────
// Runs 30 minutes after the briefing so Anna sees what's coming first

cron.schedule('30 22 * * *', async () => {
  if (!isConnected()) {
    console.log('[CRON] Outreach sequencer skipped — client not connected.');
    return;
  }

  console.log('[CRON] Running outreach sequencer...');
  try {
    const { sent, skipped } = await runOutreachSequencer();

    if (sent.length > 0 && ANNA_CHAT_ID) {
      const sentList = sent.map(s => `• ${s.name} — Message ${s.stage}`).join('\n');
      await bot.sendMessage(ANNA_CHAT_ID,
        `📤 *Outreach sent today:*\n\n${sentList}`,
        { parse_mode: 'Markdown' }
      );
    } else {
      console.log('[CRON] Outreach: no messages sent today.');
    }
  } catch (err) {
    console.error('[CRON] Outreach sequencer error:', err.message);
  }
}, { timezone: 'UTC' });

// ─── Cron: Weekly Edge — Sunday 21:00 UTC = Monday 7:00am AEST ────────────────

cron.schedule('0 21 * * 0', async () => {
  console.log('[CRON] Weekly Edge starting...');
  try {
    const { sent, failed } = await runWeeklyEdge(bot, ANNA_CHAT_ID);
    console.log(`[CRON] Weekly Edge complete — sent: ${sent}, failed: ${failed}`);
  } catch (err) {
    console.error('[CRON] Weekly Edge error:', err.message);
    if (ANNA_CHAT_ID) {
      await bot.sendMessage(ANNA_CHAT_ID, `⚠️ Weekly Edge cron error: ${err.message}`);
    }
  }
}, { timezone: 'UTC' });

// ─── Cron: Daily Edge — 20:00 UTC daily = 6:00am AEST ─────────────────────────

cron.schedule('0 20 * * *', async () => {
  console.log('[CRON] Daily Edge starting...');
  try {
    const { sent, failed } = await runDailyEdge(bot, ANNA_CHAT_ID);
    console.log(`[CRON] Daily Edge complete — sent: ${sent}, failed: ${failed}`);
  } catch (err) {
    console.error('[CRON] Daily Edge error:', err.message);
  }
}, { timezone: 'UTC' });

// ─── Cron: Day 7 / Day 30 check-in sweep — 21:30 UTC daily ───────────────────
// Checks all users who received a report 7 or 30 days ago

cron.schedule('30 21 * * *', async () => {
  const users   = getAllUsers();
  const today   = new Date();

  for (const [chatId, userData] of Object.entries(users)) {
    if (!userData.lastReportAt) continue;
    const reportDate = new Date(userData.lastReportAt);
    const daysSince  = Math.floor((today - reportDate) / (1000 * 60 * 60 * 24));

    // Day 7 check-in
    if (daysSince === 7 && !userData.checkin7Sent) {
      const tier = userData.monitoringTier || 'none';
      try {
        await sendDay7Checkin(bot, chatId, userData.firstName || 'there', tier);
        saveUser(chatId, { checkin7Sent: true });
        console.log(`[CRON] Day 7 check-in sent to ${chatId}`);
      } catch (e) {
        console.error(`[CRON] Day 7 check-in failed for ${chatId}:`, e.message);
      }
    }

    // Day 30 upsell
    if (daysSince === 30 && !userData.upsell30Sent) {
      try {
        await sendDay30Upsell(bot, chatId, userData.firstName || 'there');
        saveUser(chatId, { upsell30Sent: true });
        console.log(`[CRON] Day 30 upsell sent to ${chatId}`);
      } catch (e) {
        console.error(`[CRON] Day 30 upsell failed for ${chatId}:`, e.message);
      }
    }
  }
}, { timezone: 'UTC' });

// ─── Cron: Twitter lead scanner ───────────────────────────────────────────────
// Every 3 hours (or TWITTER_SCAN_INTERVAL_HOURS if set)
// Only runs if TWITTER_BEARER_TOKEN is set in Railway env vars

const scanIntervalHours = parseInt(process.env.TWITTER_SCAN_INTERVAL_HOURS || '3');
cron.schedule(`0 */${scanIntervalHours} * * *`, async () => {
  if (!process.env.TWITTER_BEARER_TOKEN) return;
  if (!ANNA_CHAT_ID) return;
  console.log('[CRON] Running scheduled Twitter lead scan...');
  try {
    await runLeadScan(bot, ANNA_CHAT_ID, false);
  } catch (err) {
    console.error('[CRON] Twitter scanner error:', err.message);
  }
}, { timezone: 'UTC' });

// ─── Polling error handler ─────────────────────────────────────────────────────

bot.on('polling_error', (err) => {
  console.error('Telegram polling error:', err.message);
});

const twitterConfigured = !!process.env.TWITTER_BEARER_TOKEN;
console.log('✅ Edge Index Telegram bot started (v2)');
console.log(`   Railway API: ${RAILWAY_URL}`);
console.log(`   Anna chat ID: ${ANNA_CHAT_ID || 'NOT SET — set ANNA_CHAT_ID in Railway'}`);
console.log(`   Resend: ${RESEND_KEY ? 'configured' : 'NOT CONFIGURED — set RESEND_API_KEY'}`);
console.log(`   Twitter scanner: ${twitterConfigured ? `enabled — scanning every ${scanIntervalHours}h` : 'disabled — add TWITTER_BEARER_TOKEN to activate'}`);
