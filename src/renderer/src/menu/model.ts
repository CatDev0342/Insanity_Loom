// What Insanity_Loom's menus hold. One list, in order; the menu bar is drawn from it.

import type { CommandId } from '../../../shared/commands';

export interface MenuCommand {
  readonly kind: 'command';
  /** The label, with its access key marked by '&' ("&Copy"). */
  readonly label: string;
  readonly command: CommandId;
  /** The shortcuts shown beside the label; the first is the one displayed. */
  readonly shortcuts: readonly string[];
  /**
   * True when the shortcut is the system's own and already works wherever the author types — Ctrl+C in a text box,
   * say. The menu shows it but leaves the key itself to the system, so it is never carried out twice.
   */
  readonly handledBySystem: boolean;
}

export interface MenuSeparator {
  readonly kind: 'separator';
}

export type MenuEntry = MenuCommand | MenuSeparator;

export interface TopMenu {
  readonly label: string;
  readonly entries: readonly MenuEntry[];
}

const SEPARATOR: MenuSeparator = { kind: 'separator' };

function command(
  label: string,
  commandId: CommandId,
  shortcuts: readonly string[] = [],
  handledBySystem = false,
): MenuCommand {
  return { kind: 'command', label, command: commandId, shortcuts, handledBySystem };
}

export const MENUS: readonly TopMenu[] = [
  {
    label: '&File',
    // Alt+F4 closes the window on every Windows program; the system handles it, and the menu shows it.
    entries: [command('E&xit', 'app.quit', ['Alt+F4'], true)],
  },
  {
    label: '&Edit',
    entries: [
      command('&Undo', 'edit.undo', ['Ctrl+Z'], true),
      command('&Redo', 'edit.redo', ['Ctrl+Y'], true),
      SEPARATOR,
      command('Cu&t', 'edit.cut', ['Ctrl+X'], true),
      command('&Copy', 'edit.copy', ['Ctrl+C'], true),
      command('&Paste', 'edit.paste', ['Ctrl+V'], true),
      SEPARATOR,
      command('Select &All', 'edit.selectAll', ['Ctrl+A'], true),
    ],
  },
  {
    label: '&View',
    entries: [
      command('Zoom &In', 'view.zoomIn', ['Ctrl+Plus', 'Ctrl+=']),
      command('Zoom &Out', 'view.zoomOut', ['Ctrl+Minus']),
      command('&Actual Size', 'view.zoomReset', ['Ctrl+0']),
      SEPARATOR,
      command('&Full Screen', 'view.toggleFullScreen', ['F11']),
    ],
  },
  {
    label: '&Help',
    entries: [command('&About Insanity_Loom', 'help.about')],
  },
];
