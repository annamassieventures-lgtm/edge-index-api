// ─── outreach-sequencer.js ─────────────────────────────────────────────────
// Manages the 3-message outreach sequence across all 20 targets.
// Called daily by cron. Sends messages at the right time and tracks state.

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sendOutreachMessage, isConnected } from './outreach-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTREACH_FILE = path.join(__dirname, '..', 'data', 'outreach-state.json');

// ─── State I/O ───────────────────────────────────────────────────────────────

export function loadOutreach() {
  if (!fs.existsSync(OUTREACH_FILE)) return { targets: [] };
  try { return JSON.parse(fs.readFileSync(OUTREACH_FILE, 'utf8')); }
  catch { return { targets: [] }; }
}

export function saveOutreach(data) {
  fs.mkdirSync(path.dirname(OUTREACH_FILE), { recursive: true });
  fs.writeFileSync(OUTREACH_FILE, JSON.stringify(data, null, 2));
}

// ─── Message content ─────────────────────────────────────────────────────────

const MESSAGES = {
  // Personalised Message 1s for priority targets
  m1: {
    'wolf-of-trading': `Hey,

Came across Wolf of Trading — seriously impressive what you've built. 90K members engaged around trading signals is no small thing, and the brand is built entirely on alpha and edge. That's exactly why I'm reaching out to you first.

I'm launching The Edge Index — a decision timing intelligence platform. The product: each of your members gets a personalised 12-month timing report delivered via Telegram bot. Green signal = high-clarity decision window. Amber = proceed with caution. Red = stand down.

It's built on behavioural pattern recognition — not technical analysis, not sentiment. It identifies each person's individual timing discipline patterns so they know *when* to act on their signals, not just whether the setup is right.

Your signals tell members what to trade. Timing intelligence tells them when their decision-making is sharpest. That's the behavioural edge none of your competitors are offering yet.

I'm opening 5 founding operator spots at $500/month for 3 months (standard pricing is $2,500–$12,000/month). Once one of the other Telegram communities takes a spot, this rate is gone. I'd rather offer it to you first.

Worth a quick 15-minute call this week?

— Anna
The Edge Index`,

    'bitcoin-bullets': `Hey,

Came across Bitcoin Bullets — you've built the largest trading community I'm approaching with this. That's exactly why I wanted to offer you the founding spot first.

I'm launching The Edge Index — a decision timing intelligence platform. The product: each of your members gets a personalised 12-month timing report delivered via Telegram bot. Green signal = high-clarity decision window. Amber = proceed with caution. Red = stand down.

It's built on behavioural pattern recognition — not technical analysis, not sentiment. Your members track the bullets. Timing intelligence tells them exactly when to pull the trigger.

With 106K members, even a fraction of a percent taking it up as a premium add-on is significant revenue on your side — and I handle all the delivery infrastructure.

I'm opening 5 founding operator spots at $500/month for 3 months (standard pricing is $2,500–$12,000/month). I'd like to offer you one.

Worth a quick 15-minute call this week to see if it fits?

— Anna
The Edge Index`,

    'fat-pig-signals': `Hey,

Came across Fat Pig Signals — 46K members around trading signals is serious.

I'll be direct: your signals are good. Your members' timing discipline is the variable you can't control. This fixes that.

I'm launching The Edge Index — a decision timing intelligence platform. Each member gets a personalised 12-month report via Telegram bot. Green = go. Amber = careful. Red = stand down. Built on behavioural pattern recognition, not technical analysis.

Your members are already used to acting on external intelligence — adding a timing layer is a natural extension of that, not a new ask. I handle all delivery. You offer it as a premium add-on.

5 founding operator spots at $500/month for 3 months (standard: $2,500–$12,000/month). One of those spots should be yours.

Quick call this week?

— Anna
The Edge Index`,

    'jacobs-crypto-clan': `Hey,

Came across Jacob's Crypto Clan — 44.5K members in a community built around identity and belonging is genuinely rare in trading.

I'm launching The Edge Index — a decision timing intelligence platform. Give your most engaged members something no other Discord community has: a personalised 12-month timing report delivered via Telegram bot. Green signal = high-clarity decision window. Amber = caution. Red = stand down.

Built on behavioural pattern recognition. Each member gets their own timing profile — no two are the same. It doesn't add any complexity to your Discord server; delivery is fully automated via the Telegram bot on my end.

Position it as a premium tier perk. Your top-tier members get execution intelligence that general members don't. That's a retention and upgrade play in one.

5 founding operator spots at $500/month for 3 months (standard: $2,500–$12,000/month).

Worth a 15-minute call this week?

— Anna
The Edge Index`,

    'rand-trading-group': `Hey,

Came across Rand Trading Group — the YouTube + Discord combination tells me you're building something education-forward, not just signal-based. That changes what I want to offer you.

I'm launching The Edge Index — a decision timing intelligence platform. Your YouTube content teaches traders how to trade. Timing intelligence teaches them *when* their decision-making is sharpest — that's the layer most education platforms completely ignore.

Each member gets a personalised 12-month timing report via Telegram bot. Green = high-clarity window. Amber = caution. Red = stand down. Built on behavioural pattern recognition. I handle all delivery.

There's also a longer-term angle here: once you've seen results from your members, this could be a content angle or case study for your channel. Happy to explore that once we're up and running.

5 founding operator spots at $500/month for 3 months (standard: $2,500–$12,000/month).

Quick call this week to see if the timing works?

— Anna
The Edge Index`,
  },

  // Generic Message 1 for other targets
  m1_generic: (name, size, platform) => `Hey,

Came across ${name} — ${size} members engaged around trading is seriously impressive.

I'm launching The Edge Index — a decision timing intelligence platform. The product: each of your members gets a personalised 12-month timing report delivered via Telegram bot. Green signal = high-clarity decision window. Amber = proceed with caution. Red = stand down.

It's built on behavioural pattern recognition — not technical analysis, not sentiment. It identifies each person's individual timing discipline patterns so they know *when* to act on their signals, not just whether the setup is right.

Your signals tell members what to trade. Timing intelligence tells them when their decision-making is sharpest. I handle all delivery — zero load on your side.

I'm opening 5 founding operator spots at $500/month for 3 months (standard pricing is $2,500–$12,000/month). I'd like to offer you one of those spots.

Worth a quick 15-minute call this week to see if it fits?

— Anna
The Edge Index`,

  // Message 2 — follow-up (3 days after M1)
  m2: (name) => `Hey ${name},

Just a quick follow-up on my message earlier this week.

The part most operators find most interesting: this isn't a replacement for what you already offer. It sits *on top* of your signals.

Your signals tell members what to trade. Timing intelligence tells them when their decision-making is sharpest — and when it isn't. Two of your members can receive the same signal and one exits at +30% while the other exits at breakeven. Often, the difference is timing discipline, not analysis quality.

The Telegram bot handles everything on my end. You don't carry the support load.

At the founding beta rate, you'd need fewer than 50 members taking it up to be ahead on the economics. Even a 0.5% uptake on your community covers it comfortably.

Happy to answer any questions over a quick call — or if you want, I can send through a short overview doc.

— Anna
The Edge Index`,

  // Message 3 — close (5 days after M2)
  m3: (name, communityName) => `Hey ${name},

Last message from me on this — I want to respect your time.

I'm closing the founding beta offer at the end of this week. After that, pricing moves to the standard tier ($2,500/month+). I've got one spot left at the $500/month rate, and based on the size and engagement of ${communityName}, I'd rather it go to you than anyone else.

If the timing isn't right, no problem at all. But if there's any interest, this week is the window.

Even a quick 'yes I'm open to hearing more' gets you locked in at the founding rate while we confirm details.

— Anna
The Edge Index`,
};

// ─── Day difference helper ──────────────────────────────────────────────────

function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const then = new Date(dateStr);
  const now  = new Date();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

// ─── Get message for target ─────────────────────────────────────────────────

function getMessageForTarget(target, stage) {
  const firstName = target.name.split(' ')[0]; // rough first name

  if (stage === 1) {
    // Message 1
    return MESSAGES.m1[target.id] || MESSAGES.m1_generic(target.name, target.size, target.platform);
  }
  if (stage === 2) {
    // Message 2
    return MESSAGES.m2(firstName);
  }
  if (stage === 3) {
    // Message 3
    return MESSAGES.m3(firstName, target.name);
  }
  return null;
}

// ─── Main sequencer ─────────────────────────────────────────────────────────

export async function runOutreachSequencer() {
  if (!isConnected()) {
    console.log('[SEQUENCER] Outreach client not connected — skipping.');
    return { sent: [], skipped: [] };
  }

  const outreach = loadOutreach();
  const sent     = [];
  const skipped  = [];

  for (const target of outreach.targets) {
    // Skip if no handle (Discord-only targets need manual send)
    if (!target.handle || target.platform === 'Discord') {
      skipped.push({ id: target.id, reason: 'Discord/no handle' });
      continue;
    }

    // Skip if replied or completed
    if (target.replied) { skipped.push({ id: target.id, reason: 'replied' }); continue; }
    if (target.stage >= 3 && !target.replied) {
      skipped.push({ id: target.id, reason: 'sequence complete' });
      continue;
    }

    const today = new Date().toISOString().split('T')[0];

    // Determine if we should send today
    let shouldSend = false;
    let nextStage  = target.stage + 1;

    if (target.stage === 0) {
      // Never contacted — send Message 1 immediately
      shouldSend = true;
    } else if (target.stage === 1 && daysSince(target.lastMessageDate) >= 3) {
      // Sent M1 3+ days ago — send M2
      shouldSend = true;
    } else if (target.stage === 2 && daysSince(target.lastMessageDate) >= 5) {
      // Sent M2 5+ days ago — send M3
      shouldSend = true;
    }

    if (!shouldSend) {
      const daysLeft = target.stage === 1
        ? 3 - daysSince(target.lastMessageDate)
        : 5 - daysSince(target.lastMessageDate);
      skipped.push({ id: target.id, reason: `${daysLeft}d until M${nextStage}` });
      continue;
    }

    // Get message content
    const message = getMessageForTarget(target, nextStage);
    if (!message) {
      skipped.push({ id: target.id, reason: 'no message template' });
      continue;
    }

    // Send it
    try {
      await sendOutreachMessage(target.handle, message);

      target.stage           = nextStage;
      target.lastMessageDate = today;
      sent.push({ id: target.id, name: target.name, stage: nextStage });

      console.log(`[SEQUENCER] ✅ Sent M${nextStage} to ${target.name} (${target.handle})`);

      // Delay 30s between sends to avoid rate limiting
      await new Promise(r => setTimeout(r, 30000));
    } catch (err) {
      console.error(`[SEQUENCER] ❌ Failed to send to ${target.name}:`, err.message);
      skipped.push({ id: target.id, reason: `send failed: ${err.message}` });
    }
  }

  saveOutreach(outreach);
  return { sent, skipped };
}

// ─── Draft Claude sales response ─────────────────────────────────────────────

export async function draftSalesResponse(replyData, anthropicClient) {
  const { targetName, handle, messageText, stage } = replyData;

  const systemPrompt = `You are Anna Massie, founder of The Edge Index — a personalised trading timing intelligence platform.
You are drafting a reply to a trading community operator who has responded to your outreach.

PRODUCT: B2B licensing deal. Community operators add The Edge Index as a premium add-on for their members.
- Each member gets a personalised 12-month timing report via Telegram bot
- Green/Amber/Red signal system based on behavioural pattern recognition (NOT astrology/planets/moon)
- Founding beta price: $500/month for 3 months (standard: $2,500–$12,000/month)
- You handle all delivery — zero operational load on the operator

TONE: Professional, direct, warm. Never desperate. Brief — 3-5 sentences max.
GOAL: Get them on a 15-minute call this week OR move to trial if they're interested.
NEVER: mention astrology, planets, moon phases, cosmic energy, or anything spiritual.`;

  const userPrompt = `I sent Message ${stage} to ${targetName} (${handle}).
They replied with: "${messageText}"

Draft a short, natural reply that moves them toward booking a call or accepting a trial.
Keep it to 3-5 sentences. No sign-off needed — I'll add that.`;

  const response = await anthropicClient.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  return response.content[0].text;
}
