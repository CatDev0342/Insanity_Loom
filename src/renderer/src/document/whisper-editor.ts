// The whisper as an editable rich-text document: ProseMirror, through Tiptap. The author writes anywhere in it; the
// assistant's replies are woven in after the sections they answer. Everything the assistant does to the document is
// marked as the assistant's, so it never enters the author's undo history (see extensions.ts).

import { Editor, type JSONContent } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import type { NodeType, Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { ASSISTANT_META, newIdentity, ProtectBusyReplies, Reply, SectionKeys, SectionRule, type ReplyState } from './extensions';
import type { WhisperRecord } from '../loom/catch-up';
import { afterRule, findReply, isBlank, sectionContent } from './sections';

// How many of the author's changes Ctrl+Z can take back.
const UNDO_DEPTH = 500;

export interface WhisperEditorOptions {
  readonly element: HTMLElement;
  /** The whisper's content to begin with, as HTML. */
  readonly html: string;
  /** Called when the author finishes a section, with its identity and its writing as Markdown. */
  readonly onSectionFinished: (sectionId: string, markdown: string) => void;
  /** Called after every change to the document, by the author or the assistant. */
  readonly onChange: () => void;
}

export class WhisperEditor {
  readonly editor: Editor;

  constructor(options: WhisperEditorOptions) {
    this.editor = new Editor({
      element: options.element,
      content: options.html === '' ? '<p></p>' : options.html,
      extensions: [
        StarterKit.configure({
          horizontalRule: false,
          undoRedo: { depth: UNDO_DEPTH },
          // Links are text in the document; following one is a deliberate act, not a stray click while writing.
          link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
        }),
        SectionRule,
        Reply,
        ProtectBusyReplies,
        SectionKeys.configure({ onSectionFinished: (sectionId) => this.sectionFinished(sectionId, options.onSectionFinished) }),
        Markdown,
      ],
      editorProps: {
        attributes: {
          class: 'whisper-editor',
          'aria-label': 'Whisper',
          spellcheck: 'true',
        },
      },
      onUpdate: () => options.onChange(),
    });
  }

  /** A node type of the whisper's schema, by name; its absence is a fault in the editor's own setup. */
  private nodeType(name: string): NodeType {
    const type = this.editor.schema.nodes[name];
    if (type === undefined) throw new Error(`The whisper editor has no "${name}" node.`);
    return type;
  }

  private get doc(): ProseMirrorNode {
    return this.editor.state.doc;
  }

  private sectionFinished(sectionId: string, report: WhisperEditorOptions['onSectionFinished']): void {
    const content = sectionContent(this.doc, sectionId);
    if (content === undefined) return;
    report(sectionId, this.toMarkdown(content));
  }

  private toMarkdown(content: JSONContent): string {
    const markdown = this.editor.markdown;
    if (markdown === undefined) throw new Error('The whisper editor has no Markdown support.');
    return markdown.serialize(content);
  }

  private fromMarkdown(text: string): JSONContent[] {
    const markdown = this.editor.markdown;
    if (markdown === undefined) throw new Error('The whisper editor has no Markdown support.');
    const parsed = markdown.parse(text);
    return parsed.content !== undefined && parsed.content.length > 0 ? parsed.content : [{ type: 'paragraph' }];
  }

  /** Applies a change as the assistant's: allowed inside a reply being written, and never in the author's undo. */
  private asAssistant(change: (transaction: Transaction) => void): void {
    const transaction = this.editor.state.tr;
    change(transaction);
    transaction.setMeta(ASSISTANT_META, true).setMeta('addToHistory', false);
    this.editor.view.dispatch(transaction);
  }

  private replyNode(attributes: { replyId: string; answers: string | null; state: ReplyState }, content: JSONContent[]): ProseMirrorNode {
    return this.editor.schema.nodeFromJSON({ type: 'reply', attrs: attributes, content });
  }

  /** Places an empty reply, waiting its turn, right after the rule of the section it answers. Returns its identity. */
  placeReply(sectionId: string): string {
    const replyId = newIdentity();
    this.asAssistant((transaction) => {
      const position = afterRule(transaction.doc, sectionId);
      const at = position === -1 ? transaction.doc.content.size : position;
      transaction.insert(at, this.replyNode({ replyId, answers: sectionId, state: 'waiting' }, [{ type: 'paragraph' }]));
    });
    return replyId;
  }

  /** Replaces a reply's writing with this Markdown, rendered as rich text. */
  setReply(replyId: string, markdown: string, state: ReplyState): void {
    this.asAssistant((transaction) => {
      const found = findReply(transaction.doc, replyId);
      if (found === undefined) return;
      const attributes = { replyId, answers: (found.node.attrs['answers'] as string | null) ?? null, state };
      transaction.replaceWith(found.position, found.position + found.node.nodeSize, this.replyNode(attributes, this.fromMarkdown(markdown)));
    });
  }

  setReplyState(replyId: string, state: ReplyState): void {
    this.asAssistant((transaction) => {
      const found = findReply(transaction.doc, replyId);
      if (found === undefined) return;
      transaction.setNodeMarkup(found.position, undefined, { ...found.node.attrs, state });
    });
  }

  /** Adds, at the end, a section the author wrote earlier (from a resumed conversation's history), with its rule. */
  appendAuthorSection(markdown: string): string {
    const sectionId = newIdentity();
    this.asAssistant((transaction) => {
      const blocks = this.fromMarkdown(markdown).map((block) => this.editor.schema.nodeFromJSON(block));
      transaction.insert(this.endBeforeTrailingBlank(transaction.doc), [...blocks, this.nodeType('horizontalRule').create({ sectionId })]);
    });
    return sectionId;
  }

  /** Adds, at the end, a finished reply from a resumed conversation's history. */
  appendReply(markdown: string, answers: string | null): void {
    this.asAssistant((transaction) => {
      const reply = this.replyNode({ replyId: newIdentity(), answers, state: 'finished' }, this.fromMarkdown(markdown));
      transaction.insert(this.endBeforeTrailingBlank(transaction.doc), reply);
    });
  }

  /** The end of the whisper, before the empty paragraph the author writes in, if it ends with one. */
  private endBeforeTrailingBlank(doc: ProseMirrorNode): number {
    const last = doc.lastChild;
    const trailingBlank = last !== null && last.type.name === 'paragraph' && last.childCount === 0;
    return trailingBlank ? doc.content.size - last.nodeSize : doc.content.size;
  }

  /** Empties the whisper — for a new conversation — without it entering the author's undo. */
  clear(): void {
    this.asAssistant((transaction) => {
      transaction.replaceWith(0, transaction.doc.content.size, this.nodeType('paragraph').create());
    });
  }

  /** What the whisper already holds of its conversation: finished sections, and the last reply's state. */
  get record(): WhisperRecord {
    let sections = 0;
    let lastReply: WhisperRecord['lastReply'];
    this.doc.forEach((node) => {
      if (node.type.name === 'horizontalRule' && typeof node.attrs['sectionId'] === 'string') sections += 1;
      if (node.type.name === 'reply') {
        lastReply = { replyId: node.attrs['replyId'] as string, finished: node.attrs['state'] === 'finished' };
      }
    });
    return lastReply === undefined ? { sections } : { sections, lastReply };
  }

  get isBlank(): boolean {
    return isBlank(this.doc);
  }

  get html(): string {
    return this.editor.getHTML();
  }

  get hasFocus(): boolean {
    return this.editor.isFocused;
  }

  focus(): void {
    this.editor.commands.focus('end');
  }

  undo(): void {
    this.editor.commands.undo();
  }

  redo(): void {
    this.editor.commands.redo();
  }
}
