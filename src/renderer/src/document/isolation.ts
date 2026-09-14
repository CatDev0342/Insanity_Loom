// Section isolation: keeping Select All, and the keys that reach for the ends of the whisper, inside the section the
// author is working in.
//
// A section is what stands between one dividing line and the next — the writing of one turn, or of the reply to it.
// With isolation on, Ctrl+A takes the section the caret is in and nothing else; Ctrl+Shift+Home reaches back to the
// section's own beginning, Ctrl+Shift+End forward to its own end. With it off, all three mean the whole whisper, as
// they always have.
//
// It changes nothing about the document: only how far a reach goes.

import { Extension } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorState, Selection } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';

/** What divides one section from the next: the line that closes a turn, and the assistant's reply. */
const DIVIDES = new Set(['horizontalRule', 'reply']);

export interface SectionIsolationOptions {
  /** Whether isolation is on. Asked each time a key is pressed, so turning it on and off takes effect at once. */
  isolating: () => boolean;
}

/** Where the section holding this position begins and ends, in the document's own positions. */
export function sectionAround(doc: ProseMirrorNode, position: number): { readonly from: number; readonly to: number } {
  let from = 0;
  let offset = 0;
  for (let index = 0; index < doc.childCount; index++) {
    const node = doc.child(index);
    const ends = offset + node.nodeSize;
    if (DIVIDES.has(node.type.name)) {
      // Standing inside a reply: the reply is the section, and nothing beyond it.
      if (position > offset && position < ends) return { from: offset, to: ends };
      // A dividing thing before the caret begins the section; the first one after it ends the section.
      if (ends <= position) from = ends;
      else return { from, to: offset };
    }
    offset = ends;
  }
  return { from, to: doc.content.size };
}

/** What Select All takes with isolation on: the writing of the section the caret is in. */
export function isolatedSelection(state: EditorState, caret = state.selection.from): Selection {
  const { from, to } = sectionAround(state.doc, caret);
  return TextSelection.between(state.doc.resolve(from), state.doc.resolve(to));
}

/**
 * Where the caret really is, now.
 *
 * The browser moves the caret itself for keys the editor does not handle — Ctrl+End, a click, the arrows — and the
 * editor learns of it a moment later. A reach asked for in that moment would be measured from where the caret *was*,
 * and would take the wrong section: press Ctrl+End and then Ctrl+A quickly, and you would select the turn you had
 * just left. So the page is asked where the caret is, and the editor's own answer is used only if the page has none.
 */
export function caretNow(view: EditorView): number {
  const selection = view.dom.ownerDocument.getSelection();
  const focus = selection?.focusNode;
  if (focus === null || focus === undefined || !view.dom.contains(focus)) return view.state.selection.from;
  try {
    return view.posAtDOM(focus, selection?.focusOffset ?? 0);
  } catch {
    // A place the editor cannot make sense of: its own answer is the better one.
    return view.state.selection.from;
  }
}

export const SectionIsolation = Extension.create<SectionIsolationOptions>({
  name: 'sectionIsolation',

  addOptions() {
    return { isolating: () => false };
  },

  addKeyboardShortcuts() {
    const reach = (toEnd: boolean): boolean => {
      if (!this.options.isolating()) return false;
      const { state, view } = this.editor;
      const here = sectionAround(state.doc, caretNow(view));
      const anchor = state.selection.anchor;
      const head = toEnd ? here.to : here.from;
      view.dispatch(state.tr.setSelection(TextSelection.between(state.doc.resolve(anchor), state.doc.resolve(head))).scrollIntoView());
      return true;
    };

    return {
      'Mod-a': () => {
        if (!this.options.isolating()) return false;
        const { state, view } = this.editor;
        view.dispatch(state.tr.setSelection(isolatedSelection(state, caretNow(view))));
        return true;
      },
      'Shift-Mod-Home': () => reach(false),
      'Shift-Mod-End': () => reach(true),
    };
  },
});
