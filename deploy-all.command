#!/bin/bash
# Edge Index — Deploy All
# Double-click this file to commit and push all new code to GitHub → Railway

cd "$(dirname "$0")"

echo "⚡ Edge Index — Deploy All"
echo "=================================="
echo ""

echo "Fetching GitHub state..."
git fetch origin

# Check if remote is ahead (GitHub has commits we don't have locally)
BEHIND=$(git rev-list HEAD..origin/main --count 2>/dev/null || echo "0")
if [ "$BEHIND" -gt "0" ]; then
  echo "  Remote has $BEHIND new commit(s). Merging (keeping our local changes)..."
  git merge origin/main --no-edit -X ours 2>&1 || {
    echo "  Merge failed — falling back to rebase..."
    git rebase origin/main
  }
else
  echo "  Up to date with remote ✓"
fi

echo ""
echo "Staging all changes..."
git add -A

# Show what's being committed
CHANGED=$(git diff --cached --name-only)
if [ -z "$CHANGED" ]; then
  echo "ℹ️  Nothing new to commit — already up to date."
  echo ""
  echo "Press any key to close..."
  read -n 1
  exit 0
fi

echo "Files to commit:"
echo "$CHANGED" | sed 's/^/  + /'
echo ""

echo "Committing..."
git commit -m "feat: payment gate, Resend email delivery, Whop webhook, outreach automation

- src/shared/paidUsers.js: isPaidEmail / addPaidEmail / getAllPaidEmails
- src/routes/webhook.js: POST /webhook/whop — Whop payment event handler
- src/index.js: mount webhook route, version bump to 2.0
- src/telegram-bot.js v2: email verification step, payment gate,
  Resend HTML email delivery, outreach state tracker, daily 8am AEST
  briefing cron to Anna, admin commands (/admin paid/users/emails/outreach/sent/replied)
- /myid command for all users to get their chat ID"

echo ""
echo "Pushing to GitHub..."
git push origin main

echo ""
echo "✅ Done! Railway will redeploy automatically in ~2 minutes."
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "NEXT STEPS — set these in Railway dashboard → Variables:"
echo ""
echo "  RESEND_API_KEY        → from resend.com (create free account)"
echo "  ANNA_CHAT_ID          → send /myid to your bot to get it"
echo "  WHOP_URL              → your Whop checkout link"
echo "  WHOP_WEBHOOK_SECRET   → from Whop dashboard → Webhooks"
echo "  PAID_EMAILS           → comma-separated emails (manual override)"
echo ""
echo "WHOP WEBHOOK URL to paste in Whop dashboard:"
echo "  https://YOUR-RAILWAY-URL/webhook/whop"
echo ""
echo "RESEND SETUP:"
echo "  1. Create account at resend.com"
echo "  2. Add domain edgeindex.io (or use onboarding@resend.dev for testing)"
echo "  3. Copy API key → RESEND_API_KEY in Railway"
echo ""
echo "TEST the bot:"
echo "  1. Set PAID_EMAILS=your@email.com in Railway"
echo "  2. Send /start to your bot"
echo "  3. Enter your@email.com when prompted"
echo "  4. Enter birth data and confirm report arrives in your inbox"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Press any key to close..."
read -n 1
