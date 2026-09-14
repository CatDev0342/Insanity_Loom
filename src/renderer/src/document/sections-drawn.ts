// Drawing each section of the conversation as a box of its own.
//
// A section is what stands between one dividing line and the next — a turn of the author's writing, or the reply to
// it. The document does not wrap them in anything: they are simply the blocks between two lines, which is what lets
// the author write and edit across them freely. So the boxes are drawn rather than built: each block is told whether
// it opens a section, closes it, or stands in the middle, and the sides are drawn to suit.
//
// Nothing about the writing inside changes — not its size, its spacing or its colour. The box is around it.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorState } from '@tiptap/pm/state';

/** What divides one section from the next. A reply is a section of its own and draws its own box. */
const DIVIDES = new Set(['horizontalRule', 'reply']);

/** Which blocks of the whisper open, continue and close each section, as classes for the page to draw. */
export function boxesFor(state: EditorState): DecorationSet {
  const boxes: Decoration[] = [];
  let opening = true;
  let previous: { readonly from: number; readonly to: number } | undefined;

  const close = (): void => {
    if (previous === undefined) return;
    boxes.push(Decoration.node(previous.from, previous.to, { class: 'section-closes' }));
    previous = undefined;
  };

  state.doc.forEach((node, offset) => {
    const from = offset;
    const to = offset + node.nodeSize;
    if (DIVIDES.has(node.type.name)) {
      close();
      opening = true;
      return;
    }
    // An empty line at the end of the whisper is where the author writes; it is not part of the section above it.
    boxes.push(Decoration.node(from, to, { class: opening ? 'section-opens section-inside' : 'section-inside' }));
    opening = false;
    previous = { from, to };
  });
  close();
  return DecorationSet.create(state.doc, boxes);
}

export const SectionsDrawn = Extension.create({
  name: 'sectionsDrawn',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('sectionsDrawn'),
        props: { decorations: (state) => boxesFor(state) },
      }),
    ];
  },
});
