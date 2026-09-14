// How long the assistant has been writing, said the way a person would say it.
//
// "The assistant is writing…" looks exactly the same after two seconds and after twenty minutes, so a turn that has
// quietly died is indistinguishable from one thinking hard (the designer's screenshot, 2026-Sep-14). The label says
// how long it has been, from the point where that stops being unremarkable.

/** Below this, nothing is said: every reply takes a few seconds and saying so would only be noise. */
export const SAY_NOTHING_UNDER_SECONDS = 20;

const SECONDS_PER_MINUTE = 60;

/** How often the label is brought up to date. A second is finer than anyone reads; five is enough to watch by. */
export const TICK_SECONDS = 5;

/** " · 2m 30s", or '' while it has been no time worth mentioning. */
export function howLong(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < SAY_NOTHING_UNDER_SECONDS) return '';
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / SECONDS_PER_MINUTE);
  const rest = whole % SECONDS_PER_MINUTE;
  if (minutes === 0) return ` · ${rest}s`;
  return rest === 0 ? ` · ${minutes}m` : ` · ${minutes}m ${rest}s`;
}
