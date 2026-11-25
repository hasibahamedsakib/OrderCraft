/** Time-zone helpers built on Intl, so no date library is needed. */

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export function toEpochMs(time: Date | number | string): number {
  const ms = time instanceof Date ? time.getTime() : typeof time === 'number' ? time : Date.parse(time);
  if (Number.isNaN(ms)) throw new Error(`Invalid time: ${String(time)}`);
  return ms;
}

export function zonedParts(time: Date | number | string, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(toEpochMs(time)));
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** Seconds since local midnight in the zone. 10:59:59 -> 39599. */
export function secondsOfDay(time: Date | number | string, timeZone: string): number {
  const p = zonedParts(time, timeZone);
  return p.hour * 3600 + p.minute * 60 + p.second;
}

/** "11:00" -> 39600 */
export function parseClock(hhmm: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) throw new Error(`Expected HH:MM, got ${hhmm}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60;
}

/** Local calendar date "YYYY-MM-DD" in the zone. */
export function zonedDate(time: Date | number | string, timeZone: string): string {
  const p = zonedParts(time, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** ISO 8601 with the zone's offset, e.g. "2026-11-20T09:15:00+06:00" (milliseconds kept when non-zero). */
export function toZonedIso(time: Date | number | string, timeZone: string): string {
  const ms = toEpochMs(time);
  const p = zonedParts(ms, timeZone);
  const wallClockAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offsetMinutes = Math.round((wallClockAsUtc - Math.floor(ms / 1000) * 1000) / 60_000);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const millis = ((ms % 1000) + 1000) % 1000;
  return (
    `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}` +
    (millis ? `.${String(millis).padStart(3, '0')}` : '') +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
