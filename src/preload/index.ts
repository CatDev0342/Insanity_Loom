// The bridge between the page and the layer underneath. The page is sandboxed and isolated; this is the only thing
// it can reach, and it offers only what is listed here, by name. Every ability added later comes through this file,
// one request at a time — never Node.js itself.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { ASSISTANT_CHANNELS, CONNECTION_CHANNELS, JOURNAL_CHANNELS, type AssistantEvent } from '../shared/assistant';
import type { InsanityLoomBridge } from '../shared/bridge';
import { RUN_COMMAND_CHANNEL } from '../shared/commands';
import { EDITING_CHANNELS, type ContextDetails } from '../shared/editing';
import { LINK_CHANNELS } from '../shared/links';
import { WHISPER_CHANNELS } from '../shared/whispers';

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
    signInMethods: () => ipcRenderer.invoke(ASSISTANT_CHANNELS.signInMethods),
    signIn: (methodId) => ipcRenderer.invoke(ASSISTANT_CHANNELS.signIn, methodId),
    sendSignInCode: (code) => ipcRenderer.invoke(ASSISTANT_CHANNELS.signInCode, code),
    cancelSignIn: () => ipcRenderer.invoke(ASSISTANT_CHANNELS.cancelSignIn),
    openSignInPage: (url) => ipcRenderer.invoke(ASSISTANT_CHANNELS.openSignInPage, url),
    signOut: () => ipcRenderer.invoke(ASSISTANT_CHANNELS.signOut),
    setMode: (modeId) => ipcRenderer.invoke(ASSISTANT_CHANNELS.setMode, modeId),
  },

  connection: {
    load: () => ipcRenderer.invoke(CONNECTION_CHANNELS.load),
    save: (settings) => ipcRenderer.invoke(CONNECTION_CHANNELS.save, settings),
    test: (settings) => ipcRenderer.invoke(CONNECTION_CHANNELS.test, settings),
    listContainers: (dockerProgram) => ipcRenderer.invoke(CONNECTION_CHANNELS.containers, dockerProgram),
    openLog: () => ipcRenderer.invoke(CONNECTION_CHANNELS.openLog),
  },

  editing: {
    onContextMenu: (listener) => {
      const relay = (_event: IpcRendererEvent, details: ContextDetails): void => listener(details);
      ipcRenderer.on(EDITING_CHANNELS.contextMenu, relay);
      return () => {
        ipcRenderer.removeListener(EDITING_CHANNELS.contextMenu, relay);
      };
    },
    replaceMisspelling: (suggestion) => ipcRenderer.invoke(EDITING_CHANNELS.replace, suggestion),
    loadSpelling: () => ipcRenderer.invoke(EDITING_CHANNELS.load),
    saveSpelling: (preferences) => ipcRenderer.invoke(EDITING_CHANNELS.save, preferences),
    addToDictionary: (word) => ipcRenderer.invoke(EDITING_CHANNELS.addWord, word),
    removeFromDictionary: (word) => ipcRenderer.invoke(EDITING_CHANNELS.removeWord, word),
  },

  whispers: {
    alcoveFolder: () => ipcRenderer.invoke(WHISPER_CHANNELS.alcoveFolder),
    chooseAlcoveFolder: () => ipcRenderer.invoke(WHISPER_CHANNELS.chooseAlcove),
    current: () => ipcRenderer.invoke(WHISPER_CHANNELS.current),
    create: (title, xhtml) => ipcRenderer.invoke(WHISPER_CHANNELS.create, title, xhtml),
    save: (path, xhtml) => ipcRenderer.invoke(WHISPER_CHANNELS.save, path, xhtml),
    choose: () => ipcRenderer.invoke(WHISPER_CHANNELS.choose),
    list: () => ipcRenderer.invoke(WHISPER_CHANNELS.list),
    openNamed: (name) => ipcRenderer.invoke(WHISPER_CHANNELS.openNamed, name),
    contents: (name) => ipcRenderer.invoke(WHISPER_CHANNELS.contents, name),
    pointingHere: (name) => ipcRenderer.invoke(WHISPER_CHANNELS.pointingHere, name),
    search: (looked) => ipcRenderer.invoke(WHISPER_CHANNELS.search, looked),
    rename: (path, title) => ipcRenderer.invoke(WHISPER_CHANNELS.rename, path, title),
    exportMarkdown: (suggestedName, markdown) => ipcRenderer.invoke(WHISPER_CHANNELS.exportMarkdown, suggestedName, markdown),
    showAlcove: () => ipcRenderer.invoke(WHISPER_CHANNELS.showAlcove),
  },

  links: {
    open: (address) => ipcRenderer.invoke(LINK_CHANNELS.open, address),
  },

  journal: {
    loadDraft: () => ipcRenderer.invoke(JOURNAL_CHANNELS.loadDraft),
  },
};

contextBridge.exposeInMainWorld('insanityLoom', bridge);
