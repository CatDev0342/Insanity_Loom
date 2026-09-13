// A stand-in assistant for the end-to-end tests: it speaks the Agent Client Protocol exactly as a real one does, but
// answers predictably and costs nothing. Run by Insanity_Loom as a "local" assistant host (tests/e2e/conversation.spec.ts).
//
// What it does with what it is sent:
// - anything: replies "You wrote: <text>", in several pieces, as a real reply streams;
// - text containing "permission": asks permission first, and replies with the choice made;
// - text containing "slow": keeps writing until it is stopped.

import * as acp from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';

// How long between the pieces of a streamed reply, in milliseconds: long enough to be seen streaming, short enough
// to keep the tests quick. A "slow" reply is given this many pieces at most before it gives up by itself.
const PIECE_INTERVAL_MS = 30;
const SLOW_PIECES_LIMIT = 500;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let conversationNumber = 0;
const cancelled = new Set();

const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));

new acp.AgentSideConnection(
  (client) => {
    const say = (sessionId, text) =>
      client.sessionUpdate({ sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } });

    return {
      initialize: () => ({
        protocolVersion: acp.PROTOCOL_VERSION,
        agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} } },
        agentInfo: { name: 'fake-assistant', title: 'Fake Assistant', version: '1.0.0' },
        authMethods: [],
      }),
      authenticate: () => ({}),
      newSession: () => ({ sessionId: `fake-conversation-${++conversationNumber}` }),
      listSessions: ({ cwd }) => ({
        sessions: [{ sessionId: 'fake-earlier', cwd, title: 'An earlier conversation', updatedAt: '2026-09-13T12:00:00Z' }],
      }),
      loadSession: async ({ sessionId }) => {
        await client.sessionUpdate({
          sessionId,
          update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'An earlier question' } },
        });
        await say(sessionId, 'An earlier answer');
        return {};
      },
      cancel: ({ sessionId }) => {
        cancelled.add(sessionId);
      },
      prompt: async ({ sessionId, prompt }) => {
        cancelled.delete(sessionId);
        const text = prompt.map((block) => (block.type === 'text' ? block.text : '')).join('');

        if (text.includes('permission')) {
          const answer = await client.requestPermission({
            sessionId,
            toolCall: { toolCallId: 'fake-tool', title: 'Write a file called notes.txt' },
            options: [
              { optionId: 'yes', name: 'Allow once', kind: 'allow_once' },
              { optionId: 'no', name: 'Reject', kind: 'reject_once' },
            ],
          });
          const chosen = answer.outcome.outcome === 'selected' ? answer.outcome.optionId : 'nothing';
          await say(sessionId, `Permission answer: ${chosen}`);
          return { stopReason: 'end_turn' };
        }

        if (text.includes('slow')) {
          for (let piece = 0; piece < SLOW_PIECES_LIMIT; piece++) {
            if (cancelled.has(sessionId)) return { stopReason: 'cancelled' };
            await say(sessionId, 'still writing… ');
            await wait(PIECE_INTERVAL_MS);
          }
          return { stopReason: 'end_turn' };
        }

        for (const piece of ['You ', 'wrote: ', text]) {
          await say(sessionId, piece);
          await wait(PIECE_INTERVAL_MS);
        }
        return { stopReason: 'end_turn' };
      },
    };
  },
  stream,
);
