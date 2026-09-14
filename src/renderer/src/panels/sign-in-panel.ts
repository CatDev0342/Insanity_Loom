// Assistant ▸ Sign In: signs the assistant in without a terminal window, a PowerShell prompt, or a pasted command.
// The author chooses how (the assistant offers its own methods — a Claude subscription, an Anthropic Console account),
// Insanity_Loom starts the assistant's sign-in, opens the sign-in page in their browser with one button, and takes the
// code the page shows in a box here. The assistant keeps the sign-in where it runs; Insanity_Loom never sees a
// password.
//
// It never opens by itself: signing in is always the author's own choice (Assistant ▸ Sign In, or the status bar's
// Sign In button when the assistant says it is not signed in), and the browser opens only when they press the button.

import type { AssistantBridge, AssistantEvent, SignInMethod } from '../../../shared/assistant';
import { button, choice, element, enableAccessKeys, group, row } from './kit';

type SignInEvent = Extract<AssistantEvent, { type: 'signIn' }>;

export class SignInPanel {
  private readonly form: HTMLFormElement;
  private readonly methods: HTMLElement;
  private readonly start: HTMLButtonElement;
  private readonly pageStep: HTMLFieldSetElement;
  private readonly address: HTMLInputElement;
  private readonly openPage: HTMLButtonElement;
  private readonly code: HTMLInputElement;
  private readonly finish: HTMLButtonElement;
  private readonly result: HTMLParagraphElement;
  private readonly close: HTMLButtonElement;

  constructor(
    private readonly dialog: HTMLDialogElement,
    private readonly assistant: AssistantBridge,
  ) {
    const heading = element('h2');
    heading.textContent = 'Sign In';
    const intro = element('p', 'panel-intro');
    intro.textContent =
      'Sign the assistant in to your account. Your password goes only to the sign-in page, in your own browser; the ' +
      'assistant keeps the sign-in where it runs.';

    this.methods = element('div', 'panel-choices');
    this.start = button('&Start Sign-In');
    const startHolder = element('div', 'panel-inline');
    startHolder.append(this.start);

    this.address = element('input');
    this.address.readOnly = true;
    this.openPage = button('&Open Sign-In Page');
    const pageHolder = element('span', 'panel-inline');
    pageHolder.append(this.openPage);
    this.code = element('input');
    this.code.spellcheck = false;
    this.code.autocomplete = 'off';
    const pageNote = element('p', 'panel-note');
    pageNote.textContent = 'Sign in on the page, then paste the code it shows you below.';
    this.pageStep = group(
      '2. On the sign-in page',
      pageNote,
      row('sign-in-address', 'Sign-in &page:', this.address, pageHolder),
      row('sign-in-code', '&Code from the page:', this.code),
    );

    this.result = element('p', 'panel-result');
    this.result.setAttribute('role', 'status');

    this.finish = element('button', 'panel-default');
    this.finish.type = 'submit';
    this.finish.textContent = 'Finish Sign-In';
    this.close = element('button');
    this.close.type = 'button';
    this.close.textContent = 'Cancel';
    const right = element('div', 'panel-buttons-right');
    right.append(this.finish, this.close);
    const buttons = element('div', 'panel-buttons');
    buttons.append(element('div', 'panel-buttons-left'), right);

    this.form = element('form', 'panel');
    this.form.method = 'dialog';
    this.form.append(heading, intro, group('1. How to sign in', this.methods, startHolder), this.pageStep, this.result, buttons);
    dialog.replaceChildren(this.form);
    dialog.setAttribute('aria-label', 'Sign In');
    enableAccessKeys(dialog, this.form);

    this.start.addEventListener('click', () => void this.begin());
    this.openPage.addEventListener('click', () => void this.open());
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.sendCode();
    });
    this.close.addEventListener('click', () => dialog.close());
    // Closing the panel before the sign-in finishes stops it.
    dialog.addEventListener('close', () => void this.assistant.cancelSignIn());
    assistant.onEvent((event) => {
      if (event.type === 'signIn') this.onProgress(event);
    });
  }

  /** Opens the panel with the sign-in methods the assistant offers. Only ever at the author's request. */
  async show(): Promise<void> {
    const offered: readonly SignInMethod[] = await this.assistant.signInMethods();
    this.methods.replaceChildren(
      ...offered.map((method, index) => {
        const option = choice('radio', `sign-in-${method.id}`, method.name.replace(/&/g, '&&'), 'sign-in-method');
        option.input.value = method.id;
        option.input.checked = index === 0;
        if (method.description.trim() !== '') option.row.title = method.description;
        return option.row;
      }),
    );
    if (offered.length === 0) {
      this.methods.textContent = 'The assistant offers no way to sign in from Insanity_Loom. Is it connected?';
    }
    this.start.disabled = offered.length === 0;
    this.pageStep.disabled = true;
    this.address.value = '';
    this.code.value = '';
    this.finish.disabled = true;
    this.close.textContent = 'Cancel';
    this.say('', false);
    this.dialog.showModal();
    (offered.length > 0 ? this.start : this.close).focus();
  }

  private chosenMethod(): string {
    return this.methods.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.value ?? '';
  }

  private say(message: string, failed: boolean): void {
    this.result.textContent = message;
    this.result.classList.toggle('is-failure', failed);
  }

  private async begin(): Promise<void> {
    const method = this.chosenMethod();
    if (method === '') return;
    this.start.disabled = true;
    try {
      await this.assistant.signIn(method);
    } catch (problem) {
      this.say(problem instanceof Error ? problem.message : String(problem), true);
      this.start.disabled = false;
    }
  }

  private onProgress(event: SignInEvent): void {
    if (!this.dialog.open) return;
    switch (event.stage) {
      case 'started':
        this.say(event.message, false);
        return;
      case 'page':
        this.address.value = event.url;
        this.pageStep.disabled = false;
        this.finish.disabled = false;
        this.say(event.message, false);
        this.openPage.focus();
        return;
      case 'finished':
        this.say(`${event.message} Reconnecting…`, false);
        this.pageStep.disabled = true;
        this.finish.disabled = true;
        this.close.textContent = 'Close';
        this.close.focus();
        return;
      case 'failed':
        this.say(event.message, true);
        this.start.disabled = false;
        this.pageStep.disabled = true;
        this.finish.disabled = true;
        return;
    }
  }

  private async open(): Promise<void> {
    try {
      await this.assistant.openSignInPage(this.address.value);
      this.code.focus();
    } catch (problem) {
      this.say(problem instanceof Error ? problem.message : String(problem), true);
    }
  }

  private async sendCode(): Promise<void> {
    const code = this.code.value.trim();
    if (code === '') {
      this.say('Paste the code the sign-in page shows you.', true);
      this.code.focus();
      return;
    }
    try {
      await this.assistant.sendSignInCode(code);
      this.say('Checking the code…', false);
      this.finish.disabled = true;
    } catch (problem) {
      this.say(problem instanceof Error ? problem.message : String(problem), true);
    }
  }
}
