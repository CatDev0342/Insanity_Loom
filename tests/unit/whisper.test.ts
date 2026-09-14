// @vitest-environment happy-dom
// The whisper as a document, without the application around it: sections, replies woven in after them, the author's
// undo that never takes back the assistant's writing, and the whisper's XHTML file.
import { afterEach, describe, expect, it } from 'vitest';
import { WhisperEditor } from '../../src/renderer/src/document/whisper-editor';
import { fromXhtml, toXhtml } from '../../src/renderer/src/document/xhtml';

const open: WhisperEditor[] = [];
afterEach(() => {
  for (const whisper of open.splice(0)) whisper.editor.destroy();
  document.body.replaceChildren();
});

function whisper(html: string): {
  whisper: WhisperEditor;
  sections: { sectionId: string; markdown: string }[];
  nothingToSend: { times: number };
} {
  const sections: { sectionId: string; markdown: string }[] = [];
  const nothingToSend = { times: 0 };
  const element = document.createElement('div');
  document.body.append(element);
  const made = new WhisperEditor({
    element,
    html,
    onSectionFinished: (sectionId, markdown) => sections.push({ sectionId, markdown }),
    onNothingToSend: () => {
      nothingToSend.times += 1;
    },
    onChange: () => undefined,
    onFollowLink: () => undefined,
  });
  open.push(made);
  return { whisper: made, sections, nothingToSend };
}

/** Presses a key in the editor as the keyboard would, through the editor's own key handling. */
function press(target: WhisperEditor, key: string, modifiers: { ctrlKey?: boolean } = {}): void {
  const event = new KeyboardEvent('keydown', { key, ...modifiers, bubbles: true, cancelable: true });
  target.editor.view.someProp('handleKeyDown', (handle) => handle(target.editor.view, event));
}

function types(target: WhisperEditor, text: string): void {
  target.editor.commands.insertContent(text);
}

/** Closes the turn the way the author does: Ctrl+Enter, wherever the caret is. */
function finishSection(target: WhisperEditor): void {
  target.editor.commands.focus('end');
  press(target, 'Enter', { ctrlKey: true });
}

describe('closing a turn', () => {
  it('closes it at the end of the whisper and sends what was written since the last one, as Markdown', () => {
    const { whisper: w, sections } = whisper('<p>Hello <strong>loom</strong>.</p>');
    finishSection(w);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.markdown.trim()).toBe('Hello **loom**.');
    expect(w.html).toContain('<hr data-section-id=');
    // The author carries on in a fresh paragraph after the rule.
    types(w, 'next thought');
    expect(w.html).toMatch(/<hr[^>]*><p>next thought<\/p>$/);
  });

  it('leaves three hyphens as ordinary writing, wherever they stand', () => {
    const { whisper: w, sections } = whisper('<p>---</p>');
    w.editor.commands.focus('end');
    press(w, 'Enter');
    expect(sections).toHaveLength(0);
    expect(w.html).not.toContain('<hr');
    expect(w.html).toContain('---');
  });

  it('numbers each turn and writes down when it was taken', () => {
    const { whisper: w } = whisper('<p>first</p>');
    finishSection(w);
    types(w, 'second');
    finishSection(w);
    const turns = [...w.html.matchAll(/<hr[^>]*data-turn="(\d+)"/g)].map((found) => found[1]);
    expect(turns).toEqual(['1', '2']);
    // The moment itself for programs, and the same moment as the author reads it, for the page.
    expect(w.html).toMatch(/data-when="\d{4}-\d{2}-\d{2}T/);
    expect(w.html).toMatch(/data-shown="[^"]+"/);
  });

  it('closes the turn at the end even when the author is writing further up', () => {
    const { whisper: w, sections } = whisper('<p>an old thought</p><p>what I am asking now</p>');
    // The caret up in the first paragraph: the conversation's horizon is still the end of the whisper.
    w.editor.commands.setTextSelection(3);
    press(w, 'Enter', { ctrlKey: true });
    expect(sections).toHaveLength(1);
    expect(sections[0]?.markdown.trim()).toBe('an old thought\n\nwhat I am asking now');
    expect(w.html).toMatch(/<p>what I am asking now<\/p><hr[^>]*>/);
  });

  it('sends only what was written since the last turn', () => {
    const { whisper: w, sections } = whisper('<p>first</p>');
    finishSection(w);
    types(w, 'second');
    finishSection(w);
    expect(sections.map((section) => section.markdown.trim())).toEqual(['first', 'second']);
  });
});

describe('replies', () => {
  it('are placed after the rule of the section they answer, and rendered from Markdown', () => {
    const { whisper: w, sections } = whisper('<p>question</p><p></p>');
    finishSection(w);
    const replyId = w.placeReply(sections[0]?.sectionId ?? '');
    w.setReply(replyId, '## Answer\n\n- one\n- two', 'writing');
    expect(w.html).toMatch(/<hr[^>]*><section[^>]*data-state="writing"[^>]*><h2>Answer<\/h2><ul>/);
  });

  it('cannot be changed by the author while being written, and can once finished', () => {
    const { whisper: w, sections } = whisper('<p>question</p><p></p>');
    finishSection(w);
    const replyId = w.placeReply(sections[0]?.sectionId ?? '');
    w.setReply(replyId, 'the reply', 'writing');
    const before = w.html;
    // The author's caret inside the reply, typing.
    const inside = w.html.indexOf('the reply');
    expect(inside).toBeGreaterThan(-1);
    let position = -1;
    w.editor.state.doc.descendants((node, at) => {
      if (position === -1 && node.isText && node.text === 'the reply') position = at + 1;
    });
    w.editor.commands.insertContentAt(position, 'X');
    expect(w.html).toBe(before);

    w.setReplyState(replyId, 'finished');
    w.editor.commands.insertContentAt(position, 'X');
    expect(w.html).toContain('tXhe reply');
  });

  it("never enter the author's undo: Ctrl+Z takes back only the author's own writing", () => {
    const { whisper: w, sections } = whisper('<p>question</p><p></p>');
    finishSection(w);
    const replyId = w.placeReply(sections[0]?.sectionId ?? '');
    w.setReply(replyId, 'the reply', 'finished');
    w.editor.commands.focus('end');
    types(w, 'my follow-up');
    w.undo();
    expect(w.html).toContain('the reply');
    expect(w.html).not.toContain('my follow-up');
  });
});

describe('the whisper as Markdown', () => {
  it('writes the author as they are and quotes the assistant', () => {
    const { whisper: w } = whisper(
      '<h2 id="a-heading">A heading</h2><p>The author wrote <strong>this</strong>.</p>' +
        '<hr data-section-id="s1" />' +
        '<section data-author="assistant" data-reply-id="r1" data-state="finished"><p>The reply, with a list:</p><ul><li><p>one</p></li></ul></section>' +
        '<p>and on.</p>',
    );
    expect(w.asMarkdown()).toBe(
      ['## A heading', '', 'The author wrote **this**.', '', '---', '', '> The reply, with a list:', '>', '> - one', '', 'and on.', ''].join('\n'),
    );
  });
});

describe('the whisper file', () => {
  it('round-trips through XHTML, keeping replies and section rules', () => {
    const { whisper: w, sections } = whisper('<p>Hello &amp; <em>welcome</em></p><p></p>');
    finishSection(w);
    const replyId = w.placeReply(sections[0]?.sectionId ?? '');
    w.setReply(replyId, 'A **reply**', 'finished');

    const file = toXhtml({ title: 'A & B', conversationId: 'conversation-1', bodyHtml: w.html });
    expect(file.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    // The whisper carries its own look, so it reads as itself wherever it is opened.
    expect(file).toContain('<style>');
    expect(file).toContain("section[data-author='assistant']");
    const read = fromXhtml(file);
    expect(read.title).toBe('A & B');
    expect(read.conversationId).toBe('conversation-1');

    const { whisper: reopened } = whisper(read.bodyHtml);
    expect(reopened.html).toBe(w.html);
  });

  it('refuses a damaged file instead of half-reading it', () => {
    expect(() => fromXhtml('<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><article><p>unclosed')).toThrow(
      /not well-formed/,
    );
    expect(() => fromXhtml('<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body></body></html>')).toThrow(/no whisper/);
  });
});

describe('turns that were never answered', () => {
  it('finds a turn closed with nothing after it, and says what was said', () => {
    const { whisper: w } = whisper('<p>The thing I asked.</p>');
    finishSection(w);
    const unanswered = w.unansweredTurns();
    expect(unanswered).toHaveLength(1);
    expect(unanswered[0]?.markdown.trim()).toBe('The thing I asked.');
    expect(unanswered[0]?.replyId).toBe('');
  });

  it('finds a turn whose reply never arrived, and names the reply waiting for it', () => {
    const { whisper: w, sections } = whisper('<p>The thing I asked.</p>');
    finishSection(w);
    const replyId = w.placeReply(sections[0]?.sectionId ?? '');
    expect(w.unansweredTurns()).toEqual([
      { sectionId: sections[0]?.sectionId, replyId, markdown: expect.stringContaining('The thing I asked.') },
    ]);
  });

  it('counts a turn answered once its reply is finished', () => {
    const { whisper: w, sections } = whisper('<p>The thing I asked.</p>');
    finishSection(w);
    const replyId = w.placeReply(sections[0]?.sectionId ?? '');
    w.setReply(replyId, 'The answer.', 'finished');
    expect(w.unansweredTurns()).toHaveLength(0);
  });

  it('leaves alone a reply the author stopped, and offers again one that ended in a problem', () => {
    const { whisper: w, sections } = whisper('<p>The thing I asked.</p>');
    finishSection(w);
    const replyId = w.placeReply(sections[0]?.sectionId ?? '');

    // Stopped on purpose: the author knows what happened, and being asked whether they meant it is not help.
    w.setReply(replyId, 'As far as it got.', 'stopped');
    expect(w.unansweredTurns()).toHaveLength(0);

    // Ended in a problem: the author said something and never got an answer.
    w.setReply(replyId, 'As far as it got.', 'failed');
    expect(w.unansweredTurns()).toHaveLength(1);
  });
});

describe('pictures', () => {
  it('survive being opened and saved, with what they point at and what they were called', () => {
    const { whisper: w } = whisper('<p>before</p><p><img src="a.png" alt="a picture" title="what it is" /></p><p>after</p>');
    expect(w.html).toContain('<img src="a.png" alt="a picture" title="what it is">');
    // And through the file, which is what a whisper really is.
    const file = toXhtml({ title: 'With a picture', conversationId: '', bodyHtml: w.html });
    const { whisper: reopened } = whisper(fromXhtml(file).bodyHtml);
    expect(reopened.html).toContain('src="a.png"');
  });
});

describe('closing a turn with nothing written', () => {
  it('does not leave a rule behind that says a turn was taken', () => {
    const { whisper: w, sections, nothingToSend } = whisper('<p></p>');
    finishSection(w);

    // Nothing sent, nothing marked, and the author told why rather than left to wonder.
    expect(sections).toHaveLength(0);
    expect(nothingToSend.times).toBe(1);
    expect(w.editor.getHTML()).not.toContain('<hr');
  });

  it('says the same when everything written has already been sent', () => {
    const { whisper: w, sections, nothingToSend } = whisper('<p>Already said.</p>');
    types(w, '');
    finishSection(w);
    expect(sections).toHaveLength(1);

    // A second Ctrl+Enter with nothing new written closes nothing.
    finishSection(w);
    expect(sections).toHaveLength(1);
    expect(nothingToSend.times).toBe(1);
  });

  it('closes a turn that holds a picture and no words at all', () => {
    const { whisper: w, sections, nothingToSend } = whisper('<p><img src="pictures/a.png" alt="A drawing"></p>');
    finishSection(w);
    expect(nothingToSend.times).toBe(0);
    expect(sections).toHaveLength(1);
  });
});
