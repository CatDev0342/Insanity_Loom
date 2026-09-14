// @vitest-environment happy-dom
// Finding writing in the whisper: every place marked, one of them the author's, and nothing about the whisper changed
// by the looking.
import { afterEach, describe, expect, it } from 'vitest';
import { WhisperEditor } from '../../src/renderer/src/document/whisper-editor';

const open: WhisperEditor[] = [];

function whisper(html: string): WhisperEditor {
  const element = document.createElement('div');
  document.body.append(element);
  const made = new WhisperEditor({
    element,
    html,
    onSectionFinished: () => undefined, onNothingToSend: () => undefined,
    onChange: () => undefined,
    onFollowLink: () => undefined,
  });
  open.push(made);
  return made;
}

afterEach(() => {
  for (const made of open.splice(0)) made.editor.destroy();
  document.body.replaceChildren();
});

/** What is marked in the whisper: every place found, and the one the author is at. */
function marks(target: WhisperEditor): { readonly all: number; readonly now: string } {
  const dom = target.editor.view.dom;
  return {
    all: dom.querySelectorAll('.is-found-too, .is-found-now').length,
    now: dom.querySelector('.is-found-now')?.textContent ?? '',
  };
}

describe('finding writing in the whisper', () => {
  it('marks every place it appears, and takes the author to the first from where they are', () => {
    const w = whisper('<p>A loom, and another loom, and a third loom.</p>');
    w.editor.commands.setTextSelection(1);
    expect(w.find('loom')).toEqual({ at: 0, of: 3 });
    expect(marks(w)).toEqual({ all: 3, now: 'loom' });
    // The caret is on what was found, so the author may carry on writing there.
    expect(w.editor.state.selection.from).toBe(3);
  });

  it('pays no heed to capitals', () => {
    const w = whisper('<p>Loom, loom, LOOM.</p>');
    expect(w.find('loom').of).toBe(3);
  });

  it('goes on to the next place, and round to the first again', () => {
    const w = whisper('<p>one loom, two loom</p>');
    expect(w.find('loom')).toEqual({ at: 0, of: 2 });
    expect(w.findNext()).toEqual({ at: 1, of: 2 });
    expect(w.findNext()).toEqual({ at: 0, of: 2 });
    expect(w.findPrevious()).toEqual({ at: 1, of: 2 });
  });

  it('says when there is nothing to find, and marks nothing', () => {
    const w = whisper('<p>a whisper</p>');
    expect(w.find('loom')).toEqual({ at: -1, of: 0 });
    expect(marks(w).all).toBe(0);
  });

  it('keeps its marks while the whisper is redrawn around it', () => {
    const w = whisper('<p>a loom here</p>');
    expect(w.find('loom').of).toBe(1);
    w.appendReply('an answer arriving meanwhile', null);
    expect(marks(w)).toEqual({ all: 1, now: 'loom' });
  });

  it('writes something else in its place, and goes on to the next', () => {
    const w = whisper('<p>one loom, two loom</p>');
    w.editor.commands.setTextSelection(1);
    expect(w.find('loom')).toEqual({ at: 0, of: 2 });
    expect(w.replaceFound('thread')).toEqual({ at: 0, of: 1 });
    expect(w.html).toContain('<p>one thread, two loom</p>');
    expect(w.replaceFound('thread')).toEqual({ at: -1, of: 0 });
    expect(w.html).toContain('<p>one thread, two thread</p>');
  });

  it('writes something else in place of every one, in a single change the author can take back at once', () => {
    const w = whisper('<p>loom, loom, loom</p>');
    w.find('loom');
    expect(w.replaceAllFound('thread')).toBe(3);
    expect(w.html).toContain('<p>thread, thread, thread</p>');
    w.undo();
    expect(w.html).toContain('<p>loom, loom, loom</p>');
  });

  it("leaves alone what is inside a reply the assistant is still writing", () => {
    const w = whisper('<p>a loom of my own</p>');
    const replyId = w.placeReply('no-such-section');
    w.setReply(replyId, 'the loom in the reply', 'writing');
    w.editor.commands.setTextSelection(1);
    // Both places are found and shown...
    expect(w.find('loom').of).toBe(2);
    // ...but only the author's own is changed.
    expect(w.replaceAllFound('thread')).toBe(1);
    expect(w.html).toContain('<p>a thread of my own</p>');
    expect(w.html).toContain('the loom in the reply');
  });

  it('changes nothing: the looking is not an edit, and Ctrl+Z has nothing to take back', () => {
    const w = whisper('<p>a loom here</p>');
    const before = w.html;
    w.editor.commands.focus('end');
    w.find('loom');
    w.findNext();
    w.stopFinding();
    expect(w.html).toBe(before);
    w.undo();
    expect(w.html).toBe(before);
    expect(marks(w).all).toBe(0);
  });
});
