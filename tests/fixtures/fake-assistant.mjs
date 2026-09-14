// A stand-in assistant for the end-to-end tests: it speaks the Agent Client Protocol exactly as a real one does, but
// answers predictably and costs nothing. Run by Insanity_Loom as a "local" assistant host (tests/e2e/conversation.spec.ts).
//
// What it does with what it is sent:
// - anything: replies "You wrote: <text>", in several pieces, as a real reply streams;
// - text containing "permission": asks permission first, and replies with the choice made;
// - text containing "slow": keeps writing until it is stopped.
//
// Signing in: started with `--auth-file <file>`, it needs signing in before it will talk, and offers a "terminal"
// sign-in method, as Claude's adapter does. That method runs this same program with `--login` added: it prints a
// sign-in page's address, asks for a code, and accepts only "good-code", marking the file signed in.

import * as acp from '@agentclientprotocol/sdk';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Readable, Writable } from 'node:stream';

const SIGNED_IN = 'signed-in';
const GOOD_CODE = 'good-code';
const argumentAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
};
const authFile = argumentAfter('--auth-file');
const signedIn = () => authFile === undefined || (existsSync(authFile) && readFileSync(authFile, 'utf8') === SIGNED_IN);

if (process.argv.includes('--login')) {
  // The sign-in program, as Claude's own prints it.
  process.stdout.write("Opening browser to sign in…\nIf the browser didn't open, visit: https://claude.com/fake/oauth/authorize?code=true&state=fake\n");
  process.stdout.write('Paste code here if prompted > ');
  const lines = createInterface({ input: process.stdin });
  lines.once('line', (code) => {
    if (code.trim() === GOOD_CODE && authFile !== undefined) {
      writeFileSync(authFile, SIGNED_IN);
      process.stdout.write('\nLogin successful.\n');
      process.exit(0);
    }
    process.stdout.write('\nInvalid code.\n');
    process.exit(1);
  });
} else {
  startAgent();
}

function startAgent() {
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
      const mustSignIn = () => {
        if (!signedIn()) throw acp.RequestError.authRequired(undefined, 'Not logged in · Please run /login');
      };
      const reportAccount = () =>
        client.extNotification('_auth/status_update', {
          authStatus: signedIn() ? { kind: 'subscription', label: 'Fake Plan', detail: 'author@example.com' } : { kind: 'none', label: 'Not logged in' },
        });
      const say = (sessionId, text) =>
        client.sessionUpdate({ sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } });

      return {
        initialize: ({ clientCapabilities }) => {
          setTimeout(() => void reportAccount(), 0);
          const offersTerminal = authFile !== undefined && clientCapabilities?.auth?.terminal === true;
          return {
            protocolVersion: acp.PROTOCOL_VERSION,
            agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} }, auth: { logout: {} } },
            agentInfo: { name: 'fake-assistant', title: 'Fake Assistant', version: '1.0.0' },
            authMethods: offersTerminal
              ? [{ id: 'fake-login', name: 'Fake Account', description: 'Sign in to the fake account', type: 'terminal', args: ['--login'] }]
              : [],
          };
        },
        authenticate: () => ({}),
        logout: async () => {
          if (authFile !== undefined) rmSync(authFile, { force: true });
          await reportAccount();
          return {};
        },
        newSession: () => {
          mustSignIn();
          return { sessionId: `fake-conversation-${++conversationNumber}` };
        },
        listSessions: ({ cwd }) => ({
          sessions: [{ sessionId: 'fake-earlier', cwd, title: 'An earlier conversation', updatedAt: '2026-09-13T12:00:00Z' }],
        }),
        loadSession: async ({ sessionId }) => {
          mustSignIn();
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
}
