import { Router } from 'express';
import { calculateHumanDesign } from 'natalengine';

const router = Router();

/**
 * POST /chart
 * Body: { date_of_birth, birth_time, birth_location, lat, lon, timezone }
 *   date_of_birth: "YYYY-MM-DD"
 *   birth_time:    "HH:MM" (24h) or decimal hours
 *   birth_location: string (display only)
 *   lat:           number
 *   lon:           number
 *   timezone:      number (UTC offset, e.g. 10 for AEST)
 */
router.post('/', (req, res) => {
  const { date_of_birth, birth_time, birth_location, lat, lon, timezone } = req.body;

  if (!date_of_birth || birth_time === undefined || timezone === undefined) {
    return res.status(400).json({ error: 'date_of_birth, birth_time, and timezone are required.' });
  }

  // Parse birth_time — accept "HH:MM" string or decimal number
  let timeDecimal;
  if (typeof birth_time === 'string' && birth_time.includes(':')) {
    const [h, m] = birth_time.split(':').map(Number);
    timeDecimal = h + m / 60;
  } else {
    timeDecimal = Number(birth_time);
  }

  if (isNaN(timeDecimal)) {
    return res.status(400).json({ error: 'birth_time must be "HH:MM" or a decimal number.' });
  }

  const tz = Number(timezone);

  try {
    const hd = calculateHumanDesign(date_of_birth, timeDecimal, tz);

    return res.json({
      input: {
        date_of_birth,
        birth_time,
        birth_location: birth_location ?? null,
        lat: lat ?? null,
        lon: lon ?? null,
        timezone: tz,
      },
      human_design: {
        type: hd.type?.name ?? hd.type,
        strategy: hd.type?.strategy ?? null,
        authority: hd.authority?.name ?? hd.authority,
        profile: hd.profile?.numbers ?? hd.profile,
        profile_name: hd.profile?.name ?? null,
        definition: hd.definition,
        incarnation_cross: hd.incarnationCross?.fullName ?? hd.incarnationCross?.name ?? null,
        cross_gates: hd.incarnationCross?.gates ?? null,
        defined_centers: hd.centers?.definedNames ?? [],
        undefined_centers: hd.centers?.undefinedNames ?? [],
        channels: hd.channels ?? [],
        gates: {
          personality: hd.gates?.personality ?? {},
          design: hd.gates?.design ?? {},
        },
      },
      positions: hd.positions ?? null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
