// The connection to the assistant. Insanity_Loom starts the assistant host — inside a Docker container with
// `docker exec`, or directly on this computer — and speaks the Agent Client Protocol (ACP) with it over the host's
// standard input and output. The host signs in and keeps its own trust; Insanity_Loom never sees a password.
//
// Everything the assistant says is passed on to the page as AssistantEvents (src/shared/assistant.ts). Permission
// requests wait for the author's answer in the page. The conversation in progress is remembered in the journal, so
// the next start resumes it.

import * as acp from '@agentclientprotocol/sdk';
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import {
  isSignInPage as isSignInPageAddress,
  type AssistantEvent,
  type ConnectionState,
  type ConversationSummary,
  type SessionMode,
  type SignInMethod,
} from '../shared/assistant';
import { describePlace, hostCommand, type ConnectionSettings } from '../shared/connection';
import type { Journal } from './journal';

// The most past conversations listed at once, and the most pages of them asked for to reach it.
const MOST_CONVERSATIONS_LISTED = 50;
const MOST_LIST_PAGES = 10;

// The host's own error output is kept in Data/Logs; the last lines of it are also shown when the host stops.
export const HOST_LOG_FILE_NAME = 'assistant-host.log';
const REMEMBERED_ERROR_LINES = 20;

const MILLISECONDS_PER_SECOND = 1000;

// The protocol's error code for "sign in first", as the protocol library defines it.
const SIGN_IN_REQUIRED_CODE = acp.RequestError.authRequired().code;

// The assistant reports who it is signed in as with this notification (the Claude adapter's authStatus extension).
const ACCOUNT_NOTIFICATION = '_auth/status_update';

// A sign-in code is short; anything longer, or holding a line break, is not one.
const LONGEST_SIGN_IN_CODE = 2048;

// The addresses in a sign-in program's output: the first one on a sign-in site is the sign-in page.
const ADDRESS = /https:\/\/[^\s"'<>]+/g;

// Terminal color and cursor codes, removed from a sign-in program's output before it is shown or searched. They are
// control characters by definition, which is what the rule below would otherwise forbid.
// eslint-disable-next-line no-control-regex
const TERMINAL_CODES = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*\u0007/g;

function isSignInRequired(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === SIGN_IN_REQUIRED_CODE;
}

/** Who the assistant says it is signed in as, from its account notification; undefined when it says nothing usable. */
function readAccount(params: Record<string, unknown>): { label: string; detail: string } | undefined {
  const status = params['authStatus'];
  if (typeof status !== 'object' || status === null) return undefined;
  const { label, detail } = status as { label?: unknown; detail?: unknown };
  if (typeof label !== 'string') return undefined;
  return { label, detail: typeof detail === 'string' ? detail : '' };
}

// The name Insanity_Loom gives itself to the assistant.
const CLIENT_INFO = { name: 'insanity-loom', title: 'Insanity_Loom', version: '0.0.1' } as const;

type Emit = (event: AssistantEvent) => void;

/** Where the author's chosen way of working is remembered between conversations and between runs. */
export interface ModeMemory {
  /** The way of working last chosen; '' for the assistant's own default. */
  readonly assistantMode: string;
  setAssistantMode(modeId: string): void;
}

interface PendingPermission {
  readonly choiceIds: ReadonlySet<string>;
  readonly answer: (choiceId: string | null) => void;
}

function explainStartFailure(settings: ConnectionSettings, cause: Error & { code?: string }): string {
  if (cause.code === 'ENOENT') {
    return settings.place === 'docker'
      ? `Insanity_Loom could not run Docker ("${settings.dockerProgram}"). Is Docker Desktop installed and running, and is the Docker program named correctly in Connection Settings?`
      : `Insanity_Loom could not find the assistant host program "${settings.hostProgram}".`;
  }
  return `The assistant host could not be started: ${cause.message}`;
}

/** A started host, shaken hands with. */
interface OpenHost {
  readonly host: ChildProcess;
  readonly connection: acp.ClientSideConnection;
  readonly agentTitle: string;
  /** The ways the assistant offers to sign in. */
  readonly signInMethods: readonly acp.AuthMethod[];
  readonly canSignOut: boolean;
  /** Rejects, with the reason in words, when the host stops or fails; it never resolves. */
  readonly lost: Promise<never>;
}

function stopHost(host: ChildProcess): Promise<void> {
  if (host.exitCode !== null || host.signalCode !== null) return Promise.resolve();
  const stopped = new Promise<void>((resolve) => host.once('exit', () => resolve()));
  // Closing the host's input is what tells it to finish; the kill makes sure.
  host.stdin?.end();
  host.kill();
  return stopped;
}

/**
 * Starts the host the settings describe and shakes hands with it. Its error output goes to `log`, and the last lines
 * of it are kept in `recentErrors` to explain a failure. Throws, in words for the author, when it cannot connect.
 */
async function openHost(
  settings: ConnectionSettings,
  client: () => acp.Client,
  log: WriteStream,
  recentErrors: string[],
): Promise<OpenHost> {
  const command = hostCommand(settings);
  const host = spawn(command.program, [...command.args], { cwd: command.cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

  host.stderr.setEncoding('utf8');
  host.stderr.on('data', (chunk: string) => {
    log.write(chunk);
    for (const line of chunk.split('\n')) {
      if (line.trim() === '') continue;
      recentErrors.push(line.trim());
      if (recentErrors.length > REMEMBERED_ERROR_LINES) recentErrors.shift();
    }
  });

  const lost = new Promise<never>((_resolve, reject) => {
    host.once('error', (cause) => reject(new Error(explainStartFailure(settings, cause))));
    host.once('exit', (code) => {
      const last = recentErrors.at(-1);
      reject(new Error(`The assistant host stopped (exit code ${code ?? 'none'}).${last === undefined ? '' : `\n${last}`}`));
    });
  });
  // Whoever holds the connection handles a loss; this only keeps a loss nobody is watching yet from going unhandled.
  lost.catch(() => undefined);

  const connection = new acp.ClientSideConnection(
    client,
    acp.ndJsonStream(Writable.toWeb(host.stdin) as WritableStream<Uint8Array>, Readable.toWeb(host.stdout) as ReadableStream<Uint8Array>),
  );

  let timer: NodeJS.Timeout | undefined;
  const tooSlow = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`The assistant ${describePlace(settings)} did not answer within ${settings.handshakeSeconds} seconds.`)),
      settings.handshakeSeconds * MILLISECONDS_PER_SECOND,
    );
  });
  try {
    const greeting = await Promise.race([
      connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientInfo: CLIENT_INFO,
        // Sign-in by running the host's own sign-in program is offered to clients that say they can run one.
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false, auth: { terminal: true } },
      }),
      lost,
      tooSlow,
    ]);
    return {
      host,
      connection,
      lost,
      agentTitle: greeting.agentInfo?.title ?? greeting.agentInfo?.name ?? 'the assistant',
      signInMethods: greeting.authMethods ?? [],
      canSignOut: greeting.agentCapabilities?.auth?.logout !== undefined && greeting.agentCapabilities.auth.logout !== null,
    };
  } catch (cause) {
    await stopHost(host);
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}

/** What Claude Code calls the command that makes room in its context window. */
export const COMPACT_COMMAND = 'compact';

export class Assistant {
  private settings: ConnectionSettings;
  private open: OpenHost | undefined;
  private conversationId: string | undefined;
  private replaying = false;
  /** True while room is being made in the context window: what the assistant says then is not a reply. */
  private compacting = false;
  private readonly pending = new Map<string, PendingPermission>();
  private nextRequestNumber = 1;
  private readonly recentErrors: string[] = [];
  private readonly log: WriteStream;
  private signingIn: ChildProcess | undefined;

  /** The ways of working this assistant offers, and the one in use. */
  private modes: { available: readonly SessionMode[]; current: string } = { available: [], current: '' };

  constructor(
    settings: ConnectionSettings,
    private readonly journal: Journal,
    logsFolder: string,
    private readonly emit: Emit,
    private readonly memory: ModeMemory = { assistantMode: '', setAssistantMode: () => undefined },
  ) {
    this.settings = settings;
    this.log = createWriteStream(join(logsFolder, HOST_LOG_FILE_NAME), { flags: 'a' });
  }

  /** Uses new settings from the next connection on. */
  useSettings(settings: ConnectionSettings): void {
    this.settings = settings;
  }

  private status(state: ConnectionState, detail: string): void {
    this.emit({ type: 'status', state, detail });
  }

  /** Starts the host, shakes hands, and resumes the last conversation (or begins one). */
  async connect(): Promise<void> {
    await this.disconnect();
    const settings = this.settings;
    const place = describePlace(settings);
    this.status('connecting', `Connecting to the assistant ${place}…`);
    this.recentErrors.length = 0;

    let opened: OpenHost;
    try {
      opened = await openHost(settings, () => this.client(), this.log, this.recentErrors);
    } catch (cause) {
      this.status('failed', cause instanceof Error ? cause.message : String(cause));
      return;
    }
    this.open = opened;
    opened.lost.catch((cause: unknown) => {
      if (this.open !== opened) return;
      this.dropConnection();
      this.status('failed', cause instanceof Error ? cause.message : String(cause));
    });

    this.status('connected', `Connected to ${opened.agentTitle} ${place}.`);
    try {
      const last = this.journal.loadConversationId();
      if (last === undefined) await this.startConversation();
      else await this.resumeConversation(last);
    } catch (cause) {
      if (!isSignInRequired(cause)) throw cause;
      this.needSignIn();
    }
  }

  /** Says the assistant needs the author to sign in, and how it offers to do it. */
  private needSignIn(): void {
    const place = describePlace(this.settings);
    this.status('signedOut', `${this.open?.agentTitle ?? 'The assistant'} ${place} is not signed in. Use Assistant ▸ Sign In.`);
    this.emit({ type: 'signInNeeded', methods: this.signInMethods() });
  }

  signInMethods(): readonly SignInMethod[] {
    return (this.open?.signInMethods ?? []).map((method) => ({
      id: method.id,
      name: method.name,
      description: method.description ?? '',
    }));
  }

  /**
   * Signs in with one of the assistant's own methods. A "terminal" method is the host's own sign-in program: it is
   * run with the method's arguments, the sign-in page it names is passed to the page, and the code the author pastes
   * is typed into it. Any other method the assistant carries out itself. Either way the connection is made again
   * afterwards, so the conversation can begin.
   */
  async signIn(methodId: string): Promise<void> {
    const method = this.open?.signInMethods.find((candidate) => candidate.id === methodId);
    const connection = this.open?.connection;
    if (method === undefined || connection === undefined) throw new Error(`The assistant offers no sign-in method "${methodId}".`);
    this.cancelSignIn();

    if (!('type' in method) || method.type !== 'terminal') {
      this.emit({ type: 'signIn', stage: 'started', url: '', message: `Signing in with ${method.name}…` });
      await connection.authenticate({ methodId });
      this.emit({ type: 'signIn', stage: 'finished', url: '', message: 'Signed in.' });
      await this.connect();
      return;
    }

    const environment = method.env ?? {};
    const command = hostCommand(this.settings, { extraArguments: method.args ?? [], environmentNames: Object.keys(environment) });
    const program = spawn(command.program, [...command.args], {
      cwd: command.cwd,
      env: { ...process.env, ...environment },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.signingIn = program;
    this.emit({ type: 'signIn', stage: 'started', url: '', message: `Starting ${method.name} sign-in…` });

    let output = '';
    let pageFound = false;
    const read = (chunk: Buffer): void => {
      output += chunk.toString('utf8').replace(TERMINAL_CODES, '');
      if (pageFound) return;
      const page = [...output.matchAll(ADDRESS)].map((match) => match[0]).find((address) => isSignInPageAddress(address));
      if (page === undefined) return;
      pageFound = true;
      this.emit({
        type: 'signIn',
        stage: 'page',
        url: page,
        message: 'Open the sign-in page, sign in there, and paste the code it shows you here.',
      });
    };
    program.stdout.on('data', read);
    program.stderr.on('data', read);
    program.once('error', (cause) => {
      if (this.signingIn !== program) return;
      this.signingIn = undefined;
      this.emit({ type: 'signIn', stage: 'failed', url: '', message: explainStartFailure(this.settings, cause) });
    });
    program.once('exit', (code) => {
      if (this.signingIn !== program) return;
      this.signingIn = undefined;
      if (code === 0) {
        this.emit({ type: 'signIn', stage: 'finished', url: '', message: 'Signed in.' });
        void this.connect();
        return;
      }
      const lastLines = output.trim().split(/\r?\n/).slice(-2).join('\n');
      this.emit({ type: 'signIn', stage: 'failed', url: '', message: `The sign-in did not complete.${lastLines === '' ? '' : `\n${lastLines}`}` });
    });
  }

  sendSignInCode(code: string): void {
    const program = this.signingIn;
    if (program === undefined) throw new Error('No sign-in is waiting for a code.');
    if (code.trim() === '' || code.length > LONGEST_SIGN_IN_CODE || /[\r\n]/.test(code)) throw new Error('That is not a sign-in code.');
    program.stdin?.write(`${code.trim()}\n`);
  }

  cancelSignIn(): void {
    const program = this.signingIn;
    this.signingIn = undefined;
    if (program !== undefined) void stopHost(program);
  }

  async signOut(): Promise<void> {
    const opened = this.open;
    if (opened === undefined) throw new Error('Insanity_Loom is not connected to the assistant.');
    if (!opened.canSignOut) throw new Error(`${opened.agentTitle} cannot be signed out from Insanity_Loom.`);
    await opened.connection.logout({});
    await this.connect();
  }

  /**
   * Tries settings without changing anything: starts that host, shakes hands, and stops it again. Resolves with a
   * sentence saying what answered; throws, in words for the author, when nothing did.
   */
  async test(settings: ConnectionSettings): Promise<string> {
    const refuse = (): never => {
      throw new Error('Insanity_Loom is only testing the connection.');
    };
    const opened = await openHost(settings, () => ({ requestPermission: refuse, sessionUpdate: async () => undefined }), this.log, []);
    await stopHost(opened.host);
    return `${opened.agentTitle} answered ${describePlace(settings)}.`;
  }

  private client(): acp.Client {
    return {
      requestPermission: (params) => this.askPermission(params),
      sessionUpdate: async (params) => {
        if (params.sessionId === this.conversationId) this.onUpdate(params.update);
      },
      extNotification: async (method, params) => {
        if (method !== ACCOUNT_NOTIFICATION) return;
        const account = readAccount(params);
        if (account !== undefined) this.emit({ type: 'account', ...account });
      },
    };
  }

  private askPermission(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    const requestId = String(this.nextRequestNumber++);
    return new Promise((resolve) => {
      this.pending.set(requestId, {
        choiceIds: new Set(params.options.map((option) => option.optionId)),
        answer: (choiceId) =>
          resolve(
            choiceId === null
              ? { outcome: { outcome: 'cancelled' } }
              : { outcome: { outcome: 'selected', optionId: choiceId } },
          ),
      });
      this.emit({
        type: 'permission',
        requestId,
        title: params.toolCall.title ?? 'The assistant asks for permission.',
        choices: params.options.map((option) => ({ id: option.optionId, name: option.name, kind: option.kind })),
      });
    });
  }

  private onUpdate(update: acp.SessionNotification['update']): void {
    switch (update.sessionUpdate) {
      case 'user_message_chunk':
        // The author's own words come back only when a resumed conversation's history is replayed; live, the page
        // already shows what the author sent.
        if (this.replaying && update.content.type === 'text') this.emit({ type: 'authorText', text: update.content.text });
        return;
      case 'agent_message_chunk': {
        if (update.content.type !== 'text') return;
        const messageId = update.messageId ?? '';
        // While room is being made, what the assistant says is about the conversation rather than part of it.
        this.emit(
          this.compacting
            ? { type: 'thought', text: update.content.text, messageId }
            : { type: 'replyText', text: update.content.text, messageId },
        );
        return;
      }
      case 'agent_thought_chunk':
        this.emit({ type: 'thinking' });
        // The thinking itself, as it is written: it is shown beside the whisper and kept in a document of its own,
        // never in the whisper, which is the author's prose (40.8).
        if (update.content.type === 'text') this.emit({ type: 'thought', text: update.content.text, messageId: update.messageId ?? '' });
        return;
      case 'tool_call':
        this.emit({ type: 'tool', id: update.toolCallId, title: update.title, status: update.status ?? 'pending' });
        return;
      case 'tool_call_update':
        this.emit({ type: 'tool', id: update.toolCallId, title: update.title ?? '', status: update.status ?? '' });
        return;
      case 'session_info_update': {
        const title = update.title ?? '';
        if (title.trim() !== '') this.emit({ type: 'title', title });
        return;
      }
      case 'usage_update':
        // How much of the assistant's context window is in use. The status bar shows it, and offers to make room.
        this.emit({ type: 'context', used: update.used, size: update.size });
        return;
      case 'available_commands_update':
        this.emit({ type: 'commands', names: update.availableCommands.map((command) => command.name) });
        return;
      case 'compaction_update':
        this.emit({
          type: 'compacting',
          status: update.status,
          summary: (update.summary ?? [])
            .map((block) => (block.type === 'text' ? block.text : ''))
            .join('')
            .trim(),
        });
        return;
      case 'compaction_summary_chunk':
        // The summary is the assistant's account of what it kept: thinking about the conversation, not part of it.
        if (update.content.type === 'text') this.emit({ type: 'thought', text: update.content.text, messageId: update.compactionId });
        return;
      case 'current_mode_update':
        // The assistant can change its own way of working — leaving Plan mode, say; the status bar follows it.
        this.modes = { ...this.modes, current: update.currentModeId };
        this.emit({ type: 'modes', modes: this.modes.available, current: update.currentModeId });
        return;
      default:
        return;
    }
  }

  private requireConnection(): acp.ClientSideConnection {
    if (this.open === undefined) throw new Error('Insanity_Loom is not connected to the assistant. Use Assistant ▸ Reconnect.');
    return this.open.connection;
  }

  private requireConversation(): { connection: acp.ClientSideConnection; conversationId: string } {
    const connection = this.requireConnection();
    if (this.conversationId === undefined) throw new Error('There is no conversation in progress.');
    return { connection, conversationId: this.conversationId };
  }

  async startConversation(): Promise<void> {
    const created = await this.requireConnection().newSession({ cwd: this.settings.workingFolder, mcpServers: [] });
    this.conversationId = created.sessionId;
    this.journal.saveConversationId(created.sessionId);
    this.emit({ type: 'conversation', id: created.sessionId, title: 'New conversation', replaying: false });
    await this.useModes(created.modes);
  }

  /**
   * Takes the ways of working a conversation offers, and puts the author's remembered choice back in use — a
   * conversation begins in the assistant's own default otherwise, and the author would have to choose again each time.
   */
  private async useModes(state: acp.SessionModeState | null | undefined): Promise<void> {
    if (state === undefined || state === null) {
      this.modes = { available: [], current: '' };
      this.emit({ type: 'modes', modes: [], current: '' });
      return;
    }
    const available: SessionMode[] = state.availableModes.map((mode) => ({
      id: mode.id,
      name: mode.name,
      description: mode.description ?? '',
    }));
    this.modes = { available, current: state.currentModeId };
    const remembered = this.memory.assistantMode;
    if (remembered !== '' && remembered !== state.currentModeId && available.some((mode) => mode.id === remembered)) {
      try {
        await this.requireConnection().setSessionMode({ sessionId: this.conversationId ?? '', modeId: remembered });
        this.modes = { available, current: remembered };
      } catch (cause) {
        this.emit({
          type: 'problem',
          message: `The way of working "${remembered}" could not be used: ${cause instanceof Error ? cause.message : String(cause)}`,
        });
      }
    }
    this.emit({ type: 'modes', modes: this.modes.available, current: this.modes.current });
  }

  /** Changes the way of working, and remembers it for later conversations. */
  async setMode(modeId: string): Promise<void> {
    const { connection, conversationId } = this.requireConversation();
    if (!this.modes.available.some((mode) => mode.id === modeId)) {
      throw new Error(`The assistant offers no way of working called "${modeId}".`);
    }
    await connection.setSessionMode({ sessionId: conversationId, modeId });
    this.modes = { ...this.modes, current: modeId };
    this.memory.setAssistantMode(modeId);
    this.emit({ type: 'modes', modes: this.modes.available, current: modeId });
  }

  async resumeConversation(id: string): Promise<void> {
    const connection = this.requireConnection();
    this.cancelPendingPermissions();
    // The conversation's history arrives as updates while the resume is in progress; it is shown as it comes.
    this.conversationId = id;
    this.replaying = true;
    this.emit({ type: 'conversation', id, title: 'Resumed conversation', replaying: true });
    let resumed: acp.LoadSessionResponse;
    try {
      resumed = await connection.loadSession({ sessionId: id, cwd: this.settings.workingFolder, mcpServers: [] });
    } catch (cause) {
      this.replaying = false;
      this.emit({
        type: 'problem',
        message: `The conversation ${id} could not be resumed (${cause instanceof Error ? cause.message : String(cause)}). A new one has begun.`,
      });
      await this.startConversation();
      return;
    }
    this.replaying = false;
    this.journal.saveConversationId(id);
    this.emit({ type: 'replayFinished' });
    await this.useModes(resumed.modes);
  }

  async listConversations(): Promise<readonly ConversationSummary[]> {
    const connection = this.requireConnection();
    const found: ConversationSummary[] = [];
    let cursor: string | null | undefined;
    for (let page = 0; page < MOST_LIST_PAGES && found.length < MOST_CONVERSATIONS_LISTED; page++) {
      const listed = await connection.listSessions({ cwd: this.settings.workingFolder, cursor: cursor ?? null });
      for (const session of listed.sessions) {
        found.push({ id: session.sessionId, title: session.title ?? 'Untitled conversation', updatedAt: session.updatedAt ?? '' });
      }
      cursor = listed.nextCursor;
      if (cursor === undefined || cursor === null) break;
    }
    return found.slice(0, MOST_CONVERSATIONS_LISTED);
  }

  async send(text: string): Promise<void> {
    const { connection, conversationId } = this.requireConversation();
    try {
      const result = await connection.prompt({ sessionId: conversationId, prompt: [{ type: 'text', text }] });
      this.emit({ type: 'replyFinished', reason: result.stopReason });
    } catch (cause) {
      if (isSignInRequired(cause)) {
        this.emit({ type: 'replyFinished', reason: 'error' });
        this.needSignIn();
        return;
      }
      this.emit({ type: 'problem', message: cause instanceof Error ? cause.message : String(cause) });
      this.emit({ type: 'replyFinished', reason: 'error' });
    }
  }

  /**
   * Asks the assistant to make room in its context window. Claude Code offers this as a command of its own
   * (`available_commands_update`), and a command is given the way anything is given: as a prompt. What it says while
   * doing it is not a reply to any turn, so nothing of it reaches the whisper — the page is told it is compacting,
   * and the summary arrives as thinking.
   */
  async compact(): Promise<void> {
    const { connection, conversationId } = this.requireConversation();
    this.compacting = true;
    this.emit({ type: 'compacting', status: 'in_progress', summary: '' });
    try {
      await connection.prompt({ sessionId: conversationId, prompt: [{ type: 'text', text: `/${COMPACT_COMMAND}` }] });
      this.emit({ type: 'compacting', status: 'completed', summary: '' });
    } catch (cause) {
      this.emit({ type: 'problem', message: cause instanceof Error ? cause.message : String(cause) });
      this.emit({ type: 'compacting', status: 'failed', summary: '' });
    } finally {
      this.compacting = false;
    }
  }

  async stop(): Promise<void> {
    const { connection, conversationId } = this.requireConversation();
    // The protocol asks a client that cancels to answer any permission request still open as cancelled.
    this.cancelPendingPermissions();
    await connection.cancel({ sessionId: conversationId });
  }

  answerPermission(requestId: string, choiceId: string | null): void {
    const request = this.pending.get(requestId);
    if (request === undefined) return;
    if (choiceId !== null && !request.choiceIds.has(choiceId)) {
      throw new Error(`"${choiceId}" is not one of the choices offered for this permission request.`);
    }
    this.pending.delete(requestId);
    request.answer(choiceId);
  }

  private cancelPendingPermissions(): void {
    for (const request of this.pending.values()) request.answer(null);
    this.pending.clear();
  }

  private dropConnection(): void {
    this.modes = { available: [], current: '' };
    this.cancelPendingPermissions();
    this.open = undefined;
    this.conversationId = undefined;
    this.replaying = false;
  }

  /**
   * Ends the connection and stops the host, resolving once it has actually stopped: until then it still holds its
   * working folder, and on Windows a folder in use cannot be moved or deleted.
   */
  disconnect(): Promise<void> {
    const opened = this.open;
    this.cancelSignIn();
    this.dropConnection();
    return opened === undefined ? Promise.resolve() : stopHost(opened.host);
  }

  /** Disconnects and closes the host's log file. The Assistant is not used again after this. */
  async close(): Promise<void> {
    await this.disconnect();
    await new Promise<void>((resolve) => this.log.end(resolve));
  }
}
