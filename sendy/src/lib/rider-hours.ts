/**
 * When riders actually work.
 *
 * One place, so the forms, the tracking screen and any copy that mentions it
 * cannot drift apart. Changing the hours is a one-line edit here.
 *
 * Computed in Lagos time rather than device time. Every rider is in Nigeria;
 * a customer ordering from abroad for family back home is the case where the
 * two differ, and it is the rider's clock that decides whether anyone is on
 * the road.
 */
export const RIDER_HOURS = {
  /** First hour riders are on, 24h. */
  open: 8,
  /** Hour they stop, 24h — exclusive, so 22 means the last job is before 10pm. */
  close: 22,
  timeZone: 'Africa/Lagos',
} as const;

/** "8am – 10pm" */
export function riderHoursLabel(): string {
  return `${to12h(RIDER_HOURS.open)} – ${to12h(RIDER_HOURS.close)}`;
}

/** The current hour in Lagos, 0–23. Falls back to device time if Intl is unavailable. */
export function lagosHour(now: Date = new Date()): number {
  try {
    const h = new Intl.DateTimeFormat('en-GB', {
      timeZone: RIDER_HOURS.timeZone,
      hour: 'numeric',
      hour12: false,
    }).format(now);
    // "24" at midnight on some engines; normalise.
    return Number(h) % 24;
  } catch {
    return now.getHours();
  }
}

export function ridersAvailableNow(now: Date = new Date()): boolean {
  const h = lagosHour(now);
  return h >= RIDER_HOURS.open && h < RIDER_HOURS.close;
}

/** "Riders are back at 8am" — for the out-of-hours notice. */
export function nextOpeningLabel(): string {
  return to12h(RIDER_HOURS.open);
}

function to12h(hour24: number): string {
  const h = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${h}${hour24 < 12 ? 'am' : 'pm'}`;
}
