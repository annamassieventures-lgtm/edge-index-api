# Edge Index — Project Intelligence

## What this is
The Edge Index is a personalised trading timing intelligence platform.
- **B2C product**: $2,500 one-time payment → 17-section annual decision-timing report (Claude-generated, emailed via Resend)
- **B2B product**: Community licensing for trading communities ($2,500–$12,000/month)
- **Delivery**: Telegram bot collects birth data → Claude generates report → Resend emails HTML report to client

## Owner
Anna Massie — anna@annamassie.com.au

## Stack
- **Backend**: Node.js (ESM) + Express on Railway (GitHub auto-deploy)
- **Bot**: node-telegram-bot-api (polling mode)
- **AI**: Anthropic Claude claude-sonnet-4-6 (6000 max_tokens, 17-section system prompt)
- **Email**: Resend REST API (no npm package — uses native fetch)
- **Payment**: Whop ($2,500 one-time, webhook → registers paid email)
- **Domain**: edgeindex.io (Namecheap)
- **Data**: JSON files in /data/ (Railway ephemeral — resets on deploy)

## Critical constraint
**The VM/sandbox cannot push to GitHub.** All git pushes must go through Anna's Mac via `deploy-all.command` (double-click bash script). Never try to git push from the terminal here.

## File structure
```
edge-index-api/
├── src/
│   ├── index.js              — Express app, mounts all routes
│   ├── telegram-bot.js       — Bot v2 (email gate, payment check, report gen, outreach)
│   ├── shared/
│   │   └── paidUsers.js      — isPaidEmail / addPaidEmail / getAllPaidEmails
│   └── routes/
│       ├── webhook.js        — POST /webhook/whop (Whop payment events)
│       ├── chart.js          — POST /chart (Human Design birth chart)
│       ├── moon.js           — POST /moon (moon phase data)
│       └── hours.js          — POST /hours (planetary hours)
├── data/                     — Runtime JSON (ephemeral on Railway)
│   ├── users.json            — Telegram user profiles + birth data
│   ├── paid-emails.json      — Paid emails from Whop webhook
│   └── outreach-state.json   — 20 target communities + message stage tracking
├── deploy-all.command        — Mac double-click deploy script (git fetch + merge + push)
├── fix-and-deploy.command    — Old deploy script (deprecated, keep for reference)
├── outreach-targets.md       — 20 trading community targets with contact info
├── outreach-messages.md      — 3-message outreach sequence (copy-paste ready)
└── whop-listing.md           — Whop product listing copy
```

## Railway environment variables
| Variable | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `ANTHROPIC_API_KEY` | From console.anthropic.com |
| `RESEND_API_KEY` | From resend.com |
| `ANNA_CHAT_ID` | Anna's Telegram chat ID = 5838005991 |
| `WHOP_URL` | https://whop.com/checkout/plan_3ylvni6cL0ir1 |
| `PAID_EMAILS` | Comma-separated manual override (e.g. anna@test.com) |
| `WHOP_WEBHOOK_SECRET` | From Whop dashboard (optional, for signature verification) |

## Bot conversation flow
```
/start
  → asks for email
  → isPaidEmail() check
    → NOT paid: sends WHOP_URL, stops
    → PAID: continues
  → awaiting_date (DD/MM/YYYY)
  → awaiting_time (HH:MM)
  → awaiting_location (geocodes via Nominatim)
  → generateReport() via Claude API
  → sendReportEmail() via Resend to client email
  → confirms in Telegram
```

## Admin commands (Anna only — checks ANNA_CHAT_ID)
- `/admin` — menu
- `/admin paid <email>` — manually mark email as paid
- `/admin users` — list all registered users
- `/admin emails` — list all paid emails
- `/admin outreach` — show today's outreach briefing
- `/admin sent <target-id>` — mark outreach message as sent
- `/admin replied <target-id>` — mark target as replied

## Cron jobs
- **Monday 8am UTC**: weekly report re-delivery to all paid users
- **Daily 22:00 UTC** (= 8am AEST): outreach briefing sent to Anna's Telegram

## Outreach system
20 targets in `data/outreach-state.json`. Priority 5 to contact first:
1. Wolf of Trading (@WolfofTradingAdmin) — 90k Telegram
2. Bitcoin Bullets (@joe1322) — 106k Telegram
3. Fat Pig Signals (@dad10) — 46k Telegram
4. Jacob's Crypto Clan — 44.5k Discord
5. Rand Trading Group — 38.8k Discord/YouTube

Message timing: Message 1 → wait 3 days → Message 2 → wait 5 days → Message 3
Founding beta offer: $500/month for 3 months

## Whop webhook
URL to set in Whop dashboard: `https://YOUR-RAILWAY-URL/webhook/whop`
Listens for: `membership.went_valid`, `payment.succeeded`, `membership.created`
Extracts email from payload → calls addPaidEmail()

## Resend email
- From: `The Edge Index <reports@edgeindex.io>`
- Domain verified via Namecheap DNS (DKIM verified, SPF pending)
- Report sent as styled HTML (mdToHtml() function in telegram-bot.js)
- No npm package — uses native fetch() to Resend REST API

## Deploy process
1. Make changes to files in this folder
2. Anna double-clicks `deploy-all.command` on her Mac
3. Script does: git fetch → merge -X ours → git add -A → commit → push
4. Railway auto-deploys in ~2 minutes

## Known issues / history
- Previous deploy script (fix-and-deploy.command) used git reset --hard which wiped local changes
- deploy-all.command uses merge -X ours instead (local changes always win)
- Railway filesystem is ephemeral — data/paid-emails.json resets on redeploy
  → PAID_EMAILS env var is the persistent backup
- Report is ~4,500-5,500 words, takes ~60 seconds to generate
