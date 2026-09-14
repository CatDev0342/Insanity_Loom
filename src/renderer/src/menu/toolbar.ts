// The editing shortcuts along the top of the window: the Format commands, as buttons.
//
// They name the same commands as the Format menu and are asked the same question about each — whether it can act
// where the caret is, and whether what it does is already so — so the two can never say different things
// (formatting.ts). A button that cannot act is drawn grey; one whose work is already done is drawn pressed.
//
// Square, quiet, and never taking focus: pressing one must leave the author where they were writing, or the command
// would have nothing to act on.
//
// By the keyboard it is one stop, not twenty: Tab reaches the strip, the arrows move along it, Home and End go to its
// ends. A row of buttons that each demand their own Tab press is a wall between the author and their writing.

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
      element.addEventListener('keydown', (event) => this.onKey(event));
      element.tabIndex = this.buttons.length === 0 ? 0 : -1;
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
    // The strip's one stop must be a button that can be pressed, or the keyboard reaches a dead thing.
    if (this.buttons.some(({ element }) => element.tabIndex === 0 && !element.disabled)) return;
    const usable = this.buttons.find(({ element }) => !element.disabled);
    for (const { element } of this.buttons) element.tabIndex = element === usable?.element ? 0 : -1;
  }

  /** Which button a key asks for, or nothing when the key is not the strip's. */
  private static buttonFor(key: string, at: number, count: number): number | undefined {
    if (key === 'ArrowLeft') return (at - 1 + count) % count;
    if (key === 'ArrowRight') return (at + 1) % count;
    if (key === 'Home') return 0;
    if (key === 'End') return count - 1;
    return undefined;
  }

  /** The arrows move along the strip; Home and End go to its ends. */
  private onKey(event: KeyboardEvent): void {
    const usable = this.buttons.filter(({ element }) => !element.disabled);
    const at = usable.findIndex(({ element }) => element === event.target);
    if (at === -1) return;
    const next = Toolbar.buttonFor(event.key, at, usable.length);
    if (next === undefined) return;
    event.preventDefault();
    for (const { element } of this.buttons) element.tabIndex = -1;
    const moved = usable[next]?.element;
    if (moved === undefined) return;
    moved.tabIndex = 0;
    moved.focus();
  }
}
