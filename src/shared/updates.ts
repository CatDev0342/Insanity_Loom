// Updating Insanity_Loom from inside Insanity_Loom.
//
// Nearly all of a copy is Electron; what changes between one build and the next is the program's own part — a few
// megabytes. So an update fetches that part, checks it is what it says it is, and puts it in place when the program
// next starts. When Electron itself has moved on, the whole program must be fetched instead, and the author is told
// so plainly rather than being given something that would not run.

/** What a build published, as its own release says. */
export interface NewestBuild {
  /** What it is called: 0.0.83. */
  readonly version: string;
  /** The Electron it was built against; an update in parts is only sound while this matches. */
  readonly electron: string;
}

/** How an update stands, in the words the author is shown. */
export type UpdateStanding =
  | { readonly kind: 'looking' }
  | { readonly kind: 'the newest'; readonly version: string }
  | { readonly kind: 'ready to fetch'; readonly version: string; readonly megabytes: number }
  | { readonly kind: 'whole program needed'; readonly version: string }
  | { readonly kind: 'fetching'; readonly version: string }
  | { readonly kind: 'waiting for a restart'; readonly version: string }
  | { readonly kind: 'went wrong'; readonly why: string };

export interface UpdatesBridge {
  /** Asks what the newest build is, and whether this copy can become it by itself. */
  look(): Promise<UpdateStanding>;
  /** Fetches the newest build's own part and puts it aside, to be put in place when the program next starts. */
  fetch(): Promise<UpdateStanding>;
  /** Closes the program and starts it again, so a fetched update is put in place. */
  restart(): Promise<void>;
}

export const UPDATE_CHANNELS = {
  look: 'insanity-loom:update-look',
  fetch: 'insanity-loom:update-fetch',
  restart: 'insanity-loom:update-restart',
} as const;

/** Whether a build is newer than the one running, by the number each carries. */
export function isNewer(theirs: string, ours: string): boolean {
  const asNumbers = (version: string): readonly number[] => version.split('.').map((piece) => Number.parseInt(piece, 10) || 0);
  const them = asNumbers(theirs);
  const us = asNumbers(ours);
  for (let place = 0; place < Math.max(them.length, us.length); place++) {
    const their = them[place] ?? 0;
    const our = us[place] ?? 0;
    if (their !== our) return their > our;
  }
  return false;
}
