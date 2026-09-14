// @vitest-environment happy-dom
// Shaping the writing: the Format commands over the whisper, what the menu says about them where the caret is, the
// keys that carry them out, and what may be pasted in.
import { beforeEach, describe, expect, it } from 'vitest';
import { DOMParser as HtmlParser, Slice } from '@tiptap/pm/model';
import { WhisperEditor } from '../../src/renderer/src/document/whisper-editor';
import { pasteWithoutRecord } from '../../src/renderer/src/document/paste';
import { readAddress } from '../../src/renderer/src/panels/link-panel';
import { MenuBar } from '../../src/renderer/src/menu/menubar';
import { MENUS } from '../../src/renderer/src/menu/model';
import type { AnyCommandId } from '../../src/renderer/src/commands';

const open: WhisperEditor[] = [];

function whisper(html: string): WhisperEditor {
  const element = document.createElement('div');
  document.body.append(element);
  const made = new WhisperEditor({
    element,
    html,
    onSectionFinished: () => undefined,
    onChange: () => undefined,
  });
  open.push(made);
  return made;
}

beforeEach(() => {
  for (const made of open.splice(0)) made.editor.destroy();
  document.body.replaceChildren();
});

/** Selects the whole of the whisper's first paragraph. */
function selectFirstParagraph(target: WhisperEditor): void {
  const first = target.editor.state.doc.firstChild;
  if (first === null) throw new Error('The whisper is empty.');
  target.editor.commands.setTextSelection({ from: 1, to: first.nodeSize - 1 });
}

describe('the Format commands', () => {
  it('turn a mark on and off over the selected writing', () => {
    const w = whisper('<p>plain words</p>');
    selectFirstParagraph(w);
    w.format('format.bold');
    expect(w.html).toContain('<strong>plain words</strong>');
    expect(w.formatStanding('format.bold').checked).toBe(true);
    w.format('format.bold');
    expect(w.html).not.toContain('<strong>');
  });

  it('make a heading of a paragraph, and a paragraph of a heading again', () => {
    const w = whisper('<p>a title</p>');
    w.editor.commands.focus('end');
    w.format('format.heading2');
    expect(w.html).toContain('<h2>a title</h2>');
    expect(w.formatStanding('format.heading2').checked).toBe(true);
    expect(w.formatStanding('format.paragraph').checked).toBe(false);
    w.format('format.paragraph');
    expect(w.html).toContain('<p>a title</p>');
  });

  it('make lists, and indent an item within one', () => {
    const w = whisper('<ul><li><p>first</p></li><li><p>second</p></li></ul>');
    // The caret in the second item: it may move in under the first, and then back out.
    w.editor.commands.setTextSelection(w.editor.state.doc.content.size - 3);
    expect(w.formatStanding('format.indent').enabled).toBe(true);
    w.format('format.indent');
    expect(w.html).toContain('<ul><li><p>first</p><ul><li><p>second</p></li></ul></li></ul>');
    w.format('format.outdent');
    expect(w.html).toContain('<ul><li><p>first</p></li><li><p>second</p></li></ul>');
  });

  it('take every mark off the writing and return it to an ordinary paragraph', () => {
    const w = whisper('<h2>a <strong>bold</strong> title</h2>');
    selectFirstParagraph(w);
    w.format('format.clear');
    expect(w.html).toContain('<p>a bold title</p>');
  });

  it('say a list cannot be indented where there is no list', () => {
    const w = whisper('<p>plain words</p>');
    w.editor.commands.focus('end');
    expect(w.formatStanding('format.indent').enabled).toBe(false);
  });
});

describe('links', () => {
  it('link the selected writing, and take the link off again', () => {
    const w = whisper('<p>the loom</p>');
    selectFirstParagraph(w);
    w.setLink('https://example.com/loom');
    expect(w.html).toContain('href="https://example.com/loom"');
    expect(w.linkAddress).toBe('https://example.com/loom');
    expect(w.formatStanding('format.removeLink').enabled).toBe(true);
    w.format('format.removeLink');
    expect(w.html).not.toContain('href=');
  });

  it('write the address in as its own text when nothing is selected', () => {
    const w = whisper('<p></p>');
    w.editor.commands.focus('end');
    w.setLink('https://example.com/');
    expect(w.html).toContain('>https://example.com/</a>');
  });

  it('take an address written without a scheme as a web address, and refuse what is not an address', () => {
    expect(readAddress('example.com/page')).toEqual({ address: 'https://example.com/page' });
    expect(readAddress('mailto:someone@example.com')).toEqual({ address: 'mailto:someone@example.com' });
    expect(readAddress('   ')).toEqual({ problem: 'Give an address for the link.' });
    expect(readAddress('https://')).toHaveProperty('problem');
  });
});

describe('a reply the assistant is still writing', () => {
  it('cannot be formatted, and the menu says so', () => {
    const w = whisper('<p>a question</p>');
    w.editor.commands.focus('end');
    const replyId = w.placeReply('no-such-section');
    w.setReply(replyId, 'the answer', 'writing');
    // The caret inside the reply being written: nothing there is the author's to shape yet.
    const at = w.editor.state.doc.content.size - 2;
    w.editor.commands.setTextSelection({ from: at - 3, to: at });
    expect(w.formatStanding('format.bold').enabled).toBe(false);
    w.format('format.bold');
    expect(w.html).not.toContain('<strong>');
    // Once it is finished it is the author's, like the rest of the whisper.
    w.setReplyState(replyId, 'finished');
    expect(w.formatStanding('format.bold').enabled).toBe(true);
  });
});

describe('pasting', () => {
  function pasted(target: WhisperEditor, html: string): Slice {
    const holder = document.createElement('div');
    holder.innerHTML = html;
    const slice = HtmlParser.fromSchema(target.editor.schema).parseSlice(holder);
    return pasteWithoutRecord(slice);
  }

  it('leaves ordinary rich text as it is', () => {
    const w = whisper('<p></p>');
    const slice = pasted(w, '<p>a <strong>bold</strong> line</p><ul><li><p>an item</p></li></ul>');
    expect(slice.content.childCount).toBe(2);
    expect(slice.content.firstChild?.type.name).toBe('paragraph');
  });

  it('leaves out a section rule, which names a section that was sent', () => {
    const w = whisper('<p></p>');
    const slice = pasted(w, '<p>before</p><hr data-section-id="abc" /><p>after</p>');
    const names: string[] = [];
    slice.content.forEach((node) => names.push(node.type.name));
    expect(names).toEqual(['paragraph', 'paragraph']);
  });

  it("brings a reply's writing in without the marking that says the assistant wrote it", () => {
    const w = whisper('<p></p>');
    const slice = pasted(w, '<section data-author="assistant" data-reply-id="r1"><p>the answer</p></section>');
    expect(slice.content.childCount).toBe(1);
    expect(slice.content.firstChild?.type.name).toBe('paragraph');
    expect(slice.content.firstChild?.textContent).toBe('the answer');
  });
});

describe('the Format keys', () => {
  function pressCtrl(letter: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: letter, ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    return event;
  }

  // One menu bar, as a page has one: it listens on the window for as long as the page lives, so the two cases are
  // tried on the same bar rather than on two that would both be listening.
  it('carry the command out where it can act, and leave the key alone where it cannot', () => {
    const bar = document.createElement('nav');
    document.body.append(bar);
    const run: AnyCommandId[] = [];
    let canFormat = true;
    new MenuBar(
      bar,
      MENUS,
      async (command) => {
        run.push(command);
      },
      () => ({ enabled: canFormat, checked: false }),
    );

    const carriedOut = pressCtrl('b');
    expect(run).toEqual(['format.bold']);
    // Nothing below the menu bar sees the key, so what it does is never carried out twice.
    expect(carriedOut.defaultPrevented).toBe(true);

    canFormat = false;
    const leftAlone = pressCtrl('b');
    expect(run).toEqual(['format.bold']);
    expect(leftAlone.defaultPrevented).toBe(false);
  });
});
