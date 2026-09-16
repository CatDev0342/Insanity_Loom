// What a turn cost, measured: the numbers themselves, and the row they are written down as.
import { describe, expect, it } from 'vitest';
import { TIMING_COLUMNS, TurnClock, timingRow, timingSaid, type TurnTiming } from '../../src/renderer/src/loom/timings';

const A_TURN: TurnTiming = {
  turn: 7,
  sent: 42,
  untilAsked: 3,
  untilFirstWord: 1200,
  pieces: 30,
  usualGap: 40,
  worstGap: 900,
  drawing: 120,
  untilFinished: 4300,
};

describe('timing a turn', () => {
  it('counts the pieces and the gaps between them, and is not dragged about by one stall', async () => {
    const clock = new TurnClock(1, 10);
    clock.askedNow();
    const waitFor = async (milliseconds: number): Promise<void> => {
      await new Promise((resolve) => setTimeout(resolve, milliseconds));
    };
    await waitFor(20);
    clock.piece();
    await waitFor(10);
    clock.piece();
    // One long stall among short gaps: the usual gap stays short, and the worst gap says the stall happened.
    await waitFor(60);
    clock.piece();
    await waitFor(10);
    clock.piece();
    const timing = clock.finished();
    expect(timing.pieces).toBe(4);
    expect(timing.untilFirstWord).toBeGreaterThanOrEqual(15);
    expect(timing.worstGap).toBeGreaterThan(timing.usualGap);
    expect(timing.usualGap).toBeLessThan(50);
    expect(timing.untilFinished).toBeGreaterThanOrEqual(timing.untilFirstWord);
  });

  it('says nothing came back as nothing, rather than as a time', () => {
    const clock = new TurnClock(2, 0);
    clock.askedNow();
    const timing = clock.finished();
    expect(timing.untilFirstWord).toBe(0);
    expect(timing.pieces).toBe(0);
    expect(timing.usualGap).toBe(0);
  });

  it('adds up what drawing the pieces cost', () => {
    const clock = new TurnClock(3, 5);
    clock.drew(4.4);
    clock.drew(5.5);
    expect(clock.finished().drawing).toBe(10);
  });
});

describe('writing a turn down', () => {
  it('writes one row, in the order the columns are named', () => {
    const row = timingRow(A_TURN, 'Connected to Claude in a container.', new Date('2026-09-16T05:00:00.000Z'));
    const fields = row.split('\t');
    expect(fields).toHaveLength(TIMING_COLUMNS.length);
    expect(fields[0]).toBe('2026-09-16T05:00:00.000Z');
    expect(fields[1]).toBe('7');
    expect(fields[4]).toBe('1200');
    // A row is one line: anything said about the assistant is flattened, so a row can never become two.
    expect(timingRow(A_TURN, 'Connected\nto\nsomething').split('\n')).toHaveLength(1);
  });

  it('says the same thing in words, for the record beside the conversation', () => {
    const said = timingSaid(A_TURN);
    expect(said).toContain('Turn 7');
    expect(said).toContain('first word 1200ms');
    expect(said).toContain('worst 900ms');
  });
});
