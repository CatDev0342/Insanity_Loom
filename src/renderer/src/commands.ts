// Commands the page carries out itself, alongside those it asks the layer underneath for (src/shared/commands.ts).

import { isCommandId, type CommandId } from '../../shared/commands';

export const PAGE_COMMANDS = [
  'assistant.reconnect',
  'assistant.newConversation',
  'assistant.resumeConversation',
  'assistant.stop',
  'assistant.connectionSettings',
] as const;

export type PageCommandId = (typeof PAGE_COMMANDS)[number];

/** Any command a menu entry may name. */
export type AnyCommandId = CommandId | PageCommandId;

export function isPageCommand(command: AnyCommandId): command is PageCommandId {
  return !isCommandId(command);
}
