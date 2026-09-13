// Where the author writes. Every change is saved to the journal at once — before anything else is done with it — so
// a crash, a power cut or a closed window never costs a word. A line of "---" ended with Enter, or Ctrl+Enter
// anywhere, finishes the section and hands it on.

import type { JournalBridge } from '../../../shared/assistant';
import { finishedSectionAt } from './sections';

type OnSection = (section: string) => void;

export class Compose {
  /** The draft waiting to be saved while an earlier save is still being written, if any. */
  private waitingDraft: string | undefined;
  private saving = false;

  constructor(
    private readonly area: HTMLTextAreaElement,
    private readonly journal: JournalBridge,
    private readonly onSection: OnSection,
  ) {
    area.addEventListener('input', () => this.save());
    area.addEventListener('keydown', (event) => this.onKeyDown(event));
  }

  async restore(): Promise<void> {
    this.area.value = await this.journal.loadDraft();
    this.area.setSelectionRange(this.area.value.length, this.area.value.length);
  }

  focus(): void {
    this.area.focus();
  }

  /** Saves the draft now; saves that arrive while one is being written collapse into the latest. */
  private save(): void {
    this.waitingDraft = this.area.value;
    if (this.saving) return;
    this.saving = true;
    void (async () => {
      try {
        while (this.waitingDraft !== undefined) {
          const draft = this.waitingDraft;
          this.waitingDraft = undefined;
          await this.journal.saveDraft(draft);
        }
      } finally {
        this.saving = false;
      }
    })();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.isComposing || event.altKey || event.shiftKey || event.metaKey) return;

    if (event.ctrlKey) {
      const section = this.area.value.trimEnd();
      if (section.trim() === '') return;
      event.preventDefault();
      this.hand(section, '');
      return;
    }

    const { selectionStart, selectionEnd, value } = this.area;
    if (selectionStart !== selectionEnd) return;
    const finished = finishedSectionAt(value, selectionStart);
    if (finished === undefined) return;
    event.preventDefault();
    this.hand(finished.section, finished.remaining);
  }

  private hand(section: string, remaining: string): void {
    this.area.value = remaining;
    this.area.setSelectionRange(0, 0);
    this.save();
    this.onSection(section);
  }
}
