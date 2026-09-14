// The right-click menu, drawn in the page — square, like the menu bar, and the same on Windows and Linux. It opens
// where the author right-clicked (or, from the keyboard's Menu key or Shift+F10, where Chromium places it), and works
// by keyboard as any desktop context menu does: Up and Down, Home and End, Enter or Space, the underlined letters,
// Esc to close. Choosing puts focus back where the author was first, so Cut, Copy and Paste act there.
//
// It lives in the browser's top layer (a popover), inside any dialog that is open, so it appears over dialogs too.

import type { EditingBridge } from '../../../shared/editing';
import type { AnyCommandId } from '../commands';
import { contextEntries, type ContextAction, type ContextEntry } from './context-entries';
import { parseLabel } from './labels';

const NOTHING = -1;

// How far, in pixels, the menu keeps from the window's edges when it would otherwise run off them.
const EDGE_MARGIN_PX = 4;

// A right-click arrives as a right mouse button press, then the context menu event; one with no such press within this
// many milliseconds before it came from the keyboard (the Menu key, or Shift+F10).
const POINTER_TO_MENU_MS = 1000;
const RIGHT_BUTTON = 2;

const CLASS_CURRENT = 'is-current';
const CLASS_SHOW_ACCESS_KEYS = 'shows-access-keys';

type RunCommand = (command: AnyCommandId) => Promise<void>;

interface DrawnEntry {
  readonly element: HTMLElement;
  readonly entry: Extract<ContextEntry, { kind: 'entry' }>;
  readonly accessKey: string;
}

export class ContextMenu {
  private readonly menu: HTMLElement;
  private entries: DrawnEntry[] = [];
  private current = NOTHING;
  private returnFocusTo: Element | null = null;
  private pointX = 0;
  private pointY = 0;
  private openedByKeyboard = false;
  private lastRightPress = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly editing: EditingBridge,
    private readonly runCommand: RunCommand,
    /** Quotes what the author right-clicked at the end of the whisper; where they clicked is remembered here. */
    private readonly quote: (where: { readonly x: number; readonly y: number }) => void = () => undefined,
  ) {
    this.menu = document.createElement('div');
    this.menu.className = 'context-menu';
    this.menu.setAttribute('role', 'menu');
    this.menu.setAttribute('aria-label', 'Context menu');
    this.menu.tabIndex = -1;
    this.menu.popover = 'manual';
    document.body.append(this.menu);

    // The page's own right-click event says where the pointer was, in the page's own coordinates; the details of what
    // can be done there follow from the layer underneath. The event is not cancelled: cancelling it would stop
    // Chromium from reporting the details at all.
    window.addEventListener(
      'mousedown',
      (event) => {
        if (event.button === RIGHT_BUTTON) this.lastRightPress = performance.now();
      },
      true,
    );
    window.addEventListener(
      'contextmenu',
      (event) => {
        this.pointX = event.clientX;
        this.pointY = event.clientY;
        this.openedByKeyboard = performance.now() - this.lastRightPress > POINTER_TO_MENU_MS;
        this.returnFocusTo = document.activeElement;
      },
      true,
    );
    // Whether the author clicked in their own writing decides what a right-click may offer there.
    editing.onContextMenu((details) => this.open(contextEntries(details, this.clickedInTheWhisper())));

    this.menu.addEventListener('keydown', (event) => this.onKeyDown(event));
    window.addEventListener('mousedown', (event) => {
      if (this.isOpen && !(event.target instanceof Node && this.menu.contains(event.target))) this.close(true);
    }, true);
    window.addEventListener('blur', () => this.close(false));
    window.addEventListener('resize', () => this.close(false));
  }

  /** Whether the last right-click landed in the whisper itself, rather than in one of the program's own fields. */
  private clickedInTheWhisper(): boolean {
    const under = document.elementFromPoint(this.pointX, this.pointY);
    return under instanceof Element && under.closest('.whisper-editor') !== null;
  }

  get isOpen(): boolean {
    return this.menu.matches(':popover-open');
  }

  private open(entries: readonly ContextEntry[]): void {
    this.close(false);
    if (entries.length === 0) return;
    this.draw(entries);

    // Inside an open dialog, or the menu would be inert beneath it.
    const host = document.querySelector('dialog[open]') ?? document.body;
    if (this.menu.parentElement !== host) host.append(this.menu);
    this.menu.classList.toggle(CLASS_SHOW_ACCESS_KEYS, this.openedByKeyboard);
    this.menu.showPopover();

    // Placed at the point, kept inside the window.
    const width = this.menu.offsetWidth;
    const height = this.menu.offsetHeight;
    const left = Math.max(EDGE_MARGIN_PX, Math.min(this.pointX, window.innerWidth - width - EDGE_MARGIN_PX));
    const top = Math.max(EDGE_MARGIN_PX, Math.min(this.pointY, window.innerHeight - height - EDGE_MARGIN_PX));
    this.menu.style.left = `${left}px`;
    this.menu.style.top = `${top}px`;

    this.menu.focus();
    if (this.openedByKeyboard) this.highlight(this.nextEnabled(NOTHING, 1));
  }

  private draw(entries: readonly ContextEntry[]): void {
    this.menu.replaceChildren();
    this.entries = [];
    this.current = NOTHING;
    for (const entry of entries) {
      if (entry.kind === 'separator') {
        const line = document.createElement('div');
        line.className = 'menu-separator';
        line.setAttribute('role', 'separator');
        this.menu.append(line);
        continue;
      }
      const index = this.entries.length;
      const element = document.createElement('div');
      element.className = `menu-entry${entry.emphasized ? ' is-emphasized' : ''}`;
      element.setAttribute('role', 'menuitem');
      element.setAttribute('aria-disabled', String(!entry.enabled));
      const label = document.createElement('span');
      label.className = 'menu-entry-label';
      const parsed = parseLabel(entry.label);
      if (parsed.accessKeyIndex === NOTHING) {
        label.textContent = parsed.text;
      } else {
        const key = document.createElement('span');
        key.className = 'access-key';
        key.textContent = parsed.text.charAt(parsed.accessKeyIndex);
        label.append(parsed.text.slice(0, parsed.accessKeyIndex), key, parsed.text.slice(parsed.accessKeyIndex + 1));
      }
      const shortcut = document.createElement('span');
      shortcut.className = 'menu-entry-shortcut';
      shortcut.textContent = entry.shortcut;
      element.append(label, shortcut);
      element.addEventListener('mousedown', (event) => event.preventDefault());
      element.addEventListener('mouseenter', () => this.highlight(entry.enabled ? index : NOTHING));
      element.addEventListener('click', () => this.choose(index));
      this.menu.append(element);
      this.entries.push({ element, entry, accessKey: parsed.accessKey });
    }
  }

  private highlight(index: number): void {
    this.entries.forEach((drawn, i) => drawn.element.classList.toggle(CLASS_CURRENT, i === index));
    this.current = index;
  }

  /** The next enabled entry from `from`, stepping by `step` and wrapping; NOTHING when none is enabled. */
  private nextEnabled(from: number, step: number): number {
    const count = this.entries.length;
    for (let tried = 1; tried <= count; tried++) {
      const index = (((from + step * tried) % count) + count) % count;
      if (this.entries[index]?.entry.enabled === true) return index;
    }
    return NOTHING;
  }

  private onKeyDown(event: KeyboardEvent): void {
    event.stopPropagation();
    this.menu.classList.add(CLASS_SHOW_ACCESS_KEYS);
    switch (event.key) {
      case 'Escape':
      case 'Tab':
        event.preventDefault();
        this.close(true);
        return;
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        this.highlight(this.nextEnabled(this.current === NOTHING && event.key === 'ArrowUp' ? 0 : this.current, event.key === 'ArrowDown' ? 1 : -1));
        return;
      case 'Home':
        event.preventDefault();
        this.highlight(this.nextEnabled(NOTHING, 1));
        return;
      case 'End':
        event.preventDefault();
        this.highlight(this.nextEnabled(0, -1));
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (this.current !== NOTHING) this.choose(this.current);
        return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const letter = event.key.toLowerCase();
      const index = this.entries.findIndex((drawn) => drawn.accessKey === letter && drawn.entry.enabled);
      if (index !== NOTHING) this.choose(index);
    }
  }

  private choose(index: number): void {
    const drawn = this.entries[index];
    if (drawn === undefined || !drawn.entry.enabled) return;
    this.close(true);
    void this.act(drawn.entry.action);
  }

  private async act(action: ContextAction): Promise<void> {
    switch (action.kind) {
      case 'command':
        await this.runCommand(action.command);
        return;
      case 'replace':
        await this.editing.replaceMisspelling(action.suggestion);
        return;
      case 'addToDictionary':
        await this.editing.addToDictionary(action.word);
        return;
      case 'quote':
        this.quote({ x: this.pointX, y: this.pointY });
        return;
    }
  }

  /** Closes the menu; with `returnFocus`, puts focus back where the author was, so the chosen action acts there. */
  private close(returnFocus: boolean): void {
    if (!this.isOpen) return;
    this.menu.hidePopover();
    const back = this.returnFocusTo;
    if (returnFocus && back instanceof HTMLElement && back.isConnected) back.focus();
  }
}
