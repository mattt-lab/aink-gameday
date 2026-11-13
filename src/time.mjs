// Local-time helpers. Everything goes through Intl with an explicit IANA time zone, so the same code
// gives the same answers on this PC (America/Phoenix) and on a Pi in any zone.

const partsCache = new Map();
function partsFmt(tz) {
  if (!partsCache.has(tz)) {
    partsCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }));
  }
  return partsCache.get(tz);
}
function parts(date, tz) {
  const o = {};
  for (const p of partsFmt(tz).formatToParts(date)) o[p.type] = p.value;
  return o;
}

/** 'YYYY-MM-DD' of `date` in time zone `tz`. */
export function localDate(date, tz) {
  const p = parts(date, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Hour 0-23 of `date` in `tz`. */
export function localHour(date, tz) {
  return Number(parts(date, tz).hour);
}

/** '1:30 PM' */
export function fmtTime(date, tz) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(date).replace(/ /g, ' ');
}

/** 'Saturday, Nov 14' */
export function fmtDayTitle(date, tz) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'short', day: 'numeric' }).formatToParts(date);
  const get = (t) => p.find((x) => x.type === t).value;
  return `${get('weekday')}, ${get('month')} ${get('day')}`;
}

/** '2026-11-14' -> '20261114' (ESPN's dates= format). */
export function ymd(localDateStr) {
  return localDateStr.replaceAll('-', '');
}

/** Calendar arithmetic on a 'YYYY-MM-DD' string. */
export function addDays(localDateStr, n) {
  const d = new Date(`${localDateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
