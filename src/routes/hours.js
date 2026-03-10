import { Router } from 'express';
import * as Astronomy from 'astronomy-engine';

const router = Router();

/**
 * Chaldean order of planets (ancient sequence used for planetary hours)
 * Saturn → Jupiter → Mars → Sun → Venus → Mercury → Moon → repeat
 */
const CHALDEAN = ['Saturn', 'Jupiter', 'Mars', 'Sun', 'Venus', 'Mercury', 'Moon'];

/**
 * Day rulers by weekday (0=Sunday)
 * The first hour of the day is ruled by that day's planet.
 */
const DAY_RULERS = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn'];

/**
 * Window colour per planet — performance/energy lens for The Edge Index
 */
const PLANET_COLOURS = {
  Sun:     'Green',   // vitality, confidence, leadership
  Jupiter: 'Green',   // expansion, abundance, opportunity
  Mars:    'Green',   // drive, competition, physical energy
  Mercury: 'Green',   // communication, commerce, strategy
  Venus:   'Amber',   // pleasure, attraction — enjoyable but not peak output
  Moon:    'Amber',   // emotion, intuition — creative but variable
  Saturn:  'Red',     // restriction, discipline overhead — avoid major launches
};

const PLANET_RATIONALE = {
  Sun:     'Solar hour: peak confidence and vitality. Ideal for leadership, deals, and visibility.',
  Jupiter: 'Jupiter hour: expansion and fortune. Green-light for bold moves and abundance work.',
  Mars:    'Mars hour: raw drive and physical energy. Optimal for training, competition, and initiation.',
  Mercury: 'Mercury hour: sharp mind and communication. Best for negotiations, writing, and strategy.',
  Venus:   'Venus hour: social and sensory. Good for connection and creativity; lower for hard output.',
  Moon:    'Moon hour: intuitive and emotional. Useful for reflection; variable for high-demand performance.',
  Saturn:  'Saturn hour: slow and restrictive. Avoid major launches; good only for long-term discipline work.',
};

/**
 * Get sunrise and sunset for a given date and location using astronomy-engine
 */
function getSunriseSunset(date, lat, lon) {
  const observer = new Astronomy.Observer(lat, lon, 0);
  const noon = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12));

  const sunrise = Astronomy.SearchRiseSet('Sun', observer, +1, noon, 1);
  const sunset  = Astronomy.SearchRiseSet('Sun', observer, -1, noon, 1);

  return {
    sunrise: sunrise ? sunrise.date : null,
    sunset:  sunset  ? sunset.date  : null,
  };
}

/**
 * Calculate the sequence of planetary hours for a given day.
 * Returns array of { planet, start, end, colour } objects.
 */
function calculatePlanetaryHours(date, lat, lon) {
  const dayOfWeek = date.getUTCDay(); // 0=Sun
  const dayRuler  = DAY_RULERS[dayOfWeek];
  const rulerIndex = CHALDEAN.indexOf(dayRuler);

  const { sunrise, sunset } = getSunriseSunset(date, lat, lon);

  if (!sunrise || !sunset) {
    throw new Error('Could not compute sunrise/sunset for the given location and date.');
  }

  // Next day's sunrise for night hours
  const nextDay = new Date(date.getTime() + 24 * 3600 * 1000);
  const { sunrise: nextSunrise } = getSunriseSunset(nextDay, lat, lon);

  const dayMs   = sunset.getTime()      - sunrise.getTime();
  const nightMs = nextSunrise.getTime() - sunset.getTime();

  const dayHourMs   = dayMs   / 12;
  const nightHourMs = nightMs / 12;

  const hours = [];

  // 12 day hours
  for (let i = 0; i < 12; i++) {
    const planet = CHALDEAN[(rulerIndex + i) % 7];
    const start  = new Date(sunrise.getTime() + i * dayHourMs);
    const end    = new Date(sunrise.getTime() + (i + 1) * dayHourMs);
    hours.push({ hour: i + 1, period: 'day', planet, start, end, colour: PLANET_COLOURS[planet] });
  }

  // 12 night hours
  for (let i = 0; i < 12; i++) {
    const planet = CHALDEAN[(rulerIndex + 12 + i) % 7];
    const start  = new Date(sunset.getTime() + i * nightHourMs);
    const end    = new Date(sunset.getTime() + (i + 1) * nightHourMs);
    hours.push({ hour: i + 1, period: 'night', planet, start, end, colour: PLANET_COLOURS[planet] });
  }

  return { hours, sunrise, sunset, nextSunrise, dayRuler };
}

/**
 * POST /hours
 * Body: { current_date, lat, lon, timezone }
 *   current_date: "YYYY-MM-DD"
 *   lat, lon:     numbers
 *   timezone:     number (UTC offset)
 */
router.post('/', (req, res) => {
  const { current_date, lat, lon, timezone } = req.body;

  if (!current_date || lat === undefined || lon === undefined || timezone === undefined) {
    return res.status(400).json({ error: 'current_date, lat, lon, and timezone are required.' });
  }

  const tz   = Number(timezone);
  const latN = Number(lat);
  const lonN = Number(lon);

  // Build UTC date for local midnight
  const localMidnight = new Date(`${current_date}T00:00:00`);
  const utcDate = new Date(localMidnight.getTime() - tz * 3600 * 1000);

  try {
    const { hours, sunrise, sunset, nextSunrise, dayRuler } = calculatePlanetaryHours(utcDate, latN, lonN);

    const now = new Date();

    // Find the current planetary hour
    const current = hours.find(h => now >= h.start && now < h.end) ?? null;

    // Find the next Green window after now
    const nextGreen = hours.find(h => h.colour === 'Green' && h.start > now) ?? null;

    // Format a single hour entry for the response
    const formatHour = h => ({
      hour:    h.hour,
      period:  h.period,
      planet:  h.planet,
      start:   toLocalISO(h.start, tz),
      end:     toLocalISO(h.end, tz),
      colour:  h.colour,
      rationale: PLANET_RATIONALE[h.planet],
    });

    return res.json({
      input: {
        current_date,
        lat: latN,
        lon: lonN,
        timezone: tz,
      },
      day_ruler: dayRuler,
      sunrise:      toLocalISO(sunrise, tz),
      sunset:       toLocalISO(sunset, tz),
      next_sunrise: toLocalISO(nextSunrise, tz),
      current_hour: current ? formatHour(current) : null,
      next_green_window: nextGreen ? formatHour(nextGreen) : null,
      all_hours: hours.map(formatHour),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Convert a UTC Date to a local ISO-ish string adjusted for timezone offset.
 */
function toLocalISO(date, tzOffset) {
  if (!date) return null;
  const local = new Date(date.getTime() + tzOffset * 3600 * 1000);
  return local.toISOString().replace('Z', '').replace('T', ' ').substring(0, 16);
}

export default router;
