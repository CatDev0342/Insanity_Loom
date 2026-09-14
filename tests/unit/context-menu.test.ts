import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  preferencesWith,
  PREFERENCES_FILE_NAME,
  readMode,
  readSpelling,
  savePreferences,
} from '../../src/main/preferences';
import { contextEntries, type ContextEntry } from '../../src/renderer/src/menu/context-entries';
import type { ContextDetails } from '../../src/shared/editing';

const NOTHING_POSSIBLE: ContextDetails = {
  isEditable: false,
  hasSelection: false,
  canUndo: false,
  canRedo: false,
  canCut: false,
  canCopy: false,
  canPaste: false,
  canSelectAll: false,
  misspelledWord: '',
  suggestions: [],
};

const labels = (entries: readonly ContextEntry[]): string[] => entries.map((entry) => (entry.kind === 'entry' ? entry.label : '—'));
const enabled = (entries: readonly ContextEntry[], label: string): boolean | undefined => {
  const found = entries.find((entry) => entry.kind === 'entry' && entry.label === label);
  return found?.kind === 'entry' ? found.enabled : undefined;
};

describe('the right-click menu', () => {
  it('offers the editing commands in a text field, enabled only when they can act', () => {
    const entries = contextEntries({ ...NOTHING_POSSIBLE, isEditable: true, canPaste: true, canSelectAll: true });
    expect(labels(entries)).toEqual(['&Undo', '&Redo', '—', 'Cu&t', '&Copy', '&Paste', '—', 'Select &All']);
    expect(enabled(entries, '&Paste')).toBe(true);
    expect(enabled(entries, '&Copy')).toBe(false);
  });

  it('offers spelling suggestions first on a misspelled word, then adding it to the dictionary', () => {
    const entries = contextEntries({ ...NOTHING_POSSIBLE, isEditable: true, misspelledWord: 'teh', suggestions: ['the', 'ten', 'tech'] });
    expect(labels(entries).slice(0, 5)).toEqual(['the', 'ten', 'tech', 'Add "teh" to &Dictionary', '—']);
    const first = entries[0];
    expect(first?.kind === 'entry' && first.action).toEqual({ kind: 'replace', suggestion: 'the' });
  });

  it('says so when a misspelled word has no suggestions', () => {
    const entries = contextEntries({ ...NOTHING_POSSIBLE, isEditable: true, misspelledWord: 'qwzx' });
    expect(labels(entries)[0]).toBe('No spelling suggestions');
    expect(enabled(entries, 'No spelling suggestions')).toBe(false);
  });

  it('shows at most five suggestions', () => {
    const entries = contextEntries({ ...NOTHING_POSSIBLE, misspelledWord: 'x', suggestions: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] });
    expect(entries.filter((entry) => entry.kind === 'entry' && entry.action.kind === 'replace')).toHaveLength(5);
  });

  it('offers Copy and Select All over text that cannot be changed', () => {
    const entries = contextEntries({ ...NOTHING_POSSIBLE, hasSelection: true, canCopy: true, canSelectAll: true });
    expect(labels(entries)).toEqual(['&Copy', 'Select &All']);
  });

  it('offers nothing where nothing can be done', () => {
    expect(contextEntries(NOTHING_POSSIBLE)).toEqual([]);
  });
});

describe('preferences', () => {
  const made: string[] = [];
  afterEach(() => {
    for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true });
  });
  const folder = (): string => {
    const created = mkdtempSync(join(tmpdir(), 'insanity-loom-'));
    made.push(created);
    return created;
  };

  it('are the defaults until saved, then read back as saved', () => {
    const data = folder();
    expect(loadPreferences(data)).toEqual(DEFAULT_PREFERENCES);
    savePreferences(data, preferencesWith({ enabled: false, languages: ['en-GB', 'fr'] }, 'auto', ''));
    expect(loadPreferences(data).spelling).toEqual({ enabled: false, languages: ['en-GB', 'fr'] });
    expect(loadPreferences(data).assistantMode).toBe('auto');
  });

  it('upgrade a first-version file, keeping its spelling', () => {
    const data = folder();
    writeFileSync(
      join(data, PREFERENCES_FILE_NAME),
      JSON.stringify({ version: 1, spelling: { enabled: false, languages: [] } }),
    );
    expect(loadPreferences(data)).toEqual({
      version: 3,
      spelling: { enabled: false, languages: [] },
      assistantMode: '',
      alcoveFolder: '',
    });
  });

  it('refuse a way of working that is not one', () => {
    expect(() => readMode('a way with spaces', 'the panel')).toThrow(/must name a way of working/);
    expect(readMode('acceptEdits', 'the panel')).toBe('acceptEdits');
    expect(readMode('', 'the panel')).toBe('');
  });

  it('name the problem in a damaged file', () => {
    const data = folder();
    writeFileSync(join(data, PREFERENCES_FILE_NAME), JSON.stringify({ version: 1, spelling: { enabled: 'yes', languages: [] } }));
    expect(() => loadPreferences(data)).toThrow(/"spelling.enabled" must be true or false/);
  });

  it('refuse something that is not a language code', () => {
    expect(() => readSpelling({ enabled: true, languages: ['English'] }, 'the panel')).toThrow(/language codes/);
  });
});
