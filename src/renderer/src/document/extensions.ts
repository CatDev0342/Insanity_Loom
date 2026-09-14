// What a whisper is made of, beyond ordinary rich text: the dividing line that finishes the author's section, and the
// assistant's reply that is woven in after it.
//
// - A **section rule** is a dividing line with an identity. The author makes one by typing a line of three hyphens and
//   pressing Enter (as in a word processor), or with Ctrl+Enter; it finishes the section above it, which is then sent.
// - A **reply** is the assistant's writing, in a block of its own, placed right after the rule of the section it
//   answers — found by the rule's identity, so it lands there however the author has edited elsewhere meanwhile.
//   While the assistant is still writing it, it is the assistant's; once finished, it is the author's to edit like any
//   of their own text, though it stays marked as the assistant's.
//
// The assistant's writing never enters the author's undo history: Ctrl+Z takes back only what the author did. Nor does
// finishing a section: once sent it cannot be unsent.

import { Extension, Node, mergeAttributes } from '@tiptap/core';
import HorizontalRule from '@tiptap/extension-horizontal-rule';
import { closeHistory } from '@tiptap/pm/history';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/** How a reply stands. Only a finished (or stopped, or failed) reply may be edited by the author. */
export type ReplyState = 'waiting' | 'writing' | 'finished' | 'stopped' | 'failed';

/** Marks a transaction as the assistant's: it may change a reply being written, and never enters the author's undo. */
export const ASSISTANT_META = 'insanity-loom:assistant';

/** The line of the author's writing that finishes a section, once surrounding spaces are ignored. */
export const SECTION_MARK = '---';

/**
 * Where the author has just typed a line of three hyphens — the one place Enter finishes a section.
 *
 * The signal is a thing the author *does*, not a piece of text that happens to be there. Three hyphens that arrived
 * any other way — pasted, dropped, brought in from the conversation's history — read exactly the same on the page but
 * were never a signal, and Enter after one leaves it as the writing it is. (Ctrl+Enter finishes a section wherever
 * the caret is, and says so plainly, for when that is what the author means.)
 */
const TYPED_SECTION_MARK = new PluginKey<number | null>('typedSectionMark');

export function newIdentity(): string {
  return crypto.randomUUID();
}

/** The dividing line that finishes a section, carrying the section's identity. */
export const SectionRule = HorizontalRule.extend({
  addAttributes() {
    return {
      sectionId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-section-id'),
        renderHTML: (attributes: { sectionId?: string | null }) =>
          attributes.sectionId ? { 'data-section-id': attributes.sectionId } : {},
      },
    };
  },
  // The word processor's habit is kept exactly: three hyphens become a line only when Enter is pressed (see
  // SectionKeys), not the moment the third is typed.
  addInputRules() {
    return [];
  },
});

export const Reply = Node.create({
  name: 'reply',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      replyId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-reply-id'),
        renderHTML: (attributes: { replyId?: string | null }) => ({ 'data-reply-id': attributes.replyId ?? '' }),
      },
      answers: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-answers'),
        renderHTML: (attributes: { answers?: string | null }) => (attributes.answers ? { 'data-answers': attributes.answers } : {}),
      },
      state: {
        default: 'finished',
        parseHTML: (element) => element.getAttribute('data-state') ?? 'finished',
        renderHTML: (attributes: { state?: ReplyState }) => ({ 'data-state': attributes.state ?? 'finished' }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'section[data-author="assistant"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['section', mergeAttributes(HTMLAttributes, { class: 'reply', 'data-author': 'assistant' }), 0];
  },
});

/** Whether a reply is still the assistant's alone to change. */
export function replyIsBusy(node: ProseMirrorNode): boolean {
  const state = node.attrs['state'] as ReplyState;
  return node.type.name === 'reply' && (state === 'waiting' || state === 'writing');
}

/** Every reply in a document, by its identity. */
function repliesById(doc: ProseMirrorNode): Map<string, ProseMirrorNode> {
  const found = new Map<string, ProseMirrorNode>();
  doc.descendants((node) => {
    if (node.type.name !== 'reply') return true;
    const replyId = node.attrs['replyId'];
    if (typeof replyId === 'string') found.set(replyId, node);
    // A reply holds no other reply.
    return false;
  });
  return found;
}

/**
 * Keeps a reply the assistant is still writing the assistant's alone: the author may not change a word of it, nor
 * take it away, until it is finished. Afterwards it is theirs like the rest of the whisper.
 *
 * What is asked of a change is only this: every reply being written is still there when the change is done, holding
 * exactly what the assistant wrote. Writing in one, or deleting one, fails that and is refused. Everything else is
 * allowed — including changes that reach across a reply without touching what is inside it, such as making a list of
 * the writing around it, or undoing something done before the reply arrived. Asking instead whether a change *reaches*
 * a reply would refuse those too, and an undo refused is an undo lost: the author would press Ctrl+Z and nothing at
 * all would happen, from then on.
 */
export const ProtectBusyReplies = Extension.create({
  name: 'protectBusyReplies',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('protectBusyReplies'),
        filterTransaction: (transaction, state) => {
          if (!transaction.docChanged || transaction.getMeta(ASSISTANT_META) === true) return true;
          const before = repliesById(state.doc);
          let busy = false;
          for (const node of before.values()) busy = busy || replyIsBusy(node);
          if (!busy) return true;
          const after = repliesById(transaction.doc);
          for (const [replyId, node] of before) {
            if (!replyIsBusy(node)) continue;
            const now = after.get(replyId);
            if (now === undefined || !now.content.eq(node.content)) return false;
          }
          return true;
        },
      }),
    ];
  },
});

export interface FollowLinksOptions {
  /** Called when the author asks to follow a link, with the address it carries. */
  onFollow: (address: string) => void;
}

/**
 * Following a link from inside the whisper. A plain click puts the caret in the writing, as it must in an editor, so
 * following is Ctrl+click — the same as in a word processor. Where the link goes is the loom's business
 * (src/renderer/src/loom/page.ts): another whisper opens in Insanity_Loom, and anything else is handed to the
 * system's browser.
 */
export const FollowLinks = Extension.create<FollowLinksOptions>({
  name: 'followLinks',

  addOptions() {
    return { onFollow: () => undefined };
  },

  addProseMirrorPlugins() {
    const { onFollow } = this.options;
    return [
      new Plugin({
        key: new PluginKey('followLinks'),
        props: {
          handleClick: (view, position, event) => {
            if (!event.ctrlKey && !event.metaKey) return false;
            const link = view.state.doc.resolve(position).marks().find((mark) => mark.type.name === 'link');
            const address = link?.attrs['href'];
            if (typeof address !== 'string' || address === '') return false;
            onFollow(address);
            return true;
          },
        },
      }),
    ];
  },
});

export interface SectionKeysOptions {
  /** Called when the author finishes a section, with the identity of the rule that finished it. */
  onSectionFinished: (sectionId: string) => void;
}

/**
 * The keys that finish a section:
 * - Enter at the end of a paragraph holding only three hyphens turns that paragraph into a section rule;
 * - Ctrl+Enter places a section rule after the block the caret is in.
 * Either way the author carries on writing in a fresh paragraph below the rule (and below the reply that will come).
 */
export const SectionKeys = Extension.create<SectionKeysOptions>({
  name: 'sectionKeys',

  addOptions() {
    return { onSectionFinished: () => undefined };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<number | null>({
        key: TYPED_SECTION_MARK,
        state: {
          init: () => null,
          apply: (transaction, typedAt, _before, after) => {
            // Nothing moves without the document changing, so what was remembered stays where it was.
            if (!transaction.docChanged) return typedAt;
            // Writing that arrived rather than being typed is not the author's signal, whatever it says.
            const arrived =
              transaction.getMeta('paste') === true ||
              transaction.getMeta('uiEvent') === 'drop' ||
              transaction.getMeta(ASSISTANT_META) === true;
            if (arrived) return null;
            const caret = after.selection.$from;
            if (caret.depth !== 1 || caret.parent.type.name !== 'paragraph') return null;
            return caret.parent.textContent.trim() === SECTION_MARK ? caret.before(1) : null;
          },
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    const finish = (replaceMarkParagraph: boolean): boolean => {
      const { state, view } = this.editor;
      const { selection, schema } = state;
      if (!selection.empty) return false;
      const $caret = selection.$from;
      const block = $caret.parent;
      if ($caret.depth < 1) return false;
      // The three-hyphen line counts only as a paragraph of its own at the top level of the whisper, and only where
      // the author typed it themselves (TYPED_SECTION_MARK).
      if (
        replaceMarkParagraph &&
        (block.type.name !== 'paragraph' ||
          $caret.depth !== 1 ||
          $caret.parentOffset !== block.content.size ||
          block.textContent.trim() !== SECTION_MARK ||
          TYPED_SECTION_MARK.getState(state) !== $caret.before(1))
      ) {
        return false;
      }

      const ruleType = schema.nodes['horizontalRule'];
      const paragraphType = schema.nodes['paragraph'];
      if (ruleType === undefined || paragraphType === undefined) return false;
      const sectionId = newIdentity();
      const blockStart = $caret.before(1);
      const blockEnd = $caret.after(1);
      const rule = ruleType.create({ sectionId });
      const transaction = replaceMarkParagraph
        ? state.tr.replaceWith(blockStart, blockEnd, [rule, paragraphType.create()])
        : state.tr.insert(blockEnd, [rule, paragraphType.create()]);
      // The caret goes to the fresh paragraph after the rule, where the author carries on.
      const ruleStart = replaceMarkParagraph ? blockStart : blockEnd;
      const paragraphInside = ruleStart + rule.nodeSize + 1;
      transaction.setSelection(TextSelection.create(transaction.doc, paragraphInside)).scrollIntoView();
      // A finished section is sent, and a sent section cannot be unsent: finishing it is not an undo step, and it
      // closes the author's undo history there, so Ctrl+Z afterwards takes back only what they write next.
      closeHistory(transaction).setMeta('addToHistory', false);
      view.dispatch(transaction);
      this.options.onSectionFinished(sectionId);
      return true;
    };

    /**
     * Enter with writing selected across two blocks — from a list item down into the paragraph below, say — is
     * carried out in two moves: what is selected goes first, and only then is the block split where the caret is
     * left. Splitting across the two at once asks ProseMirror to put the new block deeper than the place it goes,
     * which it refuses by throwing, and the author would lose the key entirely.
     */
    const acrossBlocks = (): boolean => {
      const { selection } = this.editor.state;
      if (selection.empty || selection.$from.sameParent(selection.$to)) return false;
      // The deletion is made first, on its own, so that Enter is then pressed against what is really there. The two
      // arrive one after the other, and the author's undo takes them back together.
      this.editor.commands.deleteSelection();
      // A selection reaching into a reply the assistant is still writing cannot be deleted, and Enter goes no
      // further: nothing at all happens, rather than the key being pressed again against what is still selected.
      if (!this.editor.state.selection.empty) return true;
      return this.editor.commands.keyboardShortcut('Enter');
    };

    return {
      Enter: () => finish(true) || acrossBlocks(),
      'Mod-Enter': () => finish(false),
    };
  },
});
