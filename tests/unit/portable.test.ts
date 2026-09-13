import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DATA_FOLDER_NAME, dataFoldersIn, findProgramFolder, prepareDataFolders } from '../../src/main/portable';

describe('findProgramFolder', () => {
  it('uses the repository during development', () => {
    expect(
      findProgramFolder({
        isPackaged: false,
        executablePath: '/repo/node_modules/electron/dist/electron',
        appImagePath: undefined,
        applicationPath: '/repo',
      }),
    ).toBe('/repo');
  });

  it("uses the executable's folder in a built copy", () => {
    expect(
      findProgramFolder({
        isPackaged: true,
        executablePath: '/usb/Insanity_Loom/insanity-loom',
        appImagePath: undefined,
        applicationPath: '/usb/Insanity_Loom/resources/app.asar',
      }),
    ).toBe('/usb/Insanity_Loom');
  });

  it("uses the AppImage file's folder, not the temporary place it unpacks to", () => {
    expect(
      findProgramFolder({
        isPackaged: true,
        executablePath: '/tmp/.mount_InsaniXYZ/insanity-loom',
        appImagePath: '/home/author/Apps/Insanity_Loom.AppImage',
        applicationPath: '/tmp/.mount_InsaniXYZ/resources/app.asar',
      }),
    ).toBe('/home/author/Apps');
  });

  it('ignores an empty AppImage variable', () => {
    expect(
      findProgramFolder({
        isPackaged: true,
        executablePath: '/opt/Insanity_Loom/insanity-loom',
        appImagePath: '',
        applicationPath: '/opt/Insanity_Loom/resources/app.asar',
      }),
    ).toBe('/opt/Insanity_Loom');
  });
});

describe('dataFoldersIn', () => {
  it('keeps every folder inside Data', () => {
    const folders = dataFoldersIn('/usb/Insanity_Loom');
    expect(folders.data).toBe(join('/usb/Insanity_Loom', DATA_FOLDER_NAME));
    for (const folder of [folders.session, folders.logs, folders.crashReports]) {
      expect(folder.startsWith(folders.data)).toBe(true);
    }
  });
});

describe('prepareDataFolders', () => {
  const made: string[] = [];
  afterEach(() => {
    for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true });
  });

  it('creates the Data folders', () => {
    const programFolder = mkdtempSync(join(tmpdir(), 'insanity-loom-'));
    made.push(programFolder);
    expect(() => prepareDataFolders(dataFoldersIn(programFolder))).not.toThrow();
  });

  it('names the folder when Data cannot be created', () => {
    const programFolder = mkdtempSync(join(tmpdir(), 'insanity-loom-'));
    made.push(programFolder);
    // A file where the Data folder should be: nothing can be created inside it, on any system.
    writeFileSync(join(programFolder, DATA_FOLDER_NAME), '');
    expect(() => prepareDataFolders(dataFoldersIn(programFolder))).toThrow(/cannot write to/);
  });
});
