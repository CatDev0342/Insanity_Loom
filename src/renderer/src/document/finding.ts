// Finding writing in the whisper the author is in: Ctrl+F.
//
// Every place the writing appears is marked, and one of them — the one the author is at — is marked differently, as
// every editor does it. The marks are the editor's own (decorations), so they survive the whisper being redrawn by a
// reply arriving or a conversation catching up, and they change nothing: what is found is not an edit, nothing is
// saved, and Ctrl+Z has nothing to take back.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/** Where the writing looked for, and which of its places the author is at, are remembered. */
export const FINDING = new PluginKey<Finding>('finding');

/** Asks for other writing to be looked for, or for another of its places. */
export const FINDING_META = 'insanity-loom:finding';

export interface Finding {
  /** The writing looked for, as the author wrote it; '' when nothing is being looked for. */
  readonly looked: string;
  /** Which place the author is at, counted from zero; -1 when there are none. */
  readonly at: number;
}

export const NOTHING_FOUND: Finding = { looked: '', at: -1 };

/** Where the writing appears in the whisper, in the order it is read. */
export function placesFound(state: EditorState, looked: string): readonly { readonly from: number; readonly to: number }[] {
  const wanted = looked.toLowerCase();
  if (wanted === '') return [];
  const places: { from: number; to: number }[] = [];
  state.doc.descendants((node, position) => {
    if (!node.isText) return true;
    const writing = (node.text ?? '').toLowerCase();
    for (let at = writing.indexOf(wanted); at !== -1; at = writing.indexOf(wanted, at + wanted.length)) {
      places.push({ from: position + at, to: position + at + wanted.length });
    }
    return true;
  });
  return places;
}

/** What the author is told: which place they are at, of how many. */
export function foundSoFar(state: EditorState): { readonly at: number; readonly of: number } {
  const finding = FINDING.getState(state) ?? NOTHING_FOUND;
  const places = placesFound(state, finding.looked);
  return { at: places.length === 0 ? -1 : finding.at, of: places.length };
}

export const FindInWhisper = Extension.create({
  name: 'findInWhisper',

  addProseMirrorPlugins() {
    return [
      new Plugin<Finding>({
        key: FINDING,
        state: {
          init: () => NOTHING_FOUND,
          apply: (transaction, finding) => {
            const asked: unknown = transaction.getMeta(FINDING_META);
            if (asked !== undefined) return asked as Finding;
            // The whisper changed under the author's feet — a reply arriving — so the places are counted afresh and
            // the one they are at is kept within them.
            return finding;
          },
        },
        props: {
          decorations: (state) => {
            const finding = FINDING.getState(state) ?? NOTHING_FOUND;
            const places = placesFound(state, finding.looked);
            if (places.length === 0) return null;
            return DecorationSet.create(
              state.doc,
              places.map((place, index) =>
                Decoration.inline(place.from, place.to, { class: index === finding.at ? 'is-found-now' : 'is-found-too' }),
              ),
            );
          },
        },
      }),
    ];
  },
});
