// What the bridge (src/preload/index.ts) offers the page, declared once so both sides agree on it.

import type { AssistantBridge, JournalBridge } from './assistant';
import type { CommandId } from './commands';

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

  /** Where the author's unsent writing is kept safe. */
  readonly journal: JournalBridge;
}
