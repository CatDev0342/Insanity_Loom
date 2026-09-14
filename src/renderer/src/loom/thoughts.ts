// The assistant's thinking: shown beside the whisper as it arrives, and kept in a companion document of its own.
//
// It is deliberately not in the whisper. The whisper is the author's prose — the thing they edit, search, share and
// hand to another assistant — and thinking is a record beside it, wanted for looking things up rather than for
// reading as writing. Keeping the two apart also keeps the whisper light: a page of prose, not a page of prose with
// thousands of tokens of reasoning folded into it (95.31).
//
// The companion is Markdown, headed by the turn it belongs to, so it can be read, indexed and searched on its own.

import type { WhispersBridge } from '../../../shared/whispers';

export interface ThoughtsElements {
  readonly thoughtsPanel: HTMLElement;
  readonly thoughtsStream: HTMLElement;
  readonly thoughtsSaid: HTMLElement;
}

/** How long the thinking may gather before it is written to the companion, in milliseconds. */
const WRITTEN_EVERY_MS = 1000;

export class Thoughts {
  /** What has arrived for the turn being answered, not yet written to the companion document. */
  private unwritten = '';
  /** Whether this turn's heading has been written to the companion yet. */
  private headed = false;
  private writingSoon = 0;
  /** The turn being answered, as the whisper numbers it, and when it was taken. */
  private turn = { number: 0, shown: '' };
  /** The whisper the thinking belongs to; '' while there is none. */
  private whisperPath = '';

  constructor(
    private readonly elements: ThoughtsElements,
    private readonly whispers: WhispersBridge,
    private readonly onProblem: (message: string) => void,
  ) {}

  /** Another whisper is open: what follows belongs beside that one, and the panel starts afresh. */
  keepBeside(whisperPath: string): void {
    this.flush();
    this.whisperPath = whisperPath;
    this.headed = false;
    this.elements.thoughtsStream.replaceChildren();
    this.elements.thoughtsSaid.textContent = '';
  }

  /**
   * The same whisper, under a new name: its file moved when the conversation was given a title, and the companion
   * moved with it. Nothing is forgotten — the thinking on the page belongs to this same conversation.
   */
  movedTo(whisperPath: string): void {
    this.whisperPath = whisperPath;
  }

  /** A turn was taken: what the assistant thinks from here belongs to it. */
  beginTurn(number: number, shown: string): void {
    this.flush();
    this.turn = { number, shown };
    this.headed = false;
    const heading = document.createElement('p');
    heading.className = 'thought-turn';
    heading.textContent = `Turn ${number} · ${shown}`;
    this.elements.thoughtsStream.append(heading);
    this.goToTheEnd();
  }

  /** A piece of thinking, as it is written. */
  add(text: string): void {
    if (text === '') return;
    const last = this.elements.thoughtsStream.lastElementChild;
    if (last instanceof HTMLElement && last.classList.contains('thought')) last.textContent += text;
    else {
      const piece = document.createElement('p');
      piece.className = 'thought';
      piece.textContent = text;
      this.elements.thoughtsStream.append(piece);
    }
    this.goToTheEnd();
    this.unwritten += text;
    this.writeSoon();
  }

  /** What the panel says when nothing is being thought. */
  say(message: string): void {
    this.elements.thoughtsSaid.textContent = message;
  }

  /** Writes what has gathered to the companion document, and stops waiting to. */
  flush(): void {
    if (this.writingSoon !== 0) {
      window.clearTimeout(this.writingSoon);
      this.writingSoon = 0;
    }
    const written = this.unwritten;
    this.unwritten = '';
    if (written === '' || this.whisperPath === '') return;
    const heading = this.headed ? '' : `\n## Turn ${this.turn.number} · ${this.turn.shown}\n\n`;
    this.headed = true;
    void this.whispers.addThought(this.whisperPath, `${heading}${written}`).catch((problem: unknown) => {
      this.onProblem(`The assistant's thinking could not be kept: ${problem instanceof Error ? problem.message : String(problem)}`);
    });
  }

  /** Thinking arrives in pieces far faster than a disk; it is gathered and written a second at a time. */
  private writeSoon(): void {
    if (this.writingSoon !== 0) return;
    this.writingSoon = window.setTimeout(() => {
      this.writingSoon = 0;
      this.flush();
    }, WRITTEN_EVERY_MS);
  }

  private goToTheEnd(): void {
    this.elements.thoughtsPanel.scrollTop = this.elements.thoughtsPanel.scrollHeight;
  }
}
