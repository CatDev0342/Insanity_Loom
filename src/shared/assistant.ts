// What passes between the page and the layer underneath about the assistant. The layer underneath owns the
// connection itself (src/main/assistant.ts); the page only shows it and answers for the author.

import type { ConnectionSettings } from './connection';

/** How the connection stands, in words the author can act on. */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'failed';

/** A past conversation the assistant can resume. */
export interface ConversationSummary {
  readonly id: string;
  readonly title: string;
  /** When it last changed, as an ISO 8601 timestamp, or '' when the assistant did not say. */
  readonly updatedAt: string;
}

/** One way the author may answer a permission request ("Allow once", "Always allow", "Reject"…). */
export interface PermissionChoice {
  readonly id: string;
  readonly name: string;
  /** The protocol's own kind: allow_once, allow_always, reject_once or reject_always. */
  readonly kind: string;
}

/** Everything the page is told about the assistant, in the order it happens. */
export type AssistantEvent =
  | { readonly type: 'status'; readonly state: ConnectionState; readonly detail: string }
  /** A conversation began or was resumed; what follows belongs to it. `replaying` is true while its history is replayed. */
  | { readonly type: 'conversation'; readonly id: string; readonly title: string; readonly replaying: boolean }
  | { readonly type: 'replayFinished' }
  /** Text the author sent, as the assistant recorded it (seen while a resumed conversation's history is replayed). */
  | { readonly type: 'authorText'; readonly text: string }
  | { readonly type: 'replyText'; readonly text: string }
  | { readonly type: 'thinking' }
  | { readonly type: 'tool'; readonly id: string; readonly title: string; readonly status: string }
  | { readonly type: 'permission'; readonly requestId: string; readonly title: string; readonly choices: readonly PermissionChoice[] }
  | { readonly type: 'replyFinished'; readonly reason: string }
  | { readonly type: 'problem'; readonly message: string };

export interface AssistantBridge {
  /** Connects, using the settings in Data/settings.json, and resumes the last conversation if there was one. */
  connect(): Promise<void>;
  listConversations(): Promise<readonly ConversationSummary[]>;
  startConversation(): Promise<void>;
  resumeConversation(id: string): Promise<void>;
  /** Sends one finished section of the author's writing. Resolves when the reply is finished. */
  send(text: string): Promise<void>;
  /** Stops the reply being written. */
  stop(): Promise<void>;
  /** Answers a permission request: a choice's id, or null to refuse without choosing. */
  answerPermission(requestId: string, choiceId: string | null): Promise<void>;
  /** Listens for assistant events. Returns a function that stops listening. */
  onEvent(listener: (event: AssistantEvent) => void): () => void;
}

export interface JournalBridge {
  /** The author's unsent writing, as last saved: '' when there is none. */
  loadDraft(): Promise<string>;
  /** Saves the author's unsent writing to disk at once. */
  saveDraft(text: string): Promise<void>;
}

/** What the Connection Settings panel opens with. */
export interface ConnectionPanelState {
  /** The settings in use, or the generic defaults when none have been saved yet. */
  readonly settings: ConnectionSettings;
  /** False until the author has saved connection settings for the first time. */
  readonly saved: boolean;
  /** Why the saved settings could not be read, or '' when they could. */
  readonly problem: string;
}

export interface ConnectionBridge {
  load(): Promise<ConnectionPanelState>;
  /** Checks and saves settings; they are used from the next connection on. Throws, in words, when they cannot be used. */
  save(settings: ConnectionSettings): Promise<void>;
  /** Tries settings without saving them. Resolves with what answered; throws, in words, when nothing did. */
  test(settings: ConnectionSettings): Promise<string>;
  /** The names of the Docker containers now running, found with the given Docker program. */
  listContainers(dockerProgram: string): Promise<readonly string[]>;
  /** Opens the assistant host's log file in the system's text viewer. */
  openLog(): Promise<void>;
}

// The channels these travel on.
export const ASSISTANT_CHANNELS = {
  connect: 'insanity-loom:assistant-connect',
  list: 'insanity-loom:assistant-list',
  start: 'insanity-loom:assistant-start',
  resume: 'insanity-loom:assistant-resume',
  send: 'insanity-loom:assistant-send',
  stop: 'insanity-loom:assistant-stop',
  answer: 'insanity-loom:assistant-answer',
  event: 'insanity-loom:assistant-event',
} as const;

export const CONNECTION_CHANNELS = {
  load: 'insanity-loom:connection-load',
  save: 'insanity-loom:connection-save',
  test: 'insanity-loom:connection-test',
  containers: 'insanity-loom:connection-containers',
  openLog: 'insanity-loom:connection-open-log',
} as const;

export const JOURNAL_CHANNELS = {
  loadDraft: 'insanity-loom:journal-load-draft',
  saveDraft: 'insanity-loom:journal-save-draft',
} as const;

/** The longest section the page may send in one piece, in characters: far beyond any real writing, but bounded. */
export const MAXIMUM_SECTION_LENGTH = 1_000_000;
