// Format ▸ Add Link: the address a piece of writing points at. A small dialog like any other Insanity_Loom panel —
// one field, OK and Cancel, and Remove Link at the bottom left when the caret is in a link already.
//
// An address written without a scheme ("example.com/page") is taken as a web address, as a browser's own address bar
// takes it. Anything that is not an address at all is named as a problem before the dialog closes, never silently
// turned into one.

import { button, dialogButtons, element, enableAccessKeys, row } from './kit';

/** What the author decided: a link to this address, no link at all, or nothing (the dialog was cancelled). */
export type LinkChoice =
  | { readonly kind: 'set'; readonly address: string }
  | { readonly kind: 'remove' }
  | { readonly kind: 'unchanged' };

/** What an address written with no scheme of its own is taken to be. */
const ASSUMED_SCHEME = 'https://';

/** Reads what the author wrote as an address, or says what is wrong with it. */
export function readAddress(written: string): { readonly address: string } | { readonly problem: string } {
  const trimmed = written.trim();
  if (trimmed === '') return { problem: 'Give an address for the link.' };
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
    this.remove = button('&Remove Link');

    const { bar, cancel, apply } = dialogButtons([this.remove]);
    // There is nothing to apply without closing: a link is one decision, made or not.
    apply.remove();

    this.form = element('form', 'panel');
    this.form.method = 'dialog';
    this.form.append(heading, this.problem, row('link-address', '&Address:', this.address), bar);
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
    cancel.addEventListener('click', () => this.dialog.close());
    this.remove.addEventListener('click', () => {
      this.choice = { kind: 'remove' };
      this.dialog.close();
    });
  }

  /** Asks for an address, starting from the one the caret is already in ('' when it is in none). */
  async show(current: string): Promise<LinkChoice> {
    this.choice = { kind: 'unchanged' };
    this.address.value = current;
    this.problem.hidden = true;
    this.remove.hidden = current === '';
    this.dialog.showModal();
    this.address.focus();
    this.address.select();
    await new Promise<void>((resolve) => this.dialog.addEventListener('close', () => resolve(), { once: true }));
    return this.choice;
  }
}
