import express from 'express';
import cors    from 'cors';

import chartRouter   from './routes/chart.js';
import moonRouter    from './routes/moon.js';
import hoursRouter   from './routes/hours.js';
import webhookRouter from './routes/webhook.js';
import './telegram-bot.js';

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({
    name: 'Edge Index API',
    version: '2.0.0',
    endpoints: {
      'POST /chart':        'Full Human Design birth chart calculation',
      'POST /moon':         'Moon phase, window colour, Mercury retrograde status',
      'POST /hours':        'Planetary hours, current hour, next Green window',
      'POST /webhook/whop': 'Whop payment webhook — registers paid emails',
    },
  });
});

app.use('/chart',   chartRouter);
app.use('/moon',    moonRouter);
app.use('/hours',   hoursRouter);
app.use('/webhook', webhookRouter);

// Temporary debug endpoint — remove after testing
app.get('/debug', (req, res) => {
  const token = req.query.token;
  if (token !== process.env.ANNA_CHAT_ID) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const paidEmails = (process.env.PAID_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
  res.json({
    ANNA_CHAT_ID: process.env.ANNA_CHAT_ID || '(not set)',
    PAID_EMAILS_RAW: process.env.PAID_EMAILS || '(not set)',
    PAID_EMAILS_PARSED: paidEmails,
    RESEND_API_KEY: process.env.RESEND_API_KEY ? '✓ set' : '(not set)',
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ? '✓ set' : '(not set)',
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? '✓ set' : '(not set)',
  });
});

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => {
  console.log(`Edge Index API running on port ${PORT}`);
});
