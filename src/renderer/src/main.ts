// The page: the menu bar, and the loom beneath it.

import { isPageCommand } from './commands';
import { Loom } from './loom/page';
import { MenuBar } from './menu/menubar';
import { MENUS } from './menu/model';

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

new MenuBar(required<HTMLElement>('#menubar'), MENUS, (command) =>
  isPageCommand(command) ? loom.run(command) : bridge.runCommand(command),
);

void loom.start();
