// What Insanity_Loom's menus hold. One list, in order; the menu bar is drawn from it.

import type { AnyCommandId } from '../commands';

export interface MenuCommand {
  readonly kind: 'command';
  /** The label, with its access key marked by '&' ("&Copy"). */
  readonly label: string;
  readonly command: AnyCommandId;
  /** The shortcuts shown beside the label; the first is the one displayed. */
  readonly shortcuts: readonly string[];
  /**
   * True when the key is already handled where the author is working — by the system (Ctrl+C in a text box) or by the
   * whisper itself (Tab, which indents a list item). The menu shows the key but does not bind it, so what it does is
   * never carried out twice.
   */
  readonly boundElsewhere: boolean;
  /** True for an entry that is either on or off where the caret is: the menu draws a tick beside it when it is on. */
  readonly checkable: boolean;
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
  commandId: AnyCommandId,
  shortcuts: readonly string[] = [],
  boundElsewhere = false,
): MenuCommand {
  return { kind: 'command', label, command: commandId, shortcuts, boundElsewhere, checkable: false };
}

/** A Format entry that shows whether it is already on where the caret is. */
function toggle(label: string, commandId: AnyCommandId, shortcuts: readonly string[] = []): MenuCommand {
  return { kind: 'command', label, command: commandId, shortcuts, boundElsewhere: false, checkable: true };
}

export const MENUS: readonly TopMenu[] = [
  {
    label: '&File',
    // Alt+F4 closes the window on every Windows program; the system handles it, and the menu shows it.
    entries: [
      command('&New Whisper', 'whisper.new', ['Ctrl+N']),
      command('&Open Whisper…', 'whisper.open', ['Ctrl+O']),
      SEPARATOR,
      command('What Points &Here…', 'whisper.pointsHere', ['Ctrl+Shift+H']),
      SEPARATOR,
      command('&Show Alcove Folder', 'whisper.showAlcove'),
      SEPARATOR,
      command('E&xit', 'app.quit', ['Alt+F4'], true),
    ],
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
      command('Paste as Te&xt', 'edit.pasteAsText', ['Ctrl+Shift+V']),
      SEPARATOR,
      command('Select &All', 'edit.selectAll', ['Ctrl+A'], true),
      SEPARATOR,
      command('Pr&eferences…', 'app.preferences'),
    ],
  },
  {
    // The whisper's own shaping of the writing. The ticks follow the caret: what is on where the author is standing.
    label: 'F&ormat',
    entries: [
      toggle('&Bold', 'format.bold', ['Ctrl+B']),
      toggle('&Italic', 'format.italic', ['Ctrl+I']),
      toggle('&Underline', 'format.underline', ['Ctrl+U']),
      toggle('Stri&kethrough', 'format.strikethrough', ['Ctrl+Shift+X']),
      toggle('Inline C&ode', 'format.code', ['Ctrl+E']),
      SEPARATOR,
      toggle('&Normal Text', 'format.paragraph', ['Ctrl+Alt+0']),
      toggle('Heading &1', 'format.heading1', ['Ctrl+Alt+1']),
      toggle('Heading &2', 'format.heading2', ['Ctrl+Alt+2']),
      toggle('Heading &3', 'format.heading3', ['Ctrl+Alt+3']),
      SEPARATOR,
      toggle('Bulleted &List', 'format.bulletList', ['Ctrl+Shift+L']),
      toggle('Nu&mbered List', 'format.orderedList', ['Ctrl+Shift+O']),
      toggle('&Quote', 'format.blockquote', ['Ctrl+Shift+Q']),
      toggle('&Code Block', 'format.codeBlock', ['Ctrl+Alt+C']),
      SEPARATOR,
      // Tab and Shift+Tab are the whisper's own keys, and only inside a list; the menu says so without binding them.
      command('Increase Inden&t', 'format.indent', ['Tab'], true),
      command('&Decrease Indent', 'format.outdent', ['Shift+Tab'], true),
      SEPARATOR,
      command('&Add Link…', 'format.link', ['Ctrl+K']),
      command('&Remove Link', 'format.removeLink'),
      SEPARATOR,
      command('Cl&ear Formatting', 'format.clear', ['Ctrl+Space']),
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
    label: '&Assistant',
    entries: [
      command('&New Conversation', 'assistant.newConversation'),
      command('Resume &Conversation…', 'assistant.resumeConversation'),
      SEPARATOR,
      // Esc is handled by the page itself, so that it can still close a dialog when one is open (src/renderer/src/loom/page.ts).
      command('&Stop Reply', 'assistant.stop', ['Esc'], true),
      SEPARATOR,
      command('&Reconnect', 'assistant.reconnect'),
      command('S&ign In…', 'assistant.signIn'),
      command('Sign O&ut', 'assistant.signOut'),
      SEPARATOR,
      command('C&onnection Settings…', 'assistant.connectionSettings'),
    ],
  },
  {
    label: '&Help',
    entries: [command('&About Insanity_Loom', 'help.about')],
  },
];
