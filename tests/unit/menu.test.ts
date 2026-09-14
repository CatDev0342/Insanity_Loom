import { describe, expect, it } from 'vitest';
import { parseLabel } from '../../src/renderer/src/menu/labels';
import { MENUS } from '../../src/renderer/src/menu/model';
import { matchesShortcut, parseShortcut, type KeyPress } from '../../src/renderer/src/menu/shortcuts';
import { PAGE_COMMANDS } from '../../src/renderer/src/commands';
import { COMMANDS } from '../../src/shared/commands';

function press(key: string, modifiers: Partial<Omit<KeyPress, 'key'>> = {}): KeyPress {
  return { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...modifiers, key };
}

describe('parseLabel', () => {
  it('finds the access key after the ampersand', () => {
    expect(parseLabel('&File')).toEqual({ text: 'File', accessKeyIndex: 0, accessKey: 'f' });
    expect(parseLabel('E&xit')).toEqual({ text: 'Exit', accessKeyIndex: 1, accessKey: 'x' });
  });

  it('reads a doubled ampersand as a literal one', () => {
    expect(parseLabel('Salt && &Pepper')).toEqual({ text: 'Salt & Pepper', accessKeyIndex: 7, accessKey: 'p' });
  });

  it('allows a label with no access key', () => {
    expect(parseLabel('Plain')).toEqual({ text: 'Plain', accessKeyIndex: -1, accessKey: '' });
  });
});

describe('shortcuts', () => {
  it('matches modifiers exactly for letters', () => {
    const redo = parseShortcut('Ctrl+Shift+Z');
    expect(matchesShortcut(redo, press('Z', { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(matchesShortcut(redo, press('z', { ctrlKey: true }))).toBe(false);
  });

  it('ignores Shift for symbol keys, which some keyboards need Shift to type', () => {
    const zoomIn = parseShortcut('Ctrl+Plus');
    expect(matchesShortcut(zoomIn, press('+', { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(matchesShortcut(zoomIn, press('+', { ctrlKey: true }))).toBe(true);
  });

  it('reads named keys', () => {
    expect(matchesShortcut(parseShortcut('F11'), press('F11'))).toBe(true);
    expect(matchesShortcut(parseShortcut('Ctrl+Minus'), press('-', { ctrlKey: true }))).toBe(true);
  });

  it('never matches with the Windows or Command key held', () => {
    expect(matchesShortcut(parseShortcut('Ctrl+0'), press('0', { ctrlKey: true, metaKey: true }))).toBe(false);
  });

  it('refuses a malformed shortcut instead of ignoring it', () => {
    expect(() => parseShortcut('Hyper+Q')).toThrow(/not Ctrl, Shift or Alt/);
    expect(() => parseShortcut('Ctrl+')).toThrow(/has no key/);
  });
});

describe('the menus', () => {
  it('name only planned commands, with shortcuts that all read', () => {
    for (const menu of MENUS) {
      for (const entry of menu.entries) {
        if (entry.kind !== 'command') continue;
        expect([...COMMANDS, ...PAGE_COMMANDS]).toContain(entry.command);
        for (const shortcut of entry.shortcuts) expect(() => parseShortcut(shortcut)).not.toThrow();
      }
    }
  });

  it('give every menu, and every entry within one menu, its own access key', () => {
    const menuKeys = MENUS.map((menu) => parseLabel(menu.label).accessKey);
    expect(new Set(menuKeys).size).toBe(menuKeys.length);
    for (const menu of MENUS) {
      const entryKeys = menu.entries.flatMap((entry) => (entry.kind === 'command' ? [parseLabel(entry.label).accessKey] : []));
      expect(entryKeys.every((key) => key !== '')).toBe(true);
      expect(new Set(entryKeys).size).toBe(entryKeys.length);
    }
  });
});

describe('sign-in pages', () => {
  it('are opened only on the assistant makers\' own sites, over https', async () => {
    const { isSignInPage } = await import('../../src/shared/assistant');
    expect(isSignInPage('https://claude.com/cai/oauth/authorize?code=true')).toBe(true);
    expect(isSignInPage('https://platform.claude.com/oauth/code/callback')).toBe(true);
    expect(isSignInPage('https://console.anthropic.com/login')).toBe(true);
    expect(isSignInPage('http://claude.com/oauth')).toBe(false);
    expect(isSignInPage('https://claude.com.evil.example/oauth')).toBe(false);
    expect(isSignInPage('https://notclaude.com/oauth')).toBe(false);
    expect(isSignInPage('javascript:alert(1)')).toBe(false);
  });
});
