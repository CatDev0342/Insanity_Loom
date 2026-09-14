import { describe, expect, it } from 'vitest';
import { catchUpWith, describeCatchUp, type HistoryPiece } from '../../src/renderer/src/loom/catch-up';

const exchange = (question: string, answer: string): HistoryPiece[] => [
  { kind: 'author', markdown: question },
  { kind: 'reply', markdown: answer },
];

describe('catching a whisper up with its conversation', () => {
  it('brings in nothing when the whisper already holds it all', () => {
    const history = [...exchange('One', 'First answer'), ...exchange('Two', 'Second answer')];
    const record = { sections: 2, lastReply: { replyId: 'r2', finished: true } };
    expect(catchUpWith(record, history)).toEqual({ append: [] });
  });

  it('brings in the exchanges said while the whisper was not open', () => {
    const history = [...exchange('One', 'First answer'), ...exchange('Two', 'Second answer')];
    const record = { sections: 1, lastReply: { replyId: 'r1', finished: true } };
    expect(catchUpWith(record, history)).toEqual({ append: exchange('Two', 'Second answer') });
  });

  it('fills in a reply the whisper never saw finish, without repeating its section', () => {
    const history = [...exchange('One', 'First answer whole')];
    const record = { sections: 1, lastReply: { replyId: 'r1', finished: false } };
    expect(catchUpWith(record, history)).toEqual({
      fillLastReply: { replyId: 'r1', markdown: 'First answer whole' },
      append: [],
    });
  });

  it('fills the unfinished reply and then brings in what followed', () => {
    const history = [...exchange('One', 'First answer whole'), ...exchange('Two', 'Second answer')];
    const record = { sections: 1, lastReply: { replyId: 'r1', finished: false } };
    expect(catchUpWith(record, history)).toEqual({
      fillLastReply: { replyId: 'r1', markdown: 'First answer whole' },
      append: exchange('Two', 'Second answer'),
    });
  });

  it('brings in nothing when the history is shorter than the whisper', () => {
    const record = { sections: 3, lastReply: { replyId: 'r3', finished: true } };
    expect(catchUpWith(record, exchange('One', 'First answer'))).toEqual({ append: [] });
  });

  it('says what it brought in, in words', () => {
    expect(describeCatchUp({ append: exchange('Two', 'Second answer') })).toBe(
      'Brought in 1 section you wrote and 1 reply said while this whisper was not open.',
    );
    expect(
      describeCatchUp({ fillLastReply: { replyId: 'r1', markdown: 'x' }, append: [{ kind: 'author', markdown: 'Two' }] }),
    ).toBe('Brought in 1 section you wrote and 1 reply said while this whisper was not open.');
    expect(describeCatchUp({ append: [] })).toBe('');
  });
});
