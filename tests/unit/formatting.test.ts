// @vitest-environment happy-dom
// Shaping the writing: the Format commands over the whisper, what the menu says about them where the caret is, the
// keys that carry them out, and what may be pasted in.
import { beforeEach, describe, expect, it } from 'vitest';
import { DOMParser as HtmlParser, Slice } from '@tiptap/pm/model';
import { WhisperEditor } from '../../src/renderer/src/document/whisper-editor';
import { pasteWithoutRecord } from '../../src/renderer/src/document/paste';
import { readAddress } from '../../src/renderer/src/panels/link-panel';
import { headingIdentity } from '../../src/renderer/src/document/extensions';
import { isWhisperAddress, readWhisperLink } from '../../src/shared/whispers';
import { MenuBar } from '../../src/renderer/src/menu/menubar';
import { MENUS } from '../../src/renderer/src/menu/model';
import type { AnyCommandId } from '../../src/renderer/src/commands';

const open: WhisperEditor[] = [];
/** The addresses the whisper has been asked to follow, in order.  */
let followed: string[] = [];

function whisper(html: string): WhisperEditor {
  const element = document.createElement('div');
  document.body.append(element);
  followed = [];
  const made = new WhisperEditor({
    element,
    html,
    onSectionFinished: () => undefined, onNothingToSend: () => undefined,
    onChange: () => undefined,
    onFollowLink: (address) => followed.push(address),
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
    // Every heading is given an identity of its own, so a link can point at it (see "a heading's identity").
    expect(w.html).toContain('<h2 id="a-title">a title</h2>');
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

describe('what the menu and the shortcuts say about the writing', () => {
  it('says a heading is a heading even when the whole of it is selected', () => {
    const w = whisper('<p>a line to shape</p>');
    w.editor.commands.focus('end');
    w.editor.commands.selectAll();
    w.format('format.heading2');
    // The caret sits inside no block when everything is selected; what matters is what the writing is.
    expect(w.formatStanding('format.heading2').checked).toBe(true);
    expect(w.formatStanding('format.paragraph').checked).toBe(false);
  });

  it('says nothing is on when the writing selected is of two kinds', () => {
    const w = whisper('<h2 id="a">A heading</h2><p>and a paragraph</p>');
    w.editor.commands.selectAll();
    expect(w.formatStanding('format.heading2').checked).toBe(false);
    expect(w.formatStanding('format.paragraph').checked).toBe(false);
  });

  it('says a list is a list when the whole of it is selected', () => {
    const w = whisper('<ul><li><p>one</p></li><li><p>two</p></li></ul>');
    w.editor.commands.selectAll();
    expect(w.formatStanding('format.bulletList').checked).toBe(true);
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

  it("take a whisper's file name as a link to it, written as a browser reads addresses", () => {
    expect(readAddress('2026-09-14 1532 A named conversation.xhtml')).toEqual({
      address: '2026-09-14%201532%20A%20named%20conversation.xhtml',
    });
    expect(isWhisperAddress('2026-09-14 1532 A named conversation.xhtml')).toBe(true);
    // Only a plain name in the alcove: nothing that reaches out of it, and nothing with a scheme of its own.
    expect(isWhisperAddress('../elsewhere/secret.xhtml')).toBe(false);
    expect(isWhisperAddress('https://example.com/page.xhtml')).toBe(false);
    expect(isWhisperAddress('notes.txt')).toBe(false);
  });

  it('point into a whisper, at a heading, and keep the two apart', () => {
    expect(readAddress('A whisper.xhtml#what-the-loom-is')).toEqual({ address: 'A%20whisper.xhtml#what-the-loom-is' });
    expect(readWhisperLink('A%20whisper.xhtml#what-the-loom-is')).toEqual({ name: 'A whisper.xhtml', heading: 'what-the-loom-is' });
    // A heading alone points into the whisper the author is already in.
    expect(readWhisperLink('#what-the-loom-is')).toEqual({ name: '', heading: 'what-the-loom-is' });
    expect(readWhisperLink('https://example.com/#section')).toBeUndefined();
  });
});

describe('a heading\'s identity', () => {
  it('is made from the words it was written with', () => {
    expect(headingIdentity('What the loom is')).toBe('what-the-loom-is');
    expect(headingIdentity('  Spaces, and punctuation!  ')).toBe('spaces-and-punctuation');
    expect(headingIdentity('!!!')).toBe('section');
  });

  it('is made when the heading is, and never taken back when it is reworded', () => {
    const w = whisper('<p>What the loom is</p>');
    w.editor.commands.focus('end');
    w.format('format.heading2');
    expect(w.html).toContain('<h2 id="what-the-loom-is">');

    // Reworded, the heading keeps the identity a link may already point at.
    const heading = w.editor.state.doc.firstChild;
    w.editor.commands.setTextSelection({ from: 1, to: (heading?.nodeSize ?? 2) - 1 });
    w.editor.commands.insertContent('Something else entirely');
    expect(w.html).toContain('<h2 id="what-the-loom-is">Something else entirely</h2>');
  });

  it('is never shared by two headings, however one of them arrived', () => {
    const w = whisper('<h2 id="a-heading">A heading</h2><p>words</p>');
    w.editor.commands.focus('end');
    // A second heading of the same words — pasted, or written again — takes an identity of its own.
    w.editor.commands.insertContent('<h2>A heading</h2>');
    const identities = [...w.html.matchAll(/<h2 id="([^"]+)"/g)].map((found) => found[1]);
    expect(identities).toHaveLength(2);
    expect(new Set(identities).size).toBe(2);
    expect(identities).toContain('a-heading');
  });
});

describe('a whisper being renamed', () => {
  it('points its own links at where it now is, and leaves every other link alone', () => {
    const old = encodeURIComponent('2026-09-14 1532 Untitled whisper.xhtml');
    const w = whisper(
      `<p><a href="${old}">itself</a> <a href="${old}#a-section">into itself</a>` +
        '<a href="Another whisper.xhtml">elsewhere</a><a href="https://example.com/">out there</a></p>',
    );
    w.renameLinks('2026-09-14 1532 Untitled whisper.xhtml', '2026-09-14 1532 Named at last.xhtml');
    const now = encodeURIComponent('2026-09-14 1532 Named at last.xhtml');
    expect(w.html).toContain(`href="${now}"`);
    expect(w.html).toContain(`href="${now}#a-section"`);
    expect(w.html).toContain('href="Another whisper.xhtml"');
    expect(w.html).toContain('href="https://example.com/"');
    expect(w.html).not.toContain(old);
  });
});

describe('the heading a link leads to', () => {
  it('is marked, and stays marked while the whisper is redrawn around it', () => {
    const w = whisper('<h2 id="first">First</h2><p>words</p><h2 id="second">Second</h2><p>more</p>');
    expect(w.goToHeading('second')).toBe(true);
    const marked = (): string[] => [...w.editor.view.dom.querySelectorAll('.is-found')].map((found) => found.textContent ?? '');
    expect(marked()).toEqual(['Second']);

    // A reply arriving, or a conversation catching up, redraws the whisper; the mark is the editor's own and stays.
    w.appendReply('an answer that arrived meanwhile', null);
    expect(marked()).toEqual(['Second']);
  });

  it('says nothing is there when the whisper holds no such heading', () => {
    const w = whisper('<h2 id="first">First</h2>');
    expect(w.goToHeading('no-such-section')).toBe(false);
  });
});

describe('following a link', () => {
  /** Clicks in the whisper the way the editor sees it, with or without Ctrl held. */
  function clicks(target: WhisperEditor, position: number, withCtrl: boolean): boolean {
    const view = target.editor.view;
    const event = new MouseEvent('click', { ctrlKey: withCtrl, bubbles: true, cancelable: true });
    return view.someProp('handleClick', (handle) => handle(view, position, event)) === true;
  }

  it('is Ctrl+click; a plain click only puts the caret in the writing', () => {
    const w = whisper('<p><a href="https://example.com/loom">the loom</a></p>');
    expect(clicks(w, 3, false)).toBe(false);
    expect(followed).toEqual([]);
    expect(clicks(w, 3, true)).toBe(true);
    expect(followed).toEqual(['https://example.com/loom']);
  });

  it('leaves Ctrl+click on ordinary writing alone', () => {
    const w = whisper('<p>no link here</p>');
    expect(clicks(w, 3, true)).toBe(false);
    expect(followed).toEqual([]);
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
