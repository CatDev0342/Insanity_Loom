// When the whisper is written to its file. The rule is simple and the whole promise of the program rests on it:
// every change is saved at once, and nothing the author writes is ever lost.
//
// Three things make that harder than it sounds, and each is handled here rather than scattered through the loom:
//
// - changes arrive faster than a disk. Changes made while a save is being written are gathered into the next one, so
//   saving never falls behind and the file is never more than one save old.
// - a whisper is sometimes between files: while a new one is being made, or another is being opened, there is nothing
//   to save to. A change then is not a failure; it simply waits for the file.
// - the file moves. A whisper is renamed as soon as its conversation has a title, and a save that landed after the
//   move would write the whisper back at the name it moved away from, leaving two of it. Whoever moves the file stops
//   the saving first and waits for the save in flight to finish.

export interface SavingOptions {
  /** Writes the whisper to this file. */
  readonly write: (path: string) => Promise<void>;
  /** Says that a save failed, in words for the author. */
  readonly onProblem: (message: string) => void;
}

export class Saving {
  /** The file being saved to, or '' while the whisper is between files. */
  private path = '';
  /** True while a save is being written. A flag, not a promise: see `changed`. */
  private busy = false;
  /** The save last begun, for whoever must wait until it is finished. */
  private done: Promise<void> = Promise.resolve();
  /** True when something has changed that this save, or the next, must write. */
  private unsaved = false;

  constructor(private readonly options: SavingOptions) {}

  /** The file the whisper is saved to, or '' while it is between files. */
  get file(): string {
    return this.path;
  }

  useFile(path: string): void {
    this.path = path;
  }

  /** Says the whisper has changed. Writes it at once, or gathers it into the save already being written. */
  changed(): void {
    this.unsaved = true;
    if (this.busy) return;
    this.busy = true;
    // Whether a save is under way is a flag of its own, rather than "is there a promise": a save that finishes
    // before it ever waits for anything — the whisper is between files — would otherwise clear the promise before it
    // had even been kept, and nothing would ever be saved again.
    this.done = this.writeUntilNothingIsLeft();
  }

  private async writeUntilNothingIsLeft(): Promise<void> {
    try {
      while (this.unsaved) {
        this.unsaved = false;
        if (this.path === '') return;
        await this.options.write(this.path);
      }
    } catch (problem) {
      this.options.onProblem(`The whisper could not be saved: ${problem instanceof Error ? problem.message : String(problem)}`);
    } finally {
      this.busy = false;
    }
  }

  /**
   * Takes the file away so that no further save begins, and waits for the one in flight to finish. Returns the file
   * that was being saved to, for whoever is about to move or leave it.
   */
  async stop(): Promise<string> {
    const path = this.path;
    this.path = '';
    await this.done;
    return path;
  }
}
