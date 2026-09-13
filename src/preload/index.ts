// The bridge between the page and the layer underneath. The page is sandboxed and isolated; this is the only thing
// it can reach, and it offers only what is listed here, by name. Every ability added later comes through this file,
// one request at a time — never Node.js itself.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { ASSISTANT_CHANNELS, JOURNAL_CHANNELS, type AssistantEvent } from '../shared/assistant';
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

  assistant: {
    connect: () => ipcRenderer.invoke(ASSISTANT_CHANNELS.connect),
    listConversations: () => ipcRenderer.invoke(ASSISTANT_CHANNELS.list),
    startConversation: () => ipcRenderer.invoke(ASSISTANT_CHANNELS.start),
    resumeConversation: (id) => ipcRenderer.invoke(ASSISTANT_CHANNELS.resume, id),
    send: (text) => ipcRenderer.invoke(ASSISTANT_CHANNELS.send, text),
    stop: () => ipcRenderer.invoke(ASSISTANT_CHANNELS.stop),
    answerPermission: (requestId, choiceId) => ipcRenderer.invoke(ASSISTANT_CHANNELS.answer, requestId, choiceId),
    onEvent: (listener) => {
      // The page gets the event alone, never Electron's own event object, which would reach past the bridge.
      const relay = (_event: IpcRendererEvent, assistantEvent: AssistantEvent): void => listener(assistantEvent);
      ipcRenderer.on(ASSISTANT_CHANNELS.event, relay);
      return () => {
        ipcRenderer.removeListener(ASSISTANT_CHANNELS.event, relay);
      };
    },
  },

  journal: {
    loadDraft: () => ipcRenderer.invoke(JOURNAL_CHANNELS.loadDraft),
    saveDraft: (text) => ipcRenderer.invoke(JOURNAL_CHANNELS.saveDraft, text),
  },
};

contextBridge.exposeInMainWorld('insanityLoom', bridge);
