// A reply that arrives as several messages: an assistant that speaks, runs a command, and speaks again.
import { describe, expect, it } from 'vitest';
import { NOTHING_YET, withPiece } from '../../src/renderer/src/loom/one-reply';

describe('a reply of several messages', () => {
  it('keeps the pieces of one message exactly as they came', () => {
    let reply = withPiece(NOTHING_YET, 'The first ', 'm1');
    reply = withPiece(reply, 'sentence, unbroken.', 'm1');
    expect(reply.markdown).toBe('The first sentence, unbroken.');
  });

  it('parts one message from the next, rather than running them together', () => {
    let reply = withPiece(NOTHING_YET, 'So I fixed it:', 'm1');
    reply = withPiece(reply, 'Now the next thing.', 'm2');
    expect(reply.markdown).toBe('So I fixed it:\n\nNow the next thing.');
  });

  it('adds nothing to a message that already ends its own paragraph', () => {
    let reply = withPiece(NOTHING_YET, 'A finished thought.\n\n', 'm1');
    reply = withPiece(reply, 'Another one.', 'm2');
    expect(reply.markdown).toBe('A finished thought.\n\nAnother one.');
  });

  it('finishes a half-ended paragraph before starting the next message', () => {
    let reply = withPiece(NOTHING_YET, '- an item\n', 'm1');
    reply = withPiece(reply, 'And then this.', 'm2');
    expect(reply.markdown).toBe('- an item\n\nAnd then this.');
  });

  it('holds its peace when nothing arrives', () => {
    expect(withPiece(NOTHING_YET, '', 'm1')).toEqual(NOTHING_YET);
  });
});
