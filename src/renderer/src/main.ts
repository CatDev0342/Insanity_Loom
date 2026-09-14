// The page: the menu bar, and the loom beneath it.

import { isPageCommand, type AnyCommandId } from './commands';
import { Loom } from './loom/page';
import { ContextMenu } from './menu/context-menu';
import { MenuBar } from './menu/menubar';
import { MENUS } from './menu/model';
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
    conversation: required<HTMLElement>('#conversation'),
    compose: required<HTMLTextAreaElement>('#compose'),
    statusText: required<HTMLElement>('#status-text'),
    reconnect: required<HTMLButtonElement>('#reconnect'),
    resumeDialog: required<HTMLDialogElement>('#resume-dialog'),
    connectionDialog: required<HTMLDialogElement>('#connection-dialog'),
    connectionSettings: required<HTMLButtonElement>('#connection-settings'),
    account: required<HTMLElement>('#account'),
    signIn: required<HTMLButtonElement>('#sign-in'),
  },
  bridge.assistant,
  bridge.connection,
  bridge.journal,
);

const preferences = new PreferencesPanel(required<HTMLDialogElement>('#preferences-dialog'), bridge.editing);
const signIn = new SignInPanel(required<HTMLDialogElement>('#sign-in-dialog'), bridge.assistant);
required<HTMLButtonElement>('#sign-in').addEventListener('click', () => void signIn.show());

async function run(command: AnyCommandId): Promise<void> {
  if (!isPageCommand(command)) return bridge.runCommand(command);
  if (command === 'app.preferences') return preferences.show();
  if (command === 'assistant.signIn') return signIn.show();
  return loom.run(command);
}

new MenuBar(required<HTMLElement>('#menubar'), MENUS, run);
new ContextMenu(bridge.editing, run);

void loom.start();
