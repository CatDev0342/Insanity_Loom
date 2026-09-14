// Showing the author what section isolation means, while it is on.
//
// A section is what stands between one dividing line and the next — a turn of the author's writing, or the reply to
// it. The document does not wrap them in anything, which is what lets the author write and edit across them freely,
// so what is shown must be drawn rather than built.
//
// What is drawn is the section the author is **in**: it is lifted off the page — a lighter ground, a soft edge above
// and below — while everything else lies flat. That says exactly what a reach would take, and it moves with the
// author as they move. Bordering every section instead drew a box out of the edges of separate blocks, which broke
// wherever the blocks did (the designer, 2026-Sep-14).
//
// Nothing about the writing inside changes: not its size, its spacing, or its colour.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorState } from '@tiptap/pm/state';

import { sectionAround } from './isolation';

/** The blocks of the section the caret is in, drawn as one lifted panel. */
export function liftedSection(state: EditorState): DecorationSet {
  const here = sectionAround(state.doc, state.selection.from);
  const lifted: Decoration[] = [];
  const inside: { from: number; to: number }[] = [];
  state.doc.forEach((node, offset) => {
    const from = offset;
    const to = offset + node.nodeSize;
    if (from < here.from || to > here.to) return;
    inside.push({ from, to });
  });
  inside.forEach((block, index) => {
    const edges = [index === 0 ? 'lifted-opens' : '', index === inside.length - 1 ? 'lifted-closes' : ''].filter((one) => one !== '');
    lifted.push(Decoration.node(block.from, block.to, { class: ['lifted', ...edges].join(' ') }));
  });
  return DecorationSet.create(state.doc, lifted);
}

export interface SectionsDrawnOptions {
  /** Whether section isolation is on. Asked each time the whisper is drawn, so turning it on shows at once. */
  isolating: () => boolean;
}

export const SectionsDrawn = Extension.create<SectionsDrawnOptions>({
  name: 'sectionsDrawn',

  addOptions() {
    return { isolating: () => false };
  },

  addProseMirrorPlugins() {
    const { isolating } = this.options;
    return [
      new Plugin({
        key: new PluginKey('sectionsDrawn'),
        props: { decorations: (state) => (isolating() ? liftedSection(state) : null) },
      }),
    ];
  },
});
