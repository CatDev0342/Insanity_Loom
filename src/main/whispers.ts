// Whispers as files, on the layer underneath: which alcove they live in, which one is open, and the system dialogs
// for choosing another. The page never touches a path it was not given here.

import { BrowserWindow, dialog, shell } from 'electron';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { OpenWhisper, WhisperInAlcove, WhisperPointingHere } from '../shared/whispers';
import { Alcove, DEFAULT_ALCOVE_NAME } from './alcove';
import type { Journal } from './journal';
import type { PreferenceStore } from './preference-store';

export class Whispers {
  private readonly alcove: Alcove;

  constructor(
    programFolder: string,
    private readonly journal: Journal,
    private readonly preferences: PreferenceStore,
  ) {
    const chosen = preferences.alcoveFolder;
    this.alcove = new Alcove(chosen === '' ? join(programFolder, DEFAULT_ALCOVE_NAME) : chosen);
  }

  get alcoveFolder(): string {
    return this.alcove.path;
  }

  /** The whisper last open, when its file is still there. */
  current(): OpenWhisper | undefined {
    const path = this.journal.whisperPath;
    if (path === undefined || !existsSync(path)) return undefined;
    return { path, name: basename(path), xhtml: this.alcove.read(path) };
  }

  create(title: string, xhtml: string): OpenWhisper {
    const path = this.alcove.create(title, xhtml);
    this.journal.whisperPath = path;
    return { path, name: basename(path), xhtml };
  }

  /** Every whisper in the alcove, for choosing one to link to. */
  list(): readonly WhisperInAlcove[] {
    return this.alcove.list().map(({ name, path }) => ({ name, path, title: Whispers.titleFromName(name) }));
  }

  /** Opens the whisper a link points at, by its file name in the alcove. */
  openNamed(name: string): OpenWhisper {
    return this.open(this.pathOf(name));
  }

  /** The whispers that link to this one, and which of its sections they point into. */
  pointingHere(name: string): readonly WhisperPointingHere[] {
    return this.alcove.pointingAt(name).map((whisper) => ({
      name: whisper.name,
      title: Whispers.titleFromName(whisper.name),
      headings: whisper.headings,
    }));
  }

  /** Reads a whisper without opening it, so that what is inside it can be listed. */
  contents(name: string): string {
    return this.alcove.read(this.pathOf(name));
  }

  private pathOf(name: string): string {
    const path = this.alcove.find(name);
    if (path === undefined) throw new Error(`The whisper "${decodeURIComponent(name)}" is not in your alcove.`);
    return path;
  }

  /** A whisper's name as the author reads it: its file name without the suffix. */
  private static titleFromName(name: string): string {
    return name.replace(/\.xhtml$/i, '');
  }

  save(path: string, xhtml: string): void {
    this.alcove.write(path, xhtml);
  }

  open(path: string): OpenWhisper {
    const xhtml = this.alcove.read(path);
    this.journal.whisperPath = path;
    return { path, name: basename(path), xhtml };
  }

  rename(path: string, title: string): OpenWhisper {
    const moved = this.alcove.rename(path, title);
    if (moved !== path) {
      this.journal.whisperPath = moved;
      // The whispers that pointed at this one are put right, so a rename never breaks a link (40.6).
      this.alcove.relink(basename(path), basename(moved));
    }
    return { path: moved, name: basename(moved), xhtml: this.alcove.read(moved) };
  }

  /** Asks the author which whisper to open, starting in the alcove. */
  async choose(window: BrowserWindow | null): Promise<OpenWhisper | undefined> {
    const options = {
      title: 'Open Whisper',
      defaultPath: this.alcove.path,
      filters: [
        { name: 'Whispers', extensions: ['xhtml'] },
        { name: 'All files', extensions: ['*'] },
      ],
      properties: ['openFile' as const],
    };
    const answer = window === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(window, options);
    const path = answer.filePaths[0];
    if (answer.canceled || path === undefined) return undefined;
    if (!Alcove.isWhisper(path)) throw new Error(`"${basename(path)}" is not a whisper: a whisper is an .xhtml file.`);
    return this.open(path);
  }

  /** Asks the author for another alcove folder, and keeps it. Returns the folder now in use. */
  async chooseAlcove(window: BrowserWindow | null): Promise<string> {
    const options = {
      title: 'Choose the alcove your whispers live in',
      defaultPath: this.alcove.path,
      properties: ['openDirectory' as const, 'createDirectory' as const],
    };
    const answer = window === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(window, options);
    const folder = answer.filePaths[0];
    if (answer.canceled || folder === undefined) return '';
    this.alcove.useFolder(folder);
    this.preferences.setAlcoveFolder(folder);
    return folder;
  }

  async showAlcove(): Promise<void> {
    const failure = await shell.openPath(this.alcove.path);
    if (failure !== '') throw new Error(`The alcove could not be opened: ${failure}`);
  }

  /**
   * Carries the whisper Milestone 2a kept in the journal into the alcove, once, so nothing written before whispers
   * were files is left behind. Returns it when there was one.
   */
  carryOverFromJournal(): OpenWhisper | undefined {
    if (this.journal.whisperPath !== undefined) return undefined;
    const kept = this.journal.loadWhisper();
    if (kept.trim() === '') return undefined;
    return this.create('Carried over', kept);
  }

  /** Where the alcove is, as the Preferences panel shows it. */
  describeAlcove(): { readonly folder: string; readonly isDefault: boolean } {
    return { folder: this.alcove.path, isDefault: this.preferences.alcoveFolder === '' };
  }

  static programFolderOf(dataFolder: string): string {
    return dirname(dataFolder);
  }
}
