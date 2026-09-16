// The assistant's thinking: shown beside the whisper as it arrives, and kept in a companion document of its own.
//
// It is deliberately not in the whisper. The whisper is the author's prose — the thing they edit, search, share and
// hand to another assistant — and thinking is a record beside it, wanted for looking things up rather than for
// reading as writing. Keeping the two apart also keeps the whisper light: a page of prose, not a page of prose with
// thousands of tokens of reasoning folded into it (95.31).
//
// The companion is Markdown, headed by the turn it belongs to, so it can be read, indexed and searched on its own.
//
// The commands the assistant runs are kept with the thinking in the companion, because what was run is part of the
// record of the turn — but they are shown in **a tab of their own**. Mixed in with the thinking they crowded it out
// entirely: a wall of `export PATH=…` with the thinking nowhere to be seen (the designer, 2026-Sep-14). Thinking in
// one tab, commands in another.
//
// They were in the status bar before that, where a long one pushed the bar up into the writing. A line beneath the
// whisper cannot hold a command, and should never try.

import type { WhispersBridge } from '../../../shared/whispers';
import { workOfACommand } from './command-lines';

/** The tab the commands are shown in, for saying that something has happened there. */
export const COMMANDS_TAB = 'commands';

export interface ThoughtsElements {
  readonly thoughtsPanel: HTMLElement;
  readonly thoughtsStream: HTMLElement;
  readonly thoughtsSaid: HTMLElement;
  readonly commandsStream: HTMLElement;
  readonly commandsSaid: HTMLElement;
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
  /** Which thought the last piece belonged to: another means another paragraph, not a longer one. */
  private thinkingAbout = '';
  /** The commands being followed, by the name the assistant gave them, so each is shown once. */
  private readonly commands = new Map<string, HTMLElement>();
  /** How many commands have arrived since the author last looked at the Commands tab. */
  private unseenCommands = 0;

  constructor(
    private readonly elements: ThoughtsElements,
    private readonly whispers: WhispersBridge,
    private readonly onProblem: (message: string) => void,
    /** Says how much has happened in a tab the author is not looking at. */
    private readonly saySomethingHappened: (tabId: string, howMuch: number) => void = () => undefined,
  ) {}

  /** The author is looking at the commands now, so there is nothing there they have not seen. */
  commandsSeen(): void {
    this.unseenCommands = 0;
  }

  /** Another whisper is open: what follows belongs beside that one, and the panel starts afresh. */
  keepBeside(whisperPath: string): void {
    this.flush();
    this.whisperPath = whisperPath;
    this.headed = false;
    this.commands.clear();
    this.unseenCommands = 0;
    this.saySomethingHappened(COMMANDS_TAB, 0);
    this.elements.thoughtsStream.replaceChildren();
    this.elements.thoughtsSaid.textContent = '';
    this.elements.commandsStream.replaceChildren();
    this.elements.commandsSaid.textContent = '';
  }

  /**
   * The same whisper, under a new name: its file moved when the conversation was given a title, and the companion
   * moved with it. Nothing is forgotten — the thinking on the page belongs to this same conversation.
   */
  movedTo(whisperPath: string): void {
    this.whisperPath = whisperPath;
  }

  /**
   * A turn was taken: what the assistant thinks from here, and everything it runs, belongs to it.
   *
   * Both streams are headed the same way and with the same words the whisper uses, so a command can be read back to
   * the turn that caused it (the designer, 2026-Sep-16).
   */
  beginTurn(number: number, shown: string): void {
    this.flush();
    this.commands.clear();
    this.turn = { number, shown };
    this.headed = false;
    const heading = document.createElement('p');
    heading.className = 'thought-turn';
    heading.textContent = `Turn ${number} · ${shown}`;
    this.elements.thoughtsStream.append(heading);
    const overTheCommands = document.createElement('p');
    overTheCommands.className = 'thought-turn';
    overTheCommands.textContent = `Turn ${number} · ${shown}`;
    this.elements.commandsStream.append(overTheCommands);
    this.commandsToTheEnd();
    this.goToTheEnd();
  }

  /**
   * A command the assistant is running, and how it is getting on. The same command is shown once and then followed:
   * a line that changes as it goes, rather than a new line each time something happens to it.
   */
  /**
   * A command the assistant is running, or one already shown moving on to its next state.
   *
   * What is shown is the work, not the getting ready (command-lines.ts), and a command run again and again in a row —
   * the same file read twice, the same build tried twice — is said once with a count beside it rather than filling
   * the panel with the same line.
   */
  command(id: string, title: string, detail: string, status: string): void {
    const whole = [title.trim(), detail.trim()].filter((part) => part !== '').join(' — ');
    if (whole === '') return;
    const already = this.commands.get(id);
    if (already !== undefined) {
      already.dataset['status'] = status;
      // A command says more of itself as it goes: what it is working on may only be known once it has begun.
      const said = already.querySelector('.thought-command-said');
      const now = workOfACommand(whole);
      if (said instanceof HTMLElement && now.length > (said.textContent ?? '').length) {
        said.textContent = now;
        already.title = whole;
      }
      return;
    }

    // Every command is its own line, whole: two that read alike from the front are not the same command, and a line
    // cut short to fit the panel hides exactly the part that tells them apart (the designer, 2026-Sep-16).
    const line = document.createElement('p');
    line.className = 'thought-command';
    // The whole of it, getting-ready and all, is on hover: the line shows the work, the hover shows what was run.
    line.title = whole;
    line.dataset['status'] = status;
    const said = document.createElement('span');
    said.className = 'thought-command-said';
    said.textContent = workOfACommand(whole);
    line.append(said);
    this.commands.set(id, line);
    this.elements.commandsStream.append(line);
    this.commandsToTheEnd();
    this.newsOfACommand();
    // Kept with the thinking, in the companion: what was run is part of the record of the turn, whichever tab it is
    // shown in. The whole command is kept, not the short name — the record is for looking things up later.
    this.unwritten += `\n\n\u0060${whole.replace(/\s+/g, ' ')}\u0060\n`;
    this.writeSoon();
  }

  private newsOfACommand(): void {
    this.unseenCommands += 1;
    this.saySomethingHappened(COMMANDS_TAB, this.unseenCommands);
  }

  /** A piece of thinking, as it is written. */
  add(text: string, messageId = ''): void {
    if (text === '') return;
    const sameThought = messageId === this.thinkingAbout;
    this.thinkingAbout = messageId;
    const last = this.elements.thoughtsStream.lastElementChild;
    if (sameThought && last instanceof HTMLElement && last.classList.contains('thought')) last.textContent += text;
    else {
      const piece = document.createElement('p');
      piece.className = 'thought';
      piece.textContent = text;
      this.elements.thoughtsStream.append(piece);
    }
    this.goToTheEnd();
    this.unwritten += sameThought ? text : `\n\n${text}`;
    this.writeSoon();
  }

  /**
   * A line about the turn itself rather than about its subject — what it cost, in milliseconds (timings.ts). It is
   * kept with the thinking, because it belongs to the record of the turn and not to the author's prose.
   */
  saySomethingAboutTheTurn(said: string): void {
    const line = document.createElement('p');
    line.className = 'thought-about-the-turn';
    line.textContent = said;
    this.elements.thoughtsStream.append(line);
    this.goToTheEnd();
    this.unwritten += `\n\n_${said}_\n`;
    this.flush();
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

  private commandsToTheEnd(): void {
    const pane = this.elements.commandsStream.parentElement?.parentElement;
    if (pane !== null && pane !== undefined) pane.scrollTop = pane.scrollHeight;
  }
}
