// The loom: the author writes, finishes a section, and the assistant's reply is woven into the conversation above.
// Sections finished while a reply is still being written wait their turn and go in order.

import type { AssistantBridge, AssistantEvent, ConnectionBridge, ConnectionState } from '../../../shared/assistant';
import { ConnectionPanel } from '../panels/connection-panel';
import type { AssistantCommandId } from '../commands';
import { Compose } from './compose';
import { Conversation } from './conversation';
import { chooseConversation } from './resume';

export interface LoomElements {
  readonly conversation: HTMLElement;
  readonly compose: HTMLTextAreaElement;
  readonly statusText: HTMLElement;
  readonly reconnect: HTMLButtonElement;
  readonly resumeDialog: HTMLDialogElement;
  readonly connectionDialog: HTMLDialogElement;
  readonly connectionSettings: HTMLButtonElement;
  readonly account: HTMLElement;
  readonly signIn: HTMLButtonElement;
}

const PAGE_TITLE = 'Insanity_Loom';

export class Loom {
  private readonly conversation: Conversation;
  private readonly compose: Compose;
  private readonly connectionPanel: ConnectionPanel;
  private readonly waiting: string[] = [];
  private replying = false;
  private state: ConnectionState = 'disconnected';

  constructor(
    private readonly elements: LoomElements,
    private readonly assistant: AssistantBridge,
    private readonly connection: ConnectionBridge,
    journal: ConstructorParameters<typeof Compose>[1],
  ) {
    this.conversation = new Conversation(elements.conversation);
    // Saving new connection settings reconnects with them at once.
    this.connectionPanel = new ConnectionPanel(elements.connectionDialog, connection, () => void this.run('assistant.reconnect'));
    elements.connectionSettings.addEventListener('click', () => void this.run('assistant.connectionSettings'));
    this.compose = new Compose(elements.compose, journal, (section) => this.finishSection(section));
    elements.reconnect.addEventListener('click', () => void this.run('assistant.reconnect'));
    assistant.onEvent((event) => this.onEvent(event));

    // Esc stops a reply being written, wherever the author is on the page — unless a dialog is open, which Esc closes.
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented && document.querySelector('dialog[open]') === null && this.replying) {
        event.preventDefault();
        void this.run('assistant.stop');
      }
    });
  }

  /**
   * Restores the author's unsent writing, then connects. Until connection settings have been saved — a new copy of
   * Insanity_Loom — the Connection Settings panel opens first, by itself.
   */
  async start(): Promise<void> {
    await this.compose.restore();
    const state = await this.connection.load();
    if (!state.saved || state.problem !== '') {
      const outcome = await this.connectionPanel.show();
      this.compose.focus();
      // Saving in the panel has already reconnected; closing it without saving leaves the status bar saying why not.
      if (outcome === 'unchanged') await this.assistant.connect();
      return;
    }
    this.compose.focus();
    if (state.settings.connectOnStart) await this.assistant.connect();
    else this.onEvent({ type: 'status', state: 'disconnected', detail: 'Not connected. Assistant ▸ Reconnect connects.' });
  }

  async run(command: AssistantCommandId): Promise<void> {
    try {
      switch (command) {
        case 'assistant.reconnect':
          this.waiting.length = 0;
          this.replying = false;
          await this.assistant.connect();
          return;
        case 'assistant.newConversation':
          this.conversation.clear();
          await this.assistant.startConversation();
          return;
        case 'assistant.resumeConversation': {
          const chosen = await chooseConversation(this.elements.resumeDialog, () => this.assistant.listConversations());
          if (chosen !== undefined) await this.assistant.resumeConversation(chosen);
          this.compose.focus();
          return;
        }
        case 'assistant.stop':
          if (this.replying) await this.assistant.stop();
          return;
        case 'assistant.connectionSettings':
          await this.connectionPanel.show();
          this.compose.focus();
          return;
        case 'assistant.signOut':
          await this.assistant.signOut();
          return;
      }
    } catch (problem) {
      this.conversation.showProblem(problem instanceof Error ? problem.message : String(problem));
    }
  }

  private finishSection(section: string): void {
    this.conversation.addAuthorSection(section);
    this.waiting.push(section);
    this.sendNext();
  }

  private sendNext(): void {
    if (this.replying || this.state !== 'connected') return;
    const section = this.waiting.shift();
    if (section === undefined) return;
    this.replying = true;
    // The reply arrives as events; the promise only settles when it has finished, which replyFinished also reports.
    this.assistant.send(section).catch((problem: unknown) => {
      this.conversation.showProblem(problem instanceof Error ? problem.message : String(problem));
      this.replying = false;
    });
  }

  private onEvent(event: AssistantEvent): void {
    switch (event.type) {
      case 'status':
        this.state = event.state;
        this.elements.statusText.textContent = event.detail;
        this.elements.statusText.dataset['state'] = event.state;
        this.elements.reconnect.hidden = event.state === 'connected' || event.state === 'connecting' || event.state === 'signedOut';
        // Signing in is offered, never started: the author presses Sign In when they choose to.
        this.elements.signIn.hidden = event.state !== 'signedOut';
        if (event.state !== 'connected') this.replying = false;
        return;
      case 'conversation':
        document.title = `${event.title} — ${PAGE_TITLE}`;
        if (event.replaying) this.conversation.clear();
        if (!event.replaying) this.sendNext();
        return;
      case 'replayFinished':
        this.conversation.finishReply('');
        this.sendNext();
        return;
      case 'authorText':
        this.conversation.addAuthorSection(event.text);
        return;
      case 'replyText':
        this.conversation.appendReply(event.text);
        return;
      case 'thinking':
        this.conversation.showThinking();
        return;
      case 'tool':
        this.conversation.showTool(event.id, event.title, event.status);
        return;
      case 'permission':
        this.conversation.askPermission(event.title, event.choices, (choiceId) => {
          void this.assistant.answerPermission(event.requestId, choiceId);
        });
        return;
      case 'replyFinished':
        this.conversation.finishReply(event.reason);
        this.replying = false;
        this.sendNext();
        return;
      case 'problem':
        this.conversation.showProblem(event.message);
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
}
