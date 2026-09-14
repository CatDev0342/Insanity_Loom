// What may be pasted into a whisper.
//
// Ordinary rich text — from a browser, a word processor, another whisper — comes in as it is; anything the whisper's
// own set of elements does not know is dropped by the editor itself. Two things of the whisper's own are never
// pasted, because they are not writing but record:
//
// - a **section rule** finishes a section and names it, and the assistant's replies are anchored to that name. A
//   pasted copy would either claim a name that is already taken or stand for a section that was never sent, so the
//   rule is left out and the writing around it comes in unbroken.
// - a **reply** is the assistant's, marked as theirs where the assistant wrote it. A pasted copy would be the
//   author's own writing wearing the assistant's mark, so the writing inside comes in and the mark does not.

import { Extension } from '@tiptap/core';
import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';

/** The pasted content with every section rule left out and every reply unwrapped into ordinary writing. */
function withoutRecord(fragment: Fragment): Fragment {
  const kept: ProseMirrorNode[] = [];
  fragment.forEach((node) => {
    if (node.type.name === 'horizontalRule') return;
    if (node.type.name === 'reply') {
      // The reply's writing comes in on its own, without the marking that says the assistant wrote it.
      withoutRecord(node.content).forEach((inner) => kept.push(inner));
      return;
    }
    if (node.content.childCount > 0) {
      kept.push(node.copy(withoutRecord(node.content)));
      return;
    }
    kept.push(node);
  });
  return Fragment.fromArray(kept);
}

export function pasteWithoutRecord(slice: Slice): Slice {
  const content = withoutRecord(slice.content);
  if (content.eq(slice.content)) return slice;
  // The open ends are given up: what is left is whole blocks, joined into the writing at the caret.
  return new Slice(content, 0, 0);
}

/** Keeps section rules and the assistant's marking out of what is pasted. */
export const WhisperPaste = Extension.create({
  name: 'whisperPaste',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('whisperPaste'),
        props: {
          transformPasted: (slice) => pasteWithoutRecord(slice),
        },
      }),
    ];
  },
});
