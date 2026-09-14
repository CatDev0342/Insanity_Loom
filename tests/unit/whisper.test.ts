// @vitest-environment happy-dom
// The whisper as a document, without the application around it: sections, replies woven in after them, the author's
// undo that never takes back the assistant's writing, and the whisper's XHTML file.
import { afterEach, describe, expect, it } from 'vitest';
import { DOMParser as HtmlParser } from '@tiptap/pm/model';
import { SECTION_MARK } from '../../src/renderer/src/document/extensions';
import { WhisperEditor } from '../../src/renderer/src/document/whisper-editor';
import { fromXhtml, toXhtml } from '../../src/renderer/src/document/xhtml';

const open: WhisperEditor[] = [];
afterEach(() => {
  for (const whisper of open.splice(0)) whisper.editor.destroy();
  document.body.replaceChildren();
});

function whisper(html: string): { whisper: WhisperEditor; sections: { sectionId: string; markdown: string }[] } {
  const sections: { sectionId: string; markdown: string }[] = [];
  const element = document.createElement('div');
  document.body.append(element);
  const made = new WhisperEditor({
    element,
    html,
    onSectionFinished: (sectionId, markdown) => sections.push({ sectionId, markdown }),
    onChange: () => undefined,
  });
  open.push(made);
  return { whisper: made, sections };
}

/** Presses a key in the editor as the keyboard would, through the editor's own key handling. */
function press(target: WhisperEditor, key: string, modifiers: { ctrlKey?: boolean } = {}): void {
  const event = new KeyboardEvent('keydown', { key, ...modifiers, bubbles: true, cancelable: true });
  target.editor.view.someProp('handleKeyDown', (handle) => handle(target.editor.view, event));
}

function types(target: WhisperEditor, text: string): void {
  target.editor.commands.insertContent(text);
}

/** Finishes a section the way the author does: the three hyphens typed on a line of their own, then Enter. */
function finishSection(target: WhisperEditor): void {
  target.editor.commands.focus('end');
  types(target, SECTION_MARK);
  press(target, 'Enter');
}

/** Puts writing in as a paste does — arriving whole, rather than being typed. */
function pastes(target: WhisperEditor, html: string): void {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const view = target.editor.view;
  const slice = HtmlParser.fromSchema(target.editor.schema).parseSlice(holder);
  view.dispatch(view.state.tr.replaceSelection(slice).setMeta('paste', true));
}

describe('finishing a section', () => {
  it('turns a line of three hyphens into a rule when Enter is pressed, and sends the section as Markdown', () => {
    const { whisper: w, sections } = whisper('<p>Hello <strong>loom</strong>.</p><p></p>');
    finishSection(w);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.markdown.trim()).toBe('Hello **loom**.');
    expect(w.html).toContain('<hr data-section-id=');
    // The author carries on in a fresh paragraph after the rule.
    types(w, 'next thought');
    expect(w.html).toMatch(/<hr[^>]*><p>next thought<\/p>$/);
  });

  it('leaves three hyphens inside a line as ordinary writing', () => {
    const { whisper: w, sections } = whisper('<p>before --- after</p>');
    w.editor.commands.focus('end');
    press(w, 'Enter');
    expect(sections).toHaveLength(0);
    expect(w.html).not.toContain('<hr');
  });

  it('leaves a pasted line of three hyphens as writing: it was never the author\'s signal', () => {
    const { whisper: w, sections } = whisper('<p></p>');
    w.editor.commands.focus('end');
    // Writing pasted in from somewhere else, ending in a line that reads exactly like the signal.
    pastes(w, '<p>a pasted note</p><p>---</p>');
    press(w, 'Enter');
    expect(sections).toHaveLength(0);
    expect(w.html).not.toContain('<hr');
    expect(w.html).toContain('<p>---</p>');
    // Ctrl+Enter still finishes the section wherever the caret is, for when that is what the author means.
    press(w, 'Enter', { ctrlKey: true });
    expect(sections).toHaveLength(1);
  });

  it('sends only the section just finished, not the ones before it', () => {
    const { whisper: w, sections } = whisper('<p>first</p><p></p>');
    finishSection(w);
    types(w, 'second');
    press(w, 'Enter', { ctrlKey: true });
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

describe('the whisper file', () => {
  it('round-trips through XHTML, keeping replies and section rules', () => {
    const { whisper: w, sections } = whisper('<p>Hello &amp; <em>welcome</em></p><p></p>');
    finishSection(w);
    const replyId = w.placeReply(sections[0]?.sectionId ?? '');
    w.setReply(replyId, 'A **reply**', 'finished');

    const file = toXhtml({ title: 'A & B', conversationId: 'conversation-1', bodyHtml: w.html });
    expect(file.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
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
