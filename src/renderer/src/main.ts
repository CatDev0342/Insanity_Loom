// The page: the menu bar, and the loom beneath it.

import { isFormatCommand, isPageCommand, type AnyCommandId, type FormatCommandId } from './commands';
import { Loom } from './loom/page';
import { ContextMenu } from './menu/context-menu';
import { MenuBar } from './menu/menubar';
import { MENUS } from './menu/model';
import { LinkPanel, type WhisperHeading } from './panels/link-panel';
import { PreferencesPanel } from './panels/preferences-panel';
import { SignInPanel } from './panels/sign-in-panel';

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`The page is missing ${selector} (src/renderer/index.html).`);
  return element;
}

const bridge = window.insanityLoom;

const loom = new Loom(
  {
    whisper: required<HTMLElement>('#whisper'),
    asks: required<HTMLElement>('#asks'),
    statusText: required<HTMLElement>('#status-text'),
    activity: required<HTMLElement>('#activity'),
    account: required<HTMLElement>('#account'),
    reconnect: required<HTMLButtonElement>('#reconnect'),
    signIn: required<HTMLButtonElement>('#sign-in'),
    connectionSettings: required<HTMLButtonElement>('#connection-settings'),
    whisperName: required<HTMLElement>('#whisper-name'),
    modeLabel: required<HTMLElement>('#mode-label'),
    mode: required<HTMLSelectElement>('#mode'),
    resumeDialog: required<HTMLDialogElement>('#resume-dialog'),
    connectionDialog: required<HTMLDialogElement>('#connection-dialog'),
  },
  bridge.assistant,
  bridge.connection,
  bridge.whispers,
  bridge.links,
  bridge.journal,
);

const preferences = new PreferencesPanel(required<HTMLDialogElement>('#preferences-dialog'), bridge.editing, bridge.whispers);
const signIn = new SignInPanel(required<HTMLDialogElement>('#sign-in-dialog'), bridge.assistant);
const link = new LinkPanel(required<HTMLDialogElement>('#link-dialog'));
required<HTMLButtonElement>('#sign-in').addEventListener('click', () => void signIn.show());

/**
 * The headings of a whisper in the alcove, read from its file: what a link may point at inside it. The file is XHTML,
 * so the page reads it with the browser's own parser (src/renderer/src/document/xhtml.ts writes it).
 */
async function headingsOf(name: string): Promise<readonly WhisperHeading[]> {
  const parsed = new DOMParser().parseFromString(await bridge.whispers.contents(name), 'application/xhtml+xml');
  if (parsed.getElementsByTagName('parsererror').length > 0) return [];
  return [...parsed.querySelectorAll('h1[id], h2[id], h3[id]')].map((heading) => ({
    identity: heading.getAttribute('id') ?? '',
    text: heading.textContent ?? '',
  }));
}

/** Format ▸ …: the whisper's own. Only the link asks for anything; the rest act where the caret is. */
async function runFormat(command: FormatCommandId): Promise<void> {
  if (command !== 'format.link') {
    loom.runFormatCommand(command);
    return;
  }
  const chosen = await link.show(loom.linkAddress, await bridge.whispers.list(), headingsOf);
  if (chosen.kind === 'set') loom.setLink(chosen.address);
  else if (chosen.kind === 'remove') loom.runFormatCommand('format.removeLink');
  loom.focusWhisper();
}

async function run(command: AnyCommandId): Promise<void> {
  // Undo and Redo in the whisper are the whisper's own: its history holds only the author's changes.
  if ((command === 'edit.undo' || command === 'edit.redo') && loom.runEditCommand(command)) return;
  if (isFormatCommand(command)) return runFormat(command);
  if (!isPageCommand(command)) return bridge.runCommand(command);
  if (command === 'app.preferences') return preferences.show();
  if (command === 'assistant.signIn') return signIn.show();
  return loom.run(command);
}

// The menus and their keys ask the whisper how each Format command stands, every time they are used; everything else
// is always ready.
new MenuBar(required<HTMLElement>('#menubar'), MENUS, run, (command) =>
  isFormatCommand(command) ? loom.formatStanding(command) : { enabled: true, checked: false },
);
new ContextMenu(bridge.editing, run);

void loom.start();
