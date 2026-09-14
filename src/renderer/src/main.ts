// The page: the menu bar, and the loom beneath it.

import { isPageCommand, type AnyCommandId } from './commands';
import { Loom } from './loom/page';
import { ContextMenu } from './menu/context-menu';
import { MenuBar } from './menu/menubar';
import { MENUS } from './menu/model';
import { PreferencesPanel } from './panels/preferences-panel';

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
  },
  bridge.assistant,
  bridge.connection,
  bridge.journal,
);

const preferences = new PreferencesPanel(required<HTMLDialogElement>('#preferences-dialog'), bridge.editing);

async function run(command: AnyCommandId): Promise<void> {
  if (!isPageCommand(command)) return bridge.runCommand(command);
  if (command === 'app.preferences') return preferences.show();
  return loom.run(command);
}

new MenuBar(required<HTMLElement>('#menubar'), MENUS, run);
new ContextMenu(bridge.editing, run);

void loom.start();
