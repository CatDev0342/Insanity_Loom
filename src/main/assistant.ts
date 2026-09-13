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
import type { Journal } from './journal';
import type { AssistantSettings } from './settings';

// How long the host may take to answer the first handshake, in milliseconds. Starting a container's host and the
// assistant behind it can take a while on a cold machine; a host that has not answered by then is not coming.
const HANDSHAKE_TIME_LIMIT_MS = 90_000;

// The most past conversations listed at once, and the most pages of them asked for to reach it.
const MOST_CONVERSATIONS_LISTED = 50;
const MOST_LIST_PAGES = 10;

// The host's own error output is kept in Data/Logs; the last lines of it are also shown when the host stops.
const HOST_LOG_FILE_NAME = 'assistant-host.log';
const REMEMBERED_ERROR_LINES = 20;

// The name Insanity_Loom gives itself to the assistant.
const CLIENT_INFO = { name: 'insanity-loom', title: 'Insanity_Loom', version: '0.0.1' } as const;

type Emit = (event: AssistantEvent) => void;

interface PendingPermission {
  readonly choiceIds: ReadonlySet<string>;
  readonly answer: (choiceId: string | null) => void;
}

/** Where the assistant runs, as the end of a sentence ("Connected to Claude Agent …"). */
function describePlace(settings: AssistantSettings): string {
  return settings.kind === 'docker' ? `in the Docker container "${settings.container}"` : 'on this computer';
}

function commandLine(settings: AssistantSettings): { program: string; args: string[]; cwd: string | undefined } {
  const [program, ...rest] = settings.hostCommand;
  if (program === undefined) throw new Error('The assistant host command is empty.');
  if (settings.kind === 'docker') {
    // -i keeps the host's input open: the protocol travels on it.
    return { program: 'docker', args: ['exec', '-i', '-w', settings.workingFolder, settings.container, program, ...rest], cwd: undefined };
  }
  return { program, args: rest, cwd: settings.workingFolder };
}

function explainStartFailure(settings: AssistantSettings, cause: Error & { code?: string }): string {
  if (cause.code === 'ENOENT') {
    return settings.kind === 'docker'
      ? 'Insanity_Loom could not run Docker. Is Docker Desktop installed, running, and on the PATH?'
      : `Insanity_Loom could not find the assistant host program "${settings.hostCommand[0] ?? ''}".`;
  }
  return `The assistant host could not be started: ${cause.message}`;
}

export class Assistant {
  private host: ChildProcess | undefined;
  private connection: acp.ClientSideConnection | undefined;
  private conversationId: string | undefined;
  private replaying = false;
  private agentTitle = 'the assistant';
  private readonly pending = new Map<string, PendingPermission>();
  private nextRequestNumber = 1;
  private readonly recentErrors: string[] = [];
  private readonly log: WriteStream;

  constructor(
    private readonly settings: AssistantSettings,
    private readonly journal: Journal,
    logsFolder: string,
    private readonly emit: Emit,
  ) {
    this.log = createWriteStream(join(logsFolder, HOST_LOG_FILE_NAME), { flags: 'a' });
  }

  private status(state: ConnectionState, detail: string): void {
    this.emit({ type: 'status', state, detail });
  }

  /** Starts the host, shakes hands, and resumes the last conversation (or begins one). */
  async connect(): Promise<void> {
    this.disconnect();
    const place = describePlace(this.settings);
    this.status('connecting', `Connecting to the assistant ${place}…`);

    const { program, args, cwd } = commandLine(this.settings);
    const host = spawn(program, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.host = host;
    this.recentErrors.length = 0;

    host.stderr.setEncoding('utf8');
    host.stderr.on('data', (chunk: string) => {
      this.log.write(chunk);
      for (const line of chunk.split('\n')) {
        if (line.trim() === '') continue;
        this.recentErrors.push(line.trim());
        if (this.recentErrors.length > REMEMBERED_ERROR_LINES) this.recentErrors.shift();
      }
    });

    // The host may fail to start, or stop at any time; either ends the connection.
    const lost = new Promise<never>((_resolve, reject) => {
      host.once('error', (cause) => reject(new Error(explainStartFailure(this.settings, cause))));
      host.once('exit', (code) => {
        const last = this.recentErrors.at(-1);
        reject(new Error(`The assistant host stopped (exit code ${code ?? 'none'}).${last === undefined ? '' : `\n${last}`}`));
      });
    });
    lost.catch((cause: unknown) => {
      if (this.host !== host) return;
      this.dropConnection();
      this.status('failed', cause instanceof Error ? cause.message : String(cause));
    });

    const stream = acp.ndJsonStream(
      Writable.toWeb(host.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(host.stdout) as ReadableStream<Uint8Array>,
    );
    const connection = new acp.ClientSideConnection(() => this.client(), stream);
    this.connection = connection;

    let timer: NodeJS.Timeout | undefined;
    const tooSlow = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`The assistant ${place} did not answer within ${HANDSHAKE_TIME_LIMIT_MS / 1000} seconds.`)),
        HANDSHAKE_TIME_LIMIT_MS,
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
      this.agentTitle = greeting.agentInfo?.title ?? greeting.agentInfo?.name ?? 'the assistant';
    } catch (cause) {
      this.disconnect();
      this.status('failed', cause instanceof Error ? cause.message : String(cause));
      return;
    } finally {
      clearTimeout(timer);
    }

    this.status('connected', `Connected to ${this.agentTitle} ${place}.`);
    const last = this.journal.loadConversationId();
    if (last === undefined) await this.startConversation();
    else await this.resumeConversation(last);
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

  private requireConnection(): { connection: acp.ClientSideConnection; conversationId: string } {
    if (this.connection === undefined || this.conversationId === undefined) {
      throw new Error('Insanity_Loom is not connected to the assistant. Use Assistant ▸ Reconnect.');
    }
    return { connection: this.connection, conversationId: this.conversationId };
  }

  async startConversation(): Promise<void> {
    if (this.connection === undefined) throw new Error('Insanity_Loom is not connected to the assistant.');
    const created = await this.connection.newSession({ cwd: this.settings.workingFolder, mcpServers: [] });
    this.conversationId = created.sessionId;
    this.journal.saveConversationId(created.sessionId);
    this.emit({ type: 'conversation', id: created.sessionId, title: 'New conversation', replaying: false });
  }

  async resumeConversation(id: string): Promise<void> {
    if (this.connection === undefined) throw new Error('Insanity_Loom is not connected to the assistant.');
    this.cancelPendingPermissions();
    // The conversation's history arrives as updates while the resume is in progress; it is shown as it comes.
    this.conversationId = id;
    this.replaying = true;
    this.emit({ type: 'conversation', id, title: 'Resumed conversation', replaying: true });
    try {
      await this.connection.loadSession({ sessionId: id, cwd: this.settings.workingFolder, mcpServers: [] });
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
    if (this.connection === undefined) throw new Error('Insanity_Loom is not connected to the assistant.');
    const found: ConversationSummary[] = [];
    let cursor: string | null | undefined;
    for (let page = 0; page < MOST_LIST_PAGES && found.length < MOST_CONVERSATIONS_LISTED; page++) {
      const listed = await this.connection.listSessions({ cwd: this.settings.workingFolder, cursor: cursor ?? null });
      for (const session of listed.sessions) {
        found.push({ id: session.sessionId, title: session.title ?? 'Untitled conversation', updatedAt: session.updatedAt ?? '' });
      }
      cursor = listed.nextCursor;
      if (cursor === undefined || cursor === null) break;
    }
    return found.slice(0, MOST_CONVERSATIONS_LISTED);
  }

  async send(text: string): Promise<void> {
    const { connection, conversationId } = this.requireConnection();
    try {
      const result = await connection.prompt({ sessionId: conversationId, prompt: [{ type: 'text', text }] });
      this.emit({ type: 'replyFinished', reason: result.stopReason });
    } catch (cause) {
      this.emit({ type: 'problem', message: cause instanceof Error ? cause.message : String(cause) });
      this.emit({ type: 'replyFinished', reason: 'error' });
    }
  }

  async stop(): Promise<void> {
    const { connection, conversationId } = this.requireConnection();
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
    this.connection = undefined;
    this.conversationId = undefined;
    this.replaying = false;
    this.host = undefined;
  }

  /** Ends the connection and stops the host. Closing the host's input is what tells it to finish. */
  disconnect(): void {
    const host = this.host;
    this.dropConnection();
    if (host !== undefined) {
      host.stdin?.end();
      host.kill();
    }
  }
}
