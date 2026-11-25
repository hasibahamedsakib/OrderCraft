/** Server "now" estimated in the browser. The only place Date.now() meets the server clock. */
export function estimateServerNow(offsetMs: number): number {
  return Date.now() + offsetMs;
}

/** Milliseconds left until a server timestamp, measured on the server clock. */
export function msUntil(serverIso: string, offsetMs: number, browserNow: number = Date.now()): number {
  return Date.parse(serverIso) - (browserNow + offsetMs);
}

/** 272_400 -> "4:32" */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
