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
TIMESTAMP=$(date +"%Y-%m-%d %H:%M")
git commit -m "deploy: ${TIMESTAMP}

Changed files:
$(git diff --cached --name-only | sed 's/^/  - /')"

echo ""
echo "Pushing to GitHub..."
git push origin main

echo ""
echo "✅ Done! Railway will redeploy automatically in ~2 minutes."
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "AFTER DEPLOY — run these commands in your Telegram bot:"
echo ""
echo "  /admin ai status          — check AI affiliate pipeline"
echo "  /admin fem status         — check trading community pipeline"
echo "  /admin fem batch 1        — fire Tier 1 cold emails (82 targets)"
echo "  /admin fem batch 2        — fire Tier 2 cold emails (100 targets)"
echo "  /admin fem batch 3        — fire Tier 3 cold emails (60 targets)"
echo "  /admin ai batch 1         — fire AI Tier 1 emails (confirmed emails only)"
echo ""
echo "⚠️  DATA WARNING:"
echo "  Once outreach emails are sent, DO NOT redeploy until the sequence"
echo "  completes (~3 weeks). Railway filesystem is ephemeral — a redeploy"
echo "  resets outreach stage tracking (who has been emailed + when)."
echo "  The system will auto-handle follow-ups and pitches via daily crons."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Press any key to close..."
read -n 1
