// What a whisper is made of, beyond ordinary rich text: the dividing line that closes a turn of the conversation, and
// the assistant's reply that follows it.
//
// - A **section rule** is a dividing line with an identity, a turn number and the local time the turn was taken. The
//   author makes one with Ctrl+Enter, which closes the turn and sends everything written since the last one.
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
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/** How a reply stands. Only a finished (or stopped, or failed) reply may be edited by the author. */
export type ReplyState = 'waiting' | 'writing' | 'finished' | 'stopped' | 'failed';

/** Marks a transaction as the assistant's: it may change a reply being written, and never enters the author's undo. */
export const ASSISTANT_META = 'insanity-loom:assistant';

export function newIdentity(): string {
  return crypto.randomUUID();
}

/** How a turn's time is written for the author to read: the local date and time, as their own system writes them. */
export function shownTime(when: Date): string {
  return when.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * The dividing line that closes a turn: its identity, which turn of the conversation it was, and when it was taken.
 *
 * The time is kept twice on purpose. `data-when` is the moment itself, as a machine reads it, for anything that must
 * sort or reckon with it. `data-shown` is the same moment as the author reads it, in their own local way of writing
 * dates, because that is what the page shows — in Insanity_Loom and in a browser opening the file, where there is no
 * program to format anything.
 */
export const SectionRule = HorizontalRule.extend({
  addAttributes() {
    return {
      sectionId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-section-id'),
        renderHTML: (attributes: { sectionId?: string | null }) =>
          attributes.sectionId ? { 'data-section-id': attributes.sectionId } : {},
      },
      turn: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-turn'),
        renderHTML: (attributes: { turn?: string | null }) => (attributes.turn ? { 'data-turn': attributes.turn } : {}),
      },
      when: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-when'),
        renderHTML: (attributes: { when?: string | null }) => (attributes.when ? { 'data-when': attributes.when } : {}),
      },
      shown: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-shown'),
        renderHTML: (attributes: { shown?: string | null }) => (attributes.shown ? { 'data-shown': attributes.shown } : {}),
      },
    };
  },
  // Nothing the author types makes a rule: a turn is closed by Ctrl+Enter and by nothing else (see SectionKeys).
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

/** How many turns the whisper already holds: the number of section rules in it. */
export function turnsSoFar(doc: ProseMirrorNode): number {
  let turns = 0;
  doc.forEach((node) => {
    if (node.type.name === 'horizontalRule') turns += 1;
  });
  return turns;
}

/** The end of the whisper, before the empty paragraph the author writes in, if it ends with one. */
export function endOfWhisper(doc: ProseMirrorNode): number {
  const last = doc.lastChild;
  const trailingBlank = last !== null && last.type.name === 'paragraph' && last.childCount === 0;
  return trailingBlank ? doc.content.size - last.nodeSize : doc.content.size;
}

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

/** What a heading with no words of its own is called, so that it can still be linked to. */
const UNNAMED_HEADING = 'section';

/** How long a heading's identity may be, so that a link stays readable. */
const LONGEST_HEADING_IDENTITY = 60;

/**
 * A heading's identity, from the words it was written with: lower case, spaces as hyphens, nothing else — the shape
 * of a wiki's anchors, so `a-whisper.xhtml#what-the-loom-is` reads as what it points at.
 */
export function headingIdentity(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LONGEST_HEADING_IDENTITY)
    .replace(/-+$/, '');
  return slug === '' ? UNNAMED_HEADING : slug;
}

/** The same identity, made one no other heading in the whisper has yet. */
function freeIdentity(wanted: string, taken: ReadonlySet<string>): string {
  if (!taken.has(wanted)) return wanted;
  for (let next = 2; ; next++) {
    const tried = `${wanted}-${next}`;
    if (!taken.has(tried)) return tried;
  }
}

/**
 * Every heading in a whisper carries an identity of its own, so a link can point at it: `#what-the-loom-is`, in this
 * whisper or from another.
 *
 * The identity is made from the heading's words when it is first written, and **never changes afterwards** — not when
 * the heading is reworded, not when it is moved, not when the whisper is renamed. A link that was right once stays
 * right. Two headings never share one: a heading copied from elsewhere is given a fresh identity, because the link
 * would otherwise land on whichever came first.
 *
 * Headings inside a reply the assistant is still writing are left until it is finished; nothing may change one of
 * those (ProtectBusyReplies), and the reply is rewritten with every piece that arrives in any case.
 */
export const HeadingIdentities = Extension.create({
  name: 'headingIdentities',

  addGlobalAttributes() {
    return [
      {
        types: ['heading'],
        attributes: {
          id: {
            default: null,
            parseHTML: (element) => element.getAttribute('id'),
            renderHTML: (attributes: { id?: string | null }) => (attributes.id ? { id: attributes.id } : {}),
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('headingIdentities'),
        appendTransaction: (transactions, _before, after) => {
          if (!transactions.some((transaction) => transaction.docChanged)) return null;
          const taken = new Set<string>();
          const toName: { readonly position: number; readonly identity: string }[] = [];
          after.doc.descendants((node, position) => {
            if (replyIsBusy(node)) return false;
            if (node.type.name !== 'heading') return node.isBlock && !node.isTextblock;
            const identity = node.attrs['id'];
            if (typeof identity === 'string' && identity !== '' && !taken.has(identity)) {
              taken.add(identity);
              return false;
            }
            const made = freeIdentity(headingIdentity(node.textContent), taken);
            taken.add(made);
            toName.push({ position, identity: made });
            return false;
          });
          if (toName.length === 0) return null;
          const transaction = after.tr;
          for (const { position, identity } of toName) transaction.setNodeAttribute(position, 'id', identity);
          // Naming a heading is the program's own housekeeping: it is not a change the author made, and Ctrl+Z has
          // nothing to take back.
          return transaction.setMeta('addToHistory', false);
        },
      }),
    ];
  },
});

/** Where the heading a link has just led to is remembered, so that it can be marked wherever it is drawn. */
const FOUND_HEADING = new PluginKey<string>('foundHeading');

/** Asks for a heading to be marked, by its identity; '' for none. */
export const FOUND_HEADING_META = 'insanity-loom:found-heading';

/**
 * Marks, for a moment, the heading a link has just led to, so the author's eye finds it.
 *
 * The mark is the editor's own — a decoration, not a class put on the page by hand. The whisper is redrawn whenever
 * anything changes it, and a reply arriving or a conversation catching up would wipe a mark written straight onto the
 * page within moments of the author getting there.
 */
export const MarkFoundHeading = Extension.create({
  name: 'markFoundHeading',

  addProseMirrorPlugins() {
    return [
      new Plugin<string>({
        key: FOUND_HEADING,
        state: {
          init: () => '',
          apply: (transaction, identity) => {
            const asked: unknown = transaction.getMeta(FOUND_HEADING_META);
            return typeof asked === 'string' ? asked : identity;
          },
        },
        props: {
          decorations: (state) => {
            const identity = FOUND_HEADING.getState(state) ?? '';
            if (identity === '') return null;
            const marks: Decoration[] = [];
            state.doc.descendants((node, position) => {
              if (node.type.name !== 'heading') return node.isBlock && !node.isTextblock;
              if (node.attrs['id'] === identity) marks.push(Decoration.node(position, position + node.nodeSize, { class: 'is-found' }));
              return false;
            });
            return DecorationSet.create(state.doc, marks);
          },
        },
      }),
    ];
  },
});

/**
 * A picture in a whisper.
 *
 * The editor keeps only what it knows, and what it does not know it drops — so a whisper holding a picture lost it the
 * moment it was opened, and the loss was written back to the file at the next save. A picture the author put there is
 * the author's; it is kept, with whatever it points at and whatever it was called, and written back as it came.
 */
export const Picture = Node.create({
  name: 'picture',
  group: 'inline',
  inline: true,
  draggable: true,

  addAttributes() {
    return {
      src: {
        default: '',
        parseHTML: (element) => element.getAttribute('src'),
        renderHTML: (attributes: { src?: string | null }) => (attributes.src ? { src: attributes.src } : {}),
      },
      alt: {
        default: null,
        parseHTML: (element) => element.getAttribute('alt'),
        renderHTML: (attributes: { alt?: string | null }) => (attributes.alt ? { alt: attributes.alt } : {}),
      },
      title: {
        default: null,
        parseHTML: (element) => element.getAttribute('title'),
        renderHTML: (attributes: { title?: string | null }) => (attributes.title ? { title: attributes.title } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'img[src]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)];
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

  addKeyboardShortcuts() {
    /**
     * Ctrl+Enter closes the turn. It closes it **at the end of the whisper**, wherever the caret happens to be: the
     * conversation has a horizon, and only what stands after the last turn is part of it. Writing further up is the
     * author's to change as they please and is never sent again, so a stray Ctrl+Enter while editing something
     * earlier cannot say it twice.
     */
    const closeTheTurn = (): boolean => {
      const { state, view } = this.editor;
      const { schema, doc } = state;
      const ruleType = schema.nodes['horizontalRule'];
      const paragraphType = schema.nodes['paragraph'];
      if (ruleType === undefined || paragraphType === undefined) return false;

      const sectionId = newIdentity();
      const when = new Date();
      const rule = ruleType.create({
        sectionId,
        turn: String(turnsSoFar(doc) + 1),
        when: when.toISOString(),
        shown: shownTime(when),
      });
      const end = endOfWhisper(doc);
      const transaction = state.tr.insert(end, [rule, paragraphType.create()]);
      // The caret goes to the fresh paragraph after the rule, where the author carries on while the reply arrives.
      const paragraphInside = end + rule.nodeSize + 1;
      transaction.setSelection(TextSelection.create(transaction.doc, paragraphInside)).scrollIntoView();
      // A turn that has been taken cannot be untaken: closing it is not an undo step, and it closes the author's undo
      // history there, so Ctrl+Z afterwards takes back only what they write next.
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
      // The deletion is made first, on its own, so that Enter is then pressed against what is really there.
      this.editor.commands.deleteSelection();
      // A selection reaching into a reply the assistant is still writing cannot be deleted, and Enter goes no
      // further: nothing at all happens, rather than the key being pressed again against what is still selected.
      if (!this.editor.state.selection.empty) return true;
      return this.editor.commands.keyboardShortcut('Enter');
    };

    return {
      Enter: () => acrossBlocks(),
      // Ctrl on Windows and Linux, Cmd on a Mac: whatever "Mod" is where the author is.
      'Mod-Enter': () => closeTheTurn(),
    };
  },
});
