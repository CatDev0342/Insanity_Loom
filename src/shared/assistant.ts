// What passes between the page and the layer underneath about the assistant. The layer underneath owns the
// connection itself (src/main/assistant.ts); the page only shows it and answers for the author.

import type { ConnectionSettings } from './connection';

/** How the connection stands, in words the author can act on. */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'signedOut' | 'failed';

/** A way the assistant offers to sign in ("Claude Subscription", "Anthropic Console"…). */
export interface SignInMethod {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

/**
 * A way of working the assistant offers, and what it does about permission: for Claude, Manual (ask every time),
 * Accept edits, Plan, Auto (the assistant decides) and Bypass permissions. Choosing one other than Manual is how the
 * author stops being asked about every step.
 */
export interface SessionMode {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

/** The steps of a sign-in, as the Sign In panel shows them. */
export type SignInStage = 'started' | 'page' | 'finished' | 'failed';

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
  /** A piece of the assistant's thinking, as it is written. Shown beside the whisper and kept in its own document. */
  | { readonly type: 'thought'; readonly text: string }
  /** How much of the assistant's context window is in use, and how big it is, in tokens. */
  | { readonly type: 'context'; readonly used: number; readonly size: number }
  /** What the assistant offers to be asked to do, by name ("compact"). */
  | { readonly type: 'commands'; readonly names: readonly string[] }
  /** The assistant is making room in its context window: 'in_progress', 'completed', 'failed' or 'cancelled'. */
  | { readonly type: 'compacting'; readonly status: string; readonly summary: string }
  | { readonly type: 'tool'; readonly id: string; readonly title: string; readonly status: string }
  | { readonly type: 'permission'; readonly requestId: string; readonly title: string; readonly choices: readonly PermissionChoice[] }
  | { readonly type: 'replyFinished'; readonly reason: string }
  | { readonly type: 'problem'; readonly message: string }
  /** Who the assistant is signed in as ("Claude Max", and the account), whenever the assistant reports it. */
  | { readonly type: 'account'; readonly label: string; readonly detail: string }
  /** The assistant needs the author to sign in before it can work. */
  | { readonly type: 'signInNeeded'; readonly methods: readonly SignInMethod[] }
  /** A sign-in in progress: `url` is the sign-in page once known; `message` says what happened, in words. */
  | { readonly type: 'signIn'; readonly stage: SignInStage; readonly url: string; readonly message: string }
  /** The ways of working this assistant offers, and the one in use. Empty when it offers none. */
  | { readonly type: 'modes'; readonly modes: readonly SessionMode[]; readonly current: string }
  /** The conversation now has a title of its own, which the assistant chose from what was said. */
  | { readonly type: 'title'; readonly title: string };

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
  /**
   * Asks the assistant to make room in its context window by summarizing what has been said so far. Nothing of it
   * enters the whisper: what the assistant says while compacting is thinking, not a reply.
   */
  compact(): Promise<void>;
  /** Answers a permission request: a choice's id, or null to refuse without choosing. */
  answerPermission(requestId: string, choiceId: string | null): Promise<void>;
  /** Listens for assistant events. Returns a function that stops listening. */
  onEvent(listener: (event: AssistantEvent) => void): () => void;
  /** Changes the way of working (and remembers it for later conversations). */
  setMode(modeId: string): Promise<void>;
  /** The ways the assistant offers to sign in; empty when it offers none, or is not connected. */
  signInMethods(): Promise<readonly SignInMethod[]>;
  /** Begins signing in with one of the offered methods. Its progress arrives as signIn events. */
  signIn(methodId: string): Promise<void>;
  /** Gives the sign-in the code the sign-in page showed the author. */
  sendSignInCode(code: string): Promise<void>;
  cancelSignIn(): Promise<void>;
  /** Opens the sign-in page in the system's browser. Only the assistant's own sign-in sites are opened. */
  openSignInPage(url: string): Promise<void>;
  signOut(): Promise<void>;
}

export interface JournalBridge {
  /** The author's unsent writing from before whispers, as last saved: '' when there is none. Read once, to carry it over. */
  loadDraft(): Promise<string>;
  /** The whisper in progress, as its XHTML file: '' when there is none yet. */
  /** Saves the whisper in progress to disk at once, crash-safely. */
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
  signInMethods: 'insanity-loom:assistant-sign-in-methods',
  signIn: 'insanity-loom:assistant-sign-in',
  signInCode: 'insanity-loom:assistant-sign-in-code',
  cancelSignIn: 'insanity-loom:assistant-sign-in-cancel',
  openSignInPage: 'insanity-loom:assistant-sign-in-page',
  signOut: 'insanity-loom:assistant-sign-out',
  setMode: 'insanity-loom:assistant-set-mode',
  compact: 'insanity-loom:assistant-compact',
} as const;

/**
 * The sites a sign-in page may be on. A sign-in page's address comes from the host's output, so it is checked before
 * the browser is asked to open it: only the assistant makers' own sign-in sites are opened.
 */
export const SIGN_IN_SITES = ['claude.com', 'claude.ai', 'anthropic.com'] as const;

export function isSignInPage(address: string): boolean {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && SIGN_IN_SITES.some((site) => url.hostname === site || url.hostname.endsWith(`.${site}`));
}

export const CONNECTION_CHANNELS = {
  load: 'insanity-loom:connection-load',
  save: 'insanity-loom:connection-save',
  test: 'insanity-loom:connection-test',
  containers: 'insanity-loom:connection-containers',
  openLog: 'insanity-loom:connection-open-log',
} as const;

export const JOURNAL_CHANNELS = {
  loadDraft: 'insanity-loom:journal-load-draft',
} as const;

/** The largest whisper file accepted from the page, in characters: far beyond any real whisper, but bounded. */
export const MAXIMUM_WHISPER_LENGTH = 50_000_000;

/** The longest section the page may send in one piece, in characters: far beyond any real writing, but bounded. */
export const MAXIMUM_SECTION_LENGTH = 1_000_000;
