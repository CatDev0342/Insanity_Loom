// The ways the author shapes their writing: bold and italic, headings, lists, quotes, code, links. Each is one named
// command, so the Format menu, its keyboard shortcut and the test that exercises it all name the same thing and
// behave the same way.
//
// A command knows three things about itself: how to carry it out, whether it is on where the caret is, and whether it
// can act there at all. That last one keeps the menu honest — an entry that cannot act is drawn grey rather than
// doing nothing when chosen.

import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import { replyIsBusy } from './extensions';

/** The heading sizes a whisper offers: a title, a section and a lesser one. Deeper headings belong to the wiki. */
export const HEADING_LEVELS = [1, 2, 3] as const;
export type HeadingLevel = (typeof HEADING_LEVELS)[number];

export const FORMAT_COMMANDS = [
  'format.bold',
  'format.italic',
  'format.underline',
  'format.strikethrough',
  'format.code',
  'format.clear',
  'format.paragraph',
  'format.heading1',
  'format.heading2',
  'format.heading3',
  'format.bulletList',
  'format.orderedList',
  'format.blockquote',
  'format.codeBlock',
  'format.indent',
  'format.outdent',
  'format.link',
  'format.removeLink',
] as const;

export type FormatCommandId = (typeof FORMAT_COMMANDS)[number];

export function isFormatCommand(command: string): command is FormatCommandId {
  return (FORMAT_COMMANDS as readonly string[]).includes(command);
}

/** How a format command stands where the caret is: whether it can act, and whether what it does is already so. */
export interface FormatStanding {
  readonly enabled: boolean;
  readonly checked: boolean;
}

interface FormatAction {
  /** Carries the command out. The caret stays where it was; the author goes on writing. */
  readonly apply: (editor: Editor) => void;
  /** Whether what the command turns on is already so where the caret is. */
  readonly isOn: (editor: Editor) => boolean;
  /** Whether the command can act at all where the caret is. */
  readonly can: (editor: Editor) => boolean;
}

function mark(name: string): FormatAction {
  return {
    apply: (editor) => void editor.chain().focus().toggleMark(name).run(),
    isOn: (editor) => editor.isActive(name),
    can: (editor) => editor.can().toggleMark(name),
  };
}

function heading(level: HeadingLevel): FormatAction {
  return {
    apply: (editor) => void editor.chain().focus().toggleHeading({ level }).run(),
    isOn: (editor) => everyBlockIs(editor, 'heading', { level }),
    can: (editor) => editor.can().toggleHeading({ level }),
  };
}

/**
 * Whether every block of writing the author has selected is of this kind.
 *
 * The editor's own `isActive` answers for where the caret *sits*, and a selection that takes in whole blocks — Ctrl+A,
 * or dragging across paragraphs — sits inside none of them, so it would answer "no" however the writing is shaped. The
 * menu and the toolbar would then say a heading is not a heading the moment the author selected all of it.
 *
 * A selection that takes in writing of two kinds is not of either, which is what a word processor shows. Empty lines
 * are passed over: they are not writing of any kind.
 */
function everyBlockIs(editor: Editor, name: string, attributes: Record<string, unknown> = {}): boolean {
  const { state } = editor;
  const { from, to } = state.selection;
  if (from === to) return editor.isActive(name, attributes);
  let blocks = 0;
  let all = true;
  state.doc.nodesBetween(from, to, (node, position) => {
    if (!node.isTextblock) return true;
    // An empty line has no say in what the writing is. Selecting everything takes in the blank line the whisper keeps
    // at its end, and that must not make a heading stop looking like a heading.
    if (node.content.size === 0) return false;
    blocks += 1;
    // The block itself, and then everything it stands inside: a paragraph in a list item is in a list.
    all = all && (matches(node, name, attributes) || standsWithin(state, position + 1, name, attributes));
    return false;
  });
  return blocks > 0 && all;
}

function matches(node: ProseMirrorNode, name: string, attributes: Record<string, unknown>): boolean {
  if (node.type.name !== name) return false;
  return Object.entries(attributes).every(([key, value]) => node.attrs[key] === value);
}

/** Whether the writing at this position stands inside something of that kind — a list, a quotation. */
function standsWithin(state: EditorState, inside: number, name: string, attributes: Record<string, unknown>): boolean {
  const at = state.doc.resolve(Math.min(inside, state.doc.content.size));
  for (let depth = at.depth; depth >= 0; depth--) {
    if (matches(at.node(depth), name, attributes)) return true;
  }
  return false;
}

const ACTIONS: Readonly<Record<FormatCommandId, FormatAction>> = {
  'format.bold': mark('bold'),
  'format.italic': mark('italic'),
  'format.underline': mark('underline'),
  'format.strikethrough': mark('strike'),
  'format.code': mark('code'),
  // Clearing takes off every mark on the writing that is selected and returns its blocks to ordinary paragraphs, as
  // a word processor's "clear formatting" does.
  'format.clear': {
    apply: (editor) => void editor.chain().focus().unsetAllMarks().clearNodes().run(),
    isOn: () => false,
    can: (editor) => editor.can().chain().unsetAllMarks().clearNodes().run(),
  },
  'format.paragraph': {
    apply: (editor) => void editor.chain().focus().setParagraph().run(),
    isOn: (editor) => everyBlockIs(editor, 'paragraph'),
    can: (editor) => editor.can().setParagraph(),
  },
  'format.heading1': heading(1),
  'format.heading2': heading(2),
  'format.heading3': heading(3),
  'format.bulletList': {
    apply: (editor) => void editor.chain().focus().toggleBulletList().run(),
    isOn: (editor) => everyBlockIs(editor, 'bulletList'),
    can: (editor) => editor.can().toggleBulletList(),
  },
  'format.orderedList': {
    apply: (editor) => void editor.chain().focus().toggleOrderedList().run(),
    isOn: (editor) => everyBlockIs(editor, 'orderedList'),
    can: (editor) => editor.can().toggleOrderedList(),
  },
  'format.blockquote': {
    apply: (editor) => void editor.chain().focus().toggleBlockquote().run(),
    isOn: (editor) => everyBlockIs(editor, 'blockquote'),
    can: (editor) => editor.can().toggleBlockquote(),
  },
  'format.codeBlock': {
    apply: (editor) => void editor.chain().focus().toggleCodeBlock().run(),
    isOn: (editor) => everyBlockIs(editor, 'codeBlock'),
    can: (editor) => editor.can().toggleCodeBlock(),
  },
  // Indenting is what Tab does in a list, and the only place either can act: a list item moves in under the item
  // above it, or back out again.
  'format.indent': {
    apply: (editor) => void editor.chain().focus().sinkListItem('listItem').run(),
    isOn: () => false,
    can: (editor) => editor.can().sinkListItem('listItem'),
  },
  'format.outdent': {
    apply: (editor) => void editor.chain().focus().liftListItem('listItem').run(),
    isOn: () => false,
    can: (editor) => editor.can().liftListItem('listItem'),
  },
  // The address is asked for in a panel, so the command itself only says whether one can be given here
  // (src/renderer/src/panels/link-panel.ts).
  'format.link': {
    apply: () => undefined,
    isOn: (editor) => editor.isActive('link'),
    can: (editor) => editor.can().setMark('link', { href: 'https://example.invalid' }),
  },
  'format.removeLink': {
    apply: (editor) => void editor.chain().focus().unsetMark('link').run(),
    isOn: () => false,
    can: (editor) => editor.isActive('link'),
  },
};

/**
 * Whether the selection lies in, or across, a reply the assistant is still writing. Such a reply is the assistant's
 * alone until it is finished (see extensions.ts), so nothing may be formatted there. The editor refuses the change in
 * any case; this is what lets the menu say so beforehand.
 */
export function touchesBusyReply(state: EditorState): boolean {
  let busy = false;
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node) => {
    if (busy) return false;
    if (!replyIsBusy(node)) return true;
    busy = true;
    return false;
  });
  return busy;
}

export function applyFormat(editor: Editor, command: FormatCommandId): void {
  ACTIONS[command].apply(editor);
}

export function formatStanding(editor: Editor, command: FormatCommandId): FormatStanding {
  const action = ACTIONS[command];
  if (!editor.isEditable || touchesBusyReply(editor.state)) return { enabled: false, checked: action.isOn(editor) };
  return { enabled: action.can(editor), checked: action.isOn(editor) };
}
