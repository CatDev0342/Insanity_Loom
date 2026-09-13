// The bridge between the page and the layer underneath. The page is sandboxed and isolated; this is the only thing
// it can reach, and it offers only what is listed here, by name. Every ability added later comes through this file,
// one request at a time — never Node.js itself.

import { contextBridge, ipcRenderer } from 'electron';
import type { InsanityLoomBridge } from '../shared/bridge';
import { RUN_COMMAND_CHANNEL } from '../shared/commands';

const bridge: InsanityLoomBridge = {
  versions: {
    electron: process.versions.electron ?? 'unknown',
    chromium: process.versions.chrome ?? 'unknown',
    node: process.versions.node,
  },

  runCommand: async (command) => {
    await ipcRenderer.invoke(RUN_COMMAND_CHANNEL, command);
  },
};

contextBridge.exposeInMainWorld('insanityLoom', bridge);
