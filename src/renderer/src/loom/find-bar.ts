// The bar that appears above the whisper when the author presses Ctrl+F, and the keys that go with it.
//
// A bar rather than a dialog, because finding is something done *while* writing: the author may type in the whisper,
// press F3 for the next place, and carry on, without a dialog standing in front of what they are looking at. Esc puts
// it away. It is the one place in Insanity_Loom that is not a classic dialog, and for that reason.

import type { WhisperEditor } from '../document/whisper-editor';

export interface FindBarElements {
  readonly bar: HTMLElement;
  readonly looked: HTMLInputElement;
  readonly said: HTMLElement;
  readonly previous: HTMLButtonElement;
  readonly next: HTMLButtonElement;
  readonly close: HTMLButtonElement;
}

export class FindBar {
  constructor(
    private readonly elements: FindBarElements,
    /** The whisper being written in, or undefined before it is open. */
    private readonly whisper: () => WhisperEditor | undefined,
  ) {
    elements.looked.addEventListener('input', () => this.look());
    elements.looked.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.step(event.shiftKey ? 'previous' : 'next');
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.hide();
      }
    });
    elements.next.addEventListener('click', () => this.step('next'));
    elements.previous.addEventListener('click', () => this.step('previous'));
    elements.close.addEventListener('click', () => this.hide());
  }

  get isShowing(): boolean {
    return !this.elements.bar.hidden;
  }

  /** Ctrl+F: shows the bar, with whatever the author has selected already in it, ready to be looked for. */
  show(): void {
    this.elements.bar.hidden = false;
    this.elements.looked.focus();
    this.elements.looked.select();
    this.look();
  }

  /** Esc, or Close: the marks go and the author is back in the whisper where they were. */
  hide(): void {
    if (!this.isShowing) return;
    this.elements.bar.hidden = true;
    this.whisper()?.stopFinding();
    this.whisper()?.focus();
  }

  /** F3 and Shift+F3, which work whether the bar is showing or not, as in any editor. */
  step(which: 'next' | 'previous'): void {
    const whisper = this.whisper();
    if (whisper === undefined) return;
    if (this.elements.looked.value.trim() === '') {
      this.show();
      return;
    }
    if (!this.isShowing) this.elements.bar.hidden = false;
    this.say(which === 'next' ? whisper.findNext() : whisper.findPrevious());
  }

  private look(): void {
    const whisper = this.whisper();
    if (whisper === undefined) return;
    const looked = this.elements.looked.value;
    this.say(looked === '' ? { at: -1, of: 0 } : whisper.find(looked));
    if (looked === '') whisper.stopFinding();
  }

  /** Which place the author is at, of how many, in the words a find bar uses. */
  private say(found: { readonly at: number; readonly of: number }): void {
    const nothingWritten = this.elements.looked.value === '';
    this.elements.said.textContent = nothingWritten ? '' : found.of === 0 ? 'None' : `${found.at + 1} of ${found.of}`;
    this.elements.said.dataset['found'] = found.of === 0 && !nothingWritten ? 'none' : 'some';
    this.elements.next.disabled = found.of === 0;
    this.elements.previous.disabled = found.of === 0;
  }
}
