const nyFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export function nyParts(tsMs) {
  const parts = Object.fromEntries(
    nyFormatter.formatToParts(tsMs).map(({ type, value }) => [type, value]),
  );
  return {
    y: Number(parts.year),
    mo: Number(parts.month),
    d: Number(parts.day),
    h: Number(parts.hour),
    mi: Number(parts.minute),
  };
}

export function nyMinuteOfDay(tsMs) {
  const { h, mi } = nyParts(tsMs);
  return h * 60 + mi;
}

export function nyWallToUtc(y, mo, d, h, mi) {
  const wallUtc = Date.UTC(y, mo - 1, d, h, mi);
  let guess = wallUtc;
  // Recheck the offset in case correction crosses a DST transition.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = nyParts(guess);
    const correction = wallUtc - Date.UTC(
      parts.y, parts.mo - 1, parts.d, parts.h, parts.mi,
    );
    if (correction === 0) return guess;
    guess += correction;
  }
  throw new RangeError('New York wall time does not exist');
}
