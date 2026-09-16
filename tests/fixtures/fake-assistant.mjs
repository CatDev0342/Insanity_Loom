// A stand-in assistant for the end-to-end tests: it speaks the Agent Client Protocol exactly as a real one does, but
// answers predictably and costs nothing. Run by Insanity_Loom as a "local" assistant host (tests/e2e/conversation.spec.ts).
//
// What it does with what it is sent:
// - anything: thinks aloud, replies "You wrote: <text>" in several pieces as a real reply streams, and says how full
//   its context window is afterwards;
// - "/compact": makes room, reporting it as a compaction rather than a reply;
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

// The JSON-RPC code for a failure on the agent's own side, which is how an agent reports a full context window.
const INTERNAL_ERROR_CODE = -32603;

const SIGNED_IN = 'signed-in';
const GOOD_CODE = 'good-code';
const argumentAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
};
const authFile = argumentAfter('--auth-file');
// How many exchanges a resumed conversation replays: one by default. More of them stand for things said while
// Insanity_Loom was not open, which it should catch up with.
const historyExchanges = Number(argumentAfter('--history') ?? 1);
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
  /** The settings it offers for a conversation, as Claude's adapter offers a model and a thinking level. */
  const settings = {
    model: 'fake-opus',
    thinking: 'medium',
  };
  const configOptions = () => [
    {
      type: 'select',
      id: 'model',
      name: 'Model',
      category: 'model',
      currentValue: settings.model,
      options: [
        { value: 'fake-opus', name: 'Fake Opus', description: 'The thorough one' },
        { value: 'fake-haiku', name: 'Fake Haiku', description: 'The quick one' },
      ],
    },
    {
      type: 'select',
      id: 'effort',
      name: 'Thinking',
      category: 'thought_level',
      currentValue: settings.thinking,
      options: [
        { value: 'low', name: 'Low' },
        { value: 'medium', name: 'Medium' },
        { value: 'high', name: 'High' },
      ],
    },
  ];
  /** The conversations with a turn being answered right now: only those can be steered. */
  const turnsRunning = new Set();
  /** The conversations a steered message has just gone into, so what was being written gives way to it. */
  const steered = new Set();

  // The ways of working it offers, as Claude's adapter does: asking every time, or deciding by itself.
  const MODES = {
    currentModeId: 'default',
    availableModes: [
      { id: 'default', name: 'Manual', description: 'Always ask before making changes' },
      { id: 'auto', name: 'Auto', description: 'The assistant decides' },
    ],
  };
  let currentMode = 'default';
  const modeState = () => ({ ...MODES, currentModeId: currentMode });

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
      const think = (sessionId, text) =>
        client.sessionUpdate({ sessionId, update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text } } });
      // How full its context window is. It fills as the conversation goes on, as a real one does.
      const CONTEXT_SIZE = 200_000;
      const CONTEXT_PER_TURN = 20_000;
      let contextUsed = 0;
      // Set once room has been made, so a conversation that was too long fits on the next try.
      let roomHasBeenMade = false;
      // Set when the host is told to go quiet: it goes on running and answers nothing at all, which is what a
      // container suspended while the author was away looks like from outside.
      let goneQuiet = false;
      const answerNothing = () => new Promise(() => undefined);
      const reportContext = (sessionId) =>
        client.sessionUpdate({ sessionId, update: { sessionUpdate: 'usage_update', used: contextUsed, size: CONTEXT_SIZE } });
      const offerCommands = (sessionId) =>
        client.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: 'available_commands_update',
            availableCommands: [{ name: 'compact', description: 'Make room in the context window' }],
          },
        });

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
            // Steering, as Claude's own adapter advertises it: a client may put a turn into the one already running.
            // Told not to, it says nothing about it, which is how a client learns it must queue instead.
            _meta: process.argv.includes('--no-steering') ? {} : { steering: { supported: true } },
          };
        },
        // The steering extension: the message goes into the turn already running, and is answered inside it.
        extMethod: async (method, params) => {
          if (method !== '_session/steering') throw new Error(`No such method: ${method}`);
          const sessionId = params.sessionId;
          const text = (params.prompt ?? []).map((block) => (block.type === 'text' ? block.text : '')).join('');
          // Nothing is running: the host asked to be told so, rather than have a turn begun behind its back.
          if (!turnsRunning.has(sessionId)) return { outcome: 'promptRequired', reason: 'noRunningTurn' };
          steered.add(sessionId);
          await say(sessionId, `Steered: ${text}`);
          return { outcome: 'injected' };
        },
        authenticate: () => ({}),
        logout: async () => {
          if (authFile !== undefined) rmSync(authFile, { force: true });
          await reportAccount();
          return {};
        },
        newSession: () => {
          mustSignIn();
          const sessionId = `fake-conversation-${++conversationNumber}`;
          // What it offers to be asked to do, as Claude's adapter does once a session is open.
          setTimeout(() => void offerCommands(sessionId), 0);
          return { sessionId, modes: modeState(), configOptions: configOptions() };
        },
        setSessionConfigOption: ({ configId, value }) => {
          if (configId === 'model') settings.model = value;
          else if (configId === 'effort') settings.thinking = value;
          else throw new Error(`Unknown config option: ${configId}`);
          // The quick model does not think hard, so choosing it changes the other setting too — as a real one does.
          if (settings.model === 'fake-haiku') settings.thinking = 'low';
          return { configOptions: configOptions() };
        },
        setSessionMode: async ({ sessionId, modeId }) => {
          currentMode = modeId;
          await client.sessionUpdate({ sessionId, update: { sessionUpdate: 'current_mode_update', currentModeId: modeId } });
          return {};
        },
        listSessions: ({ cwd }) =>
          goneQuiet
            ? answerNothing()
            : { sessions: [{ sessionId: 'fake-earlier', cwd, title: 'An earlier conversation', updatedAt: '2026-09-13T12:00:00Z' }] },
        loadSession: async ({ sessionId }) => {
          mustSignIn();
          // Told to be quiet about history, it answers nothing — and goes on answering nothing however many times
          // the connection is made again, which is what a suspended container does.
          if (process.argv.includes('--quiet-history')) return await answerNothing();
          for (let exchange = 1; exchange <= historyExchanges; exchange++) {
            const question = exchange === 1 ? 'An earlier question' : `Question ${exchange}`;
            const answer = exchange === 1 ? 'An earlier answer' : `Answer ${exchange}`;
            await client.sessionUpdate({
              sessionId,
              update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: question } },
            });
            await say(sessionId, answer);
          }
          setTimeout(() => void offerCommands(sessionId), 0);
          return { modes: modeState(), configOptions: configOptions() };
        },
        cancel: ({ sessionId }) => {
          cancelled.add(sessionId);
        },
        prompt: async ({ sessionId, prompt }) => {
          cancelled.delete(sessionId);
          turnsRunning.add(sessionId);
          try {
            return await answerTheTurn(sessionId, prompt);
          } finally {
            turnsRunning.delete(sessionId);
          }
        },
      };

      /** What one turn is answered with. Kept apart so a turn can be known to be running while it is answered. */
      async function answerTheTurn(sessionId, prompt) {
          const text = prompt.map((block) => (block.type === 'text' ? block.text : '')).join('');

          if (text.trim() === '/compact') {
            // Told to be quiet while making room, it says it has begun and then answers nothing at all: the shape of
            // a host that suspends mid-compaction.
            if (process.argv.includes('--quiet-compaction')) {
              await client.sessionUpdate({
                sessionId,
                update: { sessionUpdate: 'compaction_update', compactionId: 'fake-compaction', status: 'in_progress' },
              });
              goneQuiet = true;
              return await answerNothing();
            }
            // Making room is not a reply: it is reported as a compaction, with a summary of what was kept.
            await client.sessionUpdate({
              sessionId,
              update: { sessionUpdate: 'compaction_update', compactionId: 'fake-compaction', status: 'in_progress' },
            });
            await wait(PIECE_INTERVAL_MS);
            contextUsed = Math.round(contextUsed / 4);
            roomHasBeenMade = true;
            await client.sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: 'compaction_update',
                compactionId: 'fake-compaction',
                status: 'completed',
                summary: [{ type: 'text', text: 'Kept what mattered.' }],
              },
            });
            await reportContext(sessionId);
            return { stopReason: 'end_turn' };
          }

          if (text.includes('too long')) {
            // A conversation that no longer fits: refused once, and answered when room has been made.
            // Reported the way an agent reports it: a protocol error carrying the reason, not a crash.
            if (!roomHasBeenMade) throw new acp.RequestError(INTERNAL_ERROR_CODE, 'Prompt is too long');
            await say(sessionId, 'Answered once there was room.');
            return { stopReason: 'end_turn' };
          }

          if (text.includes('go quiet')) {
            goneQuiet = true;
            return await answerNothing();
          }

          await think(sessionId, `Thinking about what to say to: ${text}`);

          if (text.includes('speak later')) {
            // Something other than the author prompts it: a task it was set, finishing after the turn is over.
            setTimeout(() => {
              void say(sessionId, 'A word nobody asked for.');
            }, PIECE_INTERVAL_MS * 4);
          }

          if (text.includes('permission') && currentMode === 'auto') {
            // Deciding by itself: nothing is asked of the author.
            await say(sessionId, 'Permission answer: decided by the assistant');
            return { stopReason: 'end_turn' };
          }

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
              // A steered turn pre-empts what was being written, as the real adapter's `now` priority does — but the
              // turn itself runs on while the steered message is answered, which is the window the client acts in.
              if (steered.has(sessionId)) {
                steered.delete(sessionId);
                await wait(PIECE_INTERVAL_MS * 2);
                return { stopReason: 'end_turn' };
              }
              await say(sessionId, 'still writing… ');
              await wait(PIECE_INTERVAL_MS);
            }
            return { stopReason: 'end_turn' };
          }

          // A conversation gains a title of its own once there is something to name it after, as Claude's does.
          await client.sessionUpdate({ sessionId, update: { sessionUpdate: 'session_info_update', title: 'A named conversation' } });

          for (const piece of ['You ', 'wrote: ', text]) {
            await say(sessionId, piece);
            await wait(PIECE_INTERVAL_MS);
          }
          contextUsed = Math.min(CONTEXT_SIZE, contextUsed + CONTEXT_PER_TURN);
          await reportContext(sessionId);
          return { stopReason: 'end_turn' };
      }
    },
    stream,
  );
}
