// Noticing when the assistant has stopped answering (src/main/liveness.ts), and telling a full context window from
// any other failure.
import { describe, expect, it } from 'vitest';
import { answersWithin, Watchdog, type Timers } from '../../src/main/liveness';
import { isContextFull } from '../../src/shared/assistant';

/** A clock the test holds still: nothing happens until `pass` is told how many seconds went by. */
function heldClock(): Timers & { pass(seconds: number): void } {
  let now = 0;
  const due: { at: number; run: () => void; id: number }[] = [];
  let nextId = 1;
  return {
    set(run, milliseconds) {
      const id = nextId++;
      due.push({ at: now + milliseconds, run, id });
      return id;
    },
    clear(timer) {
      const which = due.findIndex((one) => one.id === timer);
      if (which >= 0) due.splice(which, 1);
    },
    pass(seconds) {
      now += seconds * 1000;
      for (const one of due.splice(0).sort((a, b) => a.at - b.at)) {
        if (one.at <= now) one.run();
        else due.push(one);
      }
    },
  };
}

describe('the watchdog', () => {
  it('says nothing while no turn is out', () => {
    const clock = heldClock();
    let quiet = 0;
    new Watchdog(() => quiet++, 45, clock);
    clock.pass(600);
    expect(quiet).toBe(0);
  });

  it('speaks up when a turn goes unanswered in silence', () => {
    const clock = heldClock();
    let quiet = 0;
    const watchdog = new Watchdog(() => quiet++, 45, clock);
    watchdog.waiting();
    clock.pass(44);
    expect(quiet).toBe(0);
    clock.pass(2);
    expect(quiet).toBe(1);
  });

  it('holds its peace while anything at all is arriving', () => {
    const clock = heldClock();
    let quiet = 0;
    const watchdog = new Watchdog(() => quiet++, 45, clock);
    watchdog.waiting();
    for (let minute = 0; minute < 10; minute++) {
      clock.pass(40);
      watchdog.heard();
    }
    expect(quiet).toBe(0);
  });

  it('says nothing more once the answer is done', () => {
    const clock = heldClock();
    let quiet = 0;
    const watchdog = new Watchdog(() => quiet++, 45, clock);
    watchdog.waiting();
    watchdog.idle();
    clock.pass(600);
    expect(quiet).toBe(0);
  });

  it('asks about one silence once, however long it lasts', () => {
    const clock = heldClock();
    let quiet = 0;
    const watchdog = new Watchdog(() => quiet++, 45, clock);
    watchdog.waiting();
    clock.pass(600);
    expect(quiet).toBe(1);
  });
});

describe('waiting for an answer of any kind', () => {
  it('counts a refusal as an answer: something was there to refuse', async () => {
    expect(await answersWithin(Promise.reject(new Error('no such method')), 5)).toBe(true);
  });

  it('counts silence as no answer', async () => {
    const clock = heldClock();
    const never = new Promise(() => undefined);
    const asked = answersWithin(never, 15, clock);
    clock.pass(16);
    expect(await asked).toBe(false);
  });
});

describe('telling a full context window from anything else', () => {
  it('knows what the assistant says when the conversation no longer fits', () => {
    expect(isContextFull('Prompt is too long')).toBe(true);
    expect(isContextFull('input length and max tokens exceed context limit')).toBe(true);
    expect(isContextFull('too many tokens in request')).toBe(true);
  });

  it('does not mistake other failures for it', () => {
    expect(isContextFull('The assistant host stopped (exit code 1).')).toBe(false);
    expect(isContextFull('This whisper is too long to save')).toBe(false);
  });
});
