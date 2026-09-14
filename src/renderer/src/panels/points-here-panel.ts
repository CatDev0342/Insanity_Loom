// File ▸ What Points Here: the whispers that link to the one the author is in, and which of its sections they point
// into. A wiki's backlinks, read from the alcove itself each time the panel opens, so it is never out of date with
// the files.
//
// Choosing one opens it, as File ▸ Open Whisper does.

import type { WhisperPointingHere } from '../../../shared/whispers';
import { dialogButtons, element, enableAccessKeys, row } from './kit';

/** How many whispers the list shows at once before it scrolls. */
const ROWS_SHOWN = 10;

/** The whisper as a whole, rather than one of its sections. */
const WHOLE_WHISPER = '';

export class PointsHerePanel {
  private readonly form: HTMLFormElement;
  private readonly pointing: HTMLSelectElement;
  private readonly count: HTMLParagraphElement;
  private chosen = '';

  constructor(private readonly dialog: HTMLDialogElement) {
    const heading = element('h2');
    heading.textContent = 'What Points Here';
    this.count = element('p', 'panel-note');
    this.count.setAttribute('role', 'status');

    this.pointing = element('select');
    this.pointing.size = ROWS_SHOWN;

    const { bar, ok, cancel } = dialogButtons([]);
    ok.textContent = 'Open';
    cancel.textContent = 'Close';

    this.form = element('form', 'panel');
    this.form.method = 'dialog';
    this.form.append(heading, this.count, row('points-here', '&Whispers:', this.pointing), bar);
    dialog.replaceChildren(this.form);
    dialog.setAttribute('aria-label', 'What Points Here');
    enableAccessKeys(dialog, this.form);

    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.chosen = this.pointing.value;
      this.dialog.close();
    });
    cancel.addEventListener('click', () => this.dialog.close());
    // Double-clicking a whisper opens it, as a list in any desktop program does.
    this.pointing.addEventListener('dblclick', () => {
      if (this.pointing.value === '') return;
      this.chosen = this.pointing.value;
      this.dialog.close();
    });
  }

  /** How a whisper is listed: its name, and the sections of this whisper it points into. */
  private static describe(whisper: WhisperPointingHere): string {
    const sections = whisper.headings.filter((heading) => heading !== WHOLE_WHISPER);
    return sections.length === 0 ? whisper.title : `${whisper.title}  →  ${sections.join(', ')}`;
  }

  /** Shows what points at the whisper open. Returns the file name of the whisper to open, or '' for none. */
  async show(here: string, pointing: readonly WhisperPointingHere[]): Promise<string> {
    this.chosen = '';
    this.count.textContent =
      pointing.length === 0
        ? `No whisper points at "${here}" yet.`
        : `${pointing.length} whisper${pointing.length === 1 ? '' : 's'} point${pointing.length === 1 ? 's' : ''} at "${here}".`;
    this.pointing.replaceChildren(
      ...pointing.map((whisper) => {
        const option = element('option');
        option.value = whisper.name;
        option.textContent = PointsHerePanel.describe(whisper);
        return option;
      }),
    );
    this.pointing.disabled = pointing.length === 0;
    if (pointing.length > 0) this.pointing.selectedIndex = 0;
    this.dialog.showModal();
    this.pointing.focus();
    await new Promise<void>((resolve) => this.dialog.addEventListener('close', () => resolve(), { once: true }));
    return this.chosen;
  }
}
