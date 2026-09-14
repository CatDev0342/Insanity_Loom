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
afterEach(async () => {
  for (const { assistant, folder } of running.splice(0)) {
    await assistant.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

function start(
  hostCommand: string[] = [process.execPath, FAKE_ASSISTANT],
  memory: ModeMemory = { assistantMode: '', setAssistantMode: () => undefined },
): { assistant: Assistant; events: AssistantEvent[] } {
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
  );
  running.push({ assistant, folder });
  return { assistant, events };
}

const replyText = (events: AssistantEvent[]): string =>
  events.flatMap((event) => (event.type === 'replyText' ? [event.text] : [])).join('');

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
    rmSync(authFolder, { recursive: true, force: true });
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
    rmSync(authFolder, { recursive: true, force: true });
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
    expect(events.at(-1)).toMatchObject({ type: 'modes', current: 'auto' });
    await expect(assistant.setMode('no-such-mode')).rejects.toThrow(/no way of working called/);
  });

  it('puts the remembered way of working back in use for a new conversation', async () => {
    const { assistant, events } = start(undefined, { assistantMode: 'auto', setAssistantMode: () => undefined });
    await assistant.connect();
    expect(events.at(-1)).toMatchObject({ type: 'modes', current: 'auto' });
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
