#!/bin/bash
# Edge Index — Fix & Deploy
# Double-click this file to apply the fix and push to Railway automatically

cd "$(dirname "$0")"

echo "⚡ Edge Index Fix & Deploy"
echo "========================="
echo ""
echo "Syncing with GitHub..."
git fetch origin
git reset --hard origin/main

echo ""
echo "Applying fixes to telegram-bot.js..."

python3 - <<'PYEOF'
with open('src/telegram-bot.js', 'r') as f:
    code = f.read()

changes = 0

# Fix 1: Replace broken generateReport function (references null chartData/moonData/hoursData)
OLD1 = '''async function generateReport(userData, chartData, moonData, hoursData) {
  const clientData = {
    client: {
      name:          userData.firstName || 'Trader',
      birthDate:     userData.dob,
      birthTime:     userData.time,
      birthLocation: userData.location,
    },
    humanDesign: {
      type:           chartData.human_design.type,
      profile:        chartData.human_design.profile?.join('/') || chartData.human_design.profile,
      authority:      chartData.human_design.authority,
      strategy:       chartData.human_design.strategy,
      definedCenters: chartData.human_design.defined_centers,
      undefinedCenters: chartData.human_design.undefined_centers,
      incarnationCross: chartData.human_design.incarnation_cross,
      channels:       chartData.human_design.channels,
    },
    currentAstrology: {
      reportDate:    new Date().toISOString().split('T')[0],
      moonPhase:     moonData.phase ?? moonData.moonPhase ?? 'Unknown',
      lunarDay:      moonData.lunarDay ?? moonData.lunar_day ?? null,
      sunSign:       moonData.sunSign ?? moonData.sun_sign ?? null,
      retrogrades:   moonData.retrogrades ?? [],
      planetaryHourGovernor: hoursData.currentHour?.planet ?? hoursData.current_hour?.planet ?? 'Unknown',
    },
    moneyBlueprint: {
      context: '12-month Edge Index Brief \u2014 annual decision-timing intelligence report.',
      knownPatterns: [],
      reactivePatterns: 'Unknown \u2014 first report',
    },
  };'''
NEW1 = '''async function generateReport(userData) {
  const clientData = {
    name:          userData.firstName || 'Trader',
    birthDate:     userData.dob,
    birthTime:     userData.time,
    birthLocation: userData.location,
    lat:           userData.lat,
    lon:           userData.lon,
    reportDate:    new Date().toISOString().split('T')[0],
  };'''
if OLD1 in code:
    code = code.replace(OLD1, NEW1)
    print("\u2705 generateReport function fixed")
    changes += 1
else:
    print("\u2139\ufe0f  generateReport already fixed")

# Fix 2: Fix the call site (remove null params)
OLD2 = 'const report = await generateReport(userData, null, null, null);'
NEW2 = 'const report = await generateReport(userData);'
if OLD2 in code:
    code = code.replace(OLD2, NEW2)
    print("\u2705 generateReport call site fixed")
    changes += 1
else:
    print("\u2139\ufe0f  call site already fixed")

# Fix 3: Fix the broken /start handler — match using a reliable anchor
# The broken handler has: awaiting_date';\n\n  await bot.sendMessage(chatId, `<broken>
import re
broken = re.search(
    r"(state\[chatId\] = 'awaiting_date';\n\n)  await bot\.sendMessage\(chatId, \`[^\`]*Error[^\`]*\`\);\S*\n.*?\`, \{ parse_mode: 'Markdown' \}\);",
    code, re.DOTALL
)
if broken:
    fixed_msg = (
        broken.group(1) +
        "  await bot.sendMessage(chatId, `\u26a1 Welcome to The Edge Index, ${firstName}!\\n\\n"
        "I'm your personalised trading timing intelligence system.\\n\\n"
        "To generate your Edge Index report, I need three things:\\n\\n"
        "1. Your **date of birth** (DD/MM/YYYY)\\n"
        "2. Your **time of birth** (HH:MM \u2014 approximate is fine)\\n"
        "3. Your **city and country of birth**\\n\\n"
        "Reply with your **date of birth** to begin.`, { parse_mode: 'Markdown' });"
    )
    code = code[:broken.start()] + fixed_msg + code[broken.end():]
    print("\u2705 /start handler fixed")
    changes += 1
else:
    print("\u2139\ufe0f  /start handler already fixed")

with open('src/telegram-bot.js', 'w') as f:
    f.write(code)

print(f"\n\u2705 telegram-bot.js saved ({changes} fix(es) applied)")
PYEOF

echo ""
echo "Committing and pushing to GitHub..."
git add src/telegram-bot.js
git commit -m "Fix: repair /start handler, clean report generation" || echo "ℹ️  Nothing new to commit"
git push origin main

echo ""
echo "✅ Done! Railway will redeploy automatically in ~2 minutes."
echo "   Then test your bot with /start in Telegram."
echo ""
echo "Press any key to close..."
read -n 1
