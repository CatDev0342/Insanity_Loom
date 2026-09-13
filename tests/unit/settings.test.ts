import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeFileSafely } from '../../src/main/files';
import { Journal } from '../../src/main/journal';
import { loadSettings, SETTINGS_FILE_NAME, validateSettings } from '../../src/main/settings';

const made: string[] = [];
function folder(): string {
  const created = mkdtempSync(join(tmpdir(), 'insanity-loom-'));
  made.push(created);
  return created;
}
afterEach(() => {
  for (const created of made.splice(0)) rmSync(created, { recursive: true, force: true });
});

describe('settings', () => {
  it('are created with defaults the first time, and read back unchanged', () => {
    const data = folder();
    const first = loadSettings(data);
    expect(existsSync(join(data, SETTINGS_FILE_NAME))).toBe(true);
    expect(loadSettings(data)).toEqual(first);
  });

  it('name the file and the problem when the file is not JSON', () => {
    const data = folder();
    writeFileSync(join(data, SETTINGS_FILE_NAME), '{ not json');
    expect(() => loadSettings(data)).toThrow(/not valid JSON/);
  });

  it('refuse a Docker assistant with no container', () => {
    expect(() =>
      validateSettings({ assistant: { kind: 'docker', workingFolder: '/w', hostCommand: ['node', 'host.js'] } }, 'settings.json'),
    ).toThrow(/assistant.container/);
  });

  it('refuse a host command that is not a list of words', () => {
    expect(() =>
      validateSettings({ assistant: { kind: 'local', workingFolder: '/w', hostCommand: 'node host.js' } }, 'settings.json'),
    ).toThrow(/hostCommand/);
  });

  it('refuse an unknown kind of assistant', () => {
    expect(() =>
      validateSettings({ assistant: { kind: 'cloud', workingFolder: '/w', hostCommand: ['x'] } }, 'settings.json'),
    ).toThrow(/"docker" or "local"/);
  });
});

describe('the journal', () => {
  it('keeps the draft and the conversation across restarts', () => {
    const data = folder();
    const journal = new Journal(data);
    expect(journal.loadDraft()).toBe('');
    expect(journal.loadConversationId()).toBeUndefined();
    journal.saveDraft('half a thought');
    journal.saveConversationId('conversation-7');

    const reopened = new Journal(data);
    expect(reopened.loadDraft()).toBe('half a thought');
    expect(reopened.loadConversationId()).toBe('conversation-7');
  });
});

describe('writeFileSafely', () => {
  it('replaces the whole file and leaves no temporary file behind', () => {
    const data = folder();
    const file = join(data, 'note.txt');
    writeFileSafely(file, 'first');
    writeFileSafely(file, 'second');
    expect(readFileSync(file, 'utf8')).toBe('second');
    expect(existsSync(`${file}.writing`)).toBe(false);
  });
});
