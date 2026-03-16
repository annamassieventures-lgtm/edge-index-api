/**
 * Edge Index — Lead Scoring Engine
 * Shared module used by both the Telegram bot (/admin score)
 * and the Twitter scanner.
 */

const LEAD_SIGNALS = [
  { pattern: /gave.{0,10}(it|them|back)|given.{0,10}back/i,           score: 4, label: 'Drawdown / gave back gains' },
  { pattern: /rough.{0,10}(week|month|trade)|bad.{0,5}(week|month)/i,  score: 4, label: 'Rough period' },
  { pattern: /bad.{0,10}execut|poor.{0,10}execut/i,                    score: 3, label: 'Execution problem' },
  { pattern: /emotional.{0,10}trad|trading.{0,10}emotion/i,            score: 3, label: 'Emotional trading' },
  { pattern: /drawdown|underwater|blew.{0,5}up|blown.{0,5}up/i,        score: 4, label: 'Drawdown language' },
  { pattern: /wrong.{0,10}time|bad.{0,10}(entry|timing)|timed.{0,10}(it|badly)/i, score: 4, label: 'Wrong timing' },
  { pattern: /volatility.{0,15}(destroyed|killed|hurt|wrecked)/i,      score: 5, label: 'Volatility impact' },
  { pattern: /should.{0,10}waited|waited.{0,10}too.{0,5}long|held.{0,10}too.{0,5}long/i, score: 4, label: 'Timing regret' },
  { pattern: /knew.{0,15}(the trade|it was|should)/i,                  score: 5, label: 'Knew better / hindsight' },
  { pattern: /trading.{0,10}psycholog|psych.{0,10}trade/i,             score: 3, label: 'Psychology discussion' },
  { pattern: /discipline.{0,10}(problem|issue|struggle)|lack.{0,5}discipline/i, score: 3, label: 'Discipline problem' },
  { pattern: /overtrading|over.{0,5}trad/i,                            score: 3, label: 'Overtrading' },
  { pattern: /fomo|fear.{0,10}missing|chased.{0,10}(the|a).{0,10}trade/i, score: 3, label: 'FOMO / chasing' },
  { pattern: /revenge.{0,5}trad/i,                                     score: 4, label: 'Revenge trading' },
  { pattern: /system.{0,15}(works|worked).{0,20}(sometimes|then|but)|strategy.{0,15}stop.{0,5}work/i, score: 5, label: 'Inconsistent system results' },
  { pattern: /profitable.{0,20}(month|week).{0,20}(then|but|and)/i,   score: 5, label: 'Profit then loss cycle' },
  { pattern: /inconsistent|not.{0,5}consistent/i,                      score: 4, label: 'Inconsistency' },
  { pattern: /market.{0,10}regime|regime.{0,10}change/i,               score: 6, label: 'Market regime awareness' },
  { pattern: /volatility.{0,10}cycle|cycle.{0,10}(aware|sensitiv)/i,   score: 6, label: 'Volatility cycle language' },
  { pattern: /macro.{0,10}cycle|macro.{0,10}shift/i,                   score: 6, label: 'Macro cycle language' },
  { pattern: /timing.{0,15}(market|cycle|entry|exit)/i,                score: 5, label: 'Timing cycle language' },
  { pattern: /just.{0,10}started|new.{0,10}trad|beginner|learning.{0,10}trad/i, score: 1, label: 'Beginner' },
  { pattern: /what.{0,10}(is|are).{0,10}(candle|indicator|rsi|macd)/i, score: 1, label: 'Basic questions' },
];

export function scoreLeadMessage(text) {
  const hits  = [];
  let total   = 0;

  for (const sig of LEAD_SIGNALS) {
    if (sig.pattern.test(text)) {
      hits.push({ label: sig.label, score: sig.score });
      total += sig.score;
    }
  }

  let tier, emoji;
  if (total >= 12)     { tier = 'HIGH-PROBABILITY BUYER';  emoji = '🔥'; }
  else if (total >= 8) { tier = 'Strong lead';             emoji = '⭐⭐'; }
  else if (total >= 5) { tier = 'Warm lead';               emoji = '⭐'; }
  else if (total >= 2) { tier = 'Awareness only';          emoji = '👀'; }
  else                 { tier = 'Low signal';              emoji = '⬜'; }

  const hasSystem     = hits.some(h => h.label.includes('Inconsistent system') || h.label.includes('Profit then loss'));
  const hasDrawdown   = hits.some(h => h.label.includes('Drawdown') || h.label.includes('gave back'));
  const hasCycle      = hits.some(h => h.label.includes('cycle') || h.label.includes('regime'));
  const hasPsychology = hits.some(h => h.label.includes('Psychology') || h.label.includes('Emotional'));

  let opener;
  if (hasSystem) {
    opener = `Have you ever noticed how the same strategy can work perfectly for weeks — and then suddenly stop working, without anything in the market obviously changing?\n\nI've been researching what's actually behind that pattern. It's not random.`;
  } else if (hasDrawdown) {
    opener = `That drawdown pattern you described — profitable run, then a rough period that gives it back — that's one of the most common things I hear from serious traders.\n\nInterestingly, there's a timing component to it that most people don't look at. Are you tracking when in your own cycle those periods hit?`;
  } else if (hasCycle) {
    opener = `Your read on cycles is interesting — most traders don't think at that level. Have you ever looked at your own decision timing as a cycle? Not the market's cycle — yours specifically.`;
  } else if (hasPsychology) {
    opener = `Emotional trading is almost always a timing problem in disguise. The emotion isn't random — it tends to hit harder in specific windows. Are you tracking when yours tend to spike?`;
  } else {
    opener = `Have you ever noticed how the same trade setup produces very different results depending on when you place it — even with identical analysis?`;
  }

  const bridge = `\n\nThat's actually what The Edge Index maps — your personal decision timing architecture across the next 12 months. Which windows are highest conviction. Which periods carry the most behavioural risk.\n\nWorth knowing about?`;

  return { total, tier, emoji, hits, opener, bridge };
}
