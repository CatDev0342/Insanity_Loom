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
    thoughts.command('one', 'export PATH="$HOME/bin:$PATH"; cd ~/work && npm run check', '', 'in_progress');

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

  it('gives every command its own line, and says what each was working on', () => {
    const { thoughts, commands } = panel();
    thoughts.keepBeside('/alcove/A.xhtml');
    // Two commands that read alike from the front and are not the same command at all: what they worked on is the
    // whole difference between them (the designer, 2026-Sep-16).
    thoughts.command('one', 'Read File', '/alcove/A.xhtml', 'completed');
    thoughts.command('two', 'Read File', '/alcove/B.xhtml', 'completed');
    thoughts.command('three', 'cd ~/work && npm run check', '', 'completed');

    const lines = [...commands.querySelectorAll('.thought-command')].map((line) => line.textContent);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('Read File — /alcove/A.xhtml');
    expect(lines[1]).toBe('Read File — /alcove/B.xhtml');
    // Nothing is counted away, and nothing is cut short.
    expect(commands.textContent).not.toContain('×');
    expect(lines[2]).toBe('npm run check');
  });

  it('heads the commands by turn, in the words the whisper uses', () => {
    const { thoughts, commands } = panel();
    thoughts.keepBeside('/alcove/A.xhtml');
    thoughts.beginTurn(7, 'Sep 16, 2026, 05:14 AM');
    thoughts.command('one', 'Read File', '/alcove/A.xhtml', 'completed');
    // A command can be read back to the turn that caused it.
    expect(commands.querySelector('.thought-turn')?.textContent).toBe('Turn 7 · Sep 16, 2026, 05:14 AM');
  });

  it('says how many commands the author has not looked at, and stops once they have', () => {
    const { thoughts, news } = panel();
    thoughts.keepBeside('/alcove/A.xhtml');
    thoughts.command('one', 'npm run check', '', 'completed');
    thoughts.command('two', 'git status', '', 'completed');
    expect(news.at(-1)).toEqual({ tabId: COMMANDS_TAB, howMuch: 2 });

    thoughts.commandsSeen();
    thoughts.command('three', 'git log', '', 'completed');
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

  it('points at documents, not at every address in the writing', () => {
    const w = whisper(
      '<p>A source: <a href="https://example.com/a-page">the page</a>, and ' +
        '<a href="Another%20whisper.xhtml#what-the-loom-is">a whisper</a>, and ' +
        '<a href="#a-heading-here">a heading of this one</a>.</p>',
    );
    // A reply full of sources would otherwise fill the panel with web addresses that say nothing about how the
    // author's own writing hangs together (the designer, 2026-Sep-16). A heading of this whisper is in the list
    // above, not this one.
    expect(whereabouts(w).pointsAt).toEqual([
      { address: 'Another%20whisper.xhtml#what-the-loom-is', name: 'Another whisper · what-the-loom-is', text: 'a whisper' },
    ]);
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

describe('the Library tab, cited twice at once', () => {
  it('lists an address once however many citings are in the air', async () => {
    const { Library } = await import('../../src/renderer/src/loom/library');
    const inside = document.createElement('div');
    const said = document.createElement('p');
    const pane = document.createElement('div');
    document.body.append(inside, said, pane);

    let answering = 0;
    const hall = {
      current: async () => undefined,
      choose: async () => undefined,
      // Slow enough that the second citing begins before the first is answered, which is the whole fault.
      sections: async (addresses: readonly string[]) => {
        answering += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return addresses.map((address) => ({
          address,
          document: '40',
          line: 1,
          text: 'What stands there.',
          title: '40',
          alsoAt: [] as number[],
        }));
      },
      document: async () => ({ markdown: '', stamp: '' }),
      saveDocument: async () => undefined,
    };
    const library = new Library(
      { libraryInside: inside, librarySaid: said, libraryPane: pane, showLibraryTab: () => undefined },
      hall,
      () => undefined,
    );
    library.useHall({
      name: 'A hall',
      form: 'TOML',
      trouble: [],
      path: '/hall/A.greathall',
      alcoves: ['/hall/Alcove'],
      library: '/hall/Library',
      libraryName: 'Test Library',
      documents: [{ address: '40', file: '40.md', title: '40' }],
    });

    // A reply finishing while the whisper's own citations are being gathered: both cite 40.6.2, at the same moment.
    await Promise.all([library.cite(1, ['40.6.2']), library.cite(2, ['40.6.2'])]);
    expect(inside.querySelectorAll('.library-entry')).toHaveLength(1);
    // And the library was read once for it, not twice.
    expect(answering).toBe(1);
  });
});
