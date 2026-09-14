// The Find in Files window: a window of its own, not a panel inside the main one.
//
// Searching a GreatHall is something an author does *beside* their writing — results in one window, the whisper in
// another, often on another screen. A panel inside the window covers the very thing being looked for, and closes the
// moment anything else is done. So this is a real window: it can be moved, left open, and put wherever the author
// keeps such things.
//
// It is a child of the main window, so it stays in front of it and closes with it, but it is not modal: the author
// goes on writing while it is open.

import { BrowserWindow } from 'electron';
import { join } from 'node:path';

/** How big the window opens, and the smallest it may be made: enough for the fields and a list of results. */
const START_WIDTH = 760;
const START_HEIGHT = 620;
const MINIMUM_WIDTH = 520;
const MINIMUM_HEIGHT = 380;

let open: BrowserWindow | undefined;

/** Opens the Find in Files window, or brings it forward when it is already open. */
export function openFindWindow(parent: BrowserWindow | null, backgroundColor: string, pagePreferences: Electron.WebPreferences): BrowserWindow {
  if (open !== undefined && !open.isDestroyed()) {
    if (open.isMinimized()) open.restore();
    open.focus();
    return open;
  }
  const how = {
    width: START_WIDTH,
    height: START_HEIGHT,
    minWidth: MINIMUM_WIDTH,
    minHeight: MINIMUM_HEIGHT,
    title: 'Find in Files — Insanity_Loom',
    backgroundColor,
    show: false,
    // In front of the whisper, and closed with it, but never in its way: the author writes while it is open.
    modal: false,
    webPreferences: { ...pagePreferences, preload: join(__dirname, '../preload/index.js') },
  };
  const window = parent === null ? new BrowserWindow(how) : new BrowserWindow({ ...how, parent });
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    open = undefined;
  });

  const developmentServer = process.env['ELECTRON_RENDERER_URL'];
  if (developmentServer !== undefined) void window.loadURL(`${developmentServer}/find.html`);
  else void window.loadFile(join(__dirname, '../renderer/find.html'));
  open = window;
  return window;
}

/** The Find in Files window, if it is open. */
export function findWindow(): BrowserWindow | undefined {
  return open !== undefined && !open.isDestroyed() ? open : undefined;
}
