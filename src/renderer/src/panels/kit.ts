// The parts every Insanity_Loom panel is built from, so they all behave like classic desktop dialogs in the same way:
// grouped fields with their labels to the left, access keys on the labels (Alt+letter moves to the field, and the
// letters are underlined while Alt is held), Tab order, Enter for OK and Esc for Cancel.

import { parseLabel } from '../menu/labels';

export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = ''): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  if (className !== '') made.className = className;
  return made;
}

/** Writes a label with its access key underlined, and records the key on the control it names. */
export function labelFor(control: HTMLElement, written: string, into: HTMLElement): void {
  const parsed = parseLabel(written);
  if (parsed.accessKeyIndex < 0) {
    into.append(parsed.text);
    return;
  }
  const key = element('span', 'access-key');
  key.textContent = parsed.text.charAt(parsed.accessKeyIndex);
  into.append(parsed.text.slice(0, parsed.accessKeyIndex), key, parsed.text.slice(parsed.accessKeyIndex + 1));
  control.dataset['accessKey'] = parsed.accessKey;
}

/** A labelled row: the label on the left, the control (and anything beside it) on the right. */
export function row(id: string, label: string, control: HTMLElement, extra?: HTMLElement): HTMLElement {
  const holder = element('div', 'panel-row');
  control.id = id;
  const caption = element('label');
  caption.htmlFor = id;
  labelFor(control, label, caption);
  const controls = element('div', 'panel-control');
  controls.append(control);
  if (extra !== undefined) controls.append(extra);
  holder.append(caption, controls);
  return holder;
}

/** A checkbox or radio button with its label to its right. */
export function choice(type: 'radio' | 'checkbox', id: string, label: string, name = ''): { row: HTMLElement; input: HTMLInputElement } {
  const input = element('input');
  input.type = type;
  input.id = id;
  if (name !== '') input.name = name;
  const caption = element('label');
  caption.htmlFor = id;
  labelFor(input, label, caption);
  const holder = element('div', 'panel-choice');
  holder.append(input, caption);
  return { row: holder, input };
}

export function button(label: string, className = ''): HTMLButtonElement {
  const made = element('button', className);
  made.type = 'button';
  labelFor(made, label, made);
  return made;
}

export function group(legend: string, ...rows: HTMLElement[]): HTMLFieldSetElement {
  const set = element('fieldset', 'panel-group');
  const title = element('legend');
  title.textContent = legend;
  set.append(title, ...rows);
  return set;
}

/** The OK / Cancel / Apply buttons, bottom right, with any secondary buttons bottom left. */
export function dialogButtons(secondary: readonly HTMLButtonElement[]): {
  readonly bar: HTMLElement;
  readonly ok: HTMLButtonElement;
  readonly cancel: HTMLButtonElement;
  readonly apply: HTMLButtonElement;
} {
  const ok = element('button', 'panel-default');
  ok.type = 'submit';
  ok.textContent = 'OK';
  const cancel = element('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  const apply = button('Appl&y');
  const left = element('div', 'panel-buttons-left');
  left.append(...secondary);
  const right = element('div', 'panel-buttons-right');
  right.append(ok, cancel, apply);
  const bar = element('div', 'panel-buttons');
  bar.append(left, right);
  return { bar, ok, cancel, apply };
}

/** Alt+letter moves to the field or presses the button whose label carries that access key, as in any desktop dialog. */
export function enableAccessKeys(dialog: HTMLDialogElement, form: HTMLElement): void {
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Alt') {
      form.classList.add('shows-access-keys');
      return;
    }
    if (!event.altKey || event.ctrlKey || event.metaKey || event.key.length !== 1) return;
    const key = event.key.toLowerCase();
    const target = [...form.querySelectorAll<HTMLElement>('[data-access-key]')].find(
      (candidate) => candidate.dataset['accessKey'] === key && candidate.closest('fieldset:disabled') === null,
    );
    if (target === undefined) return;
    event.preventDefault();
    if (target instanceof HTMLButtonElement || (target instanceof HTMLInputElement && (target.type === 'radio' || target.type === 'checkbox'))) {
      target.click();
    }
    target.focus();
  });
  dialog.addEventListener('keyup', (event) => {
    if (event.key === 'Alt') form.classList.remove('shows-access-keys');
  });
}
