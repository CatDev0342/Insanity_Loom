// Carries out the commands the page asks for (src/shared/commands.ts), each on the window that asked.

import { app, BrowserWindow, dialog, ipcMain, type WebContents } from 'electron';
import { isCommandId, RUN_COMMAND_CHANNEL, type CommandId } from '../shared/commands';

// Zoom moves in Chromium's own steps: each level is 20% larger or smaller than the one before. The limits keep the
// page between roughly a third and three times its normal size.
const ZOOM_STEP = 0.5;
const ZOOM_LEVEL_NORMAL = 0;
const ZOOM_LEVEL_SMALLEST = -3;
const ZOOM_LEVEL_LARGEST = 6;

function zoomBy(page: WebContents, step: number): void {
  const level = Math.min(ZOOM_LEVEL_LARGEST, Math.max(ZOOM_LEVEL_SMALLEST, page.getZoomLevel() + step));
  page.setZoomLevel(level);
}

async function showAbout(window: BrowserWindow | null): Promise<void> {
  const options = {
    type: 'info' as const,
    title: 'About Insanity_Loom',
    message: `Insanity_Loom ${app.getVersion()}`,
    detail:
      'A text editor for one author and an AI assistant, working in the same document.\n\n' +
      `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node.js ${process.versions.node}\n\n` +
      'Copyright 2026 CatDev0342. Licensed under the Apache License, Version 2.0.',
    buttons: ['OK'],
  };
  if (window === null) await dialog.showMessageBox(options);
  else await dialog.showMessageBox(window, options);
}

async function run(command: CommandId, page: WebContents): Promise<void> {
  const window = BrowserWindow.fromWebContents(page);
  switch (command) {
    case 'app.quit':
      app.quit();
      return;
    // The editing commands act on whatever has focus in the page, exactly as the keyboard shortcuts do.
    case 'edit.undo':
      page.undo();
      return;
    case 'edit.redo':
      page.redo();
      return;
    case 'edit.cut':
      page.cut();
      return;
    case 'edit.copy':
      page.copy();
      return;
    case 'edit.paste':
      page.paste();
      return;
    // Paste as Text drops the formatting the writing was copied with and keeps only the words.
    case 'edit.pasteAsText':
      page.pasteAndMatchStyle();
      return;
    case 'edit.selectAll':
      page.selectAll();
      return;
    case 'view.zoomIn':
      zoomBy(page, ZOOM_STEP);
      return;
    case 'view.zoomOut':
      zoomBy(page, -ZOOM_STEP);
      return;
    case 'view.zoomReset':
      page.setZoomLevel(ZOOM_LEVEL_NORMAL);
      return;
    case 'view.toggleFullScreen':
      if (window !== null) window.setFullScreen(!window.isFullScreen());
      return;
    case 'help.about':
      await showAbout(window);
      return;
  }
}

/** Starts listening for commands from every Insanity_Loom page. Call once, before the first window. */
export function listenForCommands(): void {
  ipcMain.handle(RUN_COMMAND_CHANNEL, async (event, command: unknown) => {
    // The page is never trusted to send only planned names: anything else is refused, loudly.
    if (!isCommandId(command)) throw new Error(`Insanity_Loom has no command named ${JSON.stringify(command)}.`);
    await run(command, event.sender);
  });
}
