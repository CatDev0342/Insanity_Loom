// Opening an address from a whisper in the system's own browser, and nothing else: the page may ask, but the layer
// underneath decides, and refuses anything that is not a web address (src/shared/links.ts).

import { shell } from 'electron';
import { canBeOpened } from '../shared/links';

export async function openAddress(address: string): Promise<void> {
  if (!canBeOpened(address)) throw new Error(`Insanity_Loom will not open "${address}": it is not a web address.`);
  await shell.openExternal(address);
}
