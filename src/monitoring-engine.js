/**
 * Edge Index — Monitoring Engine
 *
 * Generates and delivers personalised signal updates for
 * Weekly Edge, Daily Edge, and Live Edge subscribers.
 *
 * Weekly Edge  ($97/mo)  — Monday 7am AEST (Sunday 21:00 UTC)
 * Daily Edge   ($197/mo) — Every morning 7am AEST (20:00 UTC previous day)
 * Live Edge    ($397/mo) — Real-time alert on Golden Window convergence
 */

import Anthropic from '@anthropic-ai/sdk';
import { getSubscribersByTier, getAllSubscribers } from './shared/monitoringSubscribers.js';

const RESEND_KEY = process.env.RESEND_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

// ─── Signal Update Prompt ──────────────────────────────────────────────────────

function buildWeeklyPrompt(sub, weekLabel) {
  return `You are the Edge Index signal analyst generating a personalised Weekly Edge update.

This is a SHORT, HIGH-SIGNAL weekly briefing — not a full report. Maximum 400 words total.

CLIENT PROFILE:
- Name: ${sub.name}
- Decision Architecture: derived from HD Type: ${sub.hdType}
- Decision Mode: derived from HD Authority: ${sub.hdAuthority}
- Primary trading focus: ${sub.tradeType || 'general trading'}

WEEK: ${weekLabel}

Generate a Weekly Edge update with EXACTLY this structure:

**THIS WEEK — [GREEN/AMBER/RED]**
[One sentence on what this week's signal environment means for ${sub.name} specifically]

**PRIMARY SIGNAL THIS WEEK**
[2-3 sentences — what's the dominant signal condition this week and what it means for her decision-making]

**YOUR FOCUS THIS WEEK**
[2-3 sentences — specific guidance for her architecture and decision mode. What should she be doing/watching/avoiding this week?]

**WATCH FOR**
[One specific behavioural pattern to monitor this week, tied to her architecture]

**NEXT WEEK PREVIEW**
[One sentence on whether conditions are building, holding, or shifting next week]

---
*Edge Index Weekly Signal | ${sub.name} | ${weekLabel}*

RULES:
- No planetary names (Mercury, Saturn, Mars etc) — use signal names only (Clarity Signal, Pressure Signal, Action Signal, Expansion Signal)
- No HD terminology — use Edge Index architecture names
- Speak directly to ${sub.name} by name
- Every line must be specific to her architecture — nothing generic
- Tone: intelligent, direct, like a trusted analyst briefing her privately`;
}

function buildDailyPrompt(sub, dateLabel) {
  return `You are the Edge Index signal analyst generating a personalised Daily Edge briefing.

This is an ULTRA-SHORT daily briefing — maximum 200 words. Designed to be read in 60 seconds.

CLIENT: ${sub.name} | Architecture: ${sub.hdType} | Mode: ${sub.hdAuthority} | Focus: ${sub.tradeType || 'general trading'}

DATE: ${dateLabel}

Generate a Daily Edge briefing with EXACTLY this structure:

**TODAY — [GREEN/AMBER/RED]**

**Signal:** [One sentence — what's active today]
**Your edge today:** [One sentence — how ${sub.name}'s specific architecture should use today's conditions]
**Watch:** [One sentence — the single thing to be aware of today]
**Tomorrow:** [One sentence — preview]

---
*Edge Index Daily Signal | ${sub.name} | ${dateLabel}*

RULES: No planetary names. No HD terminology. Maximum 200 words. Direct and specific.`;
}

// ─── Email Delivery ────────────────────────────────────────────────────────────

async function sendMonitoringEmail(to, name, subject, htmlContent) {
  if (!RESEND_KEY) {
    console.error('[monitoring] No RESEND_API_KEY — cannot send email');
    return false;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from:    'The Edge Index <signals@edgeindex.io>',
      to:      [to],
      subject,
      html:    wrapEmailHtml(name, htmlContent, subject),
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('[monitoring] Email send failed:', err);
    return false;
  }
  return true;
}

function wrapEmailHtml(name, content, subject) {
  const md = content
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#080808;margin:0;padding:0;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="border-bottom:1px solid rgba(201,168,76,0.3);padding-bottom:20px;margin-bottom:32px;">
      <p style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#C9A84C;margin:0;">THE EDGE INDEX</p>
      <p style="font-size:13px;color:rgba(255,255,255,0.4);margin:4px 0 0;">${subject}</p>
    </div>
    <div style="color:rgba(255,255,255,0.85);font-size:15px;line-height:1.8;">${md}</div>
    <div style="border-top:1px solid rgba(201,168,76,0.15);margin-top:40px;padding-top:20px;">
      <p style="font-size:11px;color:rgba(255,255,255,0.3);margin:0;">
        The Edge Index | This is your personalised signal update for ${name}.<br>
        Not financial advice. Decision intelligence only.
      </p>
    </div>
  </div>
</body>
</html>`;
}

// ─── Weekly Edge Delivery ──────────────────────────────────────────────────────

export async function runWeeklyEdge(bot, annaChatId) {
  const subscribers = getSubscribersByTier('weekly');
  if (subscribers.length === 0) {
    console.log('[monitoring] Weekly Edge: no subscribers');
    return { sent: 0, failed: 0 };
  }

  const now = new Date();
  const weekLabel = `Week of ${now.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}`;
  console.log(`[monitoring] Weekly Edge running for ${subscribers.length} subscribers — ${weekLabel}`);

  let sent = 0, failed = 0;
  for (const sub of subscribers) {
    try {
      const prompt = buildWeeklyPrompt(sub, weekLabel);
      const response = await anthropic.messages.create({
        model:      'claude-sonnet-4-6',
        max_tokens: 800,
        messages:   [{ role: 'user', content: prompt }],
      });
      const update = response.content[0].text;
      const subject = `Your Edge Index — ${weekLabel}`;
      await sendMonitoringEmail(sub.email, sub.name, subject, update);

      // Telegram notification if chat ID available
      if (sub.telegramChatId && bot) {
        await bot.sendMessage(sub.telegramChatId,
          `📊 *Your Weekly Edge is in your inbox*\n\n${subject}\n\n_Check your email for the full briefing._`,
          { parse_mode: 'Markdown' }
        );
      }
      sent++;
      console.log(`[monitoring] Weekly Edge sent to ${sub.email}`);
    } catch (e) {
      console.error(`[monitoring] Weekly Edge failed for ${sub.email}:`, e.message);
      failed++;
    }
    // 5 second delay between sends
    await new Promise(r => setTimeout(r, 5000));
  }

  // Report to Anna
  if (annaChatId && bot) {
    await bot.sendMessage(annaChatId,
      `✅ *Weekly Edge delivered*\n\nSent: ${sent} | Failed: ${failed}\n_${weekLabel}_`,
      { parse_mode: 'Markdown' }
    );
  }

  return { sent, failed };
}

// ─── Daily Edge Delivery ───────────────────────────────────────────────────────

export async function runDailyEdge(bot, annaChatId) {
  const subscribers = getSubscribersByTier('daily');
  if (subscribers.length === 0) {
    console.log('[monitoring] Daily Edge: no subscribers');
    return { sent: 0, failed: 0 };
  }

  const now = new Date();
  const dateLabel = now.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  console.log(`[monitoring] Daily Edge running for ${subscribers.length} subscribers — ${dateLabel}`);

  let sent = 0, failed = 0;
  for (const sub of subscribers) {
    try {
      const prompt = buildDailyPrompt(sub, dateLabel);
      const response = await anthropic.messages.create({
        model:      'claude-sonnet-4-6',
        max_tokens: 400,
        messages:   [{ role: 'user', content: prompt }],
      });
      const update = response.content[0].text;
      await sendMonitoringEmail(sub.email, sub.name, `Edge Index Daily — ${dateLabel}`, update);

      if (sub.telegramChatId && bot) {
        await bot.sendMessage(sub.telegramChatId, update, { parse_mode: 'Markdown' });
      }
      sent++;
    } catch (e) {
      console.error(`[monitoring] Daily Edge failed for ${sub.email}:`, e.message);
      failed++;
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  return { sent, failed };
}

// ─── Customer Success: Day 7 Check-in ─────────────────────────────────────────

export async function sendDay7Checkin(bot, chatId, name, tier) {
  if (!bot || !chatId) return;
  const upsellMsg = tier === 'none'
    ? `\n\n🔔 *One thing that helps most:* knowing exactly which week your window opens — not just which month. That's what Weekly Edge gives you. $97/month, cancel anytime. Reply WEEKLY to activate.`
    : '';

  await bot.sendMessage(chatId,
    `Hi ${name} 👋\n\nYou've had your Edge Index Brief for a week now.\n\nHow is it landing? Is the timing map making sense as you move through March?\n\nIf anything feels unclear or you want to talk through your Golden Windows, just reply here.${upsellMsg}`,
    { parse_mode: 'Markdown' }
  );
}

export async function sendDay30Upsell(bot, chatId, name) {
  if (!bot || !chatId) return;
  await bot.sendMessage(chatId,
    `Hi ${name} — you're one month into your Edge Index year.\n\nIf you've been using the timing map, you'll have noticed that knowing *which month* is your Green window is powerful — but knowing *which week* it opens is where the real precision is.\n\n📊 *Weekly Edge — $97/month*\nEvery Monday: your signal environment for the week ahead. Green, Amber, or Red — before the week begins.\n\nMost clients who start Weekly Edge say the same thing: they wish they'd started it from day one.\n\nReply WEEKLY to activate, or reply DAILY for the full daily briefing ($197/month).`,
    { parse_mode: 'Markdown' }
  );
}
