// The conversation as a document: the author's sections and the assistant's replies, one after another, each closed
// with a dividing line. Replies are written into it as they stream in. Everything is added as text, never as markup,
// so nothing the assistant writes can become part of the page itself.

import type { PermissionChoice } from '../../../shared/assistant';

// When the author is within this many pixels of the bottom, the view follows a growing reply; scrolled further up
// to reread, they are left where they are.
const FOLLOW_DISTANCE_PX = 48;

// How each way a reply can end is told to the author. Anything else ends with no remark.
const ENDINGS: Readonly<Record<string, string>> = {
  cancelled: 'Stopped.',
  max_tokens: 'The reply reached its length limit.',
  max_turn_requests: 'The assistant reached its limit of steps for one reply.',
  refusal: 'The assistant declined to continue.',
  error: 'The reply ended with a problem.',
};

// Tool statuses as the author reads them.
const TOOL_STATUSES: Readonly<Record<string, string>> = {
  pending: 'waiting',
  in_progress: 'working',
  completed: 'done',
  failed: 'failed',
};

type AnswerPermission = (choiceId: string | null) => void;

interface OpenReply {
  readonly element: HTMLElement;
  readonly text: Text;
  readonly tools: HTMLElement;
  readonly toolLines: Map<string, HTMLElement>;
  thinking: HTMLElement | undefined;
}

export class Conversation {
  private reply: OpenReply | undefined;

  constructor(private readonly view: HTMLElement) {}

  clear(): void {
    this.view.replaceChildren();
    this.reply = undefined;
  }

  private get followsBottom(): boolean {
    return this.view.scrollHeight - this.view.scrollTop - this.view.clientHeight <= FOLLOW_DISTANCE_PX;
  }

  private add(element: HTMLElement): void {
    const follow = this.followsBottom;
    this.view.append(element);
    if (follow) this.view.scrollTop = this.view.scrollHeight;
  }

  private divider(): HTMLElement {
    const line = document.createElement('hr');
    line.className = 'loom-divider';
    return line;
  }

  /** A section the author wrote. Closes any reply still open (a replayed history moves straight on). */
  addAuthorSection(text: string): void {
    this.closeReply();
    const section = document.createElement('section');
    section.className = 'whisper by-author';
    section.textContent = text;
    this.add(section);
    this.add(this.divider());
  }

  private openReply(): OpenReply {
    if (this.reply !== undefined) return this.reply;
    const element = document.createElement('section');
    element.className = 'whisper by-assistant';
    element.setAttribute('aria-busy', 'true');
    const body = document.createElement('div');
    body.className = 'reply-text';
    const text = document.createTextNode('');
    body.append(text);
    const tools = document.createElement('div');
    tools.className = 'reply-tools';
    element.append(tools, body);
    this.add(element);
    this.reply = { element, text, tools, toolLines: new Map(), thinking: undefined };
    return this.reply;
  }

  appendReply(text: string): void {
    const reply = this.openReply();
    const follow = this.followsBottom;
    reply.thinking?.remove();
    reply.thinking = undefined;
    reply.text.appendData(text);
    if (follow) this.view.scrollTop = this.view.scrollHeight;
  }

  showThinking(): void {
    const reply = this.openReply();
    if (reply.thinking !== undefined || reply.text.length > 0) return;
    reply.thinking = document.createElement('p');
    reply.thinking.className = 'reply-thinking';
    reply.thinking.textContent = 'Thinking…';
    reply.element.append(reply.thinking);
  }

  showTool(id: string, title: string, status: string): void {
    const reply = this.openReply();
    let line = reply.toolLines.get(id);
    if (line === undefined) {
      line = document.createElement('p');
      line.className = 'reply-tool';
      line.dataset['title'] = '';
      reply.toolLines.set(id, line);
      reply.tools.append(line);
    }
    if (title !== '') line.dataset['title'] = title;
    const shownStatus = TOOL_STATUSES[status] ?? status;
    line.textContent = `${line.dataset['title'] ?? ''}${shownStatus === '' ? '' : ` — ${shownStatus}`}`;
  }

  /** Asks the author a permission question inside the reply it belongs to, and shows their answer afterwards. */
  askPermission(title: string, choices: readonly PermissionChoice[], answer: AnswerPermission): void {
    const reply = this.openReply();
    const card = document.createElement('div');
    card.className = 'permission';
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', 'Permission request');
    const question = document.createElement('p');
    question.textContent = title;
    const buttons = document.createElement('div');
    buttons.className = 'permission-choices';
    const settle = (choice: PermissionChoice | undefined): void => {
      buttons.remove();
      const outcome = document.createElement('p');
      outcome.className = 'permission-outcome';
      outcome.textContent = choice === undefined ? 'Not answered.' : `You chose: ${choice.name}`;
      card.append(outcome);
      answer(choice?.id ?? null);
    };
    for (const choice of choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `permission-choice kind-${choice.kind}`;
      button.textContent = choice.name;
      button.addEventListener('click', () => settle(choice));
      buttons.append(button);
    }
    card.append(question, buttons);
    reply.element.append(card);
    if (this.followsBottom) this.view.scrollTop = this.view.scrollHeight;
  }

  /** Ends the open reply with its dividing line, and says how it ended when that is worth saying. */
  finishReply(reason: string): void {
    const reply = this.reply;
    if (reply === undefined) return;
    const ending = ENDINGS[reason];
    if (ending !== undefined) {
      const remark = document.createElement('p');
      remark.className = 'reply-ending';
      remark.textContent = ending;
      reply.element.append(remark);
    }
    this.closeReply();
  }

  private closeReply(): void {
    const reply = this.reply;
    if (reply === undefined) return;
    reply.thinking?.remove();
    reply.element.removeAttribute('aria-busy');
    this.reply = undefined;
    this.add(this.divider());
  }

  showProblem(message: string): void {
    const note = document.createElement('p');
    note.className = 'loom-problem';
    note.setAttribute('role', 'alert');
    note.textContent = message;
    this.add(note);
  }
}
