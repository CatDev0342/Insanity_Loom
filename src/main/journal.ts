// The journal: what Insanity_Loom must never lose. The author's unsent writing is saved to disk on every change,
// before anything else happens with it, and the conversation in progress is remembered so a restart resumes it.
// Everything lives in Data/Journal.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileSafely } from './files';

const JOURNAL_FOLDER_NAME = 'Journal';
const DRAFT_FILE_NAME = 'draft.txt';
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
