// Insanity_Loom's layer underneath: it starts first, decides where everything is kept, and opens the window.

import { app, BrowserWindow, dialog, Menu, nativeTheme } from 'electron';
import { join } from 'node:path';
import { startServices } from './channels';
import { listenForCommands } from './commands';
import { startEditingServices } from './editing';
import { Journal } from './journal';
import { dataFoldersIn, findProgramFolder, prepareDataFolders, type DataFolders } from './portable';
import { PAGE_PREFERENCES, restrictEveryPage } from './security';

// The window's opening size, in screen points, and the smallest it may be made. The minimum keeps the page usable,
// not crushed: roughly a narrow column of text with room for the controls around it.
const WINDOW_START_WIDTH = 1200;
const WINDOW_START_HEIGHT = 800;
const WINDOW_MINIMUM_WIDTH = 480;
const WINDOW_MINIMUM_HEIGHT = 360;

// The window's ground color before the page has drawn, so opening never flashes white on a dark page or the reverse.
// It matches the page's own background (src/renderer/src/style.css).
const WINDOW_BACKGROUND_COLOR = '#1e1e22';

// The exit code for a start that cannot go on: anything other than 0 tells the system the program failed.
const EXIT_CODE_CANNOT_START = 1;

/**
 * Everything is kept in Data, beside the program. This must happen before Electron is ready: Chromium decides where
 * its own files go as it starts, and the single-instance lock below lives in the settings folder too.
 */
function keepEverythingBesideTheProgram(): DataFolders {
  const programFolder = findProgramFolder({
    isPackaged: app.isPackaged,
    executablePath: process.execPath,
    appImagePath: process.env['APPIMAGE'],
    applicationPath: app.getAppPath(),
  });
  const folders = dataFoldersIn(programFolder);
  prepareDataFolders(folders);

  app.setPath('userData', folders.data);
  app.setPath('sessionData', folders.session);
  app.setPath('crashDumps', folders.crashReports);
  app.setAppLogsPath(folders.logs);
  return folders;
}

function openMainWindow(): void {
  const window = new BrowserWindow({
    width: WINDOW_START_WIDTH,
    height: WINDOW_START_HEIGHT,
    minWidth: WINDOW_MINIMUM_WIDTH,
    minHeight: WINDOW_MINIMUM_HEIGHT,
    title: 'Insanity_Loom',
    backgroundColor: WINDOW_BACKGROUND_COLOR,
    // Shown once the page has drawn its first frame, so the author never sees an empty window.
    show: false,
    webPreferences: {
      ...PAGE_PREFERENCES,
      preload: join(__dirname, '../preload/index.js'),
    },
  });

  window.once('ready-to-show', () => window.show());

  // During development the page comes from electron-vite's live server; in a built copy, from the files inside it.
  const developmentServer = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && developmentServer !== undefined) {
    void window.loadURL(developmentServer);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function start(): void {
  let folders: DataFolders;
  try {
    folders = keepEverythingBesideTheProgram();
  } catch (problem) {
    // Before Electron is ready, a plain error box is the one dialog that may be shown.
    dialog.showErrorBox('Insanity_Loom cannot start', problem instanceof Error ? problem.message : String(problem));
    app.exit(EXIT_CODE_CANNOT_START);
    return;
  }

  // One Insanity_Loom per Data folder: a second start brings the running one forward instead of fighting it over
  // the same files.
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows();
    if (window === undefined) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  app.on('window-all-closed', () => app.quit());

  void app.whenReady().then(() => {
    restrictEveryPage();
    listenForCommands();
    // Insanity_Loom is dark, so the system draws its window frame and title bar dark too.
    nativeTheme.themeSource = 'dark';
    startEditingServices(folders.data);
    const assistant = startServices(folders.data, folders.logs, new Journal(folders.data));
    app.on('before-quit', () => void assistant.close());
    // No native menu: Insanity_Loom draws its own menu bar in the page (src/renderer/src/menu), so it looks and
    // behaves the same on Windows and Linux, square-cornered, and follows the classic Windows keyboard conventions.
    Menu.setApplicationMenu(null);
    openMainWindow();
  });
}

start();
