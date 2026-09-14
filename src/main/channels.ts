// The layer underneath's answers to the page's assistant, connection and journal requests. Everything arriving from
// the page is checked here before it is used: the page is never trusted to send only what it should.

import { BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import {
  ASSISTANT_CHANNELS,
  CONNECTION_CHANNELS,
  isSignInPage,
  JOURNAL_CHANNELS,
  MAXIMUM_SECTION_LENGTH,
  MAXIMUM_WHISPER_LENGTH,
  type AssistantEvent,
  type ConnectionPanelState,
} from '../shared/assistant';
import { DEFAULT_CONNECTION, type ConnectionSettings } from '../shared/connection';
import { Assistant, HOST_LOG_FILE_NAME } from './assistant';
import type { Journal } from './journal';
import type { PreferenceStore } from './preference-store';
import { HALL_CHANNELS, type HallSearch } from '../shared/hall';
import { searchHall } from './hall';
import { LINK_CHANNELS } from '../shared/links';
import { openAddress } from './links';
import { WHISPER_CHANNELS } from '../shared/whispers';
import { Whispers } from './whispers';
import { loadSettings, readConnection, saveSettings, settingsWith } from './settings';

// Identifiers the page passes back (conversation ids, permission request and choice ids) are short; anything longer
// is not one of them. The same bound serves for a Docker program's path.
const MAXIMUM_IDENTIFIER_LENGTH = 512;

// A sign-in page's address, with its one-time parameters, is long but bounded. A file path is bounded too.
const MAXIMUM_ADDRESS_LENGTH = 4096;
const MAXIMUM_PATH_LENGTH = 4096;

// How long Docker may take to list its running containers, in milliseconds, before Insanity_Loom stops waiting.
const CONTAINER_LIST_TIME_LIMIT_MS = 15_000;

const PANEL = 'the Connection Settings panel';

/** What the page asked to search for, checked: the layer underneath trusts nothing it is handed. */
function readHallSearch(value: unknown): HallSearch {
  const asked = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return {
    looked: text(asked['looked'], 'search', MAXIMUM_IDENTIFIER_LENGTH),
    everywhere: asked['everywhere'] === true,
    matchCase: asked['matchCase'] === true,
    wholeWord: asked['wholeWord'] === true,
    regularExpression: asked['regularExpression'] === true,
    includeThoughts: asked['includeThoughts'] === true,
  };
}

function text(value: unknown, what: string, longest: number): string {
  if (typeof value !== 'string' || value.length > longest) throw new Error(`Insanity_Loom received an invalid ${what}.`);
  return value;
}

function identifier(value: unknown, what: string): string {
  const checked = text(value, what, MAXIMUM_IDENTIFIER_LENGTH);
  if (checked === '') throw new Error(`Insanity_Loom received an empty ${what}.`);
  return checked;
}

/** Sends an assistant event to every Insanity_Loom window. */
export function sendToPages(event: AssistantEvent): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(ASSISTANT_CHANNELS.event, event);
}

function listContainers(dockerProgram: string): Promise<readonly string[]> {
  return new Promise((resolve, reject) => {
    execFile(
      dockerProgram,
      ['ps', '--format', '{{.Names}}'],
      { timeout: CONTAINER_LIST_TIME_LIMIT_MS, windowsHide: true },
      (problem, stdout, stderr) => {
        if (problem !== null) {
          const detail = stderr.trim() !== '' ? stderr.trim() : problem.message;
          reject(new Error(`Docker could not list its running containers: ${detail}`));
          return;
        }
        resolve(stdout.split(/\r?\n/).map((name) => name.trim()).filter((name) => name !== ''));
      },
    );
  });
}

/**
 * Starts the assistant and journal services and answers the page's requests for them. The connection settings may
 * not exist yet (a new copy of Insanity_Loom) or may not be readable; either way the page can still open the panel,
 * see why, and save settings that work.
 */
export function startServices(dataFolder: string, logsFolder: string, journal: Journal, preferences: PreferenceStore): Assistant {
  let saved = false;
  let problem = '';
  let connection: ConnectionSettings = DEFAULT_CONNECTION;
  try {
    const settings = loadSettings(dataFolder);
    if (settings !== undefined) {
      saved = true;
      connection = settings.connection;
    }
  } catch (cause) {
    problem = cause instanceof Error ? cause.message : String(cause);
  }

  const assistant = new Assistant(connection, journal, logsFolder, sendToPages, preferences);

  ipcMain.handle(ASSISTANT_CHANNELS.connect, async () => {
    if (!saved) {
      sendToPages({
        type: 'status',
        state: 'failed',
        detail: problem !== '' ? problem : 'Insanity_Loom does not know where the assistant runs yet. Open Assistant ▸ Connection Settings.',
      });
      return;
    }
    await assistant.connect();
  });
  ipcMain.handle(ASSISTANT_CHANNELS.list, () => assistant.listConversations());
  ipcMain.handle(ASSISTANT_CHANNELS.start, () => assistant.startConversation());
  ipcMain.handle(ASSISTANT_CHANNELS.resume, (_event, id: unknown) => assistant.resumeConversation(identifier(id, 'conversation id')));
  ipcMain.handle(ASSISTANT_CHANNELS.send, (_event, section: unknown) =>
    assistant.send(text(section, 'section of writing', MAXIMUM_SECTION_LENGTH)),
  );
  ipcMain.handle(ASSISTANT_CHANNELS.stop, () => assistant.stop());
  ipcMain.handle(ASSISTANT_CHANNELS.answer, (_event, requestId: unknown, choiceId: unknown) =>
    assistant.answerPermission(
      identifier(requestId, 'permission request id'),
      choiceId === null ? null : identifier(choiceId, 'permission choice'),
    ),
  );

  ipcMain.handle(ASSISTANT_CHANNELS.signInMethods, () => assistant.signInMethods());
  ipcMain.handle(ASSISTANT_CHANNELS.signIn, (_event, methodId: unknown) => assistant.signIn(identifier(methodId, 'sign-in method')));
  ipcMain.handle(ASSISTANT_CHANNELS.signInCode, (_event, code: unknown) =>
    assistant.sendSignInCode(text(code, 'sign-in code', MAXIMUM_IDENTIFIER_LENGTH)),
  );
  ipcMain.handle(ASSISTANT_CHANNELS.cancelSignIn, () => assistant.cancelSignIn());
  ipcMain.handle(ASSISTANT_CHANNELS.openSignInPage, async (_event, address: unknown) => {
    // The address came from the host's output: only the assistant makers' own sign-in sites are ever opened.
    const page = text(address, 'sign-in page', MAXIMUM_ADDRESS_LENGTH);
    if (!isSignInPage(page)) throw new Error('Insanity_Loom opens only the assistant\'s own sign-in pages.');
    await shell.openExternal(page);
  });
  ipcMain.handle(ASSISTANT_CHANNELS.signOut, () => assistant.signOut());
  ipcMain.handle(ASSISTANT_CHANNELS.compact, () => assistant.compact());
  ipcMain.handle(ASSISTANT_CHANNELS.setMode, (_event, modeId: unknown) => assistant.setMode(identifier(modeId, 'way of working')));

  ipcMain.handle(CONNECTION_CHANNELS.load, (): ConnectionPanelState => ({ settings: connection, saved, problem }));
  ipcMain.handle(CONNECTION_CHANNELS.save, (_event, candidate: unknown) => {
    const checked = readConnection(candidate, PANEL);
    saveSettings(dataFolder, settingsWith(checked));
    connection = checked;
    saved = true;
    problem = '';
    assistant.useSettings(checked);
  });
  ipcMain.handle(CONNECTION_CHANNELS.test, (_event, candidate: unknown) => assistant.test(readConnection(candidate, PANEL)));
  ipcMain.handle(CONNECTION_CHANNELS.containers, (_event, dockerProgram: unknown) =>
    listContainers(identifier(dockerProgram, 'Docker program')),
  );
  ipcMain.handle(CONNECTION_CHANNELS.openLog, async () => {
    const failure = await shell.openPath(join(logsFolder, HOST_LOG_FILE_NAME));
    if (failure !== '') throw new Error(`The log could not be opened: ${failure}`);
  });

  ipcMain.handle(JOURNAL_CHANNELS.loadDraft, () => journal.loadDraft());
  const whispers = new Whispers(Whispers.programFolderOf(dataFolder), journal, preferences);
  const windowOf = (event: IpcMainInvokeEvent): BrowserWindow | null => BrowserWindow.fromWebContents(event.sender);
  const whisper = (value: unknown): string => text(value, 'whisper', MAXIMUM_WHISPER_LENGTH);
  // A path only ever comes back from a dialog or from the alcove itself, so it is checked for length alone.
  const whisperPath = (value: unknown): string => text(value, 'whisper path', MAXIMUM_PATH_LENGTH);

  ipcMain.handle(WHISPER_CHANNELS.alcoveFolder, () => whispers.alcoveFolder);
  ipcMain.handle(WHISPER_CHANNELS.chooseAlcove, (event) => whispers.chooseAlcove(windowOf(event)));
  ipcMain.handle(WHISPER_CHANNELS.current, () => whispers.current() ?? whispers.carryOverFromJournal());
  ipcMain.handle(WHISPER_CHANNELS.create, (_event, title: unknown, xhtml: unknown) =>
    whispers.create(text(title, 'whisper title', MAXIMUM_IDENTIFIER_LENGTH), whisper(xhtml)),
  );
  ipcMain.handle(WHISPER_CHANNELS.save, (_event, path: unknown, xhtml: unknown) => whispers.save(whisperPath(path), whisper(xhtml)));
  ipcMain.handle(WHISPER_CHANNELS.addThought, (_event, path: unknown, written: unknown) =>
    whispers.addThought(whisperPath(path), whisper(written)),
  );
  ipcMain.handle(WHISPER_CHANNELS.choose, (event) => whispers.choose(windowOf(event)));
  ipcMain.handle(WHISPER_CHANNELS.rename, (_event, path: unknown, title: unknown) =>
    whispers.rename(whisperPath(path), text(title, 'whisper title', MAXIMUM_IDENTIFIER_LENGTH)),
  );
  ipcMain.handle(WHISPER_CHANNELS.showAlcove, () => whispers.showAlcove());
  ipcMain.handle(WHISPER_CHANNELS.exportMarkdown, (event, suggestedName: unknown, markdown: unknown) =>
    whispers.exportMarkdown(windowOf(event), text(suggestedName, 'file name', MAXIMUM_PATH_LENGTH), whisper(markdown)),
  );
  ipcMain.handle(WHISPER_CHANNELS.list, () => whispers.list());
  ipcMain.handle(WHISPER_CHANNELS.openNamed, (_event, name: unknown) =>
    whispers.openNamed(text(name, 'whisper name', MAXIMUM_PATH_LENGTH)),
  );
  ipcMain.handle(WHISPER_CHANNELS.openAt, (_event, path: unknown) => whispers.openAt(whisperPath(path)));
  ipcMain.handle(WHISPER_CHANNELS.contents, (_event, name: unknown) =>
    whispers.contents(text(name, 'whisper name', MAXIMUM_PATH_LENGTH)),
  );
  ipcMain.handle(WHISPER_CHANNELS.pointingHere, (_event, name: unknown) =>
    whispers.pointingHere(text(name, 'whisper name', MAXIMUM_PATH_LENGTH)),
  );
  ipcMain.handle(WHISPER_CHANNELS.search, (_event, looked: unknown) =>
    whispers.search(text(looked, 'search', MAXIMUM_IDENTIFIER_LENGTH)),
  );
  ipcMain.handle(HALL_CHANNELS.search, (_event, asked: unknown) => searchHall(whispers.alcoveFolder, readHallSearch(asked)));
  ipcMain.handle(LINK_CHANNELS.open, (_event, address: unknown) => openAddress(text(address, 'address', MAXIMUM_ADDRESS_LENGTH)));

  return assistant;
}
