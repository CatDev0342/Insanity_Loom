import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeFileSafely } from '../../src/main/files';
import { Journal } from '../../src/main/journal';
import { loadSettings, readConnection, saveSettings, settingsWith, SETTINGS_FILE_NAME } from '../../src/main/settings';
import { connectionProblems, DEFAULT_CONNECTION, describeCommand, hostCommand, type ConnectionSettings } from '../../src/shared/connection';

const made: string[] = [];
function folder(): string {
  const created = mkdtempSync(join(tmpdir(), 'insanity-loom-'));
  made.push(created);
  return created;
}
afterEach(() => {
  for (const created of made.splice(0)) rmSync(created, { recursive: true, force: true });
});

const DOCKER: ConnectionSettings = {
  ...DEFAULT_CONNECTION,
  container: 'my-container',
  workingFolder: '/work',
  hostProgram: 'node',
  hostArguments: ['/opt/host/index.js'],
};

describe('the defaults', () => {
  it('describe nobody\'s setup: they cannot be used until the author fills them in', () => {
    expect(DEFAULT_CONNECTION.container).toBe('');
    expect(DEFAULT_CONNECTION.workingFolder).toBe('');
    expect(DEFAULT_CONNECTION.hostProgram).toBe('');
    expect(DEFAULT_CONNECTION.hostArguments).toEqual([]);
    expect(connectionProblems(DEFAULT_CONNECTION).length).toBeGreaterThan(0);
  });
});

describe('the host command', () => {
  it('runs the host inside the container with docker exec', () => {
    expect(describeCommand(hostCommand(DOCKER))).toBe('docker exec -i -w /work my-container node /opt/host/index.js');
  });

  it('runs as the chosen user inside the container', () => {
    expect(hostCommand({ ...DOCKER, containerUser: 'writer' }).args.slice(0, 4)).toEqual(['exec', '-i', '-u', 'writer']);
  });

  it('runs the host directly, in the working folder, on this computer', () => {
    const local = hostCommand({ ...DOCKER, place: 'local' });
    expect(local).toEqual({ program: 'node', args: ['/opt/host/index.js'], cwd: '/work' });
  });

  it('quotes words with spaces when shown', () => {
    expect(describeCommand({ program: 'C:\\Program Files\\Docker\\docker.exe', args: ['ps'], cwd: undefined })).toBe(
      '"C:\\Program Files\\Docker\\docker.exe" ps',
    );
  });
});

describe('settings', () => {
  it('do not exist until the author saves them', () => {
    const data = folder();
    expect(loadSettings(data)).toBeUndefined();
    expect(existsSync(join(data, SETTINGS_FILE_NAME))).toBe(false);
  });

  it('are read back exactly as saved', () => {
    const data = folder();
    saveSettings(data, settingsWith(DOCKER));
    expect(loadSettings(data)?.connection).toEqual(DOCKER);
  });

  it('upgrade a first-version file, keeping its values, and write it back complete', () => {
    const data = folder();
    writeFileSync(
      join(data, SETTINGS_FILE_NAME),
      JSON.stringify({ assistant: { kind: 'docker', container: 'my-container', workingFolder: '/work', hostCommand: ['node', '/opt/host/index.js'] } }),
    );
    expect(loadSettings(data)?.connection).toEqual(DOCKER);
    const rewritten: unknown = JSON.parse(readFileSync(join(data, SETTINGS_FILE_NAME), 'utf8'));
    expect(rewritten).toEqual({ version: 2, connection: DOCKER });
  });

  it('name the file and the problem when the file is not JSON', () => {
    const data = folder();
    writeFileSync(join(data, SETTINGS_FILE_NAME), '{ not json');
    expect(() => loadSettings(data)).toThrow(/not valid JSON/);
  });

  it('refuse a Docker connection with no container', () => {
    expect(() => readConnection({ ...DOCKER, container: '' }, 'the panel')).toThrow(/container must be named/);
  });

  it('refuse a value of the wrong kind', () => {
    expect(() => readConnection({ ...DOCKER, hostArguments: 'node host.js' }, 'the panel')).toThrow(/"hostArguments" must be a list/);
    expect(() => readConnection({ ...DOCKER, place: 'cloud' }, 'the panel')).toThrow(/"docker" or "local"/);
  });

  it('refuse a handshake limit outside its range', () => {
    expect(() => readConnection({ ...DOCKER, handshakeSeconds: 1 }, 'the panel')).toThrow(/handshake time limit/);
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
