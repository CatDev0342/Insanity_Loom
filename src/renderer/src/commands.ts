// Commands the page carries out itself, alongside those it asks the layer underneath for (src/shared/commands.ts).

import { isCommandId, type CommandId } from '../../shared/commands';
import { isFormatCommand, type FormatCommandId } from './document/formatting';

export const PAGE_COMMANDS = [
  'whisper.new',
  'whisper.open',
  'whisper.showAlcove',
  'whisper.showKept',
  'whisper.exportMarkdown',
  'whisper.pointsHere',
  'whisper.search',
  'whisper.searchHall',
  'hall.open',
  'find.show',
  'find.replace',
  'edit.isolateSections',
  'view.comfortableMeasure',
  'find.next',
  'find.previous',
  'assistant.reconnect',
  'assistant.newConversation',
  'assistant.resumeConversation',
  'assistant.stop',
  'assistant.connectionSettings',
  'assistant.signIn',
  'assistant.signOut',
  'app.preferences',
  'app.checkForUpdates',
] as const;

export type PageCommandId = (typeof PAGE_COMMANDS)[number];

/** The page commands the loom carries out (the rest are the page's own panels). */
export type AssistantCommandId = Exclude<
  PageCommandId,
  | 'app.preferences'
  | 'app.checkForUpdates'
  | 'assistant.signIn'
  | 'whisper.pointsHere'
  | 'whisper.search'
  | 'whisper.searchHall'
  | 'hall.open'
  | 'find.show'
  | 'find.replace'
  | 'find.next'
  | 'find.previous'
  | 'edit.isolateSections'
  | 'view.comfortableMeasure'
>;

/** Any command a menu entry may name. */
export type AnyCommandId = CommandId | PageCommandId | FormatCommandId;

export function isPageCommand(command: AnyCommandId): command is PageCommandId {
  return !isCommandId(command) && !isFormatCommand(command);
}

export { isFormatCommand, type FormatCommandId };
