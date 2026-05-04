// Coarse relative-time formatter. Used by AlertView, TimelineView, and
// any other primitive that needs to show "how long ago." When localized
// formatting is needed we'll move to Intl.RelativeTimeFormat in this one
// place rather than per-component.

export function relativeTime(ts_ms: number, now_ms: number = Date.now()): string {
  const diff = now_ms - ts_ms;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}
