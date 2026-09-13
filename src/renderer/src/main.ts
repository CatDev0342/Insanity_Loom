// The page. It draws the menu bar and, for now, proves the chain page → bridge → the layer underneath works.

import { MenuBar } from './menu/menubar';
import { MENUS } from './menu/model';

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`The page is missing ${selector} (src/renderer/index.html).`);
  return element;
}

new MenuBar(required<HTMLElement>('#menubar'), MENUS, (command) => window.insanityLoom.runCommand(command));

const { electron, chromium, node } = window.insanityLoom.versions;
required<HTMLParagraphElement>('#engine').textContent = `Electron ${electron} · Chromium ${chromium} · Node.js ${node}`;
