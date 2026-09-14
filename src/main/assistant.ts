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
import type { AssistantEvent, ConnectionState, ConversationSummary } from '../shared/assistant';
import { describePlace, hostCommand, type ConnectionSettings } from '../shared/connection';
import type { Journal } from './journal';

// The most past conversations listed at once, and the most pages of them asked for to reach it.
const MOST_CONVERSATIONS_LISTED = 50;
const MOST_LIST_PAGES = 10;

// The host's own error output is kept in Data/Logs; the last lines of it are also shown when the host stops.
export const HOST_LOG_FILE_NAME = 'assistant-host.log';
const REMEMBERED_ERROR_LINES = 20;

const MILLISECONDS_PER_SECOND = 1000;

// The name Insanity_Loom gives itself to the assistant.
const CLIENT_INFO = { name: 'insanity-loom', title: 'Insanity_Loom', version: '0.0.1' } as const;

type Emit = (event: AssistantEvent) => void;

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
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      }),
      lost,
      tooSlow,
    ]);
    return { host, connection, lost, agentTitle: greeting.agentInfo?.title ?? greeting.agentInfo?.name ?? 'the assistant' };
  } catch (cause) {
    await stopHost(host);
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}

export class Assistant {
  private settings: ConnectionSettings;
  private open: OpenHost | undefined;
  private conversationId: string | undefined;
  private replaying = false;
  private readonly pending = new Map<string, PendingPermission>();
  private nextRequestNumber = 1;
  private readonly recentErrors: string[] = [];
  private readonly log: WriteStream;

  constructor(
    settings: ConnectionSettings,
    private readonly journal: Journal,
    logsFolder: string,
    private readonly emit: Emit,
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
    const last = this.journal.loadConversationId();
    if (last === undefined) await this.startConversation();
    else await this.resumeConversation(last);
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
      case 'agent_message_chunk':
        if (update.content.type === 'text') this.emit({ type: 'replyText', text: update.content.text });
        return;
      case 'agent_thought_chunk':
        this.emit({ type: 'thinking' });
        return;
      case 'tool_call':
        this.emit({ type: 'tool', id: update.toolCallId, title: update.title, status: update.status ?? 'pending' });
        return;
      case 'tool_call_update':
        this.emit({ type: 'tool', id: update.toolCallId, title: update.title ?? '', status: update.status ?? '' });
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
  }

  async resumeConversation(id: string): Promise<void> {
    const connection = this.requireConnection();
    this.cancelPendingPermissions();
    // The conversation's history arrives as updates while the resume is in progress; it is shown as it comes.
    this.conversationId = id;
    this.replaying = true;
    this.emit({ type: 'conversation', id, title: 'Resumed conversation', replaying: true });
    try {
      await connection.loadSession({ sessionId: id, cwd: this.settings.workingFolder, mcpServers: [] });
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
      this.emit({ type: 'problem', message: cause instanceof Error ? cause.message : String(cause) });
      this.emit({ type: 'replyFinished', reason: 'error' });
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
    this.dropConnection();
    return opened === undefined ? Promise.resolve() : stopHost(opened.host);
  }

  /** Disconnects and closes the host's log file. The Assistant is not used again after this. */
  async close(): Promise<void> {
    await this.disconnect();
    await new Promise<void>((resolve) => this.log.end(resolve));
  }
}
