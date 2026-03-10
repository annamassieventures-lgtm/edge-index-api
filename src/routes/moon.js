import { Router } from 'express';
import * as Astronomy from 'astronomy-engine';

const router = Router();

/**
 * Determine moon phase name and 0-360 angle from Astronomy.MoonPhase()
 * Returns angle 0=New, 90=First Quarter, 180=Full, 270=Last Quarter
 */
function getMoonPhaseName(angle) {
  if (angle < 22.5 || angle >= 337.5) return 'New Moon';
  if (angle < 67.5)  return 'Waxing Crescent';
  if (angle < 112.5) return 'First Quarter';
  if (angle < 157.5) return 'Waxing Gibbous';
  if (angle < 202.5) return 'Full Moon';
  if (angle < 247.5) return 'Waning Gibbous';
  if (angle < 292.5) return 'Last Quarter';
  return 'Waning Crescent';
}

/**
 * Window colour logic — performance/energy lens:
 * Green  = Waxing phases (building energy, optimal for action & output)
 * Amber  = Full Moon ±30° (peak but volatile; high intensity, manage emotions)
 * Red    = Waning / New Moon (rest, integrate, reduce high-demand work)
 */
function getMoonWindowColour(angle) {
  if (angle >= 30 && angle < 150) return 'Green';
  if (angle >= 150 && angle < 210) return 'Amber';
  return 'Red';
}

/**
 * Check if Mercury is currently retrograde by comparing its ecliptic
 * longitude 24 hours apart.
 */
function isMercuryRetrograde(date) {
  const d1 = new Date(date.getTime() - 12 * 3600 * 1000);
  const d2 = new Date(date.getTime() + 12 * 3600 * 1000);

  const ecl1 = Astronomy.Ecliptic(Astronomy.GeoVector('Mercury', d1, true)).elon;
  const ecl2 = Astronomy.Ecliptic(Astronomy.GeoVector('Mercury', d2, true)).elon;

  // Account for wraparound near 0/360
  let delta = ecl2 - ecl1;
  if (delta > 180)  delta -= 360;
  if (delta < -180) delta += 360;

  return delta < 0;
}

/**
 * Find the next occurrence of a specific moon phase.
 * targetLon: 0=New Moon, 180=Full Moon (ecliptic longitude difference)
 */
function findNextMoonPhase(date, targetLon) {
  // SearchMoonPhase(targetLon, startDate, limitDays)
  // targetLon is 0-360: 0=New, 90=First Quarter, 180=Full, 270=Last Quarter
  const result = Astronomy.SearchMoonPhase(targetLon, date, 35);
  return result ? result.date : null;
}

/**
 * POST /moon
 * Body: { current_date, lat, lon, timezone }
 *   current_date: "YYYY-MM-DD" or ISO string
 *   lat, lon:     numbers (location for contextual use; moon phase is geocentric)
 *   timezone:     number (UTC offset)
 */
router.post('/', (req, res) => {
  const { current_date, lat, lon, timezone } = req.body;

  if (!current_date || timezone === undefined) {
    return res.status(400).json({ error: 'current_date and timezone are required.' });
  }

  // Build a UTC Date for local midnight at the given timezone
  const tz = Number(timezone);
  const localMidnight = new Date(`${current_date}T00:00:00`);
  // Shift to UTC equivalent of local midnight
  const utcDate = new Date(localMidnight.getTime() - tz * 3600 * 1000);

  try {
    const phaseAngle = Astronomy.MoonPhase(utcDate);
    const phaseName  = getMoonPhaseName(phaseAngle);
    const windowColour = getMoonWindowColour(phaseAngle);

    const nextNewMoon  = findNextMoonPhase(utcDate, 0);
    const nextFullMoon = findNextMoonPhase(utcDate, 180);

    const retrograde = isMercuryRetrograde(utcDate);

    // Also surface a brief mercury status description
    let mercuryStatus;
    if (retrograde) {
      mercuryStatus = 'Mercury is retrograde — review contracts, avoid major launches, expect communication delays.';
    } else {
      mercuryStatus = 'Mercury is direct — clear for communication, signing agreements, and new initiatives.';
    }

    return res.json({
      input: {
        current_date,
        lat: lat ?? null,
        lon: lon ?? null,
        timezone: tz,
      },
      moon: {
        phase_angle: Math.round(phaseAngle * 100) / 100,
        phase_name: phaseName,
        window_colour: windowColour,
        window_rationale: windowColourRationale(windowColour, phaseName),
        next_new_moon:  nextNewMoon  ? nextNewMoon.toISOString().split('T')[0] : null,
        next_full_moon: nextFullMoon ? nextFullMoon.toISOString().split('T')[0] : null,
      },
      mercury: {
        retrograde,
        status: mercuryStatus,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

function windowColourRationale(colour, phase) {
  const map = {
    Green: `${phase}: Building lunar energy supports high-output work, training, and bold decisions.`,
    Amber: `${phase}: Peak lunar intensity — maintain performance but manage emotional volatility.`,
    Red:   `${phase}: Declining or resetting lunar energy — prioritise recovery, reflection, and consolidation.`,
  };
  return map[colour] ?? '';
}

export default router;
