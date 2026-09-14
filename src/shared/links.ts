// Following a link out of a whisper. A link to another whisper is opened by Insanity_Loom itself (src/shared/whispers.ts);
// anything else is the wider world's, and is handed to the system's own browser — but only when it is an address of a
// kind a browser should be given. A whisper is an ordinary file the author may have been sent, so what it points at is
// never trusted: `file:` would open something on this computer, and `javascript:` is not an address at all.

/** The kinds of address Insanity_Loom will hand to the system. */
const OPENABLE_SCHEMES = ['http:', 'https:', 'mailto:'];

export function canBeOpened(address: string): boolean {
  try {
    return OPENABLE_SCHEMES.includes(new URL(address).protocol);
  } catch {
    return false;
  }
}

export interface LinksBridge {
  /** Opens a web address in the system's own browser. Refuses anything that is not one. */
  open(address: string): Promise<void>;
}

export const LINK_CHANNELS = {
  open: 'insanity-loom:link-open',
} as const;
