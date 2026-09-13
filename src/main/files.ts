// Writing files so that a crash or a power cut can never leave one half-written: the new contents go to a temporary
// file beside the real one, are forced onto the disk, and only then take the real file's place in one step. At every
// moment the real file is either the old version or the new one, complete.

import { closeSync, fsyncSync, openSync, renameSync, writeSync } from 'node:fs';

const TEMPORARY_SUFFIX = '.writing';

export function writeFileSafely(path: string, contents: string): void {
  const temporary = `${path}${TEMPORARY_SUFFIX}`;
  const handle = openSync(temporary, 'w');
  try {
    writeSync(handle, contents);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  renameSync(temporary, path);
}
