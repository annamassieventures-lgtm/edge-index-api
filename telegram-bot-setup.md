# Edge Index — Telegram Bot Setup
# How to create the bot and get it running

---

## STEP 1 — Create the Telegram bot (5 minutes)

1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Choose a name: `The Edge Index`
4. Choose a username (must end in "bot"): `EdgeIndexBot` or `TheEdgeIndexBot`
5. BotFather will give you a **bot token** — looks like `7234567890:AAF_abc123XYZ`
6. Copy and save this token — you'll need it

**Set bot commands (so users see a menu):**
Send this to BotFather:
```
/setcommands
```
Then select your bot and paste:
```
start - Set up your Edge Index profile
report - Generate your weekly report now
mystats - View your stored birth data
help - Show available commands
```

---

## STEP 2 — Set environment variables

In your Railway project (where the API already runs):
1. Go to your Railway project → **Variables** tab
2. Add these three variables:

| Variable | Value |
|----------|-------|
| `TELEGRAM_BOT_TOKEN` | The token from BotFather |
| `RAILWAY_API_URL` | Your Railway API URL (e.g. `https://edge-index-api-production.up.railway.app`) |
| `ANTHROPIC_API_KEY` | Your Anthropic API key from console.anthropic.com |

---

## STEP 3 — Install new dependencies

In your project terminal (where your Railway code lives):
```bash
npm install
```

This will install `node-telegram-bot-api`, `node-cron`, and `@anthropic-ai/sdk` which have been added to package.json.

---

## STEP 4 — Deploy the bot

**Option A — Run separately alongside the API (recommended)**

The bot and the API are two separate processes. On Railway you can run both by creating a second service in the same project:

1. In Railway, click **+ New Service** → **GitHub Repo** (same repo)
2. Set the start command to: `node src/telegram-bot.js`
3. Add the same environment variables from Step 2
4. Deploy

**Option B — Run locally to test first**

```bash
# In your project folder
TELEGRAM_BOT_TOKEN=your_token RAILWAY_API_URL=https://your-api.up.railway.app ANTHROPIC_API_KEY=your_key npm run bot
```

---

## STEP 5 — Test the bot

1. Open Telegram and search for your bot username
2. Send `/start`
3. Follow the prompts to enter birth data
4. You should receive your first Edge Index report within ~30 seconds

---

## How the bot works

### User journey
1. New user sends `/start` → bot asks for date of birth
2. User provides DD/MM/YYYY → bot asks for time
3. User provides HH:MM → bot asks for city/country
4. Bot geocodes the location → saves all data → **immediately generates first report**
5. Every Monday at 8am UTC, all users with complete profiles receive a fresh report automatically
6. Users can request a report any time with `/report`

### Data storage
User birth data is saved to `data/users.json` in the project root. This is fine for hundreds of users. If you grow past ~10,000 users, migrate to a database (PostgreSQL on Railway works well).

### Report generation process
For each report, the bot:
1. Calls your Railway `/chart` endpoint → gets Human Design chart
2. Calls your Railway `/moon` endpoint → gets current moon phase
3. Calls your Railway `/hours` endpoint → gets planetary hour data
4. Sends all of this to Claude API with the Edge Index system prompt
5. Returns the formatted report to the user in Telegram

---

## Customising the welcome message

Edit `src/telegram-bot.js` → find the `/start` handler → update the welcome text to match your branding.

---

## WhatsApp alternative

If you want to also support WhatsApp in future (since many communities use it), the same bot logic can be ported to the Twilio API for WhatsApp. The core report generation code stays identical — only the messaging layer changes.

---

## Cost estimate

| Component | Monthly cost |
|-----------|-------------|
| Telegram bot | Free |
| Railway bot service | ~$5/month (second service) |
| Claude API (claude-opus-4-6) | ~$15 per 1,000 reports at 2,000 tokens output |
| Total for 100 users/week | ~$6–8/month in Claude API costs |

At 1,000 weekly subscribers: ~$60–80/month in Claude API costs against $97,000/month revenue. Margins are extraordinary.

---

*Bot code: `src/telegram-bot.js`*
*Dependencies: `node-telegram-bot-api`, `node-cron`, `@anthropic-ai/sdk`*
