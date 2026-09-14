// Noticing when the assistant has stopped answering.
//
// A turn is sent and the answer comes back as a stream of events. If the host dies, its stopping is noticed and the
// connection is dropped. But a host can also go *quiet* — the container it runs in suspends while the author is away,
// the stream stalls — and then nothing stops, nothing fails, and the request simply never settles. Insanity_Loom went
// on saying "connected", the turn sat unanswered forever, and every turn after it queued silently behind that one,
// until the author closed the program and opened it again (the designer, 2026-Sep-14).
//
// So a turn that has gone out is watched. Anything at all arriving counts as a sign of life. After a long enough
// silence the host is asked a question of its own; what matters is not the answer but that one comes at all.

/** How long a turn may go with nothing at all arriving before the host is asked whether it is still there. */
export const QUIET_SECONDS_BEFORE_A_CHECK = 45;

/** How long the host has to answer that question. A host that cannot answer in this time is not answering. */
export const SECONDS_TO_ANSWER_A_CHECK = 15;

const MILLISECONDS_PER_SECOND = 1000;

/** The timers the watchdog uses, so a test can hold the clock still. */
export interface Timers {
  set(run: () => void, milliseconds: number): unknown;
  clear(timer: unknown): void;
}

const REAL_TIMERS: Timers = {
  set: (run, milliseconds) => setTimeout(run, milliseconds),
  clear: (timer) => clearTimeout(timer as NodeJS.Timeout),
};

/**
 * Watches a turn that has gone out. `waiting()` when it goes, `heard()` for every sign of life, `idle()` when the
 * answer is done. After `quietSeconds` of complete silence, `onQuiet` is called — once for that turn, not repeatedly.
 */
export class Watchdog {
  private timer: unknown;
  private waitingNow = false;

  constructor(
    private readonly onQuiet: () => void,
    private readonly quietSeconds: number = QUIET_SECONDS_BEFORE_A_CHECK,
    private readonly timers: Timers = REAL_TIMERS,
  ) {}

  /** A turn has gone out; the silence starts now. */
  waiting(): void {
    this.waitingNow = true;
    this.restart();
  }

  /** Something arrived. Whatever it was, the host is alive, and the silence starts over. */
  heard(): void {
    if (!this.waitingNow) return;
    this.restart();
  }

  /** Nothing is being waited for. */
  idle(): void {
    this.waitingNow = false;
    this.stop();
  }

  private restart(): void {
    this.stop();
    this.timer = this.timers.set(() => {
      this.timer = undefined;
      // Asking is itself the last word on this turn's silence: whatever comes of it, this does not fire again until
      // something is heard, so a host that is merely slow is not asked over and over.
      this.waitingNow = false;
      this.onQuiet();
    }, this.quietSeconds * MILLISECONDS_PER_SECOND);
  }

  private stop(): void {
    if (this.timer === undefined) return;
    this.timers.clear(this.timer);
    this.timer = undefined;
  }
}

/**
 * Whether `work` came back at all within `seconds` — resolving or failing alike. A refusal is an answer: it proves
 * something is there to refuse. Only silence is not.
 */
export async function answersWithin(work: Promise<unknown>, seconds: number, timers: Timers = REAL_TIMERS): Promise<boolean> {
  let timer: unknown;
  const tooSlow = new Promise<false>((resolve) => {
    timer = timers.set(() => resolve(false), seconds * MILLISECONDS_PER_SECOND);
  });
  try {
    return await Promise.race([work.then(() => true, () => true), tooSlow]);
  } finally {
    timers.clear(timer);
  }
}
