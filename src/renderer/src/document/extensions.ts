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

/**
 * Keeps a reply being written the assistant's alone: any change the author's typing would make inside it (or to it)
 * is refused. Once the reply is finished it is the author's like the rest of the document.
 */
export const ProtectBusyReplies = Extension.create({
  name: 'protectBusyReplies',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('protectBusyReplies'),
        filterTransaction: (transaction, state) => {
          if (!transaction.docChanged || transaction.getMeta(ASSISTANT_META) === true) return true;
          const size = state.doc.content.size;
          let touchesBusyReply = false;
          for (const step of transaction.steps) {
            step.getMap().forEach((oldStart, oldEnd) => {
              state.doc.nodesBetween(Math.max(0, oldStart - 1), Math.min(size, oldEnd + 1), (node, position) => {
                if (touchesBusyReply) return false;
                if (!replyIsBusy(node)) return true;
                // A change overlapping the reply is refused; one that only meets its outer edge — typing just before
                // or just after it — is not.
                if (oldStart < position + node.nodeSize && oldEnd > position) touchesBusyReply = true;
                return false;
              });
            });
          }
          return !touchesBusyReply;
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

  addKeyboardShortcuts() {
    const finish = (replaceMarkParagraph: boolean): boolean => {
      const { state, view } = this.editor;
      const { selection, schema } = state;
      if (!selection.empty) return false;
      const $caret = selection.$from;
      const block = $caret.parent;
      if ($caret.depth < 1) return false;
      // The three-hyphen line counts only as a paragraph of its own at the top level of the whisper.
      if (
        replaceMarkParagraph &&
        (block.type.name !== 'paragraph' || $caret.depth !== 1 || $caret.parentOffset !== block.content.size || block.textContent.trim() !== SECTION_MARK)
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

    return {
      Enter: () => finish(true),
      'Mod-Enter': () => finish(false),
    };
  },
});
