// The whisper as an editable rich-text document: ProseMirror, through Tiptap. The author writes anywhere in it; the
// assistant's replies are woven in after the sections they answer. Everything the assistant does to the document is
// marked as the assistant's, so it never enters the author's undo history (see extensions.ts).

import { Editor, type JSONContent } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import { DOMParser as HtmlParser, type NodeType, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import {
  ASSISTANT_META,
  endOfWhisper,
  FollowLinks,
  FOUND_HEADING_META,
  HeadingIdentities,
  MarkFoundHeading,
  newIdentity,
  ProtectBusyReplies,
  Reply,
  SectionKeys,
  SectionRule,
  shownTime,
  turnsSoFar,
  type ReplyState,
} from './extensions';
import {
  FINDING,
  FindInWhisper,
  FINDING_META,
  foundSoFar,
  placesFound,
  placesToReplace,
  NOTHING_FOUND,
  type Finding,
} from './finding';
import { applyFormat, formatStanding, type FormatCommandId, type FormatStanding } from './formatting';
import { WhisperPaste } from './paste';
import { readWhisperLink } from '../../../shared/whispers';
import type { WhisperRecord } from '../loom/catch-up';
import { afterRule, findReply, isBlank, sectionContent } from './sections';

// How many of the author's changes Ctrl+Z can take back.
const UNDO_DEPTH = 500;

/** How long the heading a link has just led to stays marked, in milliseconds. */
const HEADING_FOUND_MS = 2000;

export interface WhisperEditorOptions {
  readonly element: HTMLElement;
  /** The whisper's content to begin with, as HTML. */
  readonly html: string;
  /** Called when the author finishes a section, with its identity and its writing as Markdown. */
  readonly onSectionFinished: (sectionId: string, markdown: string) => void;
  /** Called after every change to the document, by the author or the assistant. */
  readonly onChange: () => void;
  /** Called when the author Ctrl+clicks a link, with the address it carries. */
  readonly onFollowLink: (address: string) => void;
}

export class WhisperEditor {
  readonly editor: Editor;

  /** When the heading a link led to stops being marked. */
  private unmarkAt = 0;

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
        WhisperPaste,
        HeadingIdentities,
        MarkFoundHeading,
        FindInWhisper,
        FollowLinks.configure({ onFollow: (address) => options.onFollowLink(address) }),
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
  appendAuthorSection(markdown: string, when: Date = new Date()): string {
    const sectionId = newIdentity();
    this.asAssistant((transaction) => {
      const blocks = this.fromMarkdown(markdown).map((block) => this.editor.schema.nodeFromJSON(block));
      // A turn brought in from the conversation's history is still a turn, and is numbered in its place. The time is
      // the one this whisper learned of it, which is the best it can know: the history does not carry the hour.
      const rule = this.nodeType('horizontalRule').create({
        sectionId,
        turn: String(turnsSoFar(transaction.doc) + 1),
        when: when.toISOString(),
        shown: shownTime(when),
      });
      transaction.insert(endOfWhisper(transaction.doc), [...blocks, rule]);
    });
    return sectionId;
  }

  /** Adds, at the end, a finished reply from a resumed conversation's history. */
  appendReply(markdown: string, answers: string | null): void {
    this.asAssistant((transaction) => {
      const reply = this.replyNode({ replyId: newIdentity(), answers, state: 'finished' }, this.fromMarkdown(markdown));
      transaction.insert(endOfWhisper(transaction.doc), reply);
    });
  }

  /** Puts another whisper's content in place of this one — opening a whisper — outside the author's undo. */
  replaceAll(html: string): void {
    const holder = document.createElement('div');
    holder.innerHTML = html;
    const parsed = HtmlParser.fromSchema(this.editor.schema).parse(holder);
    this.asAssistant((transaction) => transaction.replaceWith(0, transaction.doc.content.size, parsed.content));
  }

  /** Empties the whisper — for a new conversation — without it entering the author's undo. */
  clear(): void {
    this.asAssistant((transaction) => {
      transaction.replaceWith(0, transaction.doc.content.size, this.nodeType('paragraph').create());
    });
  }

  /**
   * The whole whisper as Markdown, for tools that read Markdown rather than XHTML — the author's own library among
   * them. What the author wrote stands as it is; a section rule stays the line of three hyphens they typed; the
   * assistant's replies are quoted, which is how a Markdown reader shows writing that is someone else's, and which
   * mirrors the line down their left side here.
   */
  asMarkdown(): string {
    const pieces: string[] = [];
    this.doc.forEach((node) => {
      if (node.type.name === 'reply') {
        // The reply's own writing, not the reply node itself, which Markdown has no word for.
        const written = this.toMarkdown({ type: 'doc', content: node.content.toJSON() as JSONContent[] }).trim();
        pieces.push(
          written
            .split('\n')
            .map((line) => (line === '' ? '>' : `> ${line}`))
            .join('\n'),
        );
        return;
      }
      pieces.push(this.toMarkdown({ type: 'doc', content: [node.toJSON() as JSONContent] }).trim());
    });
    return `${pieces.filter((piece) => piece !== '').join('\n\n')}\n`;
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

  /** Carries out a Format command where the caret is (src/renderer/src/document/formatting.ts). */
  format(command: FormatCommandId): void {
    applyFormat(this.editor, command);
  }

  /** Whether a Format command can act where the caret is, and whether what it does is already so. */
  formatStanding(command: FormatCommandId): FormatStanding {
    return formatStanding(this.editor, command);
  }

  /**
   * Takes the author to the heading of this identity and marks it for a moment. False when the whisper holds no such
   * heading, so that the loom can say so.
   */
  goToHeading(identity: string): boolean {
    const found = this.headingElement(identity);
    if (found === undefined) return false;
    found.scrollIntoView({ block: 'center' });
    this.markHeading(identity);
    window.clearTimeout(this.unmarkAt);
    this.unmarkAt = window.setTimeout(() => this.markHeading(''), HEADING_FOUND_MS);
    return true;
  }

  /** Where a reply is drawn on the page, for keeping it in view as it is written. */
  replyElement(replyId: string): HTMLElement | undefined {
    const found = findReply(this.doc, replyId);
    if (found === undefined) return undefined;
    const drawn = this.editor.view.nodeDOM(found.position);
    return drawn instanceof HTMLElement ? drawn : undefined;
  }

  private headingElement(identity: string): HTMLElement | undefined {
    let position = -1;
    this.doc.descendants((node, at) => {
      if (position !== -1 || node.type.name !== 'heading') return node.isBlock && !node.isTextblock;
      if (node.attrs['id'] === identity) position = at;
      return false;
    });
    if (position === -1) return undefined;
    const drawn = this.editor.view.nodeDOM(position);
    return drawn instanceof HTMLElement ? drawn : undefined;
  }

  private markHeading(identity: string): void {
    // Marking nothing changes the document, so it neither saves nor enters the author's undo.
    this.editor.view.dispatch(this.editor.state.tr.setMeta(FOUND_HEADING_META, identity).setMeta('addToHistory', false));
  }

  /**
   * Points every link in this whisper that named one file at another — what a rename means for the whisper being
   * renamed itself, which may link to its own sections or back to itself. The whispers that are not open are put
   * right on disk (src/main/alcove.ts).
   */
  renameLinks(from: string, to: string): void {
    if (from === to) return;
    const linkType = this.editor.schema.marks['link'];
    if (linkType === undefined) return;
    const changes: { readonly from: number; readonly to: number; readonly address: string }[] = [];
    this.doc.descendants((node, position) => {
      if (!node.isText) return true;
      const link = node.marks.find((mark) => mark.type === linkType);
      const address = link?.attrs['href'];
      if (typeof address !== 'string') return true;
      const pointed = readWhisperLink(address);
      if (pointed === undefined || pointed.name !== from) return true;
      const heading = pointed.heading === '' ? '' : `#${encodeURIComponent(pointed.heading)}`;
      changes.push({ from: position, to: position + node.nodeSize, address: `${encodeURIComponent(to)}${heading}` });
      return true;
    });
    if (changes.length === 0) return;
    this.asAssistant((transaction) => {
      for (const change of changes) {
        transaction.addMark(change.from, change.to, linkType.create({ href: change.address }));
      }
    });
  }

  // ——— Finding writing in the whisper ———

  /**
   * Looks for writing in the whisper, marking every place it appears and taking the author to the first from where
   * they are. Says which place they are at, of how many.
   */
  find(looked: string): { readonly at: number; readonly of: number } {
    const places = placesFound(this.editor.state, looked);
    if (places.length === 0) {
      this.setFinding({ looked, at: -1 });
      return { at: -1, of: 0 };
    }
    // From where the author is standing, as every editor does: the next place at or after the caret.
    const caret = this.editor.state.selection.from;
    const next = places.findIndex((place) => place.from >= caret);
    return this.goToPlace(looked, next === -1 ? 0 : next, places.length);
  }

  /** The next place the writing appears, wrapping round to the first. */
  findNext(): { readonly at: number; readonly of: number } {
    return this.step(1);
  }

  /** The place before, wrapping round to the last. */
  findPrevious(): { readonly at: number; readonly of: number } {
    return this.step(-1);
  }

  private step(by: number): { readonly at: number; readonly of: number } {
    const finding = this.findingNow;
    const places = placesFound(this.editor.state, finding.looked);
    if (places.length === 0) return { at: -1, of: 0 };
    const next = (finding.at + by + places.length) % places.length;
    return this.goToPlace(finding.looked, next, places.length);
  }

  private goToPlace(looked: string, at: number, of: number): { readonly at: number; readonly of: number } {
    this.setFinding({ looked, at });
    const place = placesFound(this.editor.state, looked)[at];
    // The caret goes to what was found, so the author may carry on writing there, and the whisper scrolls to it.
    if (place !== undefined) this.editor.chain().setTextSelection(place).scrollIntoView().run();
    return { at, of };
  }

  /**
   * Writes something else in place of the one the author is at, and goes on to the next. What is inside a reply the
   * assistant is still writing is left alone: it is shown, but it is not the author's to change yet.
   */
  replaceFound(written: string): { readonly at: number; readonly of: number } {
    const finding = this.findingNow;
    const places = placesFound(this.editor.state, finding.looked);
    const here = places[finding.at];
    const mayChange = here !== undefined && placesToReplace(this.editor.state, finding.looked).some((place) => place.from === here.from);
    if (!mayChange) return this.step(1);
    // The author's own change: it is saved, and Ctrl+Z takes it back.
    this.editor.view.dispatch(this.editor.state.tr.insertText(written, here.from, here.to));
    const left = placesFound(this.editor.state, finding.looked);
    if (left.length === 0) {
      this.setFinding({ looked: finding.looked, at: -1 });
      return { at: -1, of: 0 };
    }
    return this.goToPlace(finding.looked, Math.min(finding.at, left.length - 1), left.length);
  }

  /** Writes something else in place of every one of them, in a single change the author can take back at once. */
  replaceAllFound(written: string): number {
    const finding = this.findingNow;
    const places = placesToReplace(this.editor.state, finding.looked);
    if (places.length === 0) return 0;
    const transaction = this.editor.state.tr;
    // From the last backwards, so that each place is still where it was when its turn comes.
    for (const place of [...places].reverse()) transaction.insertText(written, place.from, place.to);
    this.editor.view.dispatch(transaction);
    const left = placesFound(this.editor.state, finding.looked);
    this.setFinding({ looked: finding.looked, at: left.length === 0 ? -1 : 0 });
    return places.length;
  }

  /** Stops looking: the marks go, and the whisper is as it was. */
  stopFinding(): void {
    this.setFinding(NOTHING_FOUND);
  }

  /** What the author is being shown: which place they are at, of how many. */
  get found(): { readonly at: number; readonly of: number } {
    return foundSoFar(this.editor.state);
  }

  private get findingNow(): Finding {
    return FINDING.getState(this.editor.state) ?? NOTHING_FOUND;
  }

  private setFinding(finding: Finding): void {
    // Looking for writing changes nothing in the whisper: it neither saves nor enters the author's undo.
    this.editor.view.dispatch(this.editor.state.tr.setMeta(FINDING_META, finding).setMeta('addToHistory', false));
  }

  /** The address of the link the caret is in, or '' when it is in none. */
  get linkAddress(): string {
    const href: unknown = this.editor.getAttributes('link')['href'];
    return typeof href === 'string' ? href : '';
  }

  /**
   * Makes the selected writing a link to this address. With nothing selected, the address itself is written in and
   * linked, as a word processor does.
   */
  setLink(address: string): void {
    if (this.editor.state.selection.empty && this.linkAddress === '') {
      const linked = { type: 'text', text: address, marks: [{ type: 'link', attrs: { href: address } }] };
      this.editor.chain().focus().insertContent(linked).run();
      return;
    }
    // With writing selected, or the caret inside a link already, the whole of that link is given the new address.
    this.editor.chain().focus().extendMarkRange('link').setMark('link', { href: address }).run();
  }

  undo(): void {
    this.editor.commands.undo();
  }

  redo(): void {
    this.editor.commands.redo();
  }
}
