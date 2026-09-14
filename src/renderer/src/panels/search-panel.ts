// File ▸ Find in the Alcove: the whispers holding some writing, with a glimpse of where it was found. The alcove is
// read each time, so what is found is what is on disk.
//
// The writing is looked for as it reads on the page, not as it is written in the file: markup is no part of what the
// author sees, and no part of what they are looking for.

import type { WhisperFound } from '../../../shared/whispers';
import { dialogButtons, element, enableAccessKeys, row } from './kit';

/** How many whispers the list shows at once before it scrolls. */
const ROWS_SHOWN = 10;

export class SearchPanel {
  private readonly form: HTMLFormElement;
  private readonly looked: HTMLInputElement;
  private readonly found: HTMLSelectElement;
  private readonly said: HTMLParagraphElement;
  private search: (looked: string) => Promise<readonly WhisperFound[]> = async () => [];
  private chosen = '';

  constructor(private readonly dialog: HTMLDialogElement) {
    const heading = element('h2');
    heading.textContent = 'Find in the Alcove';

    this.looked = element('input');
    this.looked.type = 'search';
    this.looked.spellcheck = false;
    const find = element('button', 'panel-inline');
    find.type = 'button';
    find.textContent = 'Find';

    this.said = element('p', 'panel-note');
    this.said.setAttribute('role', 'status');

    this.found = element('select');
    this.found.size = ROWS_SHOWN;
    this.found.disabled = true;

    const { bar, ok, cancel } = dialogButtons([]);
    ok.textContent = 'Open';
    cancel.textContent = 'Close';

    this.form = element('form', 'panel');
    this.form.method = 'dialog';
    this.form.append(
      heading,
      row('search-for', '&Find:', this.looked, find),
      this.said,
      row('search-found', '&Whispers:', this.found),
      bar,
    );
    dialog.replaceChildren(this.form);
    dialog.setAttribute('aria-label', 'Find in the Alcove');
    enableAccessKeys(dialog, this.form);

    // Enter in the field looks; Enter anywhere else opens what is chosen, as the default button does.
    this.looked.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      void this.look();
    });
    find.addEventListener('click', () => void this.look());
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.open();
    });
    cancel.addEventListener('click', () => this.dialog.close());
    this.found.addEventListener('dblclick', () => this.open());
  }

  private open(): void {
    if (this.found.value === '') return;
    this.chosen = this.found.value;
    this.dialog.close();
  }

  private async look(): Promise<void> {
    const looked = this.looked.value.trim();
    if (looked === '') {
      this.show([], 'Write what to look for.');
      return;
    }
    const found = await this.search(looked);
    const many = found.length === 1 ? "1 whisper holds" : `${found.length} whispers hold`;
    this.show(found, found.length === 0 ? `No whisper holds "${looked}".` : `${many} "${looked}".`);
    if (found.length > 0) this.found.focus();
  }

  private show(found: readonly WhisperFound[], said: string): void {
    this.said.textContent = said;
    this.found.replaceChildren(
      ...found.map((whisper) => {
        const option = element('option');
        option.value = whisper.name;
        option.textContent = `${whisper.title}  —  ${whisper.glimpse}${whisper.found > 1 ? `  (${whisper.found})` : ''}`;
        return option;
      }),
    );
    this.found.disabled = found.length === 0;
    if (found.length > 0) this.found.selectedIndex = 0;
  }

  /** What the author asked for: a whisper to open, and the writing they were looking for in it. */
  async ask(search: (looked: string) => Promise<readonly WhisperFound[]>): Promise<{ readonly name: string; readonly looked: string }> {
    this.search = search;
    this.chosen = '';
    this.show([], 'Write what to look for.');
    this.dialog.showModal();
    this.looked.focus();
    this.looked.select();
    await new Promise<void>((resolve) => this.dialog.addEventListener('close', () => resolve(), { once: true }));
    return { name: this.chosen, looked: this.looked.value.trim() };
  }
}
