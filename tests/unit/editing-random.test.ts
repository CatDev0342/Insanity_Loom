// @vitest-environment happy-dom
// Editing, tried at random. Typing, deleting, formatting, pasting and undoing are carried out in thousands of
// sequences no one would think to write by hand, and after every single change the whisper is asked to prove three
// things:
//
// 1. it is still a whisper — a document its own rules allow;
// 2. a reply the assistant is still writing holds exactly what the assistant wrote, and nothing the author did;
// 3. the author's undo takes back everything the author did, and only what the author did.
//
// The random sequences are the same ones every time: the numbers come from a counter of our own (see `nextRandom`),
// never from the machine's, so a failure here can be run again and watched.
import { beforeEach, describe, expect, it } from 'vitest';
import { DOMParser as HtmlParser } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { WhisperEditor } from '../../src/renderer/src/document/whisper-editor';

// How much randomized editing is done. Each sequence is a whisper of its own, edited from empty.
const SEQUENCES = 400;
const CHANGES_PER_SEQUENCE = 20;
// The starting number of the counter that stands in for randomness; any number would do, this one is written down.
const FIRST_SEED = 20260914;
// How long each of these may take. Thousands of editing steps take seconds rather than milliseconds, and the machines
// that run the tests on Windows and Linux are slower than the one they are written on.
const LONG_ENOUGH = 120_000;

/** The one source of randomness these tests use: the same numbers in the same order, every run. */
function nextRandom(state: { value: number }): number {
  // A small, well-known generator (mulberry32): a counter stirred into a fraction between 0 and 1.
  state.value = (state.value + 0x6d2b79f5) | 0;
  let stirred = state.value;
  stirred = Math.imul(stirred ^ (stirred >>> 15), stirred | 1);
  stirred ^= stirred + Math.imul(stirred ^ (stirred >>> 7), stirred | 61);
  return ((stirred ^ (stirred >>> 14)) >>> 0) / 4294967296;
}

function upTo(state: { value: number }, count: number): number {
  return Math.floor(nextRandom(state) * count);
}

function pickOne<T>(state: { value: number }, choices: readonly T[]): T {
  const chosen = choices[upTo(state, choices.length)];
  if (chosen === undefined) throw new Error('Nothing to pick from.');
  return chosen;
}

const WORDS = ['loom', 'whisper', 'alcove', 'a', 'the', 'quiet', 'thread', 'spool', 'night'];

const open: WhisperEditor[] = [];

function whisper(html: string): WhisperEditor {
  const element = document.createElement('div');
  document.body.append(element);
  const made = new WhisperEditor({ element, html, onSectionFinished: () => undefined, onChange: () => undefined, onFollowLink: () => undefined });
  open.push(made);
  return made;
}

beforeEach(() => {
  for (const made of open.splice(0)) made.editor.destroy();
  document.body.replaceChildren();
});

/**
 * A place in the whisper the author could put the caret, and a stretch of writing they could have selected from it.
 * Anywhere is tried, and the nearest place that can hold a caret is taken — a click between two blocks lands in one
 * of them, never between.
 */
function somewhere(target: WhisperEditor, state: { value: number }): { from: number; to: number } {
  const doc = target.editor.state.doc;
  const from = TextSelection.near(doc.resolve(upTo(state, doc.content.size + 1))).from;
  const to = TextSelection.near(doc.resolve(Math.min(doc.content.size, from + upTo(state, 6)))).to;
  return { from: Math.min(from, to), to: Math.max(from, to) };
}

/** One change of the author's, chosen at random. Every one is something their hands could do. */
function authorChanges(target: WhisperEditor, state: { value: number }): readonly (() => void)[] {
  const editor = target.editor;
  /** Puts the caret somewhere, as a click or an arrow key would, and hands back the writing from there. */
  const chain = (): ReturnType<typeof editor.chain> => editor.chain().setTextSelection(somewhere(target, state));
  /** Puts the caret somewhere, for the commands that act where it stands rather than through a chain of their own. */
  const goSomewhere = (): void => {
    editor.commands.setTextSelection(somewhere(target, state));
  };
  return [
    () => {
      chain().insertContent(pickOne(state, WORDS)).run();
    },
    () => {
      chain().insertContent(` ${pickOne(state, WORDS)} `).run();
    },
    () => {
      chain().deleteSelection().run();
    },
    () => {
      // Enter, through the editor's own key handling, so it does whatever it would really do where the caret is.
      editor.commands.setTextSelection(somewhere(target, state));
      pressEnter(target);
    },
    () => {
      goSomewhere();
      target.format('format.bold');
    },
    () => {
      goSomewhere();
      target.format('format.italic');
    },
    () => {
      goSomewhere();
      target.format('format.underline');
    },
    () => {
      goSomewhere();
      target.format(pickOne(state, ['format.heading1', 'format.heading2', 'format.paragraph'] as const));
    },
    () => {
      goSomewhere();
      target.format(pickOne(state, ['format.bulletList', 'format.orderedList', 'format.blockquote'] as const));
    },
    () => {
      goSomewhere();
      target.format('format.clear');
    },
    () => {
      goSomewhere();
      target.setLink('https://example.com/');
    },
    () => {
      goSomewhere();
      paste(target, state);
    },
    () => target.undo(),
    () => target.redo(),
  ];
}

/** Presses Enter where the caret is, as the keyboard would. */
function pressEnter(target: WhisperEditor): void {
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  target.editor.view.someProp('handleKeyDown', (handle) => handle(target.editor.view, event));
}

/** Pastes a piece of rich text, through the same handling a real paste goes through. */
function paste(target: WhisperEditor, state: { value: number }): void {
  const html = pickOne(state, [
    '<p>pasted words</p>',
    '<p>a <strong>bold</strong> line</p><p>and another</p>',
    '<ul><li><p>an item</p></li></ul>',
    '<blockquote><p>a quotation</p></blockquote>',
    // What a copy from a whisper itself carries: a section rule and a reply, neither of which may be pasted back in.
    '<p>before</p><hr data-section-id="copied" /><section data-author="assistant" data-reply-id="copied"><p>an answer</p></section>',
  ]);
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const view = target.editor.view;
  const parsed = HtmlParser.fromSchema(target.editor.schema).parseSlice(holder);
  const slice = view.someProp('transformPasted', (transform) => transform(parsed, view, false)) ?? parsed;
  view.dispatch(view.state.tr.replaceSelection(slice));
}

/** Throws if the whisper is no longer a document its own rules allow. */
function stillAWhisper(target: WhisperEditor): void {
  target.editor.state.doc.check();
}

describe('editing at random', () => {
  it("takes back everything the author did, and leaves the whisper whole along the way", () => {
    const state = { value: FIRST_SEED };
    for (let sequence = 0; sequence < SEQUENCES; sequence++) {
      const w = whisper('<p>a first line</p>');
      const before = w.html;
      const changes = authorChanges(w, state);
      for (let change = 0; change < CHANGES_PER_SEQUENCE; change++) {
        pickOne(state, changes)();
        stillAWhisper(w);
      }
      // Undone far enough to reach the beginning, however many changes were made — and undoing past the beginning
      // does nothing at all.
      for (let step = 0; step < CHANGES_PER_SEQUENCE * 2; step++) w.undo();
      stillAWhisper(w);
      expect(w.html).toBe(before);
      w.editor.destroy();
      open.pop();
    }
  }, LONG_ENOUGH);

  it("never lets the author's editing reach a reply the assistant is still writing", () => {
    const state = { value: FIRST_SEED + 1 };
    const written = 'the **answer**, still arriving';
    for (let sequence = 0; sequence < SEQUENCES; sequence++) {
      const w = whisper('<p>a question</p>');
      const replyId = w.placeReply('no-such-section');
      w.setReply(replyId, written, 'writing');
      const asTheAssistantLeftIt = w.html;
      const changes = authorChanges(w, state);
      for (let change = 0; change < CHANGES_PER_SEQUENCE; change++) {
        pickOne(state, changes)();
        stillAWhisper(w);
        // Whatever the author did, the reply being written still holds exactly what the assistant wrote.
        expect(w.html).toContain('<p>the <strong>answer</strong>, still arriving</p>');
      }
      // The author's undo never takes the assistant's writing back either.
      for (let step = 0; step < CHANGES_PER_SEQUENCE * 2; step++) w.undo();
      expect(w.html).toBe(asTheAssistantLeftIt);
      w.editor.destroy();
      open.pop();
    }
  }, LONG_ENOUGH);
});
