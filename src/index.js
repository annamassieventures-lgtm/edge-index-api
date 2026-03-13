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

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => {
  console.log(`Edge Index API running on port ${PORT}`);
});
