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
  Picture,
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
import { SectionIsolation, sectionAround } from './isolation';
import { SectionsDrawn } from './sections-drawn';
import { applyFormat, formatStanding, type FormatCommandId, type FormatStanding } from './formatting';
import { WhisperPaste } from './paste';
import { readWhisperLink } from '../../../shared/whispers';
import type { WhisperRecord } from '../loom/catch-up';
import { afterRule, findReply, isBlank, ruleIndex, sectionContent } from './sections';

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
  /** Called whenever the caret moves, so that what is drawn about where the author is can follow them. */
  readonly onCaretMoved?: () => void;
}

export class WhisperEditor {
  readonly editor: Editor;

  /** When the heading a link led to stops being marked. */
  private unmarkAt = 0;

  /** Whether Select All and the reaching keys stay inside the section the author is in (isolation.ts). */
  private isolating = false;

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
        Picture,
        ProtectBusyReplies,
        SectionKeys.configure({ onSectionFinished: (sectionId) => this.sectionFinished(sectionId, options.onSectionFinished) }),
        SectionsDrawn,
        WhisperPaste,
        HeadingIdentities,
        MarkFoundHeading,
        FindInWhisper,
        SectionIsolation.configure({ isolating: () => this.isolating }),
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
      onSelectionUpdate: () => options.onCaretMoved?.(),
      onTransaction: () => options.onCaretMoved?.(),
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

  /** Turns section isolation on or off. */
  isolateSections(isolating: boolean): void {
    this.isolating = isolating;
  }

  get isolatingSections(): boolean {
    return this.isolating;
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

  /** Which turn a rule closed, and when — what the thinking beside it is headed with. */
  turnOf(sectionId: string): { readonly number: number; readonly shown: string } {
    let found = { number: 0, shown: '' };
    this.doc.forEach((node) => {
      if (node.type.name !== 'horizontalRule' || node.attrs['sectionId'] !== sectionId) return;
      found = {
        number: Number(node.attrs['turn'] ?? 0),
        shown: typeof node.attrs['shown'] === 'string' ? node.attrs['shown'] : '',
      };
    });
    return found;
  }

  /** Where the line closing a turn is drawn on the page, for the bar between the panels. */
  elementOfTurn(turn: number): HTMLElement | undefined {
    let position = -1;
    this.doc.forEach((node, offset) => {
      if (position === -1 && node.type.name === 'horizontalRule' && Number(node.attrs['turn'] ?? 0) === turn) position = offset;
    });
    if (position === -1) return undefined;
    const drawn = this.editor.view.nodeDOM(position);
    return drawn instanceof HTMLElement ? drawn : undefined;
  }

  /**
   * Everything the assistant's replies in this whisper cite, turn by turn, in the order they stand.
   *
   * The citations are not kept anywhere: they are read back out of the whisper, which is the record of its own
   * conversation. Opening a whisper therefore shows what *that* conversation referred to, with nothing carried over
   * from the last one and nothing lost between runs.
   */
  citations(addresses: readonly string[], referencesIn: (written: string, addresses: readonly string[]) => readonly string[]): readonly {
    readonly turn: number;
    readonly addresses: readonly string[];
  }[] {
    const found: { turn: number; addresses: readonly string[] }[] = [];
    this.doc.forEach((node) => {
      if (node.type.name !== 'reply') return;
      const cited = referencesIn(node.textContent, addresses);
      if (cited.length === 0) return;
      const answers = node.attrs['answers'];
      found.push({ turn: typeof answers === 'string' ? this.turnOf(answers).number : 0, addresses: cited });
    });
    return found;
  }

  /**
   * The turns of this whisper that were closed but never answered: the author said something and the assistant never
   * replied, because it was not there to hear it.
   *
   * The whisper is the record of its conversation, so the record is what is asked. A turn counts as unanswered when
   * the line closing it is followed by nothing, by a reply still waiting to be written, or by one that ended in a
   * problem. A reply the author **stopped** is not unanswered: they stopped it themselves, and being asked whether
   * they meant it is not help.
   */
  unansweredTurns(): readonly { readonly sectionId: string; readonly replyId: string; readonly markdown: string }[] {
    const found: { sectionId: string; replyId: string; markdown: string }[] = [];
    const children: ProseMirrorNode[] = [];
    this.doc.forEach((node) => children.push(node));
    children.forEach((node, index) => {
      if (node.type.name !== 'horizontalRule') return;
      const sectionId = node.attrs['sectionId'];
      if (typeof sectionId !== 'string') return;
      const after = children[index + 1];
      const reply = after?.type.name === 'reply' ? after : undefined;
      const state = reply?.attrs['state'];
      if (state === 'finished' || state === 'stopped') return;
      const waiting = reply;
      const written = sectionContent(this.doc, sectionId);
      if (written === undefined) return;
      found.push({
        sectionId,
        replyId: typeof waiting?.attrs['replyId'] === 'string' ? waiting.attrs['replyId'] : '',
        markdown: this.toMarkdown(written),
      });
    });
    return found;
  }

  /**
   * Quotes something said earlier at the end of the whisper, to write an answer under it — what a chat program does
   * when you right-click a message and choose Quote.
   *
   * What is quoted is whatever the author has selected; with nothing selected, the whole of the section they clicked
   * in. The quotation goes at the end, where the conversation is, and the caret is left beneath it, ready to write.
   */
  quote(where: { readonly x: number; readonly y: number }): boolean {
    const said = this.whatToQuote(where);
    if (said.trim() === '') return false;
    const quotation = {
      type: 'blockquote',
      content: said.split(/\n{2,}/).map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line.trim() }] })),
    };
    const end = endOfWhisper(this.doc);
    this.editor
      .chain()
      .insertContentAt(end, [quotation, { type: 'paragraph' }])
      .focus()
      .run();
    return true;
  }

  /** What the author meant to quote: their selection, or the section they clicked in. */
  private whatToQuote(where: { readonly x: number; readonly y: number }): string {
    const { state } = this.editor;
    if (!state.selection.empty) return state.doc.textBetween(state.selection.from, state.selection.to, '\n\n');
    const at = this.editor.view.posAtCoords({ left: where.x, top: where.y });
    if (at === null) return '';
    const section = sectionAround(state.doc, at.pos);
    return state.doc.textBetween(section.from, section.to, '\n\n');
  }

  /** Which turn a reply answers: the turn of the rule it was placed after. */
  turnAnswering(replyId: string): number {
    const found = findReply(this.doc, replyId);
    const answers = found?.node.attrs['answers'];
    return typeof answers === 'string' ? this.turnOf(answers).number : 0;
  }

  /** Takes the author to the line that closed a turn. */
  goToTurn(sectionId: string): boolean {
    const at = ruleIndex(this.doc, sectionId);
    if (at === -1) return false;
    let position = 0;
    this.doc.forEach((node, offset, index) => {
      if (index === at) position = offset;
    });
    const drawn = this.editor.view.nodeDOM(position);
    if (drawn instanceof HTMLElement) drawn.scrollIntoView({ block: 'center' });
    return true;
  }

  /**
   * Where the author is writing, drawn on the page: the block holding the caret, or the last block of the whisper.
   *
   * This is the thing that must not move while a reply arrives. Everything the assistant writes goes above it.
   */
  writingElement(): HTMLElement | undefined {
    const caret = this.editor.state.selection.$from;
    const top = caret.depth > 0 ? caret.before(1) : -1;
    const at = top === -1 ? this.lastBlockPosition() : top;
    const drawn = at === -1 ? null : this.editor.view.nodeDOM(at);
    return drawn instanceof HTMLElement ? drawn : undefined;
  }

  private lastBlockPosition(): number {
    let position = -1;
    this.doc.forEach((_node, offset) => {
      position = offset;
    });
    return position;
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
    if (place === undefined) return { at, of };
    // The caret goes to what was found, so the author may carry on writing there.
    this.editor.chain().setTextSelection(place).run();
    this.showPosition(place.from);
    return { at, of };
  }

  /**
   * Brings a place in the whisper into view.
   *
   * The editor's own "scroll to the selection" cannot be used here: it takes its bearings from where the *browser's*
   * selection is, and while the author is typing in the find bar that is in the find bar, not in the whisper — so it
   * quietly does nothing, and finding a word never moved the page. What is scrolled is therefore the writing itself,
   * found on the page by its position.
   */
  private showPosition(position: number): void {
    const at = this.editor.view.domAtPos(position);
    const node: Node | undefined = at.node.childNodes[at.offset] ?? at.node;
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
    element?.scrollIntoView({ block: 'center' });
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
