// Where the seconds go.
//
// The designer, 2026-Sep-16: claude.ai answers faster than this program does, and wants to know why. The answer is
// not arguable from first principles — a turn here goes through a container, an agent that reads files and runs
// tools, and a disk that may be a mount of another operating system, and any of those could be the whole story. So
// each turn is timed at the five places a second can hide, and the numbers are written down.
//
// The floor is measured the same way: the stand-in assistant runs on this computer with no container, no network and
// no model, so the same turn timed against it is what the program itself costs. Whatever is left over is the path.
//
// Nothing here changes what the program does. It writes rows to Data/Logs/timings.tsv and a line per turn beside the
// conversation, and that is all.

/** What one turn cost, in milliseconds, at each place a turn can spend time. */
export interface TurnTiming {
  readonly turn: number;
  /** How many characters the author sent. */
  readonly sent: number;
  /** Closing the turn until the program asked the assistant for an answer: the program's own work before the wire. */
  readonly untilAsked: number;
  /** Asking until the first word came back. This is the number the author feels. */
  readonly untilFirstWord: number;
  /** How many pieces the reply arrived in. */
  readonly pieces: number;
  /** The usual and the worst gap between one piece and the next: what makes a reply feel slow after it has begun. */
  readonly usualGap: number;
  readonly worstGap: number;
  /** What drawing those pieces into the whisper cost altogether. */
  readonly drawing: number;
  /** Asking until the reply was finished. */
  readonly untilFinished: number;
}

/** The middle value of a list — the usual gap, which a single stall cannot drag upwards the way an average can. */
function middleOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const at = sorted[middle] ?? 0;
  if (sorted.length % 2 === 1) return at;
  return Math.round((at + (sorted[middle - 1] ?? at)) / 2);
}

function whole(milliseconds: number): number {
  return Math.round(milliseconds);
}

/** Times one turn, from the moment the author closes it to the moment its reply is done. */
export class TurnClock {
  private readonly closed = performance.now();
  private asked = 0;
  private firstWord = 0;
  private lastPiece = 0;
  private readonly gaps: number[] = [];
  private pieces = 0;
  private drawing = 0;

  constructor(
    readonly turn: number,
    private readonly sent: number,
  ) {}

  /** The turn has gone to the assistant. */
  askedNow(): void {
    if (this.asked === 0) this.asked = performance.now();
  }

  /** A piece of the reply arrived. */
  piece(): void {
    const now = performance.now();
    this.pieces += 1;
    if (this.firstWord === 0) this.firstWord = now;
    else this.gaps.push(now - this.lastPiece);
    this.lastPiece = now;
  }

  /** What drawing a piece into the whisper cost. */
  drew(milliseconds: number): void {
    this.drawing += milliseconds;
  }

  /** The reply is finished; what the turn cost, all told. */
  finished(): TurnTiming {
    const done = performance.now();
    const asked = this.asked === 0 ? this.closed : this.asked;
    return {
      turn: this.turn,
      sent: this.sent,
      untilAsked: whole(asked - this.closed),
      untilFirstWord: whole(this.firstWord === 0 ? 0 : this.firstWord - asked),
      pieces: this.pieces,
      usualGap: whole(middleOf(this.gaps)),
      worstGap: whole(this.gaps.length === 0 ? 0 : Math.max(...this.gaps)),
      drawing: whole(this.drawing),
      untilFinished: whole(done - asked),
    };
  }
}

/** The row written to Data/Logs/timings.tsv: one turn, one line, in the order the columns are named below. */
export const TIMING_COLUMNS = [
  'when',
  'turn',
  'sent',
  'untilAsked',
  'untilFirstWord',
  'pieces',
  'usualGap',
  'worstGap',
  'drawing',
  'untilFinished',
  'assistant',
] as const;

export function timingRow(timing: TurnTiming, assistant: string, when: Date = new Date()): string {
  return [
    when.toISOString(),
    timing.turn,
    timing.sent,
    timing.untilAsked,
    timing.untilFirstWord,
    timing.pieces,
    timing.usualGap,
    timing.worstGap,
    timing.drawing,
    timing.untilFinished,
    assistant.replace(/\s+/g, ' '),
  ].join('\t');
}

/** The same turn in words, for the record kept beside the conversation. */
export function timingSaid(timing: TurnTiming): string {
  return (
    `Turn ${String(timing.turn)}: asked after ${String(timing.untilAsked)}ms, ` +
    `first word ${String(timing.untilFirstWord)}ms, ` +
    `${String(timing.pieces)} pieces (usual gap ${String(timing.usualGap)}ms, worst ${String(timing.worstGap)}ms), ` +
    `drawing ${String(timing.drawing)}ms, done ${String(timing.untilFinished)}ms.`
  );
}
