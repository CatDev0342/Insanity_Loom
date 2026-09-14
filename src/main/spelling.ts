// Spelling without asking anyone for anything.
//
// Chromium keeps its dictionaries in a compiled form of its own and, left alone, fetches them from Google the first
// time a language is checked — the one request Insanity_Loom would make that the author never asked for. So the
// dictionaries we ship are put where Chromium looks before it goes looking anywhere else, and fetching the rest is
// the author's choice, off unless they turn it on (Edit ▸ Preferences).
//
// When it is off, Chromium is pointed at nothing on this machine rather than at Google: a request that cannot leave
// the computer is better than a promise that none will be made.

import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Session } from 'electron';

/** Where Chromium keeps the dictionaries it has: a folder of that name inside the program's own data. */
const DICTIONARIES = 'Dictionaries';

/** Where Chromium is sent when the author would rather nothing were fetched: a door on this machine that never opens. */
const NOWHERE = 'http://127.0.0.1:1/';

/** The dictionaries shipped with the program, by their file names. */
export function shippedDictionaries(from: string): readonly string[] {
  if (!existsSync(from)) return [];
  return readdirSync(from).filter((name) => name.toLowerCase().endsWith('.bdic'));
}

/**
 * Puts the shipped dictionaries where Chromium looks, without overwriting any the author already has — a dictionary
 * they fetched themselves may be newer than ours. Returns how many were put there.
 */
export function useShippedDictionaries(from: string, dataFolders: readonly string[]): number {
  let put = 0;
  for (const name of shippedDictionaries(from)) {
    for (const data of dataFolders) {
      const folder = join(data, DICTIONARIES);
      mkdirSync(folder, { recursive: true });
      const there = join(folder, basename(name));
      if (existsSync(there)) continue;
      copyFileSync(join(from, name), there);
      put += 1;
    }
  }
  return put;
}

/** Says whether Chromium may fetch dictionaries it does not have. Off sends it nowhere; on lets it ask as it would. */
export function letChromiumFetchDictionaries(session: Session, allowed: boolean): void {
  // Electron takes an empty value as "use the built-in address", so refusing means naming somewhere that goes nowhere.
  session.setSpellCheckerDictionaryDownloadURL(allowed ? 'https://redirector.gvt1.com/edgedl/chrome/dict/' : NOWHERE);
}
