// The page Insanity_Loom shows is kept on a short leash. It runs sandboxed, cannot reach Node.js, cannot open new
// windows, cannot navigate away from itself, and is granted no browser permissions (camera, microphone, location,
// notifications…). Anything that touches the author's files or the network goes through the layer underneath, by
// name, one request at a time. Electron's own security guidance, and also what keeps the application stable: the
// page cannot do anything the rest of the program has not planned for.

import { app, session, type WebContents } from 'electron';

/** The settings every Insanity_Loom window's page runs with. */
export const PAGE_PREFERENCES = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  webviewTag: false,
  spellcheck: true,
} as const;

/** Applies the leash to every page Insanity_Loom will ever create. Call once, before the first window. */
export function restrictEveryPage(): void {
  // No browser permission is ever granted; Insanity_Loom asks for what it needs through its own channels instead.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, answer) => answer(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  app.on('web-contents-created', (_event, contents) => restrictPage(contents));
}

function restrictPage(contents: WebContents): void {
  // The page may not open windows. Links meant for a browser will be handed to the system's browser, deliberately,
  // when Insanity_Loom has links to follow.
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // The page may not navigate away from what Insanity_Loom loaded into it.
  contents.on('will-navigate', (event, url) => {
    if (url !== contents.getURL()) event.preventDefault();
  });

  // No embedded web views: they would be pages outside these rules.
  contents.on('will-attach-webview', (event) => event.preventDefault());
}
