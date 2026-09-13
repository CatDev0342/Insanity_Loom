// The assistant connection on its own, without a window: it starts the stand-in assistant
// (tests/fixtures/fake-assistant.mjs) as a real host process and speaks the real protocol with it.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Assistant } from '../../src/main/assistant';
import { Journal } from '../../src/main/journal';
import type { AssistantEvent } from '../../src/shared/assistant';

const FAKE_ASSISTANT = join(__dirname, '..', 'fixtures', 'fake-assistant.mjs');

const running: { assistant: Assistant; folder: string }[] = [];
afterEach(async () => {
  for (const { assistant, folder } of running.splice(0)) {
    await assistant.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

function start(hostCommand: string[] = [process.execPath, FAKE_ASSISTANT]): { assistant: Assistant; events: AssistantEvent[] } {
  const folder = mkdtempSync(join(tmpdir(), 'insanity-loom-'));
  const events: AssistantEvent[] = [];
  const assistant = new Assistant(
    { kind: 'local', workingFolder: folder, hostCommand },
    new Journal(folder),
    folder,
    (event) => events.push(event),
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
    expect(events.at(-1)).toEqual({ type: 'replayFinished' });
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
