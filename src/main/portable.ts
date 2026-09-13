// Insanity_Loom is portable: no installer, nothing in the user profile, nothing in the registry. Everything it keeps —
// settings, caches, logs, crash reports — lives in one folder, Data, beside the program the author double-clicked.
// Moving or copying the program's folder moves or copies everything with it.

import { accessSync, constants, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The folder, beside the program, that holds everything Insanity_Loom keeps. */
export const DATA_FOLDER_NAME = 'Data';

// Chromium's own browsing data (cookies, local storage, caches) is kept apart from Insanity_Loom's settings, inside Data.
const SESSION_FOLDER_NAME = 'Session';
const LOGS_FOLDER_NAME = 'Logs';
const CRASH_REPORTS_FOLDER_NAME = 'Crash Reports';

/** What decides where the program is: each value is read from the running process by the caller. */
export interface ProgramLocation {
  /** True in a built copy of Insanity_Loom; false when run from the source code during development. */
  readonly isPackaged: boolean;
  /** The path of the running executable. */
  readonly executablePath: string;
  /**
   * The path of the AppImage file, on Linux, when Insanity_Loom runs as one. An AppImage unpacks itself into a
   * temporary, read-only place to run, so the executable's own folder is not where the author put the program; the
   * AppImage file is.
   */
  readonly appImagePath: string | undefined;
  /** The folder holding the application's package.json: during development, the repository itself. */
  readonly applicationPath: string;
}

/**
 * The folder the author put Insanity_Loom in, where Data belongs.
 * - A built AppImage (Linux): the folder holding the AppImage file.
 * - Any other built copy (the Windows folder, a Linux folder): the folder holding the executable.
 * - During development: the repository, so a development run keeps its own Data apart from any real copy.
 */
export function findProgramFolder(location: ProgramLocation): string {
  if (!location.isPackaged) return location.applicationPath;
  if (location.appImagePath !== undefined && location.appImagePath !== '') return dirname(location.appImagePath);
  return dirname(location.executablePath);
}

/** Every folder Insanity_Loom writes to, all of them inside Data. */
export interface DataFolders {
  readonly data: string;
  readonly session: string;
  readonly logs: string;
  readonly crashReports: string;
}

export function dataFoldersIn(programFolder: string): DataFolders {
  const data = join(programFolder, DATA_FOLDER_NAME);
  return {
    data,
    session: join(data, SESSION_FOLDER_NAME),
    logs: join(data, LOGS_FOLDER_NAME),
    crashReports: join(data, CRASH_REPORTS_FOLDER_NAME),
  };
}

/**
 * Creates the Data folders and confirms Insanity_Loom may write to them. Throws, naming the folder, when it cannot:
 * a portable program in a place the author may not write to — Program Files, a read-only drive — cannot keep its
 * settings, and must say so rather than quietly keep them somewhere else.
 */
export function prepareDataFolders(folders: DataFolders): void {
  for (const folder of [folders.data, folders.session, folders.logs, folders.crashReports]) {
    try {
      mkdirSync(folder, { recursive: true });
      accessSync(folder, constants.W_OK);
    } catch (cause) {
      throw new Error(
        `Insanity_Loom keeps its settings in a Data folder beside the program, and cannot write to:\n\n${folder}\n\n` +
          'Move the Insanity_Loom folder somewhere you are allowed to change, such as your Documents folder or a ' +
          'USB drive, and start it again.',
        { cause },
      );
    }
  }
}
