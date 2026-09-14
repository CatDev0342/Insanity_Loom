// The page: the menu bar, and the loom beneath it.

import { isFormatCommand, isPageCommand, type AnyCommandId, type FormatCommandId } from './commands';
import { Loom } from './loom/page';
import { ContextMenu } from './menu/context-menu';
import { MenuBar } from './menu/menubar';
import { PanelTabs } from './loom/panel-tabs';
import { Splitters } from './loom/splitters';
import { Toolbar } from './menu/toolbar';
import { MENUS } from './menu/model';
import { LinkPanel, type WhisperHeading } from './panels/link-panel';
import { PointsHerePanel } from './panels/points-here-panel';
import { SearchPanel } from './panels/search-panel';
import { PreferencesPanel } from './panels/preferences-panel';
import { SignInPanel } from './panels/sign-in-panel';

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`The page is missing ${selector} (src/renderer/index.html).`);
  return element;
}

const bridge = window.insanityLoom;

/** How long after the last drag the widths are written down, in milliseconds. */
const WIDTHS_WRITTEN_AFTER_MS = 400;

const loom = new Loom(
  {
    whisper: required<HTMLElement>('#whisper'),
    scroll: required<HTMLElement>('.whisper-scroll'),
    asks: required<HTMLElement>('#asks'),
    statusText: required<HTMLElement>('#status-text'),
    activity: required<HTMLElement>('#activity'),
    account: required<HTMLElement>('#account'),
    reconnect: required<HTMLButtonElement>('#reconnect'),
    signIn: required<HTMLButtonElement>('#sign-in'),
    connectionSettings: required<HTMLButtonElement>('#connection-settings'),
    whisperName: required<HTMLElement>('#whisper-name'),
    modeLabel: required<HTMLElement>('#mode-label'),
    mode: required<HTMLSelectElement>('#mode'),
    bar: required<HTMLElement>('#find-bar'),
    looked: required<HTMLInputElement>('#find-looked'),
    said: required<HTMLElement>('#find-said'),
    previous: required<HTMLButtonElement>('#find-previous'),
    next: required<HTMLButtonElement>('#find-next'),
    close: required<HTMLButtonElement>('#find-close'),
    replaceRow: required<HTMLElement>('#find-replace-row'),
    replacement: required<HTMLInputElement>('#find-replacement'),
    replace: required<HTMLButtonElement>('#find-replace'),
    replaceAll: required<HTMLButtonElement>('#find-replace-all'),
    isolation: required<HTMLElement>('#isolation'),
    contextHolder: required<HTMLElement>('#context'),
    contextSaid: required<HTMLElement>('#context-said'),
    contextFull: required<HTMLElement>('#context-full'),
    compactButton: required<HTMLButtonElement>('#compact'),
    thoughtsPanel: required<HTMLElement>('#thoughts'),
    thoughtsStream: required<HTMLElement>('#thoughts-stream'),
    thoughtsSaid: required<HTMLElement>('#thoughts-said'),
    navigationInside: required<HTMLElement>('#navigation-inside'),
    libraryInside: required<HTMLElement>('#library-inside'),
    librarySaid: required<HTMLElement>('#library-said'),
    libraryPane: required<HTMLElement>('#library-pane'),
    showLibraryTab: () => besideTheWhisper.showTab('library'),
    referenceBar: required<HTMLElement>('#reference-bar'),
    resumeDialog: required<HTMLDialogElement>('#resume-dialog'),
    connectionDialog: required<HTMLDialogElement>('#connection-dialog'),
  },
  bridge.assistant,
  bridge.connection,
  bridge.whispers,
  bridge.links,
  bridge.greatHall,
  bridge.journal,
);

const preferences = new PreferencesPanel(required<HTMLDialogElement>('#preferences-dialog'), bridge.editing, bridge.whispers);
const signIn = new SignInPanel(required<HTMLDialogElement>('#sign-in-dialog'), bridge.assistant);
const link = new LinkPanel(required<HTMLDialogElement>('#link-dialog'));
const pointsHere = new PointsHerePanel(required<HTMLDialogElement>('#points-here-dialog'));
const search = new SearchPanel(required<HTMLDialogElement>('#search-dialog'));
required<HTMLButtonElement>('#sign-in').addEventListener('click', () => void signIn.show());

/**
 * The headings of a whisper in the alcove, read from its file: what a link may point at inside it. The file is XHTML,
 * so the page reads it with the browser's own parser (src/renderer/src/document/xhtml.ts writes it).
 */
async function headingsOf(name: string): Promise<readonly WhisperHeading[]> {
  const parsed = new DOMParser().parseFromString(await bridge.whispers.contents(name), 'application/xhtml+xml');
  if (parsed.getElementsByTagName('parsererror').length > 0) return [];
  return [...parsed.querySelectorAll('h1[id], h2[id], h3[id]')].map((heading) => ({
    identity: heading.getAttribute('id') ?? '',
    text: heading.textContent ?? '',
  }));
}

/** Format ▸ …: the whisper's own. Only the link asks for anything; the rest act where the caret is. */
async function runFormat(command: FormatCommandId): Promise<void> {
  if (command !== 'format.link') {
    loom.runFormatCommand(command);
    return;
  }
  const chosen = await link.show(loom.linkAddress, await bridge.whispers.list(), headingsOf);
  if (chosen.kind === 'set') loom.setLink(chosen.address);
  else if (chosen.kind === 'remove') loom.runFormatCommand('format.removeLink');
  loom.focusWhisper();
}

/** File ▸ What Points Here: the whispers that link to the one open; choosing one opens it. */
async function showWhatPointsHere(): Promise<void> {
  const here = loom.whisperFileName;
  const chosen = await pointsHere.show(here, await bridge.whispers.pointingHere(here));
  if (chosen !== '') await loom.openNamedWhisper(chosen);
  loom.focusWhisper();
}

/** File ▸ Find in the Alcove: the whispers holding some writing; choosing one opens it. */
async function findInTheAlcove(): Promise<void> {
  const asked = await search.ask((looked) => bridge.whispers.search(looked));
  if (asked.name === '') {
    loom.focusWhisper();
    return;
  }
  await loom.openNamedWhisper(asked.name);
  // The author was looking for words, not for a whisper: they land on them.
  loom.findFor(asked.looked);
}

/**
 * File ▸ Find in Files: everything the author has written, in a window of its own beside the program, so it can be
 * left open while they write. What they choose there arrives here (`onGoTo`).
 */
async function findInFiles(): Promise<void> {
  await bridge.findWindow.open();
}

bridge.findWindow.onGoTo((chosen) => void goToWhatWasFound(chosen));

/** Goes to what was chosen in the Find in Files window. */
async function goToWhatWasFound(chosen: { path: string; looked: string; address: string; line: number }): Promise<void> {
  // A place in the library opens in the Library tab, where the library is read and edited; a whisper opens as one.
  if (chosen.address !== '') {
    await loom.openLibraryAt(chosen.address, chosen.line);
    return;
  }
  await loom.openWhisperAt(chosen.path);
  loom.findFor(chosen.looked);
}

async function run(command: AnyCommandId): Promise<void> {
  // Undo and Redo in the whisper are the whisper's own: its history holds only the author's changes.
  if ((command === 'edit.undo' || command === 'edit.redo') && loom.runEditCommand(command)) return;
  if (isFormatCommand(command)) return runFormat(command);
  if (command === 'whisper.pointsHere') return showWhatPointsHere();
  if (command === 'whisper.search') return findInTheAlcove();
  if (command === 'whisper.searchHall') return findInFiles();
  if (command === 'find.show') return loom.showFindBar();
  if (command === 'edit.isolateSections') return loom.isolateSections();
  if (command === 'hall.open') return loom.openGreatHall();
  if (command === 'find.replace') return loom.showReplaceBar();
  if (command === 'find.next') return loom.stepFind('next');
  if (command === 'find.previous') return loom.stepFind('previous');
  if (!isPageCommand(command)) return bridge.runCommand(command);
  if (command === 'app.preferences') return preferences.show();
  if (command === 'assistant.signIn') return signIn.show();
  return loom.run(command);
}

// The menus and their keys ask the whisper how each Format command stands, every time they are used; everything else
// is always ready.
const standingOf = (command: AnyCommandId): { enabled: boolean; checked: boolean } => {
  if (isFormatCommand(command)) return loom.formatStanding(command);
  // The one other command that is either on or off: the menu shows a tick beside it.
  if (command === 'edit.isolateSections') return { enabled: true, checked: loom.isolatingSections };
  return { enabled: true, checked: false };
};

new MenuBar(required<HTMLElement>('#menubar'), MENUS, run, standingOf);

// The bars between the three sections. The author decides how the window is divided, and it stays divided that way.
const splitters = new Splitters(
  {
    leftSplitter: required<HTMLElement>('#left-splitter'),
    rightSplitter: required<HTMLElement>('#right-splitter'),
    leftPanel: required<HTMLElement>('#navigation'),
    rightPanel: required<HTMLElement>('#thoughts'),
  },
  (widths) => {
    // Written a moment after the author stops dragging, not at every pixel of it.
    window.clearTimeout(savingWidths);
    savingWidths = window.setTimeout(() => void bridge.layout.savePanelWidths(widths), WIDTHS_WRITTEN_AFTER_MS);
  },
);
let savingWidths = 0;
void bridge.layout.panelWidths().then((widths) => splitters.use(widths));

// The tabs at the top of each side panel. The left panel holds one thing for now; the right holds the assistant's
// thinking and the library it is citing.
new PanelTabs(required<HTMLElement>('#navigation-tabs'), [
  { id: 'navigation', name: 'Navigation', pane: required<HTMLElement>('#navigation-pane') },
]);
const besideTheWhisper = new PanelTabs(required<HTMLElement>('#thoughts-tabs'), [
  { id: 'thinking', name: 'Thinking', pane: required<HTMLElement>('#thoughts-pane') },
  { id: 'library', name: 'Library', pane: required<HTMLElement>('#library-pane') },
]);

// The editing shortcuts along the top, saying the same about each command as the Format menu does.
const toolbar = new Toolbar(required<HTMLElement>('#toolbar'), run, standingOf);
loom.followTheCaret(() => toolbar.refresh());
toolbar.refresh();
new ContextMenu(bridge.editing, run, (where) => loom.quote(where));

void loom.start();
