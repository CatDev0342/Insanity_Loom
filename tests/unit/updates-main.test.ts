// Fetching a newer Insanity_Loom: what may be done in parts, and what is put in place when.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { handOverToTheHelper, helperScript, HELPER_LOG, howTheUpdateWent, howToUpdate, updateWaiting } from '../../src/main/updates';

const made: string[] = [];
afterEach(() => {
  for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function folder(): string {
  const path = mkdtempSync(join(tmpdir(), 'insanity-loom-update-'));
  made.push(path);
  return path;
}

const HERE = { programFolder: '', dataFolder: '', version: '0.0.83', electron: '44.3.0' };

describe('whether a copy can update itself', () => {
  it('says it is the newest when it is', () => {
    expect(howToUpdate({ version: '0.0.83', electron: '44.3.0' }, HERE, true)).toEqual({ kind: 'the newest', version: '0.0.83' });
    expect(howToUpdate({ version: '0.0.82', electron: '44.3.0' }, HERE, true).kind).toBe('the newest');
  });

  it('fetches its own part when only that has changed', () => {
    expect(howToUpdate({ version: '0.0.84', electron: '44.3.0' }, HERE, true)).toMatchObject({ kind: 'ready to fetch', version: '0.0.84' });
  });

  it('asks for the whole program when what it runs on has moved', () => {
    expect(howToUpdate({ version: '0.0.84', electron: '45.0.0' }, HERE, true)).toEqual({
      kind: 'whole program needed',
      version: '0.0.84',
    });
  });

  it('asks for the whole program when the build published no part for this system', () => {
    expect(howToUpdate({ version: '0.0.84', electron: '44.3.0' }, HERE, false).kind).toBe('whole program needed');
  });
});

describe('an update waiting to be put in place', () => {
  function anUpdateWaiting(): { data: string; program: string; packagePath: string } {
    const data = folder();
    const program = folder();
    writeFileSync(join(program, 'app.asar'), 'the old program');
    const waiting = join(data, 'Update');
    mkdirSync(waiting, { recursive: true });
    const packagePath = join(waiting, 'part.zip');
    writeFileSync(packagePath, 'a package');
    writeFileSync(join(waiting, 'update.json'), JSON.stringify({ version: '0.0.84', package: packagePath }));
    return { data, program, packagePath };
  }

  it('is handed to a helper, because the program cannot replace the file it is running from', async () => {
    const { data, program } = anUpdateWaiting();
    let setGoing = '';
    const standing = await handOverToTheHelper(
      { ...HERE, programFolder: program, dataFolder: data },
      (_package: string, into: string) => writeFileSync(join(into, 'app.asar'), 'the new program'),
      (scriptPath: string) => {
        setGoing = scriptPath;
        // A helper that has started says so before the program agrees to quit for it.
        writeFileSync(join(data, 'Update', HELPER_LOG), 'Started.\n');
      },
      join(program, 'Insanity_Loom.exe'),
    );

    expect(standing).toEqual({ kind: 'waiting for a restart', version: '0.0.84' });
    // The helper was written and set going, and the program itself has touched nothing.
    expect(setGoing).toContain('put-in-place');
    expect(readFileSync(join(program, 'app.asar'), 'utf8')).toBe('the old program');
    const script = readFileSync(setGoing, 'utf8');
    expect(script).toContain('cpSync');
    expect(script).toContain('Insanity_Loom.exe');
  });

  it('does not quit for a helper that never started, and says so', async () => {
    const { data, program } = anUpdateWaiting();
    const standing = await handOverToTheHelper(
      { ...HERE, programFolder: program, dataFolder: data },
      (_package: string, into: string) => writeFileSync(join(into, 'app.asar'), 'the new program'),
      // Set going and never heard from: a script host that refuses without a word.
      () => undefined,
      join(program, 'Insanity_Loom.exe'),
    );

    expect(standing.kind).toBe('went wrong');
    expect(standing).toMatchObject({ why: expect.stringContaining('Nothing has been changed.') });
    expect(readFileSync(join(program, 'app.asar'), 'utf8')).toBe('the old program');
  });

  it('leaves the program exactly as it was when the package cannot be opened, and says so', async () => {
    const { data, program } = anUpdateWaiting();
    const standing = await handOverToTheHelper(
      { ...HERE, programFolder: program, dataFolder: data },
      () => {
        throw new Error('that package is not a package');
      },
      () => undefined,
      join(program, 'Insanity_Loom.exe'),
    );

    expect(standing.kind).toBe('went wrong');
    // A program that runs is worth more than a program that is new.
    expect(readFileSync(join(program, 'app.asar'), 'utf8')).toBe('the old program');
    expect(updateWaiting(data)).toBeUndefined();
  });

  it('says there is nothing waiting when there is not', () => {
    expect(updateWaiting(folder())).toBeUndefined();
  });
});

describe('the helper itself, run as a real program', () => {
  // On Windows the helper is run by the program's own executable as a plain Node program; here it is run by node
  // directly, which is the same thing. What is being tested is the helper's own work: wait, copy, start again.
  it.skipIf(process.platform === 'win32')('waits for the program to go, puts the files in place, and starts it again', async () => {
    const data = folder();
    const program = folder();
    const opened = join(data, 'opened');
    mkdirSync(join(opened, 'resources'), { recursive: true });
    mkdirSync(join(program, 'resources'), { recursive: true });
    writeFileSync(join(program, 'resources', 'app.asar'), 'the old program');
    writeFileSync(join(opened, 'resources', 'app.asar'), 'the new program');

    // Something to be waited for, and something to be started afterwards.
    const waitedFor = spawn(process.execPath, ['-e', 'setTimeout(() => undefined, 400)']);
    const marker = join(data, 'started-again');
    const exe = join(data, 'restart.sh');
    writeFileSync(exe, `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 });

    const log = join(data, HELPER_LOG);
    const script = join(data, 'put-in-place.js');
    writeFileSync(script, helperScript({ pid: waitedFor.pid ?? 0, opened, programFolder: program, exe, log }));
    const helper = spawn(process.execPath, [script], { stdio: 'ignore' });
    await new Promise((settle) => helper.once('exit', settle));

    expect(readFileSync(join(program, 'resources', 'app.asar'), 'utf8')).toBe('the new program');
    const said = readFileSync(log, 'utf8');
    expect(said).toContain('Started.');
    expect(said).toContain('The program has closed.');
    expect(said).toContain('Put in place.');
    await expect.poll(() => existsSync(marker)).toBe(true);
  }, RUNNING_THE_HELPER_MS);
});

/** The helper waits for a program to go, lets the system settle, copies, and starts it again. */
const RUNNING_THE_HELPER_MS = 20_000;

describe('how an update went, read at the next start', () => {
  it('says nothing when no update was ever handed over', () => {
    expect(howTheUpdateWent({ ...HERE, dataFolder: folder(), programFolder: folder() })).toBeUndefined();
  });

  it('says it took when the program is now the version that was waiting', () => {
    const data = folder();
    const waiting = join(data, 'Update');
    mkdirSync(waiting, { recursive: true });
    const packagePath = join(waiting, 'part.zip');
    writeFileSync(packagePath, 'a package');
    writeFileSync(join(waiting, 'update.json'), JSON.stringify({ version: '0.0.84', package: packagePath }));
    writeFileSync(join(waiting, HELPER_LOG), 'Put in place.');

    const went = howTheUpdateWent({ ...HERE, version: '0.0.84', dataFolder: data, programFolder: folder() });
    expect(went).toEqual({ kind: 'the newest', version: '0.0.84' });
    expect(updateWaiting(data)).toBeUndefined();
  });

  it('says plainly when it did not take, rather than starting up looking unchanged', () => {
    const data = folder();
    const waiting = join(data, 'Update');
    mkdirSync(waiting, { recursive: true });
    const packagePath = join(waiting, 'part.zip');
    writeFileSync(packagePath, 'a package');
    writeFileSync(join(waiting, 'update.json'), JSON.stringify({ version: '0.0.84', package: packagePath }));
    writeFileSync(join(waiting, HELPER_LOG), 'The update could not be put in place: access denied');

    // Still 0.0.83: this is exactly what the author saw, and it must not pass in silence.
    const went = howTheUpdateWent({ ...HERE, dataFolder: data, programFolder: folder() });
    expect(went?.kind).toBe('went wrong');
    expect(went).toMatchObject({ why: expect.stringContaining('access denied') });
    expect(went).toMatchObject({ why: expect.stringContaining('0.0.84') });
    // And it is not tried again and again: what failed once is cleared away.
    expect(updateWaiting(data)).toBeUndefined();
  });
});
