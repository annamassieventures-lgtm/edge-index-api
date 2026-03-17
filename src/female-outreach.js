/**
 * Edge Index — Female Community Outreach Engine
 *
 * Automates 3-stage email outreach to female trading/investing community founders.
 * Stage 0 = not started, Stage 1 = cold email sent, Stage 2 = follow-up sent, Stage 3 = licensing pitch
 *
 * Email sequence:
 *   Stage 1: Cold outreach — offer free personalised report
 *   Stage 2: Follow-up (3 days later if no reply)
 *   Stage 3: Licensing pitch (sent manually after they accept/engage)
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { addPaidEmail } from './shared/paidUsers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '..', 'data', 'female-outreach.json');
const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'The Edge Index <reports@edgeindex.io>';

// ─── Initial target list ────────────────────────────────────────────────────

const INITIAL_TARGETS = [
  // TIER 1 — Highest Priority
  { id: 'maren-altman',      name: 'Maren Altman',       community: 'Maren Altman Astrology',    tier: 1, platform: 'TikTok/YouTube',  audience: '1.4M TikTok',  email: 'maren@marenaltman.com',           dmHandle: '@marenaltman',           niche: 'Astrology + crypto',   stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'Perfect fit — astrology + crypto' },
  { id: 'her-first-100k',    name: 'Tori Dunlap',        community: 'Her First $100K',           tier: 1, platform: 'TikTok/Podcast',  audience: '5M+ women',    email: 'tori@herfirst100k.com',           dmHandle: '@herfirst100k',          niche: 'Women investing',      stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'Largest female investing community' },
  { id: 'humbled-trader',    name: 'Shay',               community: 'Humbled Trader',            tier: 1, platform: 'YouTube',         audience: 'Large',        email: null,                              dmHandle: '@humbledtrader',         niche: 'Day trading',          stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'Contact via website form' },
  { id: 'layah-heilpern',    name: 'Layah Heilpern',     community: 'The Layah Heilpern Show',   tier: 1, platform: 'TikTok/Podcast',  audience: '362K TikTok',  email: 'layah@bloxlive.tv',               dmHandle: '@layahheilpern',         niche: 'Crypto/blockchain',    stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'cryptocita',        name: 'Alina Pak',          community: 'Cryptocita',                tier: 1, platform: 'TikTok',          audience: '745K TikTok',  email: 'hello@cryptocita.com',            dmHandle: '@cryptocita',            niche: 'Crypto education',     stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '745K crypto women audience' },
  { id: 'wallstreet-queen',  name: 'Wallstreet Queen',   community: 'Wallstreet Queen Official', tier: 1, platform: 'Telegram',        audience: '145K-235K',    email: null,                              dmHandle: '@wallstreetqueenofficial',niche: 'Crypto signals',       stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'Telegram DM only' },
  { id: 'mindfully-trading', name: 'Emily Butler',       community: 'Mindfully Trading',         tier: 1, platform: 'YouTube',         audience: '81.5K subs',   email: 'emily@mindfullytrading.com',      dmHandle: '@mindfullytrading',      niche: 'Forex + psychology',   stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'Trading psychology — strong fit' },
  { id: 'imkarenfoo',        name: 'Karen Foo',          community: 'imkarenfoo8',               tier: 1, platform: 'Instagram/YouTube',audience: 'Large',        email: 'admin@karen-foo.com',             dmHandle: '@imkarenfoo8',           niche: 'Forex trading',        stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'invest-diva',       name: 'Kiana Danial',       community: 'Invest Diva',               tier: 1, platform: 'Instagram',       audience: 'Large',        email: 'support@investdiva.com',          dmHandle: '@investdiva',            niche: 'Wealth building',      stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'corinne-florence',  name: 'Corinne Florence',   community: 'Crypto + Feminine Energy',  tier: 1, platform: 'Instagram',       audience: 'Growing',      email: null,                              dmHandle: 'Search Instagram',       niche: 'Crypto + spirituality',stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'DM via Instagram' },

  // TIER 2 — Strong Fit
  { id: 'clever-girl-finance',name: 'Bola Sokunbi',      community: 'Clever Girl Finance',       tier: 2, platform: 'YouTube',         audience: '4.3M views',   email: null,                              dmHandle: '@clevergirlfinance',     niche: 'Personal finance',     stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'broke-black-girl',  name: 'Dasha Kennedy',      community: 'The Broke Black Girl',      tier: 2, platform: 'Facebook/Instagram',audience: '255K',        email: null,                              dmHandle: '@thebrokeblackgirl',     niche: 'Financial education',  stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'delyanne',          name: 'Delyanne Barros',    community: 'Stocks and Savings',        tier: 2, platform: 'Instagram',       audience: 'Large',        email: 'delyanneb@gmail.com',             dmHandle: '@delyannethemoneycoach', niche: 'Stock investing',       stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'vestpod',           name: 'Emilie Bellet',      community: 'Vestpod',                   tier: 2, platform: 'Online platform', audience: 'Growing',      email: 'hello@vestpod.com',               dmHandle: 'vestpod.com',            niche: 'Financial independence',stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'nischa',            name: 'Nischa Shah',        community: 'Finance Content',           tier: 2, platform: 'Social Media',    audience: 'Large',        email: null,                              dmHandle: '@nischa',                niche: 'Wealth/career',        stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'cryptowendyo',      name: 'Cryptowendyo',       community: 'CryptoWendyo',              tier: 2, platform: 'TikTok',          audience: '272K',         email: null,                              dmHandle: '@cryptowendyo',          niche: 'Crypto basics',        stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'joyee-yang',        name: 'Joyee Yang',         community: 'Financial Freedom',         tier: 2, platform: 'TikTok/Instagram',audience: '161.2K TikTok',email: null,                              dmHandle: '@joyeeyang0',            niche: 'Stocks/crypto',        stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'bitcoin-babyy',     name: 'Kayla',              community: 'Bitcoin Babyy',             tier: 2, platform: 'TikTok/Instagram',audience: '71.2K TikTok', email: null,                              dmHandle: '@bitcoinbabyy',          niche: 'FX/crypto',            stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'pennies-to-pounds', name: 'Kia Commodore',      community: 'Pennies to Pounds',         tier: 2, platform: 'Podcast/BBC',     audience: 'Large',        email: null,                              dmHandle: '@pennies_to_pounds',     niche: 'Financial literacy',   stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'raghee-horner',     name: 'Raghee Horner',      community: 'Raghee Horner Trading',     tier: 2, platform: 'Instagram/YouTube',audience: 'Large',       email: null,                              dmHandle: '@ragheehorner',          niche: 'Forex/futures',        stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'trader-neza',       name: 'Neza Molk',          community: 'Trader Neza',               tier: 2, platform: 'Instagram',       audience: 'Large',        email: null,                              dmHandle: '@traderneza',            niche: 'Day trading',          stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },

  // TIER 3 — Community Licensing Targets
  { id: 'shefi',             name: 'Maggie Love',        community: 'SheFi',                     tier: 3, platform: 'Bootcamp/Community',audience: 'Growing',     email: null,                              dmHandle: 'SheFi.io',               niche: 'Crypto/Web3',          stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'B2B licensing potential' },
  { id: 'cryptochicks',      name: 'Elena Sinelnikova',  community: 'CryptoChicks',              tier: 3, platform: 'Non-profit/Intl',  audience: 'International',email: 'elena.sinelnikova@gmail.com',     dmHandle: 'cryptochicks.ca',        niche: 'Blockchain education', stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'International reach' },
  { id: 'wib-talks',         name: 'Lavinia Osborne',    community: 'Women in Blockchain Talks', tier: 3, platform: 'Podcast/Platform', audience: 'Growing',      email: null,                              dmHandle: '@wibtalks',              niche: 'Blockchain',           stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'ladies-finance-club',name: 'Ladies Finance Club',community: 'Ladies Finance Club',      tier: 3, platform: 'Website/Events',  audience: 'Growing',      email: 'hello@ladiesfinanceclub.com.au',  dmHandle: 'ladiesfinanceclub.com.au',niche: 'General finance',      stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'Australia — great fit' },
  { id: 'womens-personal-fin',name: 'Angela',            community: "Women's Personal Finance",  tier: 3, platform: 'Facebook',         audience: '83K members',  email: null,                              dmHandle: 'womenspersonalfinance.org',niche: 'FIRE movement',        stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'financial-diet',    name: 'Chelsea Fagan',      community: 'The Financial Diet',        tier: 3, platform: 'YouTube',          audience: 'Large',        email: 'chelsea@thefinancialdiet.com',    dmHandle: '@thefinancialdiet',      niche: 'Women + money',        stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },

  // TIER 4 — AU Targets
  { id: 'heygermaine',       name: 'Germaine Chow',      community: 'Financial Literacy AUS',    tier: 4, platform: 'Instagram',        audience: 'Large',        email: null,                              dmHandle: '@heygermaine',           niche: 'Property/finance',     stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'Australian — priority' },
  { id: 'wifs-australia',    name: 'WIFS Australia',     community: 'Women in Finance Summit',   tier: 4, platform: 'Events/Network',   audience: 'Industry',     email: null,                              dmHandle: 'womeninfinancesummit.com.au',niche: 'Finance industry',  stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'AU B2B target' },
  { id: '100wf-australia',   name: '100WF Australia',    community: '100 Women in Finance AUS',  tier: 4, platform: 'Events/Network',   audience: 'Professional', email: null,                              dmHandle: '100women.org/australia', niche: 'Finance professional', stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },

  // TIER 6 — Wealth + Mindset
  { id: 'aligned-trader',    name: 'Aligned Trader',     community: 'Aligned Trader',            tier: 6, platform: 'Community',        audience: 'Growing',      email: null,                              dmHandle: 'Search Instagram',       niche: 'HD + trading',         stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: 'Human Design + trading — perfect fit' },
  { id: 'cosmic-trading',    name: 'Cosmic Trading',     community: 'Cosmic Trading',            tier: 6, platform: 'Community',        audience: 'Growing',      email: null,                              dmHandle: 'Search Instagram',       niche: 'Astrology + trading',  stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
  { id: 'wealth-with-soph',  name: 'Wealth With Soph',   community: 'Wealth With Soph',          tier: 6, platform: 'Social Media',     audience: 'Growing',      email: null,                              dmHandle: 'Search Instagram',       niche: 'Wealth mindset',       stage: 0, emailSentAt: null, followupSentAt: null, replied: false, notes: '' },
];

// ─── State management ────────────────────────────────────────────────────────

export function loadOutreachData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(INITIAL_TARGETS, null, 2));
      return [...INITIAL_TARGETS];
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch { return [...INITIAL_TARGETS]; }
}

export function saveOutreachData(targets) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(targets, null, 2));
}

export function getTarget(id) {
  return loadOutreachData().find(t => t.id === id) || null;
}

export function updateTarget(id, updates) {
  const targets = loadOutreachData();
  const idx = targets.findIndex(t => t.id === id);
  if (idx === -1) return false;
  targets[idx] = { ...targets[idx], ...updates };
  saveOutreachData(targets);
  return true;
}

// ─── Email templates ─────────────────────────────────────────────────────────

function buildColdEmailHtml(target) {
  const niche = target.niche.toLowerCase();
  const nicheLabel = niche.includes('crypto') ? 'crypto'
    : niche.includes('forex') || niche.includes('trading') ? 'trading'
    : 'investing';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Georgia, serif; background: #0a0a0a; color: #e8e0d0; margin: 0; padding: 0; }
    .container { max-width: 580px; margin: 0 auto; padding: 40px 32px; }
    .header { border-bottom: 1px solid #2a2a2a; padding-bottom: 24px; margin-bottom: 32px; }
    .logo { font-family: 'Helvetica Neue', sans-serif; font-size: 13px; letter-spacing: 3px; color: #c9a84c; text-transform: uppercase; }
    .body { font-size: 16px; line-height: 1.7; color: #d4ccc0; }
    .body p { margin: 0 0 20px; }
    .signature { border-top: 1px solid #2a2a2a; padding-top: 24px; margin-top: 32px; font-size: 14px; color: #8a7a60; }
    .cta { display: inline-block; margin: 8px 0; padding: 14px 28px; background: #c9a84c; color: #0a0a0a; font-family: 'Helvetica Neue', sans-serif; font-size: 14px; font-weight: 600; letter-spacing: 1px; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">The Edge Index</div>
    </div>
    <div class="body">
      <p>Hi ${target.name},</p>
      <p>I've been following ${target.community} for a while — love what you're building for women in ${nicheLabel}.</p>
      <p>Right now the pressure on women financially is unlike anything we've seen in a long time. Rates are up. Petrol, food, everything costs more. The geopolitical situation is feeding straight into cost of living — and for women who are trying to trade or invest their way to more security, the stakes of every decision have never felt higher.</p>
      <p>On top of that, women carry a weight that rarely gets talked about in trading spaces — the background hum of financial anxiety that never fully switches off. Worrying whether it's enough. Whether the decisions they're making now will hold. Whether they should be doing more, or less, or something different entirely. That stress doesn't stay out of the market — it sits behind every trade, every entry, every time they hesitate or second-guess a position they know is right. Most of them blame themselves for it. The reality is it's timing — and it follows a pattern specific to each person.</p>
      <p>I built The Edge Index for exactly this — a personalised report and platform designed to give every trader their personal edge. Not a generic signal. Not a market forecast. A map of <em>them</em> — so they know when to back themselves and when to step back, in any market condition.</p>
      <p>I'd love to send you a complimentary one. No strings attached — it takes two minutes, and you'll have the full report in your inbox within the hour.</p>
      <p>Would you be open to it?</p>
      <p><a href="https://t.me/TheEdgeIndexBot" class="cta">Get Your Free Report →</a></p>
    </div>
    <div class="signature">
      Anna Massie<br>
      Founder, The Edge Index<br>
      <a href="https://edgeindex.io" style="color: #c9a84c; text-decoration: none;">edgeindex.io</a>
    </div>
  </div>
</body>
</html>`;
}

function buildFollowUpEmailHtml(target) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Georgia, serif; background: #0a0a0a; color: #e8e0d0; margin: 0; padding: 0; }
    .container { max-width: 580px; margin: 0 auto; padding: 40px 32px; }
    .header { border-bottom: 1px solid #2a2a2a; padding-bottom: 24px; margin-bottom: 32px; }
    .logo { font-family: 'Helvetica Neue', sans-serif; font-size: 13px; letter-spacing: 3px; color: #c9a84c; text-transform: uppercase; }
    .body { font-size: 16px; line-height: 1.7; color: #d4ccc0; }
    .body p { margin: 0 0 20px; }
    .signature { border-top: 1px solid #2a2a2a; padding-top: 24px; margin-top: 32px; font-size: 14px; color: #8a7a60; }
    .cta { display: inline-block; margin: 8px 0; padding: 14px 28px; background: #c9a84c; color: #0a0a0a; font-family: 'Helvetica Neue', sans-serif; font-size: 14px; font-weight: 600; letter-spacing: 1px; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">The Edge Index</div>
    </div>
    <div class="body">
      <p>Hi ${target.name},</p>
      <p>Just following up on my note from a few days ago.</p>
      <p>With everything happening in the world right now — rates rising, cost of living squeezing harder, markets reacting to every geopolitical headline — the women who come out ahead won't just have the best strategy. They'll know themselves well enough to execute it clearly when the pressure is highest.</p>
      <p>The women I've sent this report to say the same thing: they already knew their strategy — what they didn't have was a map of themselves. Now they know which months to be aggressive, which weeks to step back, and why certain periods have always felt harder than others. One said it was the first time she stopped feeling like the problem.</p>
      <p>I'd love to send you yours — just two minutes to get your details across.</p>
      <p><a href="https://t.me/TheEdgeIndexBot" class="cta">Get Your Free Report →</a></p>
    </div>
    <div class="signature">
      Anna Massie<br>
      Founder, The Edge Index<br>
      <a href="https://edgeindex.io" style="color: #c9a84c; text-decoration: none;">edgeindex.io</a>
    </div>
  </div>
</body>
</html>`;
}

function buildLicensingEmailHtml(target) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Georgia, serif; background: #0a0a0a; color: #e8e0d0; margin: 0; padding: 0; }
    .container { max-width: 580px; margin: 0 auto; padding: 40px 32px; }
    .header { border-bottom: 1px solid #2a2a2a; padding-bottom: 24px; margin-bottom: 32px; }
    .logo { font-family: 'Helvetica Neue', sans-serif; font-size: 13px; letter-spacing: 3px; color: #c9a84c; text-transform: uppercase; }
    .body { font-size: 16px; line-height: 1.7; color: #d4ccc0; }
    .body p { margin: 0 0 20px; }
    .highlight { background: #1a1a0e; border-left: 3px solid #c9a84c; padding: 16px 20px; margin: 20px 0; font-size: 15px; color: #c9a84c; }
    .signature { border-top: 1px solid #2a2a2a; padding-top: 24px; margin-top: 32px; font-size: 14px; color: #8a7a60; }
    .cta { display: inline-block; margin: 8px 0; padding: 14px 28px; background: #c9a84c; color: #0a0a0a; font-family: 'Helvetica Neue', sans-serif; font-size: 14px; font-weight: 600; letter-spacing: 1px; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">The Edge Index</div>
    </div>
    <div class="body">
      <p>Hi ${target.name},</p>
      <p>I'm glad you found your report valuable.</p>
      <p>Given your audience, I wanted to reach out about something specific. I'm currently offering three founding community licences — access for your entire community to receive personalised Edge Index reports.</p>
      <div class="highlight">
        Founding rate: <strong>$500/month</strong> (vs. $2,500/month standard)<br>
        Your community gets personalised 12-month decision-timing reports at member level.
      </div>
      <p>Given that your audience already thinks about cycles, timing, and decision quality — this would land well. I think it could genuinely strengthen your offering.</p>
      <p>Would you be open to a 15-minute call to explore it?</p>
      <p><a href="mailto:anna@annamassie.com.au" class="cta">Reply to Book a Call →</a></p>
    </div>
    <div class="signature">
      Anna Massie<br>
      Founder, The Edge Index<br>
      <a href="https://edgeindex.io" style="color: #c9a84c; text-decoration: none;">edgeindex.io</a>
    </div>
  </div>
</body>
</html>`;
}

function buildPostReportEmailHtml(target) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Georgia, serif; background: #0a0a0a; color: #e8e0d0; margin: 0; padding: 0; }
    .container { max-width: 580px; margin: 0 auto; padding: 40px 32px; }
    .header { border-bottom: 1px solid #2a2a2a; padding-bottom: 24px; margin-bottom: 32px; }
    .logo { font-family: 'Helvetica Neue', sans-serif; font-size: 13px; letter-spacing: 3px; color: #c9a84c; text-transform: uppercase; }
    .body { font-size: 16px; line-height: 1.7; color: #d4ccc0; }
    .body p { margin: 0 0 20px; }
    .highlight { background: #1a1a0e; border-left: 3px solid #c9a84c; padding: 16px 20px; margin: 20px 0; font-size: 15px; color: #c9a84c; }
    .signature { border-top: 1px solid #2a2a2a; padding-top: 24px; margin-top: 32px; font-size: 14px; color: #8a7a60; }
    .cta { display: inline-block; margin: 8px 0; padding: 14px 28px; background: #c9a84c; color: #0a0a0a; font-family: 'Helvetica Neue', sans-serif; font-size: 14px; font-weight: 600; letter-spacing: 1px; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">The Edge Index</div>
    </div>
    <div class="body">
      <p>Hi ${target.name},</p>
      <p>I hope your Edge Index Brief landed well — I'd love to know what you took from it.</p>
      <p>I want to be direct with you about why I reached out specifically.</p>
      <p>The women in ${target.community} trust you. They follow you because you've shown them something real about money, markets, and how to navigate both. Right now — with cost of living crushing people, geopolitical instability driving up the price of everything, and a level of financial anxiety most of us haven't felt in our lifetimes — the women in your community are scared. Not just about their trades. About their future. Their children's future. Whether the decisions they're making right now are going to hold.</p>
      <p>What you just experienced in your report is a map. A personalised map that tells you when your judgment is clearest and when emotional pressure distorts it. That map is what every woman in your community needs right now — not as a luxury, but as protection. So they stop second-guessing themselves at exactly the wrong moment. So they stop losing money in windows that were always going to be hard for them specifically.</p>
      <p>You have the ability to give every one of them that.</p>
      <div class="highlight">
        Founding community licence: <strong>$500/month</strong> (standard rate: $2,500/month)<br><br>
        Every member of ${target.community} gets their own personalised 12-month Edge Index Brief. Their own map. Their own edge.
      </div>
      <p>This is what community leaders do in a crisis — they bring their people something that actually helps. Would you be open to a quick call this week?</p>
      <p><a href="mailto:anna@annamassie.com.au" class="cta">Reply to Book a Call →</a></p>
    </div>
    <div class="signature">
      Anna Massie<br>
      Founder, The Edge Index<br>
      <a href="https://edgeindex.io" style="color: #c9a84c; text-decoration: none;">edgeindex.io</a>
    </div>
  </div>
</body>
</html>`;
}

function buildPostReportNudgeHtml(target) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Georgia, serif; background: #0a0a0a; color: #e8e0d0; margin: 0; padding: 0; }
    .container { max-width: 580px; margin: 0 auto; padding: 40px 32px; }
    .header { border-bottom: 1px solid #2a2a2a; padding-bottom: 24px; margin-bottom: 32px; }
    .logo { font-family: 'Helvetica Neue', sans-serif; font-size: 13px; letter-spacing: 3px; color: #c9a84c; text-transform: uppercase; }
    .body { font-size: 16px; line-height: 1.7; color: #d4ccc0; }
    .body p { margin: 0 0 20px; }
    .signature { border-top: 1px solid #2a2a2a; padding-top: 24px; margin-top: 32px; font-size: 14px; color: #8a7a60; }
    .cta { display: inline-block; margin: 8px 0; padding: 14px 28px; background: #c9a84c; color: #0a0a0a; font-family: 'Helvetica Neue', sans-serif; font-size: 14px; font-weight: 600; letter-spacing: 1px; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">The Edge Index</div>
    </div>
    <div class="body">
      <p>Hi ${target.name},</p>
      <p>Just a final note from me.</p>
      <p>The world feels financially unstable right now in a way that's hard to ignore. The women in your community are feeling it — in their trading, in their decisions, in the quiet anxiety about whether they're doing enough to protect themselves and the people they love.</p>
      <p>The founding licence I mentioned gives every one of them their own personalised edge — their own map of when to push and when to protect. I only have three spots at this rate, and I wanted to make sure you had a genuine chance to claim one for your community before I move on.</p>
      <p>If now isn't the right moment, no problem at all. But if you want to talk through what it would look like — even just a 15-minute conversation — I'm here.</p>
      <p><a href="mailto:anna@annamassie.com.au" class="cta">Let's Talk →</a></p>
    </div>
    <div class="signature">
      Anna Massie<br>
      Founder, The Edge Index<br>
      <a href="https://edgeindex.io" style="color: #c9a84c; text-decoration: none;">edgeindex.io</a>
    </div>
  </div>
</body>
</html>`;
}

// ─── Resend email sender ─────────────────────────────────────────────────────

async function sendEmail(to, subject, html) {
  if (!RESEND_KEY) throw new Error('RESEND_API_KEY not set');
  if (!to) throw new Error('No email address for this target');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error (${res.status}): ${err}`);
  }
  return res.json();
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Send cold outreach email to a target (stage 1)
 */
export async function sendColdEmail(targetId) {
  const targets = loadOutreachData();
  const target = targets.find(t => t.id === targetId);
  if (!target) throw new Error(`Target not found: ${targetId}`);
  if (!target.email) throw new Error(`No email address for ${target.name} — use DM instead (${target.dmHandle})`);
  if (target.stage >= 1) throw new Error(`Already at stage ${target.stage} — cold email already sent`);

  const subject = `Complimentary Edge Index Brief for you`;
  const html = buildColdEmailHtml(target);
  await sendEmail(target.email, subject, html);

  // Whitelist their email so they pass the payment gate automatically
  addPaidEmail(target.email);

  updateTarget(targetId, { stage: 1, emailSentAt: new Date().toISOString() });
  return target;
}

/**
 * Send follow-up email (stage 2) — called automatically 3 days after cold email
 */
export async function sendFollowUp(targetId) {
  const target = getTarget(targetId);
  if (!target) throw new Error(`Target not found: ${targetId}`);
  if (!target.email) throw new Error(`No email for ${target.name}`);
  if (target.replied) throw new Error(`${target.name} already replied — no follow-up needed`);
  if (target.stage !== 1) throw new Error(`Target at stage ${target.stage} — follow-up requires stage 1`);

  const subject = `Re: Complimentary Edge Index Brief`;
  const html = buildFollowUpEmailHtml(target);
  await sendEmail(target.email, subject, html);

  updateTarget(targetId, { stage: 2, followupSentAt: new Date().toISOString() });
  return target;
}

/**
 * Send licensing pitch (stage 3) — manual trigger after they engage
 */
export async function sendLicensingPitch(targetId) {
  const target = getTarget(targetId);
  if (!target) throw new Error(`Target not found: ${targetId}`);
  if (!target.email) throw new Error(`No email for ${target.name}`);

  const subject = `Community licence — The Edge Index`;
  const html = buildLicensingEmailHtml(target);
  await sendEmail(target.email, subject, html);

  updateTarget(targetId, { stage: 3 });
  return target;
}

/**
 * Mark a target as replied (stops follow-up sequence)
 */
export function markReplied(targetId, notes = '') {
  const target = getTarget(targetId);
  if (!target) return false;
  updateTarget(targetId, { replied: true, notes: notes || target.notes });
  return true;
}

/**
 * Called by the bot when a report is sent to someone in the outreach list.
 * Marks them as report_received so the licensing sequence can begin.
 */
export function markReportReceived(email) {
  const targets = loadOutreachData();
  const target = targets.find(t => t.email?.toLowerCase() === email?.toLowerCase());
  if (!target) return false;
  updateTarget(target.id, { reportReceivedAt: new Date().toISOString() });
  return target;
}

/**
 * Daily sweep — sends post-report licensing pitch 24hrs after report, nudge 5 days later
 */
export async function runDailyLicensingSweep() {
  const targets = loadOutreachData();
  const now = Date.now();
  const ONE_DAY  = 24 * 60 * 60 * 1000;
  const FIVE_DAYS = 5 * 24 * 60 * 60 * 1000;
  const results = [];

  for (const target of targets) {
    if (!target.email || !target.reportReceivedAt || target.replied) continue;
    const receivedAt = new Date(target.reportReceivedAt).getTime();
    const elapsed = now - receivedAt;

    // Send licensing pitch 24hrs after they received their report
    if (elapsed >= ONE_DAY && !target.licensingPitchSentAt) {
      try {
        const subject = `Your Edge Index Brief — and what's possible for ${target.community}`;
        const html = buildPostReportEmailHtml(target);
        await sendEmail(target.email, subject, html);
        updateTarget(target.id, { licensingPitchSentAt: new Date().toISOString() });
        results.push({ target, status: 'pitch_sent' });
      } catch (e) {
        results.push({ target, status: 'error', error: e.message });
      }
    }

    // Send final nudge 5 days after licensing pitch if no reply
    if (elapsed >= ONE_DAY + FIVE_DAYS && target.licensingPitchSentAt && !target.nudgeSentAt) {
      try {
        const subject = `Re: Edge Index community licence — last note`;
        const html = buildPostReportNudgeHtml(target);
        await sendEmail(target.email, subject, html);
        updateTarget(target.id, { nudgeSentAt: new Date().toISOString() });
        results.push({ target, status: 'nudge_sent' });
      } catch (e) {
        results.push({ target, status: 'error', error: e.message });
      }
    }
  }
  return results;
}

/**
 * Daily sweep — sends follow-ups to stage 1 targets 3+ days after cold email
 * Returns list of { target, result } pairs
 */
export async function runDailyFollowUpSweep() {
  const targets = loadOutreachData();
  const now = Date.now();
  const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
  const results = [];

  for (const target of targets) {
    if (target.stage !== 1 || target.replied || !target.email || !target.emailSentAt) continue;
    const sentAt = new Date(target.emailSentAt).getTime();
    if (now - sentAt >= THREE_DAYS) {
      try {
        await sendFollowUp(target.id);
        results.push({ target, status: 'sent' });
      } catch (e) {
        results.push({ target, status: 'error', error: e.message });
      }
    }
  }
  return results;
}

/**
 * Get outreach stats summary
 */
export function getOutreachStats() {
  const targets = loadOutreachData();
  const total = targets.length;
  const byStage = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const replied = targets.filter(t => t.replied).length;
  const hasEmail = targets.filter(t => t.email).length;
  const byTier = {};

  for (const t of targets) {
    byStage[t.stage] = (byStage[t.stage] || 0) + 1;
    byTier[t.tier] = (byTier[t.tier] || 0) + 1;
  }

  return { total, byStage, replied, hasEmail, byTier };
}

/**
 * Get tier targets (for batch sending)
 */
export function getTierTargets(tier) {
  return loadOutreachData().filter(t => t.tier === tier && t.stage === 0 && t.email);
}

/**
 * Get all targets ready to email (stage 0, has email)
 */
export function getReadyTargets() {
  return loadOutreachData().filter(t => t.stage === 0 && t.email);
}
