// The layer underneath's answers to the page's assistant and journal requests. Everything arriving from the page is
// checked here before it is used: the page is never trusted to send only what it should.

import { BrowserWindow, ipcMain } from 'electron';
import { ASSISTANT_CHANNELS, JOURNAL_CHANNELS, MAXIMUM_SECTION_LENGTH, type AssistantEvent } from '../shared/assistant';
import type { Assistant } from './assistant';
import type { Journal } from './journal';

// Identifiers the page passes back (conversation ids, permission request and choice ids) are short; anything longer
// is not one of them.
const MAXIMUM_IDENTIFIER_LENGTH = 512;

function text(value: unknown, what: string, longest: number): string {
  if (typeof value !== 'string' || value.length > longest) throw new Error(`Insanity_Loom received an invalid ${what}.`);
  return value;
}

function identifier(value: unknown, what: string): string {
  const checked = text(value, what, MAXIMUM_IDENTIFIER_LENGTH);
  if (checked === '') throw new Error(`Insanity_Loom received an empty ${what}.`);
  return checked;
}

/** Sends an assistant event to every Insanity_Loom window. */
export function sendToPages(event: AssistantEvent): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(ASSISTANT_CHANNELS.event, event);
}

export function answerAssistantRequests(assistant: Assistant): void {
  ipcMain.handle(ASSISTANT_CHANNELS.connect, () => assistant.connect());
  ipcMain.handle(ASSISTANT_CHANNELS.list, () => assistant.listConversations());
  ipcMain.handle(ASSISTANT_CHANNELS.start, () => assistant.startConversation());
  ipcMain.handle(ASSISTANT_CHANNELS.resume, (_event, id: unknown) =>
    assistant.resumeConversation(identifier(id, 'conversation id')),
  );
  ipcMain.handle(ASSISTANT_CHANNELS.send, (_event, section: unknown) =>
    assistant.send(text(section, 'section of writing', MAXIMUM_SECTION_LENGTH)),
  );
  ipcMain.handle(ASSISTANT_CHANNELS.stop, () => assistant.stop());
  ipcMain.handle(ASSISTANT_CHANNELS.answer, (_event, requestId: unknown, choiceId: unknown) =>
    assistant.answerPermission(
      identifier(requestId, 'permission request id'),
      choiceId === null ? null : identifier(choiceId, 'permission choice'),
    ),
  );
}

export function answerJournalRequests(journal: Journal): void {
  ipcMain.handle(JOURNAL_CHANNELS.loadDraft, () => journal.loadDraft());
  ipcMain.handle(JOURNAL_CHANNELS.saveDraft, (_event, draft: unknown) =>
    journal.saveDraft(text(draft, 'draft', MAXIMUM_SECTION_LENGTH)),
  );
}

/**
 * When the settings cannot be read there is no assistant to connect to: every request says why, and Reconnect
 * shows the settings problem in the status bar, so the author can fix the file and try again after a restart.
 */
export function refuseAssistantRequests(problem: Error): void {
  const refuse = (): never => {
    throw problem;
  };
  ipcMain.handle(ASSISTANT_CHANNELS.connect, () => sendToPages({ type: 'status', state: 'failed', detail: problem.message }));
  for (const channel of [ASSISTANT_CHANNELS.list, ASSISTANT_CHANNELS.start, ASSISTANT_CHANNELS.resume, ASSISTANT_CHANNELS.send, ASSISTANT_CHANNELS.stop, ASSISTANT_CHANNELS.answer]) {
    ipcMain.handle(channel, refuse);
  }
}
