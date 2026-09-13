// The loom: the author writes, finishes a section, and the assistant's reply is woven into the conversation above.
// Sections finished while a reply is still being written wait their turn and go in order.

import type { AssistantBridge, AssistantEvent, ConnectionState } from '../../../shared/assistant';
import type { PageCommandId } from '../commands';
import { Compose } from './compose';
import { Conversation } from './conversation';
import { chooseConversation } from './resume';

export interface LoomElements {
  readonly conversation: HTMLElement;
  readonly compose: HTMLTextAreaElement;
  readonly statusText: HTMLElement;
  readonly reconnect: HTMLButtonElement;
  readonly resumeDialog: HTMLDialogElement;
}

const PAGE_TITLE = 'Insanity_Loom';

export class Loom {
  private readonly conversation: Conversation;
  private readonly compose: Compose;
  private readonly waiting: string[] = [];
  private replying = false;
  private state: ConnectionState = 'disconnected';

  constructor(
    private readonly elements: LoomElements,
    private readonly assistant: AssistantBridge,
    journal: ConstructorParameters<typeof Compose>[1],
  ) {
    this.conversation = new Conversation(elements.conversation);
    this.compose = new Compose(elements.compose, journal, (section) => this.finishSection(section));
    elements.reconnect.addEventListener('click', () => void this.run('assistant.reconnect'));
    assistant.onEvent((event) => this.onEvent(event));

    // Esc stops a reply being written, wherever the author is on the page — unless a dialog is open, which Esc closes.
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !elements.resumeDialog.open && this.replying) {
        event.preventDefault();
        void this.run('assistant.stop');
      }
    });
  }

  async start(): Promise<void> {
    await this.compose.restore();
    this.compose.focus();
    await this.assistant.connect();
  }

  async run(command: PageCommandId): Promise<void> {
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
        this.elements.reconnect.hidden = event.state === 'connected' || event.state === 'connecting';
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
    }
  }
}
