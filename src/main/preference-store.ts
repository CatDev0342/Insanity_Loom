// The author's preferences, held in one place so everything that changes them writes the same file
// (Data/preferences.json): spelling (Edit ▸ Preferences) and the assistant's way of working (the status bar).
//
// Preferences that cannot be read are reported, and the defaults serve meanwhile; the file is left as it is until the
// author saves new ones, so nothing of theirs is lost to a typo.

import type { SpellingPreferences } from '../shared/editing';
import { DEFAULT_PREFERENCES, loadPreferences, preferencesWith, savePreferences, type Preferences } from './preferences';

export class PreferenceStore {
  private preferences: Preferences = DEFAULT_PREFERENCES;
  /** Why the saved preferences could not be read, or '' when they could. */
  private failure = '';

  constructor(private readonly dataFolder: string) {
    try {
      this.preferences = loadPreferences(dataFolder);
    } catch (cause) {
      this.failure = cause instanceof Error ? cause.message : String(cause);
    }
  }

  get problem(): string {
    return this.failure;
  }

  get spelling(): SpellingPreferences {
    return this.preferences.spelling;
  }

  /** The way of working last chosen for the assistant; '' for the assistant's own default. */
  get assistantMode(): string {
    return this.preferences.assistantMode;
  }

  /** The folder the author's whispers live in; '' for the Alcove folder beside the program. */
  get alcoveFolder(): string {
    return this.preferences.alcoveFolder;
  }

  setSpelling(spelling: SpellingPreferences): void {
    this.write(preferencesWith(spelling, this.preferences.assistantMode, this.preferences.alcoveFolder));
  }

  setAssistantMode(assistantMode: string): void {
    if (assistantMode === this.preferences.assistantMode) return;
    this.write(preferencesWith(this.preferences.spelling, assistantMode, this.preferences.alcoveFolder));
  }

  setAlcoveFolder(alcoveFolder: string): void {
    if (alcoveFolder === this.preferences.alcoveFolder) return;
    this.write(preferencesWith(this.preferences.spelling, this.preferences.assistantMode, alcoveFolder));
  }

  private write(preferences: Preferences): void {
    savePreferences(this.dataFolder, preferences);
    this.preferences = preferences;
    this.failure = '';
  }
}
