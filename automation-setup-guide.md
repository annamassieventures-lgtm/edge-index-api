# Edge Index — Automation Setup Guide
# Whop → Zapier → MailerLite
# Estimated time: 45 minutes. No code required.

---

## What this does

When someone signs up on your Whop listing, this automation:
1. Captures their name and email
2. Adds them to MailerLite as a new subscriber
3. Automatically sends your 4-email onboarding sequence (welcome → day 3 → day 7 → day 14)
4. Tags them based on which product they bought (community license vs individual tier)

You set it up once. It runs forever.

---

## STEP 1 — Create your MailerLite account (5 minutes)

1. Go to **mailerlite.com** → click "Sign up free"
2. Enter your name, email, company name (use "The Edge Index")
3. Verify your email
4. Free plan covers up to 1,000 subscribers and 12,000 emails/month — plenty to start

**Inside MailerLite, create your groups (these act as tags):**
1. Click **Subscribers** in the left menu → **Groups** → **Create group**
2. Create these three groups:
   - `Community License` (for Whop B2B buyers)
   - `Individual Subscriber` (for Whop B2C buyers)
   - `No Setup Completed` (for the Day 3 follow-up sequence)

---

## STEP 2 — Build your email sequences in MailerLite (20 minutes)

### Create the automation

1. Click **Automations** in the left menu → **Create automation**
2. Name it: `Edge Index — New Signup Sequence`
3. Set the trigger: **When subscriber joins a group** → select `Community License` (you'll duplicate this for individual subscribers)

### Add Email 1 (Immediate)

1. Click **+ Add step** → **Email**
2. Subject: `Your Edge Index access is being set up`
3. Paste the body from your `email-sequence.md` file (Email 1 content)
4. Set delay: **immediately (0 hours after trigger)**

### Add Email 2 (Day 3)

1. Click **+ Add step** → **Delay** → set to **3 days**
2. Click **+ Add step** → **Email**
3. Subject: `Quick question about your community`
4. Paste Email 2 body from `email-sequence.md`

### Add Email 3 (Day 7)

1. Click **+ Add step** → **Delay** → set to **4 more days** (total 7 days from signup)
2. Click **+ Add step** → **Email**
3. Subject: `What your members will actually see`
4. Paste Email 3 body from `email-sequence.md`

### Add Email 4 (Day 14)

1. Click **+ Add step** → **Delay** → set to **7 more days** (total 14 days from signup)
2. Click **+ Add step** → **Email**
3. Subject: `Founding partner pricing closes [DATE]` — replace [DATE] with 30 days from today
4. Paste Email 4 body from `email-sequence.md`

5. Click **Save & close** → toggle the automation **ON**

**Duplicate the automation** for individual subscribers: go back to Automations, click the three dots on your sequence → **Duplicate** → change the trigger group to `Individual Subscriber`.

---

## STEP 3 — Get your MailerLite API key (2 minutes)

1. In MailerLite, click your profile icon (bottom left) → **Integrations**
2. Click **API** → **Generate new token**
3. Name it `Zapier`
4. Copy the API key — you'll need it in Step 5

---

## STEP 4 — Create your Zapier account (2 minutes)

1. Go to **zapier.com** → "Sign up free"
2. Free plan gives you 100 tasks/month — enough for early signups
3. Verify your email

---

## STEP 5 — Build the Zap: Whop → MailerLite (15 minutes)

### Create the Zap

1. Click **+ Create** → **Zap**
2. Name it: `Whop New Sale → MailerLite`

### Set up the Trigger (Whop)

1. Search for **Whop** in the trigger search box
2. Select **Whop** → Trigger event: **New Sale** (or **New Membership** — use whichever appears)
3. Click **Sign in to Whop** → you'll be redirected to authorise Zapier to access your Whop account
4. Log in to your Whop seller account and click Allow
5. Back in Zapier, click **Test trigger** — Zapier will pull a sample sale (if you don't have one yet, it may say no data — that's fine, continue anyway)

### Set up the Action (MailerLite — Add Subscriber)

1. Click **+** to add an action
2. Search for **MailerLite** → select it
3. Action event: **Create or Update Subscriber**
4. Click **Sign in to MailerLite** → enter your API key from Step 3
5. Map the fields:
   - **Email**: map to the email field from the Whop trigger (e.g., `Customer Email`)
   - **Name**: map to the name field from the Whop trigger (e.g., `Customer Name`)
   - **Groups**: type `Community License` (or `Individual Subscriber` — see note below)
6. Click **Test action** → check MailerLite to confirm the subscriber appeared

### Handle different products (B2B vs B2C)

If you have both a community licensing product and an individual subscription product on Whop, add a **Filter** step between the trigger and action:

After the trigger, click **+** → **Filter** → set condition:
- Field: `Product Name` (from Whop trigger)
- Condition: `Contains`
- Value: `Community License`

This Zap then only fires for B2B purchases. Duplicate the Zap and change the filter to `Individual` and the group to `Individual Subscriber` for B2C purchases.

### Turn on the Zap

1. Click **Publish** (top right)
2. Toggle it ON

---

## STEP 6 — Test the full flow (5 minutes)

1. Do a test purchase on your own Whop listing (you can set price to $0 for testing, then change back)
2. Wait 2–3 minutes
3. Check MailerLite Subscribers — you should see yourself added with the correct group tag
4. Check that the automation has fired and Email 1 has been sent to you

If it works, you're done. All future Whop signups will flow automatically into MailerLite and receive the full onboarding sequence.

---

## OPTIONAL: Add a Slack or Gmail notification when a new sale comes in

Add a second action to your Zap:
1. After the MailerLite action, click **+**
2. Search for **Gmail** or **Slack**
3. Gmail action: **Send Email to Yourself** with subject `New Edge Index Sale 💰` and the customer name and product in the body
4. This way you know the moment someone buys — without checking Whop constantly

---

## Summary of what you've built

| Platform | What it does |
|----------|-------------|
| **Whop** | Sells your product, takes payment |
| **Zapier** | Detects the sale, passes data to MailerLite |
| **MailerLite** | Stores the subscriber, fires the 4-email onboarding sequence automatically |

Total monthly cost at launch: **$0** (all free tiers).
When you exceed 1,000 subscribers: MailerLite $9/month. Zapier paid: $19.99/month.

---

## Troubleshooting

**Subscriber not appearing in MailerLite:**
- Check the Zap history in Zapier (left menu → Zap History) — look for errors
- Most common: field mapping issue — make sure the Email field is correctly mapped to the Whop email output

**Automation not sending emails:**
- Make sure the automation is toggled ON in MailerLite
- Check the trigger is set to the correct group (must exactly match the group name you assigned in the Zap)

**Whop not connecting in Zapier:**
- Make sure you're logged in to Whop in the same browser before authorising
- Try disconnecting and reconnecting the Whop account in Zapier

---

*Last updated: March 2026*
