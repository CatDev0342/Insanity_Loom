// What the bridge (src/preload/index.ts) offers the page, declared once so both sides agree on it.

import type { AssistantBridge, ConnectionBridge, JournalBridge } from './assistant';
import type { CommandId } from './commands';
import type { EditingBridge } from './editing';
import type { GreatHallBridge } from './greathall';
import type { FindWindowBridge, HallBridge } from './hall';
import type { LayoutBridge } from './layout';
import type { LinksBridge } from './links';
import type { WhispersBridge } from './whispers';

export interface InsanityLoomBridge {
  /** The versions of the engine Insanity_Loom runs on, for the About box and for bug reports. */
  readonly versions: {
    readonly electron: string;
    readonly chromium: string;
    readonly node: string;
  };

  /** Asks the layer underneath to carry out one of the planned commands (src/shared/commands.ts). */
  runCommand(command: CommandId): Promise<void>;

  /** The assistant: connecting, conversations, sending, permission answers, and everything it says. */
  readonly assistant: AssistantBridge;

  /** The connection settings: reading, saving, testing, and the help the Connection Settings panel needs. */
  readonly connection: ConnectionBridge;

  /** Right-click menus, spelling and the personal dictionary. */
  readonly editing: EditingBridge;

  /** The author's whispers as files, and the alcove they live in. */
  readonly whispers: WhispersBridge;

  /** Following a link out of a whisper into the wider world. */
  readonly links: LinksBridge;

  /** Searching everything the author has written. */
  readonly hall: HallBridge;

  /** The Find in Files window, which stands beside the program rather than inside it. */
  readonly findWindow: FindWindowBridge;

  /** The GreatHall in use: what belongs together, and the library it cites. */
  readonly greatHall: GreatHallBridge;

  /** How the author divided the window between its three sections. */
  readonly layout: LayoutBridge;

  /** Where the author's unsent writing is kept safe. */
  readonly journal: JournalBridge;
}
