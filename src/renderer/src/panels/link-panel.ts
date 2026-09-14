// Format ▸ Add Link: the address a piece of writing points at. A small dialog like any other Insanity_Loom panel —
// one field, a list of the whispers in the alcove to save typing, OK and Cancel, and Remove Link at the bottom left
// when the caret is in a link already.
//
// Two kinds of address are understood. A whisper in the alcove is named by its file name, and the link is written
// relative, so it works both in Insanity_Loom and in a browser opening the file, and survives the alcove being moved
// or copied. Anything else is a web address: one written without a scheme ("example.com/page") is taken as a web
// address, as a browser's own address bar takes it, and what is not an address at all is named as a problem before
// the dialog closes, never silently turned into one.

import { isWhisperAddress, type WhisperInAlcove } from '../../../shared/whispers';
import { button, dialogButtons, element, enableAccessKeys, row } from './kit';

/** What the author decided: a link to this address, no link at all, or nothing (the dialog was cancelled). */
export type LinkChoice =
  | { readonly kind: 'set'; readonly address: string }
  | { readonly kind: 'remove' }
  | { readonly kind: 'unchanged' };

/** What an address written with no scheme of its own is taken to be. */
const ASSUMED_SCHEME = 'https://';

/** The first entry of the whisper list, which chooses none. */
const NO_WHISPER_CHOSEN = '';

/** An address as the author reads and writes it: a whisper's link is shown as its plain file name. */
function asWritten(address: string): string {
  try {
    const decoded = decodeURIComponent(address);
    return isWhisperAddress(decoded) ? decoded : address;
  } catch {
    return address;
  }
}

/** Reads what the author wrote as an address, or says what is wrong with it. */
export function readAddress(written: string): { readonly address: string } | { readonly problem: string } {
  const trimmed = written.trim();
  if (trimmed === '') return { problem: 'Give an address for the link.' };
  // A whisper is named by its file name; the link carries it as a web address does, so spaces and the like are
  // written the way a browser expects to read them back.
  if (isWhisperAddress(trimmed)) return { address: encodeURIComponent(trimmed) };
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `${ASSUMED_SCHEME}${trimmed}`;
  try {
    return { address: new URL(withScheme).href };
  } catch {
    return { problem: `"${trimmed}" is not an address Insanity_Loom can follow.` };
  }
}

export class LinkPanel {
  private readonly form: HTMLFormElement;
  private readonly address: HTMLInputElement;
  private readonly whispers: HTMLSelectElement;
  private readonly problem: HTMLParagraphElement;
  private readonly remove: HTMLButtonElement;
  private choice: LinkChoice = { kind: 'unchanged' };

  constructor(private readonly dialog: HTMLDialogElement) {
    const heading = element('h2');
    heading.textContent = 'Link';
    this.problem = element('p', 'panel-problem');
    this.problem.setAttribute('role', 'alert');
    this.problem.hidden = true;

    this.address = element('input');
    this.address.type = 'text';
    this.address.spellcheck = false;
    this.whispers = element('select');
    this.remove = button('&Remove Link');
    const whispersNote = element('p', 'panel-note');
    whispersNote.textContent =
      'A link to a whisper is written relative to the alcove, so it works here and in a browser, and keeps working ' +
      'when the alcove is moved or copied.';

    const { bar, cancel, apply } = dialogButtons([this.remove]);
    // There is nothing to apply without closing: a link is one decision, made or not.
    apply.remove();

    this.form = element('form', 'panel');
    this.form.method = 'dialog';
    this.form.append(
      heading,
      this.problem,
      row('link-address', '&Address:', this.address),
      row('link-whisper', 'Or a &whisper:', this.whispers),
      whispersNote,
      bar,
    );
    dialog.replaceChildren(this.form);
    dialog.setAttribute('aria-label', 'Link');
    enableAccessKeys(dialog, this.form);

    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      const read = readAddress(this.address.value);
      if ('problem' in read) {
        this.problem.textContent = read.problem;
        this.problem.hidden = false;
        this.address.focus();
        return;
      }
      this.choice = { kind: 'set', address: read.address };
      this.dialog.close();
    });
    // Choosing a whisper fills the address in; it can still be edited by hand afterwards.
    this.whispers.addEventListener('change', () => {
      if (this.whispers.value === NO_WHISPER_CHOSEN) return;
      this.address.value = this.whispers.value;
      this.problem.hidden = true;
    });
    cancel.addEventListener('click', () => this.dialog.close());
    this.remove.addEventListener('click', () => {
      this.choice = { kind: 'remove' };
      this.dialog.close();
    });
  }

  /** Asks for an address, starting from the one the caret is already in ('' when it is in none). */
  async show(current: string, whispers: readonly WhisperInAlcove[]): Promise<LinkChoice> {
    this.choice = { kind: 'unchanged' };
    const none = element('option');
    none.value = NO_WHISPER_CHOSEN;
    none.textContent = '(none)';
    this.whispers.replaceChildren(
      none,
      ...whispers.map((whisper) => {
        const option = element('option');
        option.value = whisper.name;
        option.textContent = whisper.title;
        return option;
      }),
    );
    const written = asWritten(current);
    this.whispers.value = whispers.some((whisper) => whisper.name === written) ? written : NO_WHISPER_CHOSEN;
    this.address.value = written;
    this.problem.hidden = true;
    this.remove.hidden = current === '';
    this.dialog.showModal();
    this.address.focus();
    this.address.select();
    await new Promise<void>((resolve) => this.dialog.addEventListener('close', () => resolve(), { once: true }));
    return this.choice;
  }
}
