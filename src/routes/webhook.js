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

    // Whop fires membership.went_valid when payment succeeds
    if (
      action === 'membership.went_valid'  ||
      action === 'payment.succeeded'      ||
      action === 'membership.created'
    ) {
      // Email can be nested in different places depending on product type
      const email =
        event?.data?.user?.email              ||
        event?.data?.membership?.user?.email  ||
        event?.data?.email                    ||
        null;

      if (email) {
        addPaidEmail(email);
        console.log(`✅ Whop payment confirmed — registered: ${email}`);
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
