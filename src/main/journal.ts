// The journal: what Insanity_Loom must never lose. The whisper in progress — the author's writing and the assistant's
// replies — is saved to disk on every change, crash-safely, and the conversation in progress is remembered so a
// restart resumes it. Everything lives in Data/Journal.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileSafely } from './files';

const JOURNAL_FOLDER_NAME = 'Journal';
// Milestone 1 kept the author's unsent writing as plain text; it is read once, to carry it into the whisper.
const DRAFT_FILE_NAME = 'draft.txt';
// Milestone 2a kept the whisper itself here; whispers are files in an alcove now, and the journal remembers which.
const WHISPER_FILE_NAME = 'whisper.xhtml';
const WHISPER_PATH_FILE_NAME = 'whisper.json';
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

  /** Where the whisper open now lives, or undefined when none has been opened. */
  get whisperPath(): string | undefined {
    const file = join(this.folder, WHISPER_PATH_FILE_NAME);
    if (!existsSync(file)) return undefined;
    const saved: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const path = typeof saved === 'object' && saved !== null ? (saved as { path?: unknown }).path : undefined;
    if (typeof path !== 'string' || path === '') throw new Error(`The journal file ${file} does not name a whisper.`);
    return path;
  }

  set whisperPath(path: string) {
    writeFileSafely(join(this.folder, WHISPER_PATH_FILE_NAME), `${JSON.stringify({ path })}\n`);
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
