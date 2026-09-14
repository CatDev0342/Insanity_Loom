// The journal: what Insanity_Loom must never lose. The whisper in progress — the author's writing and the assistant's
// replies — is saved to disk on every change, crash-safely, and the conversation in progress is remembered so a
// restart resumes it. Everything lives in Data/Journal.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileSafely } from './files';

const JOURNAL_FOLDER_NAME = 'Journal';
// Milestone 1 kept the author's unsent writing as plain text; it is read once, to carry it into the whisper.
const DRAFT_FILE_NAME = 'draft.txt';
const WHISPER_FILE_NAME = 'whisper.xhtml';
const CONVERSATION_FILE_NAME = 'conversation.json';

export class Journal {
  private readonly folder: string;

  constructor(dataFolder: string) {
    this.folder = join(dataFolder, JOURNAL_FOLDER_NAME);
    mkdirSync(this.folder, { recursive: true });
  }

  loadDraft(): string {
    const file = join(this.folder, DRAFT_FILE_NAME);
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
  }

  saveDraft(text: string): void {
    writeFileSafely(join(this.folder, DRAFT_FILE_NAME), text);
  }

  loadWhisper(): string {
    const file = join(this.folder, WHISPER_FILE_NAME);
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
  }

  saveWhisper(xhtml: string): void {
    writeFileSafely(join(this.folder, WHISPER_FILE_NAME), xhtml);
  }

  /** The conversation to resume on the next start, or undefined when there is none. */
  loadConversationId(): string | undefined {
    const file = join(this.folder, CONVERSATION_FILE_NAME);
    if (!existsSync(file)) return undefined;
    const saved: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const id = typeof saved === 'object' && saved !== null ? (saved as { id?: unknown }).id : undefined;
    if (typeof id !== 'string' || id === '') throw new Error(`The journal file ${file} does not name a conversation.`);
    return id;
  }

  saveConversationId(id: string): void {
    writeFileSafely(join(this.folder, CONVERSATION_FILE_NAME), `${JSON.stringify({ id })}\n`);
  }
}
