// The editing shortcuts along the top of the window: the Format commands, as buttons.
//
// They name the same commands as the Format menu and are asked the same question about each — whether it can act
// where the caret is, and whether what it does is already so — so the two can never say different things
// (formatting.ts). A button that cannot act is drawn grey; one whose work is already done is drawn pressed.
//
// Square, quiet, and never taking focus: pressing one must leave the author where they were writing, or the command
// would have nothing to act on.

import type { AnyCommandId } from '../commands';
import type { CommandStandingSource } from './menubar';

interface ToolbarButton {
  readonly kind: 'button';
  /** What is drawn on the button: a letter or two, as a word processor draws them. */
  readonly face: string;
  /** What it is called, for the tooltip and for anything reading the page aloud. */
  readonly name: string;
  readonly command: AnyCommandId;
  /** The key that does the same thing, shown in the tooltip. */
  readonly shortcut: string;
  /** How the face is drawn: bold, italic and the rest show themselves. */
  readonly face_style?: 'bold' | 'italic' | 'underline' | 'strike' | 'code';
}

interface ToolbarSeparator {
  readonly kind: 'separator';
}

type ToolbarEntry = ToolbarButton | ToolbarSeparator;

const SEPARATOR: ToolbarSeparator = { kind: 'separator' };

function button(face: string, name: string, command: AnyCommandId, shortcut: string, face_style?: ToolbarButton['face_style']): ToolbarButton {
  return face_style === undefined
    ? { kind: 'button', face, name, command, shortcut }
    : { kind: 'button', face, name, command, shortcut, face_style };
}

export const TOOLBAR: readonly ToolbarEntry[] = [
  button('B', 'Bold', 'format.bold', 'Ctrl+B', 'bold'),
  button('I', 'Italic', 'format.italic', 'Ctrl+I', 'italic'),
  button('U', 'Underline', 'format.underline', 'Ctrl+U', 'underline'),
  button('S', 'Strikethrough', 'format.strikethrough', 'Ctrl+Shift+X', 'strike'),
  button('{ }', 'Inline code', 'format.code', 'Ctrl+E', 'code'),
  SEPARATOR,
  button('¶', 'Normal text', 'format.paragraph', 'Ctrl+Alt+0'),
  button('H1', 'Heading 1', 'format.heading1', 'Ctrl+Alt+1'),
  button('H2', 'Heading 2', 'format.heading2', 'Ctrl+Alt+2'),
  button('H3', 'Heading 3', 'format.heading3', 'Ctrl+Alt+3'),
  SEPARATOR,
  button('•', 'Bulleted list', 'format.bulletList', 'Ctrl+Shift+L'),
  button('1.', 'Numbered list', 'format.orderedList', 'Ctrl+Shift+O'),
  button('❝', 'Quote', 'format.blockquote', 'Ctrl+Shift+Q'),
  button('▤', 'Code block', 'format.codeBlock', 'Ctrl+Alt+C'),
  SEPARATOR,
  button('⇥', 'Increase indent', 'format.indent', 'Tab'),
  button('⇤', 'Decrease indent', 'format.outdent', 'Shift+Tab'),
  SEPARATOR,
  button('🔗', 'Add link', 'format.link', 'Ctrl+K'),
  button('⌫', 'Clear formatting', 'format.clear', 'Ctrl+Space'),
];

export class Toolbar {
  private readonly buttons: { readonly element: HTMLButtonElement; readonly command: AnyCommandId }[] = [];

  constructor(
    container: HTMLElement,
    runCommand: (command: AnyCommandId) => Promise<void>,
    private readonly standingOf: CommandStandingSource,
  ) {
    for (const entry of TOOLBAR) {
      if (entry.kind === 'separator') {
        const line = document.createElement('span');
        line.className = 'toolbar-separator';
        line.setAttribute('role', 'separator');
        container.append(line);
        continue;
      }
      const element = document.createElement('button');
      element.type = 'button';
      element.textContent = entry.face;
      element.title = `${entry.name} (${entry.shortcut})`;
      element.setAttribute('aria-label', entry.name);
      if (entry.face_style !== undefined) element.dataset['face'] = entry.face_style;
      // The press must not take the author out of their writing, or the command would have nothing to act on.
      element.addEventListener('mousedown', (event) => event.preventDefault());
      element.addEventListener('click', () => void runCommand(entry.command));
      container.append(element);
      this.buttons.push({ element, command: entry.command });
    }
  }

  /** Asks how each command stands where the author is working, and draws the buttons so. */
  refresh(): void {
    for (const { element, command } of this.buttons) {
      const standing = this.standingOf(command);
      element.disabled = !standing.enabled;
      element.setAttribute('aria-pressed', standing.checked ? 'true' : 'false');
    }
  }
}
