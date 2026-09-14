// Assistant ▸ Connection Settings: every option for reaching the assistant, in one panel that behaves like a classic
// desktop dialog. Labels carry access keys (Alt+letter moves to the field), Tab moves through the fields in order,
// Enter is OK, Esc is Cancel. The exact command that will run is shown beneath the options as they are changed, and
// any problem with them is named before anything is saved.
//
// It opens by itself on the first start, until the author has said where the assistant runs. Nothing entered here
// leaves the computer: it is kept in the Data folder beside the program.

import type { ConnectionBridge } from '../../../shared/assistant';
import {
  connectionProblems,
  describeCommand,
  hostCommand,
  LONGEST_HANDSHAKE_SECONDS,
  SHORTEST_HANDSHAKE_SECONDS,
  type AssistantPlace,
  type ConnectionSettings,
} from '../../../shared/connection';
import { parseLabel } from '../menu/labels';

/** How the panel was closed: saved (OK, or Apply before closing) or not. */
export type PanelOutcome = 'saved' | 'unchanged';

type AfterSave = () => void;

interface Fields {
  readonly docker: HTMLInputElement;
  readonly local: HTMLInputElement;
  readonly dockerGroup: HTMLFieldSetElement;
  readonly dockerProgram: HTMLInputElement;
  readonly container: HTMLInputElement;
  readonly containerNames: HTMLDataListElement;
  readonly containerUser: HTMLInputElement;
  readonly workingFolder: HTMLInputElement;
  readonly hostProgram: HTMLInputElement;
  readonly hostArguments: HTMLTextAreaElement;
  readonly handshakeSeconds: HTMLInputElement;
  readonly connectOnStart: HTMLInputElement;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = ''): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  if (className !== '') made.className = className;
  return made;
}

/** Writes a label with its access key underlined, and records the key on the control it names. */
function labelFor(control: HTMLElement, written: string, into: HTMLElement): void {
  const parsed = parseLabel(written);
  const key = element('span', 'access-key');
  key.textContent = parsed.text.charAt(parsed.accessKeyIndex);
  into.append(parsed.text.slice(0, parsed.accessKeyIndex), key, parsed.text.slice(parsed.accessKeyIndex + 1));
  control.dataset['accessKey'] = parsed.accessKey;
}

function textRow(id: string, label: string, control: HTMLInputElement | HTMLTextAreaElement, extra?: HTMLElement): HTMLElement {
  const row = element('div', 'panel-row');
  control.id = id;
  const caption = element('label');
  caption.htmlFor = id;
  labelFor(control, label, caption);
  const holder = element('div', 'panel-control');
  holder.append(control);
  if (extra !== undefined) holder.append(extra);
  row.append(caption, holder);
  return row;
}

function choice(type: 'radio' | 'checkbox', id: string, label: string, name = ''): { row: HTMLElement; input: HTMLInputElement } {
  const input = element('input');
  input.type = type;
  input.id = id;
  if (name !== '') input.name = name;
  const caption = element('label');
  caption.htmlFor = id;
  labelFor(input, label, caption);
  const row = element('div', 'panel-choice');
  row.append(input, caption);
  return { row, input };
}

function button(label: string, className = ''): HTMLButtonElement {
  const made = element('button', className);
  made.type = 'button';
  labelFor(made, label, made);
  return made;
}

function group(legend: string, ...rows: HTMLElement[]): HTMLFieldSetElement {
  const set = element('fieldset', 'panel-group');
  const title = element('legend');
  title.textContent = legend;
  set.append(title, ...rows);
  return set;
}

export class ConnectionPanel {
  private readonly form: HTMLFormElement;
  private readonly fields: Fields;
  private readonly intro: HTMLParagraphElement;
  private readonly savedProblem: HTMLParagraphElement;
  private readonly preview: HTMLElement;
  private readonly problems: HTMLUListElement;
  private readonly result: HTMLParagraphElement;
  private readonly ok: HTMLButtonElement;
  private readonly apply: HTMLButtonElement;
  private readonly test: HTMLButtonElement;
  private readonly findContainers: HTMLButtonElement;
  private outcome: PanelOutcome = 'unchanged';

  constructor(
    private readonly dialog: HTMLDialogElement,
    private readonly connection: ConnectionBridge,
    private readonly afterSave: AfterSave,
  ) {
    const docker = choice('radio', 'place-docker', 'In a &Docker container on this computer', 'place');
    const local = choice('radio', 'place-local', 'Directly on this co&mputer', 'place');

    const containerNames = element('datalist');
    containerNames.id = 'container-names';
    const container = element('input');
    container.setAttribute('list', containerNames.id);
    this.findContainers = button('&Find Running');
    const containerExtras = element('span', 'panel-inline');
    containerExtras.append(this.findContainers, containerNames);

    const handshakeSeconds = element('input');
    handshakeSeconds.type = 'number';
    handshakeSeconds.min = String(SHORTEST_HANDSHAKE_SECONDS);
    handshakeSeconds.max = String(LONGEST_HANDSHAKE_SECONDS);
    handshakeSeconds.step = '1';
    const seconds = element('span', 'panel-unit');
    seconds.textContent = 'seconds';

    const connectOnStart = choice('checkbox', 'connect-on-start', 'Connect when Insanity_Loom &starts');

    const containerUser = element('input');
    containerUser.placeholder = "(the container's own default user)";
    const hostArguments = element('textarea');
    hostArguments.rows = 3;
    hostArguments.spellcheck = false;

    const dockerProgram = element('input');
    const workingFolder = element('input');
    const hostProgram = element('input');
    for (const input of [dockerProgram, container, containerUser, workingFolder, hostProgram]) input.spellcheck = false;

    const dockerGroup = group(
      'Docker',
      textRow('docker-program', 'Docker &program:', dockerProgram),
      textRow('container', '&Container:', container, containerExtras),
      textRow('container-user', 'Run as &user:', containerUser),
    );

    this.fields = {
      docker: docker.input,
      local: local.input,
      dockerGroup,
      dockerProgram,
      container,
      containerNames,
      containerUser,
      workingFolder,
      hostProgram,
      hostArguments,
      handshakeSeconds,
      connectOnStart: connectOnStart.input,
    };

    const heading = element('h2');
    heading.textContent = 'Connection Settings';
    this.intro = element('p', 'panel-intro');
    this.intro.textContent =
      'Tell Insanity_Loom where the assistant runs and how to start it. Nothing entered here leaves this computer: ' +
      'it is kept in the Data folder beside the program.';
    this.savedProblem = element('p', 'panel-problem');
    this.savedProblem.setAttribute('role', 'alert');

    const previewLabel = element('div', 'panel-preview-label');
    previewLabel.textContent = 'The command that will run:';
    // A plain block, not an <output>: an output element counts as a status message, and the panel's one status
    // message is the result line below, so the two would be mistaken for each other.
    this.preview = element('div', 'panel-preview');
    this.preview.setAttribute('aria-label', 'The command that will run');
    this.problems = element('ul', 'panel-problems');
    this.problems.setAttribute('role', 'alert');
    this.result = element('p', 'panel-result');
    this.result.setAttribute('role', 'status');

    this.test = button('&Test Connection');
    const openLog = button('Open Host Lo&g');
    this.ok = element('button', 'panel-default');
    this.ok.type = 'submit';
    this.ok.textContent = 'OK';
    const cancel = element('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    this.apply = button('Appl&y');
    const leftButtons = element('div', 'panel-buttons-left');
    leftButtons.append(this.test, openLog);
    const rightButtons = element('div', 'panel-buttons-right');
    rightButtons.append(this.ok, cancel, this.apply);
    const buttons = element('div', 'panel-buttons');
    buttons.append(leftButtons, rightButtons);

    this.form = element('form', 'panel');
    this.form.method = 'dialog';
    this.form.append(
      heading,
      this.intro,
      this.savedProblem,
      group('Where the assistant runs', docker.row, local.row),
      dockerGroup,
      group(
        'Assistant host',
        textRow('working-folder', '&Working folder:', workingFolder),
        textRow('host-program', '&Host program:', hostProgram),
        textRow('host-arguments', '&Arguments, one per line:', hostArguments),
      ),
      group('Connecting', textRow('handshake-seconds', 'Handshake time &limit:', handshakeSeconds, seconds), connectOnStart.row),
      previewLabel,
      this.preview,
      this.problems,
      this.result,
      buttons,
    );
    dialog.replaceChildren(this.form);
    dialog.setAttribute('aria-label', 'Connection Settings');

    this.form.addEventListener('input', () => this.refresh());
    this.form.addEventListener('change', () => this.refresh());
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.save(true);
    });
    cancel.addEventListener('click', () => dialog.close());
    this.apply.addEventListener('click', () => void this.save(false));
    this.test.addEventListener('click', () => void this.runTest());
    openLog.addEventListener('click', () => void this.openLog());
    this.findContainers.addEventListener('click', () => void this.listContainers());
    dialog.addEventListener('keydown', (event) => this.onAccessKey(event));
    // Access letters are underlined while Alt is held, as in any desktop dialog.
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Alt') this.form.classList.add('shows-access-keys');
    });
    dialog.addEventListener('keyup', (event) => {
      if (event.key === 'Alt') this.form.classList.remove('shows-access-keys');
    });
  }

  /** Opens the panel with the settings in use, and resolves when it closes. */
  async show(): Promise<PanelOutcome> {
    const state = await this.connection.load();
    this.fill(state.settings);
    this.intro.hidden = state.saved;
    this.savedProblem.textContent = state.problem;
    this.savedProblem.hidden = state.problem === '';
    this.result.textContent = '';
    this.outcome = 'unchanged';
    this.refresh();
    this.dialog.showModal();
    (state.saved ? this.fields.workingFolder : this.fields.container).focus();
    return new Promise((resolve) => this.dialog.addEventListener('close', () => resolve(this.outcome), { once: true }));
  }

  private fill(settings: ConnectionSettings): void {
    const f = this.fields;
    f.docker.checked = settings.place === 'docker';
    f.local.checked = settings.place === 'local';
    f.dockerProgram.value = settings.dockerProgram;
    f.container.value = settings.container;
    f.containerUser.value = settings.containerUser;
    f.workingFolder.value = settings.workingFolder;
    f.hostProgram.value = settings.hostProgram;
    f.hostArguments.value = settings.hostArguments.join('\n');
    f.handshakeSeconds.value = String(settings.handshakeSeconds);
    f.connectOnStart.checked = settings.connectOnStart;
  }

  /** The settings exactly as the panel now shows them. */
  private read(): ConnectionSettings {
    const f = this.fields;
    const place: AssistantPlace = f.local.checked ? 'local' : 'docker';
    const argumentsText = f.hostArguments.value.replace(/\r\n/g, '\n').replace(/\n+$/, '');
    return {
      place,
      dockerProgram: f.dockerProgram.value.trim(),
      container: f.container.value.trim(),
      containerUser: f.containerUser.value.trim(),
      workingFolder: f.workingFolder.value.trim(),
      hostProgram: f.hostProgram.value.trim(),
      hostArguments: argumentsText === '' ? [] : argumentsText.split('\n').map((line) => line.trim()),
      handshakeSeconds: Number(f.handshakeSeconds.value),
      connectOnStart: f.connectOnStart.checked,
    };
  }

  /** Shows the command the options produce, and what is wrong with them, as they change. */
  private refresh(): void {
    const settings = this.read();
    this.fields.dockerGroup.disabled = settings.place !== 'docker';
    this.preview.textContent = describeCommand(hostCommand(settings));
    const problems = connectionProblems(settings);
    this.problems.replaceChildren(
      ...problems.map((problem) => {
        const item = element('li');
        item.textContent = problem;
        return item;
      }),
    );
    const usable = problems.length === 0;
    this.ok.disabled = !usable;
    this.apply.disabled = !usable;
    this.test.disabled = !usable;
  }

  private say(message: string, failed: boolean): void {
    this.result.textContent = message;
    this.result.classList.toggle('is-failure', failed);
  }

  private async save(close: boolean): Promise<void> {
    try {
      await this.connection.save(this.read());
    } catch (problem) {
      this.say(problem instanceof Error ? problem.message : String(problem), true);
      return;
    }
    this.outcome = 'saved';
    this.intro.hidden = true;
    this.savedProblem.hidden = true;
    this.afterSave();
    if (close) this.dialog.close();
    else this.say('Saved. Reconnecting with these settings.', false);
  }

  private async runTest(): Promise<void> {
    this.say('Testing the connection…', false);
    this.test.disabled = true;
    try {
      this.say(await this.connection.test(this.read()), false);
    } catch (problem) {
      this.say(problem instanceof Error ? problem.message : String(problem), true);
    } finally {
      this.refresh();
    }
  }

  private async openLog(): Promise<void> {
    try {
      await this.connection.openLog();
    } catch (problem) {
      this.say(problem instanceof Error ? problem.message : String(problem), true);
    }
  }

  private async listContainers(): Promise<void> {
    this.say('Asking Docker which containers are running…', false);
    try {
      const names = await this.connection.listContainers(this.fields.dockerProgram.value.trim() || 'docker');
      this.fields.containerNames.replaceChildren(
        ...names.map((name) => {
          const option = element('option');
          option.value = name;
          return option;
        }),
      );
      this.say(
        names.length === 0
          ? 'Docker has no containers running.'
          : `Running: ${names.join(', ')}. Choose one in the Container box.`,
        false,
      );
      if (names.length === 1 && this.fields.container.value.trim() === '') {
        this.fields.container.value = names[0] ?? '';
        this.refresh();
      }
    } catch (problem) {
      this.say(problem instanceof Error ? problem.message : String(problem), true);
    }
  }

  /** Alt+letter: the field or button whose label carries that access key, as in any desktop dialog. */
  private onAccessKey(event: KeyboardEvent): void {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.key.length !== 1) return;
    const key = event.key.toLowerCase();
    const target = [...this.form.querySelectorAll<HTMLElement>('[data-access-key]')].find(
      (candidate) => candidate.dataset['accessKey'] === key && !candidate.closest('fieldset:disabled'),
    );
    if (target === undefined) return;
    event.preventDefault();
    if (target instanceof HTMLButtonElement || (target instanceof HTMLInputElement && (target.type === 'radio' || target.type === 'checkbox'))) {
      target.click();
      target.focus();
    } else {
      target.focus();
    }
  }
}
