/**
 * Edge Index — Twitter/X Lead Scanner
 *
 * Runs on a cron schedule, searches Twitter/X for traders posting
 * frustration signals, scores each result, and sends high-probability
 * leads to Anna's Telegram with the suggested opener ready to copy.
 *
 * Required env var: TWITTER_BEARER_TOKEN (from developer.twitter.com)
 * Optional env var: TWITTER_SCAN_INTERVAL_HOURS (default: 3)
 *
 * Admin commands added:
 *   /admin scanner        — show scanner status + stats
 *   /admin scanner on     — enable scanner
 *   /admin scanner off    — disable scanner
 *   /admin scanner now    — run a manual scan immediately
 */

import { scoreLeadMessage } from './lead-scorer.js';

const BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;
const MIN_SCORE    = parseInt(process.env.TWITTER_MIN_SCORE || '8');

// ─── Search queries — targeting high-signal trader frustration ─────────────────
// Each query uses Twitter's advanced search operators.
// -is:retweet excludes retweets. lang:en for English only.
// We use multiple focused queries rather than one broad one for better precision.

const SEARCH_QUERIES = [
  // Performance frustration — highest intent signals
  '"gave back" (profits OR gains OR trades) trading -is:retweet lang:en',
  '"gave it all back" trading -is:retweet lang:en',
  '"emotional trading" mistake loss -is:retweet lang:en',
  '"bad execution" trade loss -is:retweet lang:en',
  '"trading psychology" struggle discipline -is:retweet lang:en',

  // Timing frustration
  '"wrong time" trade (loss OR mistake OR again) -is:retweet lang:en',
  '"same strategy" (works OR worked) (sometimes OR stopped OR inconsistent) trading -is:retweet lang:en',
  '"profitable" then (gave OR lost OR drawdown) trading -is:retweet lang:en',
  '"volatility" (destroyed OR killed OR wrecked) (trade OR position OR account) -is:retweet lang:en',

  // Cycle / pattern awareness (B2C high-conviction)
  '"market regime" trading (shift OR change OR cycle) -is:retweet lang:en',
  '"volatility cycle" trading -is:retweet lang:en',
  '"macro cycle" trade decision -is:retweet lang:en',

  // Drawdown / streak
  '"drawdown" (psychology OR emotional OR discipline OR pattern) trading -is:retweet lang:en',
  '"losing streak" trading (why OR pattern OR always OR again) -is:retweet lang:en',
  '"overtrading" (again OR problem OR stop OR keep) -is:retweet lang:en',
  '"revenge trading" -is:retweet lang:en',

  // B2B community signals — trading community admins discussing retention
  '"trading community" (retention OR churn OR members OR engagement) -is:retweet lang:en',
  '"trading group" (retention OR members OR value OR losing) -is:retweet lang:en',
  '"trading discord" (members OR grow OR retention OR value) -is:retweet lang:en',
];

// ─── Deduplicate seen tweet IDs across scans ──────────────────────────────────
const seenTweetIds = new Set();

// ─── Twitter API v2 search ────────────────────────────────────────────────────

async function searchTweets(query, maxResults = 10) {
  if (!BEARER_TOKEN) return [];

  const params = new URLSearchParams({
    query,
    max_results:  String(Math.min(maxResults, 10)),
    'tweet.fields': 'created_at,author_id,text,public_metrics',
    'user.fields':  'username,name,public_metrics',
    expansions:     'author_id',
  });

  try {
    const res = await fetch(
      `https://api.twitter.com/2/tweets/search/recent?${params}`,
      {
        headers: {
          Authorization: `Bearer ${BEARER_TOKEN}`,
          'User-Agent':  'EdgeIndexScanner/1.0',
        },
      }
    );

    if (!res.ok) {
      const err = await res.text();
      console.error(`[SCANNER] Twitter API error (${res.status}):`, err.substring(0, 200));
      return [];
    }

    const data = await res.json();
    if (!data.data) return [];

    // Build user map for easy lookup
    const userMap = {};
    for (const u of (data.includes?.users || [])) {
      userMap[u.id] = u;
    }

    return data.data.map(tweet => ({
      id:          tweet.id,
      text:        tweet.text,
      authorId:    tweet.author_id,
      username:    userMap[tweet.author_id]?.username || 'unknown',
      name:        userMap[tweet.author_id]?.name     || 'Unknown',
      followers:   userMap[tweet.author_id]?.public_metrics?.followers_count || 0,
      likes:       tweet.public_metrics?.like_count    || 0,
      retweets:    tweet.public_metrics?.retweet_count || 0,
      createdAt:   tweet.created_at,
      url:         `https://x.com/${userMap[tweet.author_id]?.username || 'i'}/status/${tweet.id}`,
    }));
  } catch (err) {
    console.error('[SCANNER] Fetch error:', err.message);
    return [];
  }
}

// ─── Rate limit manager — Twitter free tier: 1 request per 15 seconds ────────

async function rateLimitedSearch(query) {
  await new Promise(r => setTimeout(r, 16000)); // 16s gap between requests
  return searchTweets(query, 10);
}

// ─── Run a full scan across all queries ──────────────────────────────────────

export async function runLeadScan(bot, annaChatId, silent = false) {
  if (!BEARER_TOKEN) {
    if (!silent) {
      await bot.sendMessage(annaChatId,
        '⚠️ Twitter scanner not configured.\n\nAdd TWITTER_BEARER_TOKEN to Railway environment variables.\n\nGet it from: developer.twitter.com → Your App → Keys and Tokens → Bearer Token'
      );
    }
    return { leads: [], total: 0 };
  }

  console.log('[SCANNER] Starting Twitter lead scan...');
  if (!silent) await bot.sendMessage(annaChatId, '🔍 Running Twitter lead scan...');

  const allLeads = [];
  let newCount   = 0;
  let skipCount  = 0;

  for (const query of SEARCH_QUERIES) {
    const tweets = await rateLimitedSearch(query);

    for (const tweet of tweets) {
      // Skip already seen
      if (seenTweetIds.has(tweet.id)) { skipCount++; continue; }
      seenTweetIds.add(tweet.id);

      // Score the tweet text
      const score = scoreLeadMessage(tweet.text);
      if (score.total < MIN_SCORE) continue;

      // Bonus for follower count (community admin signal)
      const followerBonus = tweet.followers >= 10000 ? 3 : tweet.followers >= 1000 ? 1 : 0;
      const finalScore    = score.total + followerBonus;

      allLeads.push({ tweet, score: { ...score, total: finalScore }, query });
      newCount++;
    }
  }

  // Sort by score descending, take top 10
  allLeads.sort((a, b) => b.score.total - a.score.total);
  const topLeads = allLeads.slice(0, 10);

  console.log(`[SCANNER] Scan complete. ${newCount} new leads found, ${skipCount} skipped (seen before).`);

  if (topLeads.length === 0) {
    if (!silent) {
      await bot.sendMessage(annaChatId,
        `✅ Scan complete — no new high-probability leads found this run.\n\nScanned ${SEARCH_QUERIES.length} queries. Check back next scan.`
      );
    }
    return { leads: [], total: newCount };
  }

  // Send each lead as a Telegram message
  await bot.sendMessage(annaChatId,
    `🎯 *Twitter Scan Complete — ${topLeads.length} lead${topLeads.length !== 1 ? 's' : ''} found*\n\n` +
    `Showing top ${topLeads.length} by score (minimum score: ${MIN_SCORE})`,
    { parse_mode: 'Markdown' }
  );

  for (const { tweet, score } of topLeads) {
    const tierLine = score.total >= 12
      ? '🔥 HIGH-PROBABILITY BUYER'
      : score.total >= 8
      ? '⭐⭐ Strong lead'
      : '⭐ Warm lead';

    const signalLines = score.hits.slice(0, 3).map(h => `  • ${h.label}`).join('\n') || '  • General frustration signal';
    const followerLine = tweet.followers >= 1000
      ? `${(tweet.followers / 1000).toFixed(1)}k followers`
      : `${tweet.followers} followers`;

    const msg =
      `${tierLine} — Score: ${score.total}\n\n` +
      `👤 @${tweet.username} (${followerLine})\n` +
      `🔗 ${tweet.url}\n\n` +
      `💬 Their post:\n"${tweet.text.substring(0, 200)}${tweet.text.length > 200 ? '...' : ''}"\n\n` +
      `📊 Signals:\n${signalLines}\n\n` +
      `✉️ *Suggested opener:*\n${score.opener}`;

    // Split if too long for Telegram
    const chunks = msg.match(/[\s\S]{1,4000}/g) || [msg];
    for (const chunk of chunks) {
      await bot.sendMessage(annaChatId, chunk, { parse_mode: 'Markdown' }).catch(() =>
        bot.sendMessage(annaChatId, chunk) // fallback without markdown if parse fails
      );
      await new Promise(r => setTimeout(r, 200));
    }

    await new Promise(r => setTimeout(r, 500));
  }

  await bot.sendMessage(annaChatId,
    `────────────────────────\n` +
    `📋 *Next steps:*\n` +
    `• Reply to each tweet with the suggested opener\n` +
    `• Or DM them directly\n` +
    `• Use /admin score <their reply> to score follow-up messages\n\n` +
    `Next auto-scan: in ${process.env.TWITTER_SCAN_INTERVAL_HOURS || 3} hours`,
    { parse_mode: 'Markdown' }
  );

  return { leads: topLeads, total: newCount };
}

// ─── Scanner status ───────────────────────────────────────────────────────────

export function getScannerStatus() {
  return {
    configured: !!BEARER_TOKEN,
    minScore:   MIN_SCORE,
    queries:    SEARCH_QUERIES.length,
    seenCount:  seenTweetIds.size,
    interval:   parseInt(process.env.TWITTER_SCAN_INTERVAL_HOURS || '3'),
  };
}
