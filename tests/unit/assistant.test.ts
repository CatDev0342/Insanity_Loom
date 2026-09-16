// The assistant connection on its own, without a window: it starts the stand-in assistant
// (tests/fixtures/fake-assistant.mjs) as a real host process and speaks the real protocol with it.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Assistant, type ModeMemory } from '../../src/main/assistant';
import { Journal } from '../../src/main/journal';
import type { AssistantEvent } from '../../src/shared/assistant';
import { DEFAULT_CONNECTION } from '../../src/shared/connection';

const FAKE_ASSISTANT = join(__dirname, '..', 'fixtures', 'fake-assistant.mjs');

const running: { assistant: Assistant; folder: string }[] = [];

/**
 * Tidies a folder away, giving Windows time to let go of it. A host that has just been closed may still hold its
 * working folder for a moment, and a test that cannot tidy up is not a test that has failed.
 */
function tidyAway(folder: string): void {
  rmSync(folder, { recursive: true, force: true, maxRetries: TIDYING_TRIES, retryDelay: TIDYING_WAIT_MS });
}

/** How many times, and how long apart, tidying is tried before it is given up on. */
const TIDYING_TRIES = 10;
const TIDYING_WAIT_MS = 50;

afterEach(async () => {
  for (const { assistant, folder } of running.splice(0)) {
    await assistant.close();
    try {
      tidyAway(folder);
    } catch {
      // A folder the machine will not let go of is the machine's business, not this test's.
    }
  }
});

function start(
  hostCommand: string[] = [process.execPath, FAKE_ASSISTANT],
  memory: ModeMemory = { assistantMode: '', setAssistantMode: () => undefined },
  quietSeconds?: number,
): { assistant: Assistant; events: AssistantEvent[]; folder: string } {
  const folder = mkdtempSync(join(tmpdir(), 'insanity-loom-'));
  const events: AssistantEvent[] = [];
  const assistant = new Assistant(
    {
      ...DEFAULT_CONNECTION,
      place: 'local',
      workingFolder: folder,
      hostProgram: hostCommand[0] ?? '',
      hostArguments: hostCommand.slice(1),
    },
    new Journal(folder),
    folder,
    (event) => events.push(event),
    memory,
    quietSeconds,
  );
  running.push({ assistant, folder });
  return { assistant, events, folder };
}

const replyText = (events: AssistantEvent[]): string =>
  events.flatMap((event) => (event.type === 'replyText' ? [event.text] : [])).join('');

/**
 * The last event of one kind. The assistant says several things at once when a conversation opens — its ways of
 * working, what it offers to be asked to do, how full it is — and which lands last is not ours to say.
 */
function lastOfType(events: readonly AssistantEvent[], type: AssistantEvent['type']): AssistantEvent | undefined {
  return [...events].reverse().find((event) => event.type === type);
}

describe('the assistant connection', () => {
  it('connects, begins a conversation, and streams a reply', async () => {
    const { assistant, events } = start();
    await assistant.connect();
    expect(events).toContainEqual({ type: 'status', state: 'connected', detail: 'Connected to Fake Assistant on this computer.' });
    expect(events.some((event) => event.type === 'conversation' && !event.replaying)).toBe(true);

    await assistant.send('a small thought');
    expect(replyText(events)).toBe('You wrote: a small thought');
    expect(events.at(-1)).toEqual({ type: 'replyFinished', reason: 'end_turn' });
  });

  it('passes a permission request to the author and their answer back', async () => {
    const { assistant, events } = start();
    await assistant.connect();
    const sending = assistant.send('ask permission please');
    await expect.poll(() => events.find((event) => event.type === 'permission')).toBeDefined();
    const request = events.find((event) => event.type === 'permission');
    if (request?.type !== 'permission') throw new Error('No permission request arrived.');
    expect(request.choices.map((choice) => choice.name)).toEqual(['Allow once', 'Reject']);
    expect(() => assistant.answerPermission(request.requestId, 'not-offered')).toThrow(/not one of the choices/);
    assistant.answerPermission(request.requestId, 'no');
    await sending;
    expect(replyText(events)).toBe('Permission answer: no');
  });

  it('stops a reply when asked', async () => {
    const { assistant, events } = start();
    await assistant.connect();
    const sending = assistant.send('something slow');
    await expect.poll(() => replyText(events)).toContain('still writing');
    await assistant.stop();
    await sending;
    expect(events.at(-1)).toEqual({ type: 'replyFinished', reason: 'cancelled' });
  });

  it('resumes the last conversation on the next connection, replaying its history', async () => {
    const { assistant, events } = start();
    await assistant.connect();
    events.length = 0;
    await assistant.connect();
    expect(events).toContainEqual({ type: 'authorText', text: 'An earlier question' });
    expect(replyText(events)).toBe('An earlier answer');
    expect(events).toContainEqual({ type: 'replayFinished' });
  });

  it('tests settings without connecting', async () => {
    const { assistant, events } = start();
    const folder = mkdtempSync(join(tmpdir(), 'insanity-loom-'));
    const answer = await assistant.test({
      ...DEFAULT_CONNECTION,
      place: 'local',
      workingFolder: folder,
      hostProgram: process.execPath,
      hostArguments: [FAKE_ASSISTANT],
    });
    rmSync(folder, { recursive: true, force: true });
    expect(answer).toBe('Fake Assistant answered on this computer.');
    expect(events).toEqual([]);
  });

  it('says when the assistant needs signing in, and signs in with the code from the sign-in page', async () => {
    const authFolder = mkdtempSync(join(tmpdir(), 'insanity-loom-'));
    const { assistant, events } = start([process.execPath, FAKE_ASSISTANT, '--auth-file', join(authFolder, 'auth.txt')]);
    await assistant.connect();
    expect(events.at(-1)).toEqual({ type: 'signInNeeded', methods: [{ id: 'fake-login', name: 'Fake Account', description: 'Sign in to the fake account' }] });
    expect(events.some((event) => event.type === 'status' && event.state === 'signedOut')).toBe(true);

    await assistant.signIn('fake-login');
    await expect.poll(() => events.find((event) => event.type === 'signIn' && event.stage === 'page')).toBeDefined();
    const page = events.find((event) => event.type === 'signIn' && event.stage === 'page');
    expect(page?.type === 'signIn' && page.url).toBe('https://claude.com/fake/oauth/authorize?code=true&state=fake');

    assistant.sendSignInCode('good-code');
    await expect.poll(() => events.some((event) => event.type === 'signIn' && event.stage === 'finished')).toBe(true);
    // Signed in, it connects again and the conversation begins.
    await expect.poll(() => events.some((event) => event.type === 'conversation')).toBe(true);
    await expect.poll(() => events.find((event) => event.type === 'account' && event.label === 'Fake Plan')).toBeDefined();
    tidyAway(authFolder);
  });

  it('reports a sign-in that fails', async () => {
    const authFolder = mkdtempSync(join(tmpdir(), 'insanity-loom-'));
    const { assistant, events } = start([process.execPath, FAKE_ASSISTANT, '--auth-file', join(authFolder, 'auth.txt')]);
    await assistant.connect();
    await assistant.signIn('fake-login');
    await expect.poll(() => events.some((event) => event.type === 'signIn' && event.stage === 'page')).toBe(true);
    assistant.sendSignInCode('wrong-code');
    await expect.poll(() => events.find((event) => event.type === 'signIn' && event.stage === 'failed')).toBeDefined();
    const failed = events.find((event) => event.type === 'signIn' && event.stage === 'failed');
    expect(failed?.type === 'signIn' && failed.message).toMatch(/did not complete[\s\S]*Invalid code/);
    tidyAway(authFolder);
  });

  it('refuses to type anything but a single-line code into the sign-in', () => {
    const { assistant } = start();
    expect(() => assistant.sendSignInCode('code')).toThrow(/No sign-in is waiting/);
  });

  it('offers the assistant\'s ways of working, and remembers the one chosen', async () => {
    const remembered: string[] = [];
    const { assistant, events } = start(undefined, { assistantMode: '', setAssistantMode: (mode) => remembered.push(mode) });
    await assistant.connect();
    expect(events).toContainEqual({
      type: 'modes',
      current: 'default',
      modes: [
        { id: 'default', name: 'Manual', description: 'Always ask before making changes' },
        { id: 'auto', name: 'Auto', description: 'The assistant decides' },
      ],
    });

    await assistant.setMode('auto');
    expect(remembered).toEqual(['auto']);
    expect(lastOfType(events, 'modes')).toMatchObject({ type: 'modes', current: 'auto' });
    await expect(assistant.setMode('no-such-mode')).rejects.toThrow(/no way of working called/);
  });

  it('puts the remembered way of working back in use for a new conversation', async () => {
    const { assistant, events } = start(undefined, { assistantMode: 'auto', setAssistantMode: () => undefined });
    await assistant.connect();
    expect(lastOfType(events, 'modes')).toMatchObject({ type: 'modes', current: 'auto' });
  });

  it('lists earlier conversations', async () => {
    const { assistant } = start();
    await assistant.connect();
    expect(await assistant.listConversations()).toEqual([
      { id: 'fake-earlier', title: 'An earlier conversation', updatedAt: '2026-09-13T12:00:00Z' },
    ]);
  });

  it('says plainly when the host cannot be started', async () => {
    const { assistant, events } = start(['/no/such/program']);
    await assistant.connect();
    const last = events.at(-1);
    expect(last?.type === 'status' && last.state).toBe('failed');
    expect(last?.type === 'status' && last.detail).toMatch(/could not find the assistant host program/);
  });
});

describe('when a turn cannot get through', () => {
  it('makes room and sends the same words again, rather than losing them', async () => {
    const { assistant, events } = start();
    await assistant.connect();
    await assistant.send('a conversation grown too long');

    // The author is told what is happening, in words about the conversation and not about their writing.
    const said = events.flatMap((event) => (event.type === 'problem' ? [event.message] : []));
    expect(said.some((message) => message.includes('Room is being made'))).toBe(true);
    expect(said.some((message) => message.includes('Prompt is too long'))).toBe(false);
    // And the turn was answered on the second try, with no help from the author.
    expect(replyText(events)).toContain('Answered once there was room.');
    expect(lastOfType(events, 'replyFinished')).toEqual({ type: 'replyFinished', reason: 'end_turn' });
  });

  it('notices a host that has gone quiet, and connects again instead of waiting forever', async () => {
    // A second of silence rather than three quarters of a minute: the same watch, wound tighter.
    const { assistant, events } = start(undefined, undefined, 1);
    await assistant.connect();
    const sent = assistant.send('go quiet now');
    // The send never comes back on its own — that is the bug. What must come back is the program.
    await Promise.race([sent, new Promise((resolve) => setTimeout(resolve, QUIET_ENOUGH_MS))]);

    const said = events.flatMap((event) => (event.type === 'problem' ? [event.message] : []));
    expect(said.some((message) => message.includes('stopped answering'))).toBe(true);
    // The turn is ended, so the page is free to send it again; and the connection is being made afresh.
    expect(events.some((event) => event.type === 'replyFinished' && event.reason === 'error')).toBe(true);
    expect(events.some((event) => event.type === 'status' && event.state === 'connecting')).toBe(true);
  }, LONG_ENOUGH_FOR_A_QUIET_HOST_MS);


  it('watches the conversation being brought back, not only a turn', async () => {
    // A host that never answers about history. The conversation to resume is remembered, so every fresh connection
    // asks again and is answered with the same silence — the one way this could go round forever.
    const { assistant, events, folder } = start([process.execPath, FAKE_ASSISTANT, '--quiet-history'], undefined, 1);
    new Journal(folder).saveConversationId('fake-earlier');
    // Not raced: connecting resolves each time, and it is the rounds after it that this is about.
    void assistant.connect();
    await new Promise((resolve) => setTimeout(resolve, GIVING_UP_MS));

    // The page is freed rather than left waiting on a history that is not coming.
    expect(events.some((event) => event.type === 'replayFinished')).toBe(true);
    const said = events.flatMap((event) => (event.type === 'problem' ? [event.message] : []));
    expect(said.some((message) => message.includes('brought back'))).toBe(true);
    // And each round takes the best part of a minute and says the same thing, so it is left to the author.
    const last = lastOfType(events, 'status');
    expect(last).toMatchObject({ state: 'failed' });
    expect(last).toMatchObject({ detail: expect.stringContaining('Assistant ▸ Reconnect') });
  }, LONG_ENOUGH_TO_GIVE_UP_MS);
});

describe('making room can hold the channel open too', () => {
  it('notices a host that goes quiet while making room, instead of saying so forever', async () => {
    const { assistant, events } = start([process.execPath, FAKE_ASSISTANT, '--quiet-compaction'], undefined, 1);
    await assistant.connect();
    const making = assistant.compact();
    // As with a turn, the request never comes back on its own; what must come back is the program.
    await Promise.race([making, new Promise((resolve) => setTimeout(resolve, QUIET_ENOUGH_MS))]);

    const said = events.flatMap((event) => (event.type === 'problem' ? [event.message] : []));
    expect(said.some((message) => message.includes('making room'))).toBe(true);
    // The status bar is not left saying room is being made.
    expect(events.some((event) => event.type === 'compacting' && event.status === 'failed')).toBe(true);
  }, LONG_ENOUGH_FOR_A_QUIET_HOST_MS);
});

/** Long enough for a one-second watch to run out and for the check after it to go unanswered. */
const QUIET_ENOUGH_MS = 20_000;
const LONG_ENOUGH_FOR_A_QUIET_HOST_MS = 40_000;
/** Three rounds of the same silence: quiet, check, connect again, and again, until it is left to the author. */
const GIVING_UP_MS = 45_000;
const LONG_ENOUGH_TO_GIVE_UP_MS = 120_000;
