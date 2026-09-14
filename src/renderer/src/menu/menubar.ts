// Insanity_Loom's menu bar, drawn in the page rather than by the system, so it is square-cornered and identical on
// Windows and Linux. It follows the classic Windows conventions a desktop user's hands already know:
// - Alt pressed and released alone, or F10, moves to the menu bar; Alt+letter opens the menu with that access key;
// - the access letters are underlined only while the keyboard is in use, as in Windows itself;
// - Left and Right move between menus, Up and Down within one, Home and End to its ends; Enter or Space chooses;
//   a letter chooses the entry with that access key; Esc steps back one level; Tab or a click elsewhere leaves;
// - with a menu open, pointing at another menu's name opens that one instead.
// Leaving the menu bar returns focus to exactly where the author was, so Edit ▸ Copy copies what they had selected.

import type { AnyCommandId } from '../commands';
import { parseLabel } from './labels';
import type { MenuCommand, TopMenu } from './model';
import { matchesShortcut, parseShortcut, type Shortcut } from './shortcuts';

const NOTHING = -1;

// Keys whose meaning inside the menu bar is its own; everything else passes through untouched.
const STEP_BACK = 'Escape';
const PREVIOUS_MENU = 'ArrowLeft';
const NEXT_MENU = 'ArrowRight';
const PREVIOUS_ENTRY = 'ArrowUp';
const NEXT_ENTRY = 'ArrowDown';
const FIRST_ENTRY = 'Home';
const LAST_ENTRY = 'End';
const CHOOSE_KEYS = new Set(['Enter', ' ']);
const LEAVE = 'Tab';
const MENU_BAR_KEY = 'F10';
const ALT = 'Alt';

// CSS classes the stylesheet draws from (src/renderer/src/style.css).
const CLASS_IN_USE = 'is-in-use';
const CLASS_SHOW_ACCESS_KEYS = 'shows-access-keys';
const CLASS_CURRENT = 'is-current';

type RunCommand = (command: AnyCommandId) => Promise<void>;

interface DrawnMenu {
  readonly button: HTMLButtonElement;
  readonly popup: HTMLElement;
  readonly accessKey: string;
  /** The menu's choosable entries, in order (separators left out). */
  readonly entries: readonly { readonly element: HTMLElement; readonly command: MenuCommand; readonly accessKey: string }[];
}

function drawLabel(into: HTMLElement, label: string): string {
  const parsed = parseLabel(label);
  if (parsed.accessKeyIndex === NOTHING) {
    into.textContent = parsed.text;
    return '';
  }
  const accessLetter = document.createElement('span');
  accessLetter.className = 'access-key';
  accessLetter.textContent = parsed.text.charAt(parsed.accessKeyIndex);
  into.append(parsed.text.slice(0, parsed.accessKeyIndex), accessLetter, parsed.text.slice(parsed.accessKeyIndex + 1));
  return parsed.accessKey;
}

export class MenuBar {
  private readonly bar: HTMLElement;
  private readonly menus: DrawnMenu[] = [];
  private readonly shortcuts: { readonly shortcut: Shortcut; readonly command: AnyCommandId }[] = [];

  /** The menu whose name has focus, while the menu bar is in use. */
  private currentMenu = NOTHING;
  /** The menu that is open, if any. */
  private openMenu = NOTHING;
  /** The highlighted entry in the open menu, if any. */
  private currentEntry = NOTHING;
  /** Where the author was before the menu bar took focus. */
  private returnFocusTo: Element | null = null;
  /** True between Alt going down and coming up with no other key pressed in between. */
  private altAlone = false;

  constructor(
    container: HTMLElement,
    menus: readonly TopMenu[],
    private readonly runCommand: RunCommand,
  ) {
    this.bar = container;
    this.bar.setAttribute('role', 'menubar');
    this.bar.setAttribute('aria-label', 'Menu');
    menus.forEach((menu, index) => this.menus.push(this.drawMenu(menu, index)));

    // The capture phase: the menu bar sees keys before anything in the page can act on them.
    window.addEventListener('keydown', (event) => this.onKeyDown(event), true);
    window.addEventListener('keyup', (event) => this.onKeyUp(event), true);
    window.addEventListener('mousedown', (event) => this.onMouseDownAnywhere(event), true);
    window.addEventListener('blur', () => this.leave());
  }

  private drawMenu(menu: TopMenu, menuIndex: number): DrawnMenu {
    const holder = document.createElement('div');
    holder.className = 'menubar-menu';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menubar-name';
    button.id = `menu-${menuIndex}`;
    button.tabIndex = -1;
    button.setAttribute('role', 'menuitem');
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    const accessKey = drawLabel(button, menu.label);

    const popup = document.createElement('div');
    popup.className = 'menu-popup';
    popup.setAttribute('role', 'menu');
    popup.setAttribute('aria-labelledby', button.id);
    popup.hidden = true;

    const entries: DrawnMenu['entries'][number][] = [];
    for (const entry of menu.entries) {
      if (entry.kind === 'separator') {
        const line = document.createElement('div');
        line.className = 'menu-separator';
        line.setAttribute('role', 'separator');
        popup.append(line);
        continue;
      }
      const entryIndex = entries.length;
      const element = document.createElement('div');
      element.className = 'menu-entry';
      element.tabIndex = -1;
      element.setAttribute('role', 'menuitem');
      const label = document.createElement('span');
      label.className = 'menu-entry-label';
      const entryAccessKey = drawLabel(label, entry.label);
      const shortcut = document.createElement('span');
      shortcut.className = 'menu-entry-shortcut';
      shortcut.textContent = entry.shortcuts[0] ?? '';
      element.append(label, shortcut);
      popup.append(element);

      element.addEventListener('mousedown', (event) => event.preventDefault());
      element.addEventListener('mouseenter', () => this.highlightEntry(entryIndex, false));
      element.addEventListener('click', () => this.choose(menuIndex, entryIndex));
      entries.push({ element, command: entry, accessKey: entryAccessKey });

      if (!entry.handledBySystem) {
        for (const written of entry.shortcuts) this.shortcuts.push({ shortcut: parseShortcut(written), command: entry.command });
      }
    }

    // Pressing a menu's name opens it, or closes it if it is already open. The press must not move focus away from
    // where the author was, or Edit ▸ Copy would copy from the menu instead of their selection.
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      if (this.openMenu === menuIndex) this.leave();
      else this.open(menuIndex, NOTHING);
    });
    button.addEventListener('mouseenter', () => {
      if (this.openMenu !== NOTHING && this.openMenu !== menuIndex) this.open(menuIndex, NOTHING);
    });

    holder.append(button, popup);
    this.bar.append(holder);
    return { button, popup, accessKey, entries };
  }

  private get isInUse(): boolean {
    return this.currentMenu !== NOTHING;
  }

  /** Takes focus to the menu bar, remembering where the author was. */
  private enter(menuIndex: number, showAccessKeys: boolean): void {
    if (!this.isInUse) this.returnFocusTo = document.activeElement;
    this.bar.classList.add(CLASS_IN_USE);
    this.bar.classList.toggle(CLASS_SHOW_ACCESS_KEYS, showAccessKeys);
    this.focusMenuName(menuIndex);
  }

  private focusMenuName(menuIndex: number): void {
    this.currentMenu = menuIndex;
    this.menus[menuIndex]?.button.focus();
  }

  private open(menuIndex: number, entryIndex: number, showAccessKeys = false): void {
    if (!this.isInUse) this.enter(menuIndex, showAccessKeys);
    this.closeOpenMenu();
    const menu = this.menus[menuIndex];
    if (menu === undefined) return;
    this.openMenu = menuIndex;
    menu.popup.hidden = false;
    menu.button.setAttribute('aria-expanded', 'true');
    menu.button.classList.add(CLASS_CURRENT);
    this.focusMenuName(menuIndex);
    if (entryIndex !== NOTHING) this.highlightEntry(entryIndex, true);
  }

  private closeOpenMenu(): void {
    const menu = this.menus[this.openMenu];
    if (menu !== undefined) {
      menu.popup.hidden = true;
      menu.button.setAttribute('aria-expanded', 'false');
      menu.button.classList.remove(CLASS_CURRENT);
      for (const entry of menu.entries) entry.element.classList.remove(CLASS_CURRENT);
    }
    this.openMenu = NOTHING;
    this.currentEntry = NOTHING;
  }

  private highlightEntry(entryIndex: number, moveFocus: boolean): void {
    const menu = this.menus[this.openMenu];
    if (menu === undefined) return;
    menu.entries.forEach((entry, index) => entry.element.classList.toggle(CLASS_CURRENT, index === entryIndex));
    this.currentEntry = entryIndex;
    if (moveFocus) menu.entries[entryIndex]?.element.focus();
  }

  /** Leaves the menu bar entirely and puts focus back where the author was. */
  private leave(): void {
    if (!this.isInUse && this.openMenu === NOTHING) {
      this.bar.classList.remove(CLASS_SHOW_ACCESS_KEYS);
      return;
    }
    this.closeOpenMenu();
    this.currentMenu = NOTHING;
    this.bar.classList.remove(CLASS_IN_USE, CLASS_SHOW_ACCESS_KEYS);
    const back = this.returnFocusTo;
    this.returnFocusTo = null;
    if (back instanceof HTMLElement && back.isConnected) back.focus();
    else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  private choose(menuIndex: number, entryIndex: number): void {
    const entry = this.menus[menuIndex]?.entries[entryIndex];
    if (entry === undefined) return;
    // Focus goes back first, so the command acts on what the author was working on.
    this.leave();
    void this.runCommand(entry.command.command);
  }

  /** True while a dialog is open: the menus stand aside for it, as they do under any modal dialog. */
  private get dialogIsOpen(): boolean {
    return document.querySelector('dialog[open]') !== null;
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.dialogIsOpen) return;
    if (event.key === ALT) {
      if (!event.repeat) this.altAlone = true;
      this.bar.classList.add(CLASS_SHOW_ACCESS_KEYS);
      return;
    }
    this.altAlone = false;

    if (this.isInUse) {
      if (this.onKeyInMenuBar(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    const plain = !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
    if (event.key === MENU_BAR_KEY && plain) {
      event.preventDefault();
      this.enter(0, true);
      return;
    }

    if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.length === 1) {
      const menuIndex = this.menus.findIndex((menu) => menu.accessKey === event.key.toLowerCase());
      if (menuIndex !== NOTHING) {
        event.preventDefault();
        this.open(menuIndex, 0, true);
        return;
      }
    }

    const match = this.shortcuts.find(({ shortcut }) => matchesShortcut(shortcut, event));
    if (match !== undefined) {
      event.preventDefault();
      void this.runCommand(match.command);
    }
  }

  private onKeyUp(event: KeyboardEvent): void {
    if (event.key !== ALT || this.dialogIsOpen) return;
    if (!this.isInUse) this.bar.classList.remove(CLASS_SHOW_ACCESS_KEYS);
    if (!this.altAlone) return;
    this.altAlone = false;
    // Windows' own habit: Alt tapped alone moves to the menu bar, and tapped again leaves it. The key-up must not
    // reach Chromium, which would otherwise treat it as a menu activation of its own.
    event.preventDefault();
    if (this.isInUse) this.leave();
    else this.enter(0, true);
  }

  /** Handles a key while the menu bar is in use. Returns true when the key was the menu bar's to handle. */
  private onKeyInMenuBar(event: KeyboardEvent): boolean {
    const count = this.menus.length;
    const menu = this.menus[this.openMenu];
    const isOpen = menu !== undefined;
    this.bar.classList.add(CLASS_SHOW_ACCESS_KEYS);

    switch (event.key) {
      case STEP_BACK:
        if (isOpen) {
          this.closeOpenMenu();
          this.focusMenuName(this.currentMenu);
        } else {
          this.leave();
        }
        return true;
      case PREVIOUS_MENU:
      case NEXT_MENU: {
        const step = event.key === NEXT_MENU ? 1 : -1;
        const next = (this.currentMenu + step + count) % count;
        if (isOpen) this.open(next, 0);
        else this.focusMenuName(next);
        return true;
      }
      case NEXT_ENTRY:
      case PREVIOUS_ENTRY: {
        const step = event.key === NEXT_ENTRY ? 1 : -1;
        if (!isOpen) {
          const opened = this.menus[this.currentMenu];
          this.open(this.currentMenu, step === 1 ? 0 : (opened?.entries.length ?? 0) - 1);
          return true;
        }
        const total = menu.entries.length;
        const from = this.currentEntry === NOTHING ? (step === 1 ? -1 : 0) : this.currentEntry;
        this.highlightEntry((from + step + total) % total, true);
        return true;
      }
      case FIRST_ENTRY:
      case LAST_ENTRY:
        if (!isOpen) return true;
        this.highlightEntry(event.key === FIRST_ENTRY ? 0 : menu.entries.length - 1, true);
        return true;
      case LEAVE:
        this.leave();
        return true;
    }

    if (CHOOSE_KEYS.has(event.key)) {
      if (isOpen && this.currentEntry !== NOTHING) this.choose(this.openMenu, this.currentEntry);
      else this.open(this.currentMenu, 0);
      return true;
    }

    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      const letter = event.key.toLowerCase();
      if (isOpen) {
        const entryIndex = menu.entries.findIndex((entry) => entry.accessKey === letter);
        if (entryIndex !== NOTHING) this.choose(this.openMenu, entryIndex);
      } else {
        const menuIndex = this.menus.findIndex((candidate) => candidate.accessKey === letter);
        if (menuIndex !== NOTHING) this.open(menuIndex, 0);
      }
      // Letters are the menu bar's while it is in use, found or not: none may type into the document behind it.
      return true;
    }

    return false;
  }

  private onMouseDownAnywhere(event: MouseEvent): void {
    if (!this.isInUse) return;
    if (event.target instanceof Node && this.bar.contains(event.target)) return;
    this.leave();
  }
}
