// Keyboard shortcuts written as the author sees them ("Ctrl+Shift+Z", "F11"), and matched against key presses.

export interface Shortcut {
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  /** The key, as the browser names it (KeyboardEvent.key), lower-cased for letters. */
  readonly key: string;
}

/** The subset of a key press a shortcut is matched against. */
export interface KeyPress {
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly key: string;
}

// Key names written in shortcuts that differ from the browser's own names for them.
const KEY_NAMES: Readonly<Record<string, string>> = {
  plus: '+',
  minus: '-',
  space: ' ',
  esc: 'Escape',
};

const SEPARATOR = '+';

/** Reads a shortcut as written. Throws on anything malformed, so a mistyped menu fails at once rather than silently. */
export function parseShortcut(written: string): Shortcut {
  // "Ctrl+Plus" and "Ctrl++" both mean Ctrl with the plus key; the last part is the key, the rest are modifiers.
  const parts = written.endsWith(`${SEPARATOR}${SEPARATOR}`)
    ? [...written.slice(0, -2).split(SEPARATOR), SEPARATOR]
    : written.split(SEPARATOR);
  const keyPart = parts.pop();
  if (keyPart === undefined || keyPart === '') throw new Error(`The shortcut "${written}" has no key.`);

  const modifiers = new Set(parts.map((part) => part.toLowerCase()));
  for (const modifier of modifiers) {
    if (modifier !== 'ctrl' && modifier !== 'shift' && modifier !== 'alt') {
      throw new Error(`The shortcut "${written}" uses "${modifier}", which is not Ctrl, Shift or Alt.`);
    }
  }

  const named = KEY_NAMES[keyPart.toLowerCase()];
  const key = named ?? (keyPart.length === 1 ? keyPart.toLowerCase() : keyPart);
  return { ctrl: modifiers.has('ctrl'), shift: modifiers.has('shift'), alt: modifiers.has('alt'), key };
}

/**
 * Whether a key press is this shortcut. For symbol keys (+, -, =) Shift is not compared, because keyboards differ in
 * which of them need Shift to type at all.
 */
export function matchesShortcut(shortcut: Shortcut, press: KeyPress): boolean {
  if (press.metaKey) return false;
  const pressedKey = press.key.length === 1 ? press.key.toLowerCase() : press.key;
  if (pressedKey !== shortcut.key) return false;
  if (press.ctrlKey !== shortcut.ctrl || press.altKey !== shortcut.alt) return false;
  const isSymbol = shortcut.key.length === 1 && !/[a-z0-9]/.test(shortcut.key);
  return isSymbol || press.shiftKey === shortcut.shift;
}
