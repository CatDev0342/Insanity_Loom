// The loom: one whisper, written by the author and the assistant together. The author writes anywhere; finishing a
// section (a line of three hyphens and Enter, or Ctrl+Enter) sends it, and the assistant's reply is woven in right
// after it, streaming in as rich text. Sections finished while a reply is still being written wait their turn, each
// with its reply already in place, and go in order.
//
// The whisper is saved to the journal on every change, crash-safely, so a crash or a closed window never costs a word.
// A reply being written redraws at most once per frame, however fast its text arrives.

import type { AssistantBridge, AssistantEvent, ConnectionBridge, ConnectionState, JournalBridge } from '../../../shared/assistant';
import type { AssistantCommandId } from '../commands';
import type { ReplyState } from '../document/extensions';
import { WhisperEditor } from '../document/whisper-editor';
import { fromXhtml, toXhtml } from '../document/xhtml';
import { ConnectionPanel } from '../panels/connection-panel';
import { chooseConversation } from './resume';

export interface LoomElements {
  readonly whisper: HTMLElement;
  readonly asks: HTMLElement;
  readonly statusText: HTMLElement;
  readonly activity: HTMLElement;
  readonly account: HTMLElement;
  readonly reconnect: HTMLButtonElement;
  readonly signIn: HTMLButtonElement;
  readonly connectionSettings: HTMLButtonElement;
  readonly resumeDialog: HTMLDialogElement;
  readonly connectionDialog: HTMLDialogElement;
}

const PAGE_TITLE = 'Insanity_Loom';
const UNTITLED = 'Untitled whisper';


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
  private readonly waiting: Waiting[] = [];
  private state: ConnectionState = 'disconnected';
  private conversationId = '';
  private title = UNTITLED;

  /** The reply being written, and its Markdown so far. */
  private writing: { replyId: string; markdown: string } | undefined;
  private renderScheduled = false;

  /** While a resumed conversation's history is replayed: `ignore` is true when the whisper already records it. */
  private replay: { ignore: boolean; author: string; reply: string; lastSection: string | null } | undefined;

  /** True while a save is being written; changes made meanwhile set `unsaved`, and are written as soon as it is done. */
  private saving = false;
  private unsaved = false;

  constructor(
    private readonly elements: LoomElements,
    private readonly assistant: AssistantBridge,
    private readonly connection: ConnectionBridge,
    private readonly journal: JournalBridge,
  ) {
    // Saving new connection settings reconnects with them at once.
    this.connectionPanel = new ConnectionPanel(elements.connectionDialog, connection, () => void this.run('assistant.reconnect'));
    elements.connectionSettings.addEventListener('click', () => void this.run('assistant.connectionSettings'));
    elements.reconnect.addEventListener('click', () => void this.run('assistant.reconnect'));
    assistant.onEvent((event) => this.onEvent(event));

    // Esc stops a reply being written, wherever the author is on the page — unless a dialog or menu is open. It is
    // caught before the whisper sees it (the editor has its own use for Esc, selecting the block around the caret),
    // and only while a reply is being written; otherwise Esc keeps its ordinary meaning.
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Escape' || this.writing === undefined) return;
        if (document.querySelector('dialog[open], :popover-open') !== null) return;
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

  private async openWhisper(): Promise<void> {
    const saved = await this.journal.loadWhisper();
    let html: string;
    if (saved !== '') {
      try {
        const whisper = fromXhtml(saved);
        html = whisper.bodyHtml;
        this.conversationId = whisper.conversationId;
        this.title = whisper.title === '' ? UNTITLED : whisper.title;
      } catch (problem) {
        this.showProblem(`The whisper in progress could not be read, and has been left as it is. ${problem instanceof Error ? problem.message : String(problem)}`);
        throw problem;
      }
    } else {
      // Writing left over from before whispers is carried in, a paragraph per line.
      const draft = await this.journal.loadDraft();
      html = draft
        .split('\n')
        .map((line) => `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
        .join('');
    }
    this.editor = new WhisperEditor({
      element: this.elements.whisper,
      html,
      onSectionFinished: (sectionId, markdown) => this.sectionFinished(sectionId, markdown),
      onChange: () => this.saveNow(),
    });
    this.showTitle();
  }

  private requireEditor(): WhisperEditor {
    if (this.editor === undefined) throw new Error('The whisper is not open yet.');
    return this.editor;
  }

  private showTitle(): void {
    document.title = `${this.title} — ${PAGE_TITLE}`;
  }

  // ——— Saving ———

  /**
   * Writes the whisper to the journal at once, on every change. Changes that arrive while a save is being written —
   * fast typing, a streaming reply — are gathered into the next save, so saving never falls behind and the file on
   * disk is never more than one save old.
   */
  private saveNow(): void {
    this.unsaved = true;
    if (this.saving) return;
    this.saving = true;
    void (async () => {
      try {
        while (this.unsaved) {
          this.unsaved = false;
          const editor = this.editor;
          if (editor === undefined) return;
          await this.journal.saveWhisper(toXhtml({ title: this.title, conversationId: this.conversationId, bodyHtml: editor.html }));
        }
      } catch (problem) {
        this.showProblem(`The whisper could not be saved: ${problem instanceof Error ? problem.message : String(problem)}`);
      } finally {
        this.saving = false;
      }
    })();
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
      }
    } catch (problem) {
      this.showProblem(problem instanceof Error ? problem.message : String(problem));
    }
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
    const replyId = this.requireEditor().placeReply(sectionId);
    this.waiting.push({ replyId, markdown });
    this.saveNow();
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
      if (writing !== undefined) this.requireEditor().setReply(writing.replyId, writing.markdown, 'writing');
    });
  }

  private finishWriting(state: ReplyState): void {
    const writing = this.writing;
    if (writing === undefined) return;
    this.writing = undefined;
    const editor = this.requireEditor();
    if (writing.markdown === '') editor.setReplyState(writing.replyId, state);
    else editor.setReply(writing.replyId, writing.markdown, state);
    this.elements.activity.textContent = '';
    this.hideAsks();
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
        return;
      case 'conversation':
        this.onConversation(event.id, event.replaying);
        return;
      case 'replayFinished':
        this.flushReplay();
        this.replay = undefined;
        this.saveNow();
        this.sendNext();
        return;
      case 'authorText':
        if (this.replay !== undefined && !this.replay.ignore) {
          if (this.replay.reply !== '') this.flushReplay();
          this.replay.author += event.text;
        }
        return;
      case 'replyText':
        if (this.replay !== undefined) {
          if (this.replay.ignore) return;
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
      case 'tool':
        if (this.writing !== undefined && event.title !== '') this.elements.activity.textContent = `${event.title} — ${event.status}`;
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
    }
  }

  /**
   * A conversation began or was resumed. The whisper records its conversation: resuming the one it already records
   * shows nothing new (its history is already in it); resuming another fills a fresh whisper from that history.
   */
  private onConversation(id: string, replaying: boolean): void {
    const editor = this.requireEditor();
    if (replaying) {
      const alreadyRecorded = id === this.conversationId && !editor.isBlank;
      this.replay = { ignore: alreadyRecorded, author: '', reply: '', lastSection: null };
      if (!alreadyRecorded) {
        this.abandonWriting('stopped');
        this.waiting.length = 0;
        editor.clear();
        this.title = 'Resumed conversation';
      }
    }
    this.conversationId = id;
    this.showTitle();
    this.saveNow();
    if (!replaying) this.sendNext();
  }

  /** Writes whatever part of a replayed history has been gathered: an author's section, or a reply. */
  private flushReplay(): void {
    const replay = this.replay;
    if (replay === undefined || replay.ignore) return;
    const editor = this.requireEditor();
    if (replay.author !== '') {
      replay.lastSection = editor.appendAuthorSection(replay.author);
      replay.author = '';
    }
    if (replay.reply !== '') {
      editor.appendReply(replay.reply, replay.lastSection);
      replay.reply = '';
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

  private showProblem(message: string): void {
    const note = document.createElement('div');
    note.className = 'ask ask-problem';
    note.setAttribute('role', 'alert');
    const text = document.createElement('p');
    text.textContent = message;
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.textContent = 'Dismiss';
    dismiss.addEventListener('click', () => {
      note.remove();
      this.elements.asks.hidden = this.elements.asks.childElementCount === 0;
    });
    note.append(text, dismiss);
    this.elements.asks.append(note);
    this.elements.asks.hidden = false;
  }
}
