import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  preferencesWith,
  PREFERENCES_FILE_NAME,
  readAssistantSettings,
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
  it('offers to quote only where the author is writing, never in the program\'s own fields', () => {
    const inAField = contextEntries({ ...NOTHING_POSSIBLE, isEditable: true });
    expect(inAField.some((entry) => entry.kind === 'entry' && entry.label === '&Quote')).toBe(false);
    const inTheWhisper = contextEntries({ ...NOTHING_POSSIBLE, isEditable: true }, true);
    expect(inTheWhisper[0]).toMatchObject({ label: '&Quote', action: { kind: 'quote' } });
  });

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
    savePreferences(data, preferencesWith(DEFAULT_PREFERENCES, { spelling: { enabled: false, languages: ['en-GB', 'fr'], fetchDictionaries: false }, assistantMode: 'auto' }));
    expect(loadPreferences(data).spelling).toEqual({ enabled: false, languages: ['en-GB', 'fr'], fetchDictionaries: false });
    expect(loadPreferences(data).assistantMode).toBe('auto');
  });

  it('upgrade a first-version file, keeping its spelling', () => {
    const data = folder();
    writeFileSync(
      join(data, PREFERENCES_FILE_NAME),
      JSON.stringify({ version: 1, spelling: { enabled: false, languages: [] } }),
    );
    expect(loadPreferences(data)).toEqual({
      version: 5,
      spelling: { enabled: false, languages: [], fetchDictionaries: false },
      assistantMode: '',
      alcoveFolder: '',
      greatHallPath: '',
      panelWidths: { left: 0, right: 0 },
      comfortableMeasure: false,
      assistantSettings: {},
    });
  });

  it('upgrade a file written before the measure was remembered, keeping everything it held', () => {
    const data = folder();
    // What an author using the program before this was written actually has on disk. Everything in it is theirs.
    writeFileSync(
      join(data, PREFERENCES_FILE_NAME),
      JSON.stringify({
        version: 3,
        spelling: { enabled: true, languages: ['en-US'], fetchDictionaries: true },
        assistantMode: 'acceptEdits',
        alcoveFolder: '/somewhere/of/their/own',
        greatHallPath: '/somewhere/of/their/own/CoreGame.greathall',
        panelWidths: { left: 320, right: 400 },
      }),
    );
    expect(loadPreferences(data)).toEqual({
      version: 5,
      spelling: { enabled: true, languages: ['en-US'], fetchDictionaries: true },
      assistantMode: 'acceptEdits',
      alcoveFolder: '/somewhere/of/their/own',
      greatHallPath: '/somewhere/of/their/own/CoreGame.greathall',
      panelWidths: { left: 320, right: 400 },
      comfortableMeasure: false,
      assistantSettings: {},
    });
  });

  it('upgrade a version-4 file, keeping the measure the author chose', () => {
    const data = folder();
    // What an author on build 111 has: everything version 4 held, including a measure they had turned on.
    writeFileSync(
      join(data, PREFERENCES_FILE_NAME),
      JSON.stringify({
        version: 4,
        spelling: { enabled: true, languages: [], fetchDictionaries: false },
        assistantMode: '',
        alcoveFolder: '',
        greatHallPath: '',
        panelWidths: { left: 0, right: 0 },
        comfortableMeasure: true,
      }),
    );
    const read = loadPreferences(data);
    expect(read.version).toBe(5);
    expect(read.comfortableMeasure).toBe(true);
    expect(read.assistantSettings).toEqual({});
  });

  it("remember what the assistant was set to, and pass over what is not a setting", () => {
    const data = folder();
    savePreferences(data, preferencesWith(DEFAULT_PREFERENCES, { assistantSettings: { model: 'claude-opus-5', effort: 'medium' } }));
    expect(loadPreferences(data).assistantSettings).toEqual({ model: 'claude-opus-5', effort: 'medium' });

    // The identifiers and values are the assistant's own words, so anything that is not a pair of strings is
    // passed over rather than trusted.
    expect(readAssistantSettings({ model: 'claude-opus-5', effort: 3, '': 'x' })).toEqual({ model: 'claude-opus-5' });
    expect(readAssistantSettings('not an object')).toEqual({});
  });

  it('remember the measure once it is chosen', () => {
    const data = folder();
    savePreferences(data, preferencesWith(DEFAULT_PREFERENCES, { comfortableMeasure: true }));
    expect(loadPreferences(data).comfortableMeasure).toBe(true);
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
