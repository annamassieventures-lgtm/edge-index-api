/**
 * Edge Index — Whop Payment Webhook
 *
 * Receives payment events from Whop and registers the buyer's email
 * as a paid user so the Telegram bot grants them access.
 *
 * Set this as your webhook URL in Whop dashboard:
 *   https://YOUR-RAILWAY-URL/webhook/whop
 *
 * Required env var:
 *   WHOP_WEBHOOK_SECRET — from Whop dashboard (optional but recommended)
 */

import { Router } from 'express';
import crypto     from 'crypto';
import { addPaidEmail } from '../shared/paidUsers.js';
import { addSubscriber } from '../shared/monitoringSubscribers.js';

// Whop plan ID → monitoring tier mapping
const MONITORING_PLANS = {
  'plan_BxrNEydk1OwxU': 'weekly',   // Weekly Edge $97/month
  'plan_MuLGo1pM0Y9KR': 'daily',    // Daily Edge  $197/month
  'plan_q4X3kcISZSjud': 'live',     // Live Edge   $397/month
};

const router = Router();

// POST /webhook/whop
router.post('/whop', async (req, res) => {
  try {
    // Optional: verify Whop HMAC signature
    const secret = process.env.WHOP_WEBHOOK_SECRET;
    if (secret) {
      const sig      = req.headers['whop-signature'] || '';
      const body     = JSON.stringify(req.body);
      const computed = 'sha256=' + crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');

      if (sig !== computed) {
        console.warn('Whop webhook: signature mismatch — rejected');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const event = req.body;
    const action = event?.action || 'unknown';
    console.log(`Whop webhook: ${action}`);

    // Handle both dot and underscore event name formats from Whop
    if (
      action === 'membership.went_valid'  ||
      action === 'membership_activated'   ||
      action === 'payment.succeeded'      ||
      action === 'payment_succeeded'      ||
      action === 'membership.created'     ||
      action === 'entry_approved'
    ) {
      // Email can be nested in different places depending on product type
      const email =
        event?.data?.user?.email              ||
        event?.data?.membership?.user?.email  ||
        event?.data?.email                    ||
        null;

      // Extract plan ID from payload (Whop nests it in different places)
      const planId =
        event?.data?.membership?.plan_id  ||
        event?.data?.plan_id              ||
        event?.data?.product?.id          ||
        event?.data?.membership?.product_id ||
        null;

      console.log(`Whop webhook: plan_id=${planId}, email=${email}`);

      if (email) {
        const monitoringTier = planId ? MONITORING_PLANS[planId] : null;

        if (monitoringTier) {
          // Monitoring subscription — add to subscriber registry
          addSubscriber({ email, tier: monitoringTier });
          addPaidEmail(email); // also grant bot access
          console.log(`✅ Monitoring subscription — ${monitoringTier} tier registered: ${email}`);
        } else {
          // Report purchase (or unknown plan) — grant bot access only
          addPaidEmail(email);
          console.log(`✅ Report payment confirmed — registered: ${email}`);
        }
      } else {
        console.warn('Whop webhook: payment event received but no email found in payload', JSON.stringify(event?.data));
      }
    }

    res.json({ ok: true });

  } catch (err) {
    console.error('Webhook error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
