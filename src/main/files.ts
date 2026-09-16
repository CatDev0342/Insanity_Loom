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

/**
 * Adds to the end of a file, forcing what was added onto the disk, making the file if it is not there yet.
 *
 * A record that only ever grows — the assistant's thinking, written a second at a time — must not be read whole and
 * written whole for every piece added: a long conversation's companion document would then be rewritten from the
 * beginning every second, and the cost of adding one line would grow with everything already written. Adding to the
 * end cannot half-write what is already there, so nothing already kept can be lost by it.
 */
export function appendFileSafely(path: string, contents: string): void {
  const handle = openSync(path, 'a');
  try {
    writeSync(handle, contents);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
}
