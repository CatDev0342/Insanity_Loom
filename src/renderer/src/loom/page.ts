// The loom: one whisper, written by the author and the assistant together. The author writes anywhere; finishing a
// section (a line of three hyphens and Enter, or Ctrl+Enter) sends it, and the assistant's reply is woven in right
// after it, streaming in as rich text. Sections finished while a reply is still being written wait their turn, each
// with its reply already in place, and go in order.
//
// The whisper is saved to the journal on every change, crash-safely, so a crash or a closed window never costs a word.
// A reply being written redraws at most once per frame, however fast its text arrives.

import type {
  AssistantBridge,
  AssistantEvent,
  ConnectionBridge,
  ConnectionState,
  JournalBridge,
  SessionMode,
} from '../../../shared/assistant';
import { referencesIn, type GreatHallBridge } from '../../../shared/greathall';
import type { LinksBridge } from '../../../shared/links';
import { readWhisperLink, type OpenWhisper, type WhispersBridge } from '../../../shared/whispers';
import type { AssistantCommandId } from '../commands';
import type { ReplyState } from '../document/extensions';
import type { FormatCommandId, FormatStanding } from '../document/formatting';
import { WhisperEditor } from '../document/whisper-editor';
import { fromXhtml, toXhtml } from '../document/xhtml';
import { ConnectionPanel } from '../panels/connection-panel';
import { catchUpWith, describeCatchUp, type HistoryPiece } from './catch-up';
import { ContextRoom, type ContextElements } from './context-room';
import { FindBar, type FindBarElements } from './find-bar';
import { Library, type LibraryElements } from './library';
import { Navigation, type NavigationElements } from './navigation';
import { ReferenceBar, type ReferenceBarElements } from './reference-bar';
import { Thoughts, type ThoughtsElements } from './thoughts';
import { Saving } from './saving';
import { theAuthorsOwn } from './the-authors-own';
import { whatWasLost } from './nothing-lost';
import { chooseConversation } from './resume';

export interface LoomElements
  extends FindBarElements,
    ContextElements,
    ThoughtsElements,
    NavigationElements,
    LibraryElements,
    ReferenceBarElements {
  /** The word in the status bar saying that section isolation is on. */
  readonly isolation: HTMLElement;
  readonly whisper: HTMLElement;
  /** What scrolls when the whisper is longer than the window. */
  readonly scroll: HTMLElement;
  readonly asks: HTMLElement;
  readonly statusText: HTMLElement;
  readonly activity: HTMLElement;
  readonly account: HTMLElement;
  readonly reconnect: HTMLButtonElement;
  readonly signIn: HTMLButtonElement;
  readonly connectionSettings: HTMLButtonElement;
  readonly whisperName: HTMLElement;
  readonly modeLabel: HTMLElement;
  readonly mode: HTMLSelectElement;
  readonly resumeDialog: HTMLDialogElement;
  readonly connectionDialog: HTMLDialogElement;
}

/** What Claude Code calls the command that makes room in its context window (src/main/assistant.ts). */
const COMPACT_COMMAND = 'compact';

const PAGE_TITLE = 'Insanity_Loom';
const UNTITLED = 'Untitled whisper';

/**
 * How far past the bottom of the window the end of a reply may be and still count as being watched, in pixels. While
 * the author can see where the reply is being written, it keeps itself under their eyes as it grows; once they have
 * scrolled away from it — reading something further up, or writing in the middle — they are left where they are,
 * because being pulled away from what you are reading is worse than having to scroll down.
 *
 * It is the reply itself that is measured, not the scroll: the whisper keeps four tenths of the window as empty room
 * below the writing, so the end of the writing is never the end of the scroll.
 */
const WATCHING_WITHIN_PX = 80;


/** A finished section, with its reply already in place, waiting to be sent. */
interface Waiting {
  readonly replyId: string;
  readonly markdown: string;
}

/** How a reply that ended is marked, by the protocol's reason for the ending. */
function endingState(reason: string): ReplyState {
  if (reason === 'cancelled') return 'stopped';
  if (reason === 'error' || reason === 'refusal') return 'failed';
  return 'finished';
}

export class Loom {
  private editor: WhisperEditor | undefined;
  private readonly connectionPanel: ConnectionPanel;
  private readonly findBar: FindBar;
  private readonly contextRoom: ContextRoom;
  private readonly thoughts: Thoughts;
  private readonly navigation: Navigation;
  private readonly library: Library;
  private readonly referenceBar: ReferenceBar;
  /** Called whenever the caret moves or the whisper changes, so the toolbar can follow the author. */
  private caretMoved: () => void = () => undefined;
  /** The whisper whose unanswered turns have already been offered, so the author is asked once and not again. */
  private offeredUnansweredFor = '';
  private readonly waiting: Waiting[] = [];
  private state: ConnectionState = 'disconnected';
  private conversationId = '';
  private title = UNTITLED;
  /** When the whisper is written to its file (saving.ts); it holds the file the whisper is kept in. */
  private readonly saving: Saving;
  /** What the whisper's file is called. */
  private whisperName = '';

  /** The reply being written, and its Markdown so far. */
  private writing: { replyId: string; markdown: string } | undefined;
  private renderScheduled = false;

  /**
   * While a resumed conversation's history is replayed. `fill` writes it straight into a whisper that does not record
   * it; otherwise the history is gathered and compared with what the whisper holds, so that only what is missing is
   * brought in (catch-up.ts).
   */
  private replay:
    /** The whisper is blank: the history is written straight into it. */
    | { way: 'fill'; author: string; reply: string; lastSection: string | null }
    /** The whisper records this conversation: only what it is missing is brought in (catch-up.ts). */
    | { way: 'catchUp'; author: string; reply: string; history: HistoryPiece[] }
    /**
     * The whisper holds writing of its own, and this is another conversation. Nothing of the whisper is touched: the
     * history is gathered and written into a whisper of its own when it has all arrived.
     */
    | { way: 'intoANewWhisper'; author: string; reply: string; history: HistoryPiece[]; id: string }
    | undefined;

  /**
   * True while the whisper is where the author is working. The menu bar and the dialogs take focus to carry out what
   * they are asked, so neither counts as leaving the whisper: Format ▸ Bold acts on the writing the author left, and
   * Ctrl+B typed in a dialog's field does nothing.
   */
  private authorIsInWhisper = true;

  constructor(
    private readonly elements: LoomElements,
    private readonly assistant: AssistantBridge,
    private readonly connection: ConnectionBridge,
    private readonly whispers: WhispersBridge,
    private readonly links: LinksBridge,
    private readonly greatHall: GreatHallBridge,
    private readonly journal: JournalBridge,
  ) {
    this.findBar = new FindBar(elements, () => this.editor);
    this.contextRoom = new ContextRoom(elements, () => void this.compact());
    this.thoughts = new Thoughts(elements, whispers, (message) => this.showProblem(message));
    this.library = new Library(elements, greatHall, (message) => this.showProblem(message));
    this.referenceBar = new ReferenceBar(elements, {
      citations: () => this.library.citationsByTurn,
      turnElement: (turn) => this.editor?.elementOfTurn(turn),
      entryElement: (address) => this.library.entryFor(address),
      whisperScroll: elements.scroll,
      panelScroll: elements.libraryPane,
      goToCitation: (address) => {
        this.elements.showLibraryTab();
        this.library.goTo(address);
      },
    });
    this.navigation = new Navigation(elements, () => this.editor, {
      goToHeading: (identity) => this.goToHeading(identity),
      goToTurn: (sectionId) => this.goToTurn(sectionId),
      follow: (address) => void this.follow(address),
      open: (name) => void this.openNamedWhisper(name),
    });
    this.saving = new Saving({
      // Before the whisper is open there is nothing to write; the first save comes with the whisper itself.
      write: async (path) => (this.editor === undefined ? undefined : this.whispers.save(path, this.asXhtml())),
      onProblem: (message) => this.showProblem(message),
    });

    // Saving new connection settings reconnects with them at once.
    this.connectionPanel = new ConnectionPanel(elements.connectionDialog, connection, () => void this.run('assistant.reconnect'));
    elements.connectionSettings.addEventListener('click', () => void this.run('assistant.connectionSettings'));
    elements.reconnect.addEventListener('click', () => void this.run('assistant.reconnect'));
    elements.mode.addEventListener('change', () => void this.chooseMode(elements.mode.value));
    assistant.onEvent((event) => this.onEvent(event));

    // Where the author is working, followed as focus moves. The menu bar and open dialogs are passed over: they stand
    // in front of the whisper for a moment, they do not take the author away from it.
    window.addEventListener('focusin', (event) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest('.menubar, dialog') !== null) return;
      this.authorIsInWhisper = elements.whisper.contains(target);
    });

    // Esc stops a reply being written, wherever the author is on the page — unless a dialog or menu is open. It is
    // caught before the whisper sees it (the editor has its own use for Esc, selecting the block around the caret),
    // and only while a reply is being written; otherwise Esc keeps its ordinary meaning.
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Escape') return;
        if (document.querySelector('dialog[open], :popover-open') !== null) return;
        // Esc stops a reply being written; with none, it puts the find bar away.
        if (this.writing === undefined) {
          if (!this.findBar.isShowing) return;
          event.preventDefault();
          event.stopPropagation();
          this.findBar.hide();
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        void this.run('assistant.stop');
      },
      true,
    );
  }

  /**
   * Opens the whisper in progress, then connects. Until connection settings have been saved — a new copy of
   * Insanity_Loom — the Connection Settings panel opens first, by itself.
   */
  async start(): Promise<void> {
    // The GreatHall opened last time, if there was one: the author never opens it twice.
    this.library.useHall(await this.greatHall.current());
    this.showWhatIsCited();
    // An empty panel looks broken; it says what it is waiting for.
    this.thoughts.say('What the assistant thinks while it answers will appear here, and be kept beside the whisper.');
    await this.openWhisper();
    const state = await this.connection.load();
    if (!state.saved || state.problem !== '') {
      const outcome = await this.connectionPanel.show();
      this.editor?.focus();
      // Saving in the panel has already reconnected; closing it without saving leaves the status bar saying why not.
      if (outcome === 'unchanged') await this.assistant.connect();
      return;
    }
    this.editor?.focus();
    if (state.settings.connectOnStart) await this.assistant.connect();
    else this.onEvent({ type: 'status', state: 'disconnected', detail: 'Not connected. Assistant ▸ Reconnect connects.' });
  }

  /**
   * Opens the whisper the author was last in — a file in their alcove — or makes a new one. Writing left over from
   * before whispers were files is carried into it.
   */
  private async openWhisper(): Promise<void> {
    const open = await this.whispers.current();
    let html: string;
    if (open !== undefined) {
      try {
        const whisper = fromXhtml(open.xhtml);
        html = whisper.bodyHtml;
        this.conversationId = whisper.conversationId;
        this.title = whisper.title === '' ? UNTITLED : whisper.title;
        this.saving.useFile(open.path);
        this.thoughts.keepBeside(open.path);
        this.whisperName = open.name;
      } catch (problem) {
        this.showProblem(
          `"${open.name}" could not be read, and has been left as it is. ${problem instanceof Error ? problem.message : String(problem)}`,
        );
        throw problem;
      }
    } else {
      // Writing left over from Milestone 1's writing box is carried in, a paragraph per line.
      const draft = await this.journal.loadDraft();
      html = draft
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
        .join('');
    }
    this.editor = new WhisperEditor({
      element: this.elements.whisper,
      html,
      onSectionFinished: (sectionId, markdown) => this.sectionFinished(sectionId, markdown),
      onChange: () => {
        this.saveNow();
        this.navigation.changed();
      },
      onFollowLink: (address) => void this.follow(address),
      onCaretMoved: () => this.caretMoved(),
    });
    if (open === undefined) await this.makeWhisperFile();
    else this.checkNothingWasLost(open.path, html);
    this.showTitle();
  }

  /**
   * A turn the author closed that was never answered — because the assistant was away, or the program was closed
   * before it could be sent — is found in the whisper itself when it is opened, and offered again. What the author
   * said is never lost for want of a connection, and never quietly forgotten either.
   */
  private offerUnansweredTurns(): void {
    const editor = this.editor;
    if (editor === undefined) return;
    // Once for each whisper opened. The title arriving, or the file moving, is not another reason to ask again.
    const here = this.saving.file;
    if (here === '' || here === this.offeredUnansweredFor) return;
    this.offeredUnansweredFor = here;
    // A turn being answered right now is not unanswered: the reply is on its way, or waiting its turn to be sent.
    const inFlight = new Set([this.writing?.replyId ?? '', ...this.waiting.map((one) => one.replyId)]);
    const unanswered = editor.unansweredTurns().filter((turn) => !inFlight.has(turn.replyId));
    if (unanswered.length === 0) return;
    const many = unanswered.length === 1 ? 'One turn was' : `${String(unanswered.length)} turns were`;
    this.showNotice(`${many} closed here without an answer. The assistant was not there to hear it.`, {
      name: unanswered.length === 1 ? 'Send it' : 'Send them',
      take: () => this.sendAgain(unanswered),
    });
  }

  /** Puts unanswered turns back in the queue, in the order they were written. */
  private sendAgain(turns: readonly { readonly sectionId: string; readonly replyId: string; readonly markdown: string }[]): void {
    const editor = this.requireEditor();
    for (const turn of turns) {
      const replyId = turn.replyId === '' ? editor.placeReply(turn.sectionId) : turn.replyId;
      this.waiting.push({ replyId, markdown: turn.markdown });
    }
    this.saveNow();
    this.sendNext();
  }

  /**
   * Fills the Library with what this whisper's own replies cite. The whisper is the record of its conversation, so
   * its citations are read back out of it: opening another whisper shows what that conversation referred to.
   */
  private showWhatIsCited(): void {
    const editor = this.editor;
    if (editor === undefined) return;
    this.library.forget();
    const addresses = this.library.addresses;
    if (addresses.length === 0) return;
    void (async () => {
      for (const citation of editor.citations(addresses, referencesIn)) {
        await this.library.cite(citation.turn, citation.addresses);
      }
      this.referenceBar.drawSoon();
    })();
  }

  /** Asks what points at the whisper open, for the panel on the left. Quietly: it is a nicety, not a promise. */
  private showWhatPointsHere(): void {
    const name = this.whisperName;
    if (name === '') return;
    void this.whispers
      .pointingHere(name)
      .then((pointing) => this.navigation.showPointingHere(pointing))
      .catch(() => this.navigation.showPointingHere([]));
  }

  /**
   * Keeps a copy of the whisper open before its document is replaced wholesale — emptied for a new one, or swapped
   * for another whisper. These are the only two moments when the program puts something else where the author's
   * writing was, and on 2026-Sep-14 one of them destroyed a day of it. A copy costs one write; not having one cost
   * the author work that existed nowhere else.
   */
  private async keepACopyFirst(why: string): Promise<void> {
    const path = this.saving.file;
    if (path === '' || this.editor === undefined || this.editor.isBlank) return;
    try {
      await this.whispers.keepCopy(path, why);
    } catch (problem) {
      // A copy that cannot be kept is worth saying out loud, because what follows replaces what is there.
      this.showProblem(`A copy of this whisper could not be kept: ${problem instanceof Error ? problem.message : String(problem)}`);
    }
  }

  /**
   * Weighs what the file said against what the whisper now holds. Anything the editor could not read would be written
   * back over the file at the next save, so the file is kept aside first and the author is told where it is.
   */
  private checkNothingWasLost(path: string, fromTheFile: string): void {
    const editor = this.editor;
    if (editor === undefined) return;
    const lost = whatWasLost(fromTheFile, editor.html);
    if (!lost.lost) return;
    void this.whispers
      .keepCopy(path, 'as it was on opening')
      .then((kept) => {
        this.showProblem(
          `Some of this whisper could not be read, so it is not all here: about ${String(Math.round(lost.share * 100))}% of the writing. ` +
            `The file as it stood has been kept at "${kept}", and nothing has been written over it yet.`,
        );
      })
      .catch((problem: unknown) => {
        this.showProblem(`Some of this whisper could not be read, and a copy could not be kept: ${problem instanceof Error ? problem.message : String(problem)}`);
      });
  }

  /** Makes the file this whisper lives in, in the alcove. */
  private async makeWhisperFile(): Promise<void> {
    const made = await this.whispers.create(this.title, this.asXhtml());
    this.saving.useFile(made.path);
    this.thoughts.keepBeside(made.path);
    this.whisperName = made.name;
  }

  private asXhtml(): string {
    return toXhtml({ title: this.title, conversationId: this.conversationId, bodyHtml: this.requireEditor().html });
  }

  private requireEditor(): WhisperEditor {
    if (this.editor === undefined) throw new Error('The whisper is not open yet.');
    return this.editor;
  }

  private showTitle(): void {
    this.showWhatPointsHere();
    this.showWhatIsCited();
    this.offerUnansweredTurns();
    this.navigation.draw();
    document.title = this.whisperName === '' ? `${this.title} — ${PAGE_TITLE}` : `${this.whisperName} — ${PAGE_TITLE}`;
    this.elements.whisperName.textContent = this.whisperName;
  }

  // ——— Saving ———

  /** Says the whisper has changed; when it reaches its file is saving.ts's business. */
  private saveNow(): void {
    this.saving.changed();
  }

  // ——— Commands ———

  async run(command: AssistantCommandId): Promise<void> {
    try {
      switch (command) {
        case 'assistant.reconnect':
          this.abandonWriting('failed');
          await this.assistant.connect();
          return;
        case 'assistant.newConversation':
          this.abandonWriting('stopped');
          this.waiting.length = 0;
          await this.keepACopyFirst('before a new conversation');
          this.requireEditor().clear();
          this.conversationId = '';
          this.title = UNTITLED;
          this.showTitle();
          this.saveNow();
          await this.assistant.startConversation();
          return;
        case 'assistant.resumeConversation': {
          const chosen = await chooseConversation(this.elements.resumeDialog, () => this.assistant.listConversations());
          if (chosen !== undefined) await this.assistant.resumeConversation(chosen);
          this.editor?.focus();
          return;
        }
        case 'assistant.stop':
          if (this.writing !== undefined) await this.assistant.stop();
          return;
        case 'assistant.connectionSettings':
          await this.connectionPanel.show();
          this.editor?.focus();
          return;
        case 'assistant.signOut':
          await this.assistant.signOut();
          return;
        case 'whisper.new':
          await this.newWhisper();
          return;
        case 'whisper.open':
          await this.openAnotherWhisper();
          return;
        case 'whisper.showAlcove':
          await this.whispers.showAlcove();
          return;
        case 'whisper.showKept':
          await this.whispers.showKept();
          return;
        case 'whisper.exportMarkdown':
          await this.exportMarkdown();
          return;
      }
    } catch (problem) {
      this.showProblem(problem instanceof Error ? problem.message : String(problem));
    }
  }

  // ——— Finding writing in the whisper ———

  /** Opens a place in the hall's library — what Find in Files hands back for a library document. */
  async openLibraryAt(address: string, line: number): Promise<void> {
    this.elements.showLibraryTab();
    await this.library.openAt(address, line);
  }

  /** File ▸ Open GreatHall: what belongs together, and the library the assistant cites (greathall.ts). */
  async openGreatHall(): Promise<void> {
    try {
      const chosen = await this.greatHall.choose();
      if (chosen === undefined) return;
      this.library.useHall(chosen);
      this.showWhatIsCited();
      this.showNotice(`The GreatHall "${chosen.name}" is open. What the assistant cites will be listed in the Library.`);
    } catch (problem) {
      this.showProblem(problem instanceof Error ? problem.message : String(problem));
    }
    this.editor?.focus();
  }

  /**
   * Edit ▸ Section Isolation: whether Select All and the keys that reach for the ends of the whisper stay inside the
   * section the author is working in (isolation.ts). Said in the status bar, because it changes what a key does.
   */
  isolateSections(): void {
    const editor = this.requireEditor();
    const isolating = !editor.isolatingSections;
    editor.isolateSections(isolating);
    this.elements.isolation.hidden = !isolating;
    this.showNotice(
      isolating
        ? 'Section isolation is on: Select All takes the section you are in.'
        : 'Section isolation is off: Select All takes the whole whisper.',
    );
    editor.focus();
  }

  /** Whether section isolation is on, for the menu's tick. */
  get isolatingSections(): boolean {
    return this.editor?.isolatingSections ?? false;
  }

  /** Whatever must follow the caret — the editing shortcuts along the top — is told so here. */
  followTheCaret(follower: () => void): void {
    this.caretMoved = follower;
  }

  /** Edit ▸ Find: the bar above the whisper, with whatever is selected ready to be looked for. */
  showFindBar(): void {
    this.findBar.show();
  }

  /** Edit ▸ Replace: the find bar, with the line for what to write instead. */
  showReplaceBar(): void {
    this.findBar.showReplace();
  }

  /** Takes the author to writing they looked for across the alcove, in the whisper just opened. */
  findFor(looked: string): void {
    this.findBar.showFor(looked);
  }

  /** Edit ▸ Find Next and Find Previous, which work whether the bar is showing or not. */
  stepFind(which: 'next' | 'previous'): void {
    this.findBar.step(which);
  }

  // ——— Formatting ———

  /** Format ▸ …, carried out on the whisper (src/renderer/src/document/formatting.ts). */
  runFormatCommand(command: FormatCommandId): void {
    this.requireEditor().format(command);
  }

  /** How a Format command stands where the author is working; nothing can be formatted anywhere else. */
  formatStanding(command: FormatCommandId): FormatStanding {
    if (this.editor === undefined || !this.authorIsInWhisper) return { enabled: false, checked: false };
    return this.editor.formatStanding(command);
  }

  /** The file name of the whisper open, for what points at it. */
  get whisperFileName(): string {
    return this.whisperName;
  }

  /** Opens a whisper by where its file is: what Find in Files hands back. */
  async openWhisperAt(path: string): Promise<void> {
    try {
      await this.showWhisper(await this.whispers.openAt(path));
    } catch (problem) {
      this.showProblem(problem instanceof Error ? problem.message : String(problem));
    }
  }

  /** Opens a whisper of the alcove by its file name — what points here, and links. */
  async openNamedWhisper(name: string): Promise<void> {
    try {
      await this.showWhisper(await this.whispers.openNamed(name));
    } catch (problem) {
      this.showProblem(problem instanceof Error ? problem.message : String(problem));
    }
  }

  /** The address of the link the caret is in, or '' when it is in none. */
  get linkAddress(): string {
    return this.editor === undefined ? '' : this.editor.linkAddress;
  }

  setLink(address: string): void {
    this.requireEditor().setLink(address);
  }

  focusWhisper(): void {
    this.editor?.editor.commands.focus();
  }

  /** Edit ▸ Undo and Redo, when the whisper has focus: the whisper's own history, which holds only the author's changes. */
  runEditCommand(command: 'edit.undo' | 'edit.redo'): boolean {
    const editor = this.editor;
    if (editor === undefined || !editor.hasFocus) return false;
    if (command === 'edit.undo') editor.undo();
    else editor.redo();
    return true;
  }

  // ——— Sections and replies ———

  private sectionFinished(sectionId: string, markdown: string): void {
    // The caret has just been taken to the fresh paragraph after the rule, so the author is already looking at where
    // the reply will appear; nothing needs scrolling here.
    const editor = this.requireEditor();
    const turn = editor.turnOf(sectionId);
    this.thoughts.beginTurn(turn.number, turn.shown);
    this.thoughts.say('');
    this.navigation.changed();
    const replyId = editor.placeReply(sectionId);
    this.waiting.push({ replyId, markdown });
    this.saveNow();
    if (this.state !== 'connected') {
      this.showNotice('The assistant is not there at the moment. This turn is kept, and goes as soon as it returns.');
    }
    this.sendNext();
  }

  private sendNext(): void {
    if (this.writing !== undefined || this.state !== 'connected' || this.replay !== undefined) return;
    const next = this.waiting.shift();
    if (next === undefined) return;
    this.writing = { replyId: next.replyId, markdown: '' };
    this.requireEditor().setReplyState(next.replyId, 'writing');
    // The reply arrives as events; the promise settles when it has finished, which replyFinished also reports.
    this.assistant.send(next.markdown).catch((problem: unknown) => {
      this.showProblem(problem instanceof Error ? problem.message : String(problem));
      this.finishWriting('failed');
    });
  }

  /** Redraws the reply being written at most once per frame, however fast its text arrives. */
  private scheduleRender(): void {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    requestAnimationFrame(() => {
      this.renderScheduled = false;
      const writing = this.writing;
      if (writing === undefined) return;
      const following = this.isWatching(writing.replyId);
      this.requireEditor().setReply(writing.replyId, writing.markdown, 'writing');
      if (following) this.keepInView(writing.replyId);
    });
  }

  /** Whether the author can see where this reply is being written. */
  private isWatching(replyId: string): boolean {
    const reply = this.editor?.replyElement(replyId);
    if (reply === undefined) return false;
    return reply.getBoundingClientRect().bottom <= this.elements.scroll.getBoundingClientRect().bottom + WATCHING_WITHIN_PX;
  }

  /** Keeps the end of a reply in view as it grows. */
  private keepInView(replyId: string): void {
    this.editor?.replyElement(replyId)?.scrollIntoView({ block: 'end' });
  }

  private finishWriting(state: ReplyState): void {
    const writing = this.writing;
    if (writing === undefined) return;
    this.writing = undefined;
    const following = this.isWatching(writing.replyId);
    const editor = this.requireEditor();
    if (writing.markdown === '') editor.setReplyState(writing.replyId, state);
    else editor.setReply(writing.replyId, writing.markdown, state);
    this.elements.activity.textContent = '';
    // What the reply cited of the library, for the Library tab beside the whisper, and for the bar between them.
    const answered = this.requireEditor().turnAnswering(writing.replyId);
    void this.library.cite(answered, referencesIn(writing.markdown, this.library.addresses)).then(() => {
      this.referenceBar.drawSoon();
    });
    this.hideAsks();
    if (following) this.keepInView(writing.replyId);
    this.saveNow();
    this.sendNext();
  }

  /** A reply cut off by a lost connection or a new conversation is marked so; the sections waiting stay waiting. */
  private abandonWriting(state: ReplyState): void {
    if (this.writing !== undefined) this.finishWriting(state);
  }

  // ——— What the assistant says ———

  private onEvent(event: AssistantEvent): void {
    switch (event.type) {
      case 'status':
        this.state = event.state;
        this.elements.statusText.textContent = event.detail;
        this.elements.statusText.dataset['state'] = event.state;
        this.elements.reconnect.hidden = event.state === 'connected' || event.state === 'connecting' || event.state === 'signedOut';
        // Signing in is offered, never started: the author presses Sign In when they choose to.
        this.elements.signIn.hidden = event.state !== 'signedOut';
        if (event.state !== 'connected') this.abandonWriting('failed');
        // Whatever the author closed while the assistant was away goes now. Nothing they have said is ever dropped
        // for want of a connection.
        else this.sendNext();
        return;
      case 'conversation':
        this.onConversation(event.id, event.replaying);
        return;
      case 'replayFinished':
        this.flushReplay();
        this.finishReplay();
        this.saveNow();
        this.sendNext();
        return;
      case 'authorText':
        if (this.replay !== undefined) {
          if (this.replay.reply !== '') this.flushReplay();
          this.replay.author += event.text;
        }
        return;
      case 'replyText':
        if (this.replay !== undefined) {
          if (this.replay.author !== '') this.flushReplay();
          this.replay.reply += event.text;
          return;
        }
        if (this.writing === undefined) return;
        this.writing.markdown += event.text;
        this.elements.activity.textContent = '';
        this.scheduleRender();
        return;
      case 'thinking':
        if (this.writing !== undefined) this.elements.activity.textContent = 'Thinking…';
        return;
      case 'thought':
        this.thoughts.add(event.text);
        return;
      case 'context':
        this.contextRoom.show(event.used, event.size);
        return;
      case 'commands':
        this.contextRoom.offersCompacting(event.names.includes(COMPACT_COMMAND));
        return;
      case 'compacting':
        this.contextRoom.compacting(event.status);
        if (event.status === 'completed') this.thoughts.say('Room was made in the context window.');
        if (event.status === 'failed') this.thoughts.say('Room could not be made in the context window.');
        if (event.summary !== '') this.thoughts.add(`${event.summary}\n`);
        return;
      case 'tool':
        // Commands are shown beside the whisper, never in the status bar: a line beneath the writing cannot hold one,
        // and a long one used to push the bar up into the writing itself.
        this.thoughts.command(event.id, event.title, event.status);
        return;
      case 'permission':
        this.ask(event.requestId, event.title, event.choices);
        return;
      case 'replyFinished':
        this.finishWriting(endingState(event.reason));
        return;
      case 'problem':
        this.showProblem(event.message);
        return;
      case 'account':
        this.elements.account.textContent = event.detail === '' ? event.label : `${event.label} · ${event.detail}`;
        return;
      case 'signInNeeded':
        // Shown in the status bar, with its Sign In button; nothing opens by itself.
        this.elements.account.textContent = 'Not signed in';
        return;
      case 'signIn':
        // The Sign In panel shows a sign-in's progress (src/renderer/src/panels/sign-in-panel.ts).
        return;
      case 'modes':
        this.showModes(event.modes, event.current);
        return;
      case 'title':
        void this.useTitle(event.title);
        return;
    }
  }

  /**
   * A conversation began or was resumed. The whisper records its conversation: resuming the one it already records
   * shows nothing new (its history is already in it); resuming another fills a fresh whisper from that history.
   */
  private onConversation(id: string, replaying: boolean): void {
    const editor = this.requireEditor();
    if (replaying) {
      if (id === this.conversationId && !editor.isBlank) {
        // The whisper records this conversation: gather the history and bring in only what the whisper is missing.
        this.replay = { way: 'catchUp', author: '', reply: '', history: [] };
      } else if (editor.isBlank) {
        // Nothing to lose: the history is written straight into the whisper.
        this.replay = { way: 'fill', author: '', reply: '', lastSection: null };
        this.abandonWriting('stopped');
        this.waiting.length = 0;
        this.title = 'Resumed conversation';
      } else {
        // The whisper holds writing of its own and this is another conversation. **It is not ours to empty.** The
        // history is gathered and given a whisper of its own; what the author wrote stays exactly where it is.
        this.replay = { way: 'intoANewWhisper', author: '', reply: '', history: [], id };
        return;
      }
    }
    this.conversationId = id;
    this.showTitle();
    this.saveNow();
    if (!replaying) this.sendNext();
  }

  /** Sets aside whatever part of a replayed history has been gathered: an author's section, or a reply. */
  private flushReplay(): void {
    const replay = this.replay;
    if (replay === undefined) return;
    const editor = this.requireEditor();
    if (replay.way === 'fill') {
      if (replay.author !== '') {
        // Only what the author themselves wrote goes into the whisper; the machinery's own words are left out.
        const written = theAuthorsOwn(replay.author);
        if (written !== '') replay.lastSection = editor.appendAuthorSection(written);
        replay.author = '';
      }
      if (replay.reply !== '') {
        editor.appendReply(replay.reply, replay.lastSection);
        replay.reply = '';
      }
      return;
    }
    if (replay.author !== '') {
      const written = theAuthorsOwn(replay.author);
      if (written !== '') replay.history.push({ kind: 'author', markdown: written });
      replay.author = '';
    }
    if (replay.reply !== '') {
      replay.history.push({ kind: 'reply', markdown: replay.reply });
      replay.reply = '';
    }
  }

  /**
   * The history has all arrived. A whisper that already records this conversation is caught up with whatever was
   * said while it was not open — nothing it already holds is written twice — and the author is told what came in.
   */
  private finishReplay(): void {
    const replay = this.replay;
    this.replay = undefined;
    if (replay === undefined || replay.way === 'fill') return;
    if (replay.way === 'intoANewWhisper') {
      void this.fillANewWhisper(replay.id, replay.history);
      return;
    }

    const editor = this.requireEditor();
    const catchUp = catchUpWith(editor.record, replay.history);
    if (catchUp.fillLastReply !== undefined) {
      editor.setReply(catchUp.fillLastReply.replyId, catchUp.fillLastReply.markdown, 'finished');
    }
    let lastSection: string | null = null;
    for (const piece of catchUp.append) {
      if (piece.kind === 'author') lastSection = editor.appendAuthorSection(piece.markdown);
      else editor.appendReply(piece.markdown, lastSection);
    }
    const said = describeCatchUp(catchUp);
    if (said !== '') this.showNotice(said);
  }

  /**
   * Gives a resumed conversation a whisper of its own, because the one open holds writing that is not its own.
   *
   * The whisper the author was in is saved and left exactly as it is; the new one is made beside it and filled with
   * what the assistant remembers. The author is told which whisper they are now in, and how to go back.
   */
  private async fillANewWhisper(id: string, history: readonly HistoryPiece[]): Promise<void> {
    const leaving = this.whisperName;
    try {
      await this.newWhisper();
      this.conversationId = id;
      this.title = 'Resumed conversation';
      const editor = this.requireEditor();
      let lastSection: string | null = null;
      for (const piece of history) {
        if (piece.kind === 'author') lastSection = editor.appendAuthorSection(piece.markdown);
        else editor.appendReply(piece.markdown, lastSection);
      }
      this.showTitle();
      this.saveNow();
      this.showNotice(`That conversation was brought into a whisper of its own. "${leaving}" is untouched, and File ▸ Open Whisper goes back to it.`);
    } catch (problem) {
      this.showProblem(problem instanceof Error ? problem.message : String(problem));
    }
  }

  /** The conversation's own title, which also names its whisper's file (keeping the date it began). */
  /** A new whisper: a new file in the alcove, and a new conversation to go with it. */
  private async newWhisper(): Promise<void> {
    const editor = this.requireEditor();
    this.abandonWriting('stopped');
    this.waiting.length = 0;
    await this.keepACopyFirst('before a new whisper');
    // Nothing is saved until the new whisper has a file of its own: emptying the document while the whisper being
    // left is still the one open would write the emptiness over it.
    await this.saving.stop();
    editor.clear();
    this.title = UNTITLED;
    this.conversationId = '';
    await this.makeWhisperFile();
    this.showTitle();
    if (this.state === 'connected') await this.assistant.startConversation();
    editor.focus();
  }

  /**
   * Opens another whisper from the alcove, and takes up its conversation where it left off — anything said while that
   * whisper was closed is brought in (catch-up.ts).
   */
  private async openAnotherWhisper(): Promise<void> {
    const chosen = await this.whispers.choose();
    if (chosen === undefined) return;
    await this.showWhisper(chosen);
  }

  /**
   * Follows a link the author Ctrl+clicked. A link to another whisper — a file name in the alcove — opens it here;
   * anything else is the wider world's, and goes to the system's own browser (src/main/links.ts decides what may).
   */
  private async follow(address: string): Promise<void> {
    try {
      const link = readWhisperLink(address);
      if (link === undefined) {
        await this.links.open(address);
        return;
      }
      if (link.name !== '') await this.showWhisper(await this.whispers.openNamed(link.name));
      if (link.heading !== '') this.goToHeading(link.heading);
    } catch (problem) {
      this.showProblem(problem instanceof Error ? problem.message : String(problem));
    }
  }

  /** Asks the assistant to make room in its context window; nothing of it enters the whisper. */
  private async compact(): Promise<void> {
    try {
      this.thoughts.say('Making room in the assistant\u2019s context window…');
      await this.assistant.compact();
    } catch (problem) {
      this.showProblem(problem instanceof Error ? problem.message : String(problem));
    }
  }

  /** Takes the author to a turn of the conversation — the line that closed it. */
  private goToTurn(sectionId: string): void {
    this.requireEditor().goToTurn(sectionId);
  }

  /** Takes the author to the heading a link points at; the whisper marks it for a moment so their eye finds it. */
  private goToHeading(identity: string): void {
    if (!this.requireEditor().goToHeading(identity)) this.showNotice(`This whisper has no section called "${identity}".`);
  }

  /** Puts a whisper from the alcove in the window, and takes up the conversation it records. */
  private async showWhisper(opened: OpenWhisper): Promise<void> {
    const whisper = fromXhtml(opened.xhtml);
    const editor = this.requireEditor();
    this.abandonWriting('stopped');
    this.waiting.length = 0;
    await this.keepACopyFirst('before another whisper was opened');
    // As with a new whisper: nothing is saved while the document is being swapped, so the whisper being left keeps
    // what it holds.
    await this.saving.stop();
    editor.replaceAll(whisper.bodyHtml);
    this.saving.useFile(opened.path);
    this.thoughts.keepBeside(opened.path);
    this.whisperName = opened.name;
    this.conversationId = whisper.conversationId;
    this.title = whisper.title === '' ? UNTITLED : whisper.title;
    this.showTitle();
    if (this.state === 'connected' && whisper.conversationId !== '') await this.assistant.resumeConversation(whisper.conversationId);
    editor.focus();
  }

  /** File ▸ Export as Markdown: the whisper written out for tools that read Markdown, wherever the author says. */
  private async exportMarkdown(): Promise<void> {
    const suggested = `${this.whisperName.replace(/\.xhtml$/i, '') || this.title}.md`;
    const written = await this.whispers.exportMarkdown(suggested, this.requireEditor().asMarkdown());
    if (written !== '') this.showNotice(`The whisper was written out as "${written}".`);
    this.editor?.focus();
  }

  private async useTitle(title: string): Promise<void> {
    if (title === this.title) return;
    this.title = title;
    this.saveNow();
    if (this.saving.file !== '') {
      const left = this.whisperName;
      const path = await this.saving.stop();
      try {
        const moved = await this.whispers.rename(path, title);
        this.saving.useFile(moved.path);
        this.thoughts.movedTo(moved.path);
        this.whisperName = moved.name;
        // Whispers that pointed here have been put right on disk; this one's own links are put right in the window,
        // where the whisper is held, or the next save would write the old name back over them.
        this.editor?.renameLinks(left, moved.name);
      } catch (problem) {
        // The whisper stays where it was, under the name it had, and goes on being saved there.
        this.saving.useFile(path);
        this.showProblem(`The whisper's file could not be named after the conversation: ${problem instanceof Error ? problem.message : String(problem)}`);
      }
      this.saveNow();
    }
    this.showTitle();
  }

  /**
   * The ways of working the assistant offers, in the status bar. Choosing one other than its first — Manual, for
   * Claude — is how the author stops being asked to approve every step; the choice is remembered for later
   * conversations. The assistant may change it itself (leaving Plan mode, say), and the status bar follows.
   */
  private showModes(modes: readonly SessionMode[], current: string): void {
    const { mode, modeLabel } = this.elements;
    modeLabel.hidden = modes.length === 0;
    if (modes.length === 0) {
      mode.replaceChildren();
      return;
    }
    mode.replaceChildren(
      ...modes.map((offered) => {
        const option = document.createElement('option');
        option.value = offered.id;
        option.textContent = offered.name;
        if (offered.description !== '') option.title = offered.description;
        return option;
      }),
    );
    mode.value = current;
    mode.title = modes.find((offered) => offered.id === current)?.description ?? '';
    // Anything but the assistant's first way of working means it is acting with less asking: said plainly, in color.
    mode.dataset['asking'] = current === modes[0]?.id ? 'always' : 'less';
  }

  private async chooseMode(modeId: string): Promise<void> {
    try {
      await this.assistant.setMode(modeId);
    } catch (problem) {
      this.showProblem(problem instanceof Error ? problem.message : String(problem));
    }
  }

  // ——— Permission questions and problems, shown above the whisper ———

  private ask(requestId: string, title: string, choices: readonly { id: string; name: string; kind: string }[]): void {
    const card = document.createElement('div');
    card.className = 'ask';
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', 'Permission request');
    const question = document.createElement('p');
    question.textContent = `The assistant asks: ${title}`;
    const buttons = document.createElement('div');
    buttons.className = 'ask-choices';
    for (const choice of choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `ask-choice kind-${choice.kind}`;
      button.textContent = choice.name;
      button.addEventListener('click', () => {
        card.remove();
        this.elements.asks.hidden = this.elements.asks.childElementCount === 0;
        void this.assistant.answerPermission(requestId, choice.id);
        this.editor?.focus();
      });
      buttons.append(button);
    }
    card.append(question, buttons);
    this.elements.asks.append(card);
    this.elements.asks.hidden = false;
  }

  private hideAsks(): void {
    for (const card of [...this.elements.asks.querySelectorAll('[aria-label="Permission request"]')]) card.remove();
    this.elements.asks.hidden = this.elements.asks.childElementCount === 0;
  }

  /** A quiet word to the author about something Insanity_Loom did, dismissable, above the whisper. */
  private showNotice(message: string, offer?: { readonly name: string; readonly take: () => void }): void {
    this.showCard(message, 'ask ask-notice', 'status', offer);
  }

  private showProblem(message: string): void {
    this.showCard(message, 'ask ask-problem', 'alert');
  }

  private showCard(message: string, className: string, role: string, offer?: { readonly name: string; readonly take: () => void }): void {
    const note = document.createElement('div');
    note.className = className;
    note.setAttribute('role', role);
    const text = document.createElement('p');
    text.textContent = message;
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.textContent = 'Dismiss';
    dismiss.addEventListener('click', () => {
      note.remove();
      this.elements.asks.hidden = this.elements.asks.childElementCount === 0;
    });
    note.append(text);
    // A notice about something the author may want done offers to do it, rather than leaving them to work out how.
    if (offer !== undefined) {
      const take = document.createElement('button');
      take.type = 'button';
      take.textContent = offer.name;
      take.addEventListener('click', () => {
        note.remove();
        this.elements.asks.hidden = this.elements.asks.childElementCount === 0;
        offer.take();
      });
      note.append(take);
    }
    note.append(dismiss);
    this.elements.asks.append(note);
    this.elements.asks.hidden = false;
  }
}
