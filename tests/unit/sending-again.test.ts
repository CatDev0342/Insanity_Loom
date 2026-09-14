// Whether a turn that ended goes again (src/renderer/src/loom/sending-again.ts).
import { describe, expect, it } from 'vitest';
import { MOST_TRIES, sendAgain, wentUnheard } from '../../src/renderer/src/loom/sending-again';

const turn = (over: Partial<{ markdown: string; sent: string; tries: number }> = {}) => ({
  markdown: '',
  sent: 'What the author wrote.',
  tries: 1,
  ...over,
});

describe('a turn that ended', () => {
  it('goes again when the connection fell over before a word came back', () => {
    expect(sendAgain(turn(), 'failed')).toBe(true);
  });

  it('goes again when it was still waiting to be heard', () => {
    expect(sendAgain(turn(), 'waiting')).toBe(true);
  });

  it('does not go again when some of the reply had already arrived', () => {
    // Sending it again would answer the same turn twice, and the author would read it twice.
    expect(sendAgain(turn({ markdown: 'I was part way through' }), 'failed')).toBe(false);
  });

  it('does not go again when the author stopped it themselves', () => {
    expect(sendAgain(turn(), 'stopped')).toBe(false);
  });

  it('does not go again when the assistant finished without saying anything', () => {
    expect(sendAgain(turn(), 'finished')).toBe(false);
  });

  it('does not go again when nothing was ever sent — the assistant spoke unasked', () => {
    expect(sendAgain(turn({ sent: '' }), 'failed')).toBe(false);
  });

  it('stops trying rather than going round forever, and says so', () => {
    const tired = turn({ tries: MOST_TRIES });
    expect(sendAgain(tired, 'failed')).toBe(false);
    // Still unheard, though: the author is told it did not get through, not left thinking it did.
    expect(wentUnheard(tired, 'failed')).toBe(true);
  });
});
