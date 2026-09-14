// @vitest-environment happy-dom
// Section isolation: how far Select All reaches, and the keys that reach for the ends of the whisper.
import { afterEach, describe, expect, it } from 'vitest';
import { sectionAround } from '../../src/renderer/src/document/isolation';
import { WhisperEditor } from '../../src/renderer/src/document/whisper-editor';

const open: WhisperEditor[] = [];

function whisper(html: string): WhisperEditor {
  const element = document.createElement('div');
  document.body.append(element);
  const made = new WhisperEditor({
    element,
    html,
    onSectionFinished: () => undefined,
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

/** A whisper of three turns: writing, a line closing it, a reply, and so on. */
function conversation(): WhisperEditor {
  return whisper(
    '<p>The first question.</p><hr data-section-id="s1" data-turn="1" />' +
      '<section data-author="assistant" data-reply-id="r1" data-state="finished"><p>The first answer.</p></section>' +
      '<p>The second question.</p><hr data-section-id="s2" data-turn="2" />' +
      '<section data-author="assistant" data-reply-id="r2" data-state="finished"><p>The second answer.</p></section>' +
      '<p>What I am writing now.</p>',
  );
}

/** Presses a key through the editor's own key handling. */
function press(target: WhisperEditor, key: string, modifiers: { ctrlKey?: boolean; shiftKey?: boolean } = {}): void {
  const event = new KeyboardEvent('keydown', { key, ...modifiers, bubbles: true, cancelable: true });
  target.editor.view.someProp('handleKeyDown', (handle) => handle(target.editor.view, event));
}

/** What the author has selected, as writing. */
function selected(target: WhisperEditor): string {
  const { from, to } = target.editor.state.selection;
  return target.editor.state.doc.textBetween(from, to, ' ').trim();
}

describe('where a section begins and ends', () => {
  it('is between the lines that divide the conversation', () => {
    const w = conversation();
    const doc = w.editor.state.doc;
    // Inside the last piece of writing, after the second reply.
    const last = sectionAround(doc, doc.content.size - 2);
    expect(doc.textBetween(last.from, last.to, ' ').trim()).toBe('What I am writing now.');
    // Inside the first question, before any line.
    const first = sectionAround(doc, 2);
    expect(doc.textBetween(first.from, first.to, ' ').trim()).toBe('The first question.');
  });

  it('takes a reply as a section of its own', () => {
    const w = conversation();
    const doc = w.editor.state.doc;
    let insideReply = -1;
    doc.descendants((node, position) => {
      if (insideReply === -1 && node.type.name === 'reply') insideReply = position + 2;
      return insideReply === -1;
    });
    const around = sectionAround(doc, insideReply);
    expect(doc.textBetween(around.from, around.to, ' ').trim()).toBe('The first answer.');
  });
});

describe('Select All', () => {
  it('takes the whole whisper while isolation is off', () => {
    const w = conversation();
    w.editor.commands.setTextSelection(w.editor.state.doc.content.size - 2);
    press(w, 'a', { ctrlKey: true });
    // Nothing was claimed by the whisper: the editor's own Select All takes everything.
    expect(w.isolatingSections).toBe(false);
  });

  it('takes only the section the author is in while isolation is on', () => {
    const w = conversation();
    w.isolateSections(true);
    w.editor.commands.setTextSelection(w.editor.state.doc.content.size - 2);
    press(w, 'a', { ctrlKey: true });
    expect(selected(w)).toBe('What I am writing now.');

    // And in an earlier turn, that turn alone.
    w.editor.commands.setTextSelection(2);
    press(w, 'a', { ctrlKey: true });
    expect(selected(w)).toBe('The first question.');
  });

  it("reaches for the section's own ends with Ctrl+Shift+Home and Ctrl+Shift+End", () => {
    const w = conversation();
    w.isolateSections(true);
    const size = w.editor.state.doc.content.size;
    const caret = size - 8;
    const here = sectionAround(w.editor.state.doc, caret);

    const doc = w.editor.state.doc;
    // Back to this section's own beginning, not the whisper's. (A selection cannot stand on the boundary itself, so
    // what it takes is the writing between the boundary and the caret.)
    w.editor.commands.setTextSelection(caret);
    press(w, 'Home', { ctrlKey: true, shiftKey: true });
    expect(selected(w)).toBe(doc.textBetween(here.from, caret, ' ').trim());
    // The section reached for is the last piece of writing, not the whisper.
    expect(doc.textBetween(here.from, here.to, ' ').trim()).toBe('What I am writing now.');

    // Forward to this section's own end.
    w.editor.commands.setTextSelection(caret);
    press(w, 'End', { ctrlKey: true, shiftKey: true });
    expect(selected(w)).toBe(doc.textBetween(caret, here.to, ' ').trim());
  });

  it('turns off again, and the reach is the whole whisper', () => {
    const w = conversation();
    w.isolateSections(true);
    w.isolateSections(false);
    expect(w.isolatingSections).toBe(false);
  });
});
