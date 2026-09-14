// @vitest-environment happy-dom
// What the three panels say: how much room is left in the assistant's context window, what the whisper points at and
// what points here, and where the assistant's thinking is kept.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeRoom, inThousands } from '../../src/renderer/src/loom/context-room';
import { COMMANDS_TAB, Thoughts } from '../../src/renderer/src/loom/thoughts';
import { whereabouts } from '../../src/renderer/src/loom/navigation';
import { WhisperEditor } from '../../src/renderer/src/document/whisper-editor';
import type { WhispersBridge } from '../../src/shared/whispers';

const open: WhisperEditor[] = [];

function whisper(html: string): WhisperEditor {
  const element = document.createElement('div');
  document.body.append(element);
  const made = new WhisperEditor({
    element,
    html,
    onSectionFinished: () => undefined, onNothingToSend: () => undefined,
    onChange: () => undefined,
    onFollowLink: () => undefined,
  });
  open.push(made);
  return made;
}

afterEach(() => {
  for (const made of open.splice(0)) made.editor.destroy();
  document.body.replaceChildren();
});

describe('the room left in the context window', () => {
  it('says how much is in use, in the thousands every tool counts in', () => {
    expect(inThousands(820)).toBe('820');
    expect(inThousands(124_000)).toBe('124k');
    const room = describeRoom(124_000, 200_000);
    expect(room.said).toBe('62% of context · 124k of 200k');
    expect(room.little).toBe(false);
  });

  it('says plainly when there is little room left', () => {
    expect(describeRoom(185_000, 200_000).little).toBe(true);
    expect(describeRoom(100, 200_000).little).toBe(false);
  });

  it('says nothing at all until the assistant says how big its window is', () => {
    expect(describeRoom(0, 0).said).toBe('');
  });
});

describe("where the assistant's thinking is kept", () => {
  function panel(): {
    readonly thoughts: Thoughts;
    readonly written: { path: string; text: string }[];
    readonly stream: HTMLElement;
    readonly commands: HTMLElement;
    readonly news: { tabId: string; howMuch: number }[];
  } {
    const thoughtsPanel = document.createElement('div');
    const thoughtsStream = document.createElement('div');
    const thoughtsSaid = document.createElement('p');
    const commandsStream = document.createElement('div');
    const commandsSaid = document.createElement('p');
    thoughtsPanel.append(thoughtsStream);
    document.body.append(thoughtsPanel, thoughtsSaid, commandsStream, commandsSaid);
    const written: { path: string; text: string }[] = [];
    const news: { tabId: string; howMuch: number }[] = [];
    const whispers = {
      addThought: async (path: string, text: string) => {
        written.push({ path, text });
        return Promise.resolve();
      },
    } as unknown as WhispersBridge;
    const thoughts = new Thoughts(
      { thoughtsPanel, thoughtsStream, thoughtsSaid, commandsStream, commandsSaid },
      whispers,
      () => undefined,
      (tabId, howMuch) => news.push({ tabId, howMuch }),
    );
    return { thoughts, written, stream: thoughtsStream, commands: commandsStream, news };
  }

  it('shows it beside the whisper and keeps it in the companion document, headed by the turn', () => {
    vi.useFakeTimers();
    const { thoughts, written, stream } = panel();
    thoughts.keepBeside('/alcove/A conversation.xhtml');
    thoughts.beginTurn(3, '14 Sep 2026, 06:12');
    thoughts.add('Thinking about ');
    thoughts.add('the loom.');

    // On the page at once, as it is written.
    expect(stream.textContent).toContain('Turn 3 · 14 Sep 2026, 06:12');
    expect(stream.textContent).toContain('Thinking about the loom.');
    // Written to the companion a moment later, gathered rather than a piece at a time.
    expect(written).toHaveLength(0);
    vi.runAllTimers();
    expect(written).toEqual([
      { path: '/alcove/A conversation.xhtml', text: '\n## Turn 3 · 14 Sep 2026, 06:12\n\nThinking about the loom.' },
    ]);
    vi.useRealTimers();
  });

  it('heads each turn once, and keeps nothing when there is no whisper to keep it beside', () => {
    vi.useFakeTimers();
    const { thoughts, written } = panel();
    thoughts.add('thinking with nowhere to keep it');
    vi.runAllTimers();
    expect(written).toHaveLength(0);

    thoughts.keepBeside('/alcove/A.xhtml');
    thoughts.beginTurn(1, 'now');
    thoughts.add('first');
    vi.runAllTimers();
    thoughts.add('second');
    vi.runAllTimers();
    expect(written.map((piece) => piece.text)).toEqual(['\n## Turn 1 · now\n\nfirst', 'second']);
    vi.useRealTimers();
  });

  it('keeps commands out of the thinking and in a tab of their own', () => {
    vi.useFakeTimers();
    const { thoughts, stream, commands, written } = panel();
    thoughts.keepBeside('/alcove/A.xhtml');
    thoughts.beginTurn(1, 'now');
    thoughts.add('Working out what to do.');
    thoughts.command('one', 'export PATH="$HOME/bin:$PATH"; cd ~/work && npm run check', 'in_progress');

    // The thinking is not crowded out by the command, and the command says the work rather than the getting ready.
    expect(stream.textContent).toContain('Working out what to do.');
    expect(stream.textContent).not.toContain('npm run check');
    expect(commands.textContent).toContain('npm run check');
    expect(commands.textContent).not.toContain('export PATH');
    // The whole command is kept in the companion, and on hover: the record is for looking things up later.
    vi.runAllTimers();
    expect(written.map((piece) => piece.text).join('')).toContain('export PATH="$HOME/bin:$PATH"');
    expect(commands.querySelector('.thought-command')?.getAttribute('title')).toContain('export PATH');
    vi.useRealTimers();
  });

  it('says the same work done again in a row once, with a count', () => {
    const { thoughts, commands } = panel();
    thoughts.keepBeside('/alcove/A.xhtml');
    thoughts.command('one', 'cd ~/work && npm run check', 'completed');
    thoughts.command('two', 'export PATH="/x:$PATH"; npm run check', 'completed');
    thoughts.command('three', 'npm run check', 'completed');

    expect(commands.querySelectorAll('.thought-command')).toHaveLength(1);
    expect(commands.textContent).toContain('× 3');
  });

  it('says how many commands the author has not looked at, and stops once they have', () => {
    const { thoughts, news } = panel();
    thoughts.keepBeside('/alcove/A.xhtml');
    thoughts.command('one', 'npm run check', 'completed');
    thoughts.command('two', 'git status', 'completed');
    expect(news.at(-1)).toEqual({ tabId: COMMANDS_TAB, howMuch: 2 });

    thoughts.commandsSeen();
    thoughts.command('three', 'git log', 'completed');
    expect(news.at(-1)).toEqual({ tabId: COMMANDS_TAB, howMuch: 1 });
  });
});

describe('what the navigation panel reads from the whisper', () => {
  it('finds its headings, its turns and what it points at', () => {
    const w = whisper(
      '<h2 id="what-the-loom-is">What the loom is</h2><p>A line, and <a href="Another%20whisper.xhtml">a link</a>.</p>' +
        '<hr data-section-id="s1" data-turn="1" data-shown="14 Sep 2026, 06:12" />' +
        '<section data-author="assistant" data-reply-id="r1" data-state="finished"><p>A reply.</p></section>' +
        '<h3 id="a-lesser-one">A lesser one</h3><p>and on.</p>',
    );
    const here = whereabouts(w);
    expect(here.headings).toEqual([
      { identity: 'what-the-loom-is', text: 'What the loom is', level: 2 },
      { identity: 'a-lesser-one', text: 'A lesser one', level: 3 },
    ]);
    expect(here.turns).toEqual([{ sectionId: 's1', turn: '1', shown: '14 Sep 2026, 06:12' }]);
    expect(here.pointsAt).toEqual([{ address: 'Another%20whisper.xhtml', name: 'Another whisper', text: 'a link' }]);
  });
});

describe('the bar between the panels', () => {
  it('says which way the panel must go to show what the author is reading about', async () => {
    const { whichWay } = await import('../../src/renderer/src/loom/reference-bar');
    const view = new DOMRect(0, 100, 300, 400);
    expect(whichWay(new DOMRect(0, 50, 300, 20), view)).toBe('up');
    expect(whichWay(new DOMRect(0, 600, 300, 20), view)).toBe('down');
    expect(whichWay(new DOMRect(0, 200, 300, 20), view)).toBe('here');
    // Nothing to point at: the turn being read cited nothing the panel holds.
    expect(whichWay(undefined, view)).toBe('none');
  });
});

describe('how the window is divided', () => {
  it('keeps a panel within what the window can hold', async () => {
    const { widthWithin } = await import('../../src/renderer/src/loom/splitters');
    // Narrow enough to tuck away, never so wide that the writing has nowhere to go.
    expect(widthWithin(300, 1600)).toBe(300);
    expect(widthWithin(20, 1600)).toBe(120);
    expect(widthWithin(1500, 1600)).toBe(720);
    // A tiny window still leaves a panel usable rather than a sliver.
    expect(widthWithin(300, 400)).toBe(180);
  });
});
