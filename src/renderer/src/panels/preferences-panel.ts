// Edit ▸ Preferences: how Insanity_Loom behaves for the author. For now, spelling: whether it is checked as they
// type, in which languages, and their personal dictionary — the words never marked as misspelled, including every word
// added from the right-click menu.
//
// The spelling options are kept with OK or Apply, like any dialog's. Dictionary changes are made at once, because
// Chromium keeps the dictionary itself; the panel says so beside them.

import type { EditingBridge, SpellingPreferences } from '../../../shared/editing';
import type { WhispersBridge } from '../../../shared/whispers';
import { button, choice, dialogButtons, element, enableAccessKeys, group, row } from './kit';

// How many dictionary words the list shows at once before it scrolls.
const DICTIONARY_ROWS_SHOWN = 8;

const LANGUAGE_NAMES = new Intl.DisplayNames(undefined, { type: 'language' });

function languageName(code: string): string {
  try {
    return `${LANGUAGE_NAMES.of(code) ?? code} (${code})`;
  } catch {
    return code;
  }
}

export class PreferencesPanel {
  private readonly form: HTMLFormElement;
  private readonly problem: HTMLParagraphElement;
  private readonly enabled: HTMLInputElement;
  private readonly fetchDictionaries: HTMLInputElement;
  private readonly languages: HTMLElement;
  private readonly newWord: HTMLInputElement;
  private readonly words: HTMLSelectElement;
  private readonly result: HTMLParagraphElement;

  private readonly alcove: HTMLInputElement;

  constructor(
    private readonly dialog: HTMLDialogElement,
    private readonly editing: EditingBridge,
    private readonly whispers: WhispersBridge,
  ) {
    const heading = element('h2');
    heading.textContent = 'Preferences';
    this.problem = element('p', 'panel-problem');
    this.problem.setAttribute('role', 'alert');

    const enabled = choice('checkbox', 'spelling-enabled', 'Check spelling as you &type');
    this.enabled = enabled.input;
    this.languages = element('div', 'panel-checklist');
    this.languages.setAttribute('role', 'group');
    const languagesNote = element('p', 'panel-note');
    languagesNote.textContent = "With none ticked, the languages Insanity_Loom's system chose are checked.";

    const fetchDictionaries = choice('checkbox', 'spelling-fetch', 'Fetch &dictionaries for other languages when needed');
    this.fetchDictionaries = fetchDictionaries.input;
    const fetchNote = element('p', 'panel-note');
    fetchNote.textContent =
      'Insanity_Loom ships with English. Other languages are fetched from Google, which is the only thing this ' +
      'program asks of anyone but your assistant — so it is off unless you turn it on.';

    this.newWord = element('input');
    this.newWord.spellcheck = false;
    const add = button('&Add');
    const addHolder = element('span', 'panel-inline');
    addHolder.append(add);

    this.words = element('select');
    this.words.size = DICTIONARY_ROWS_SHOWN;
    const remove = button('&Remove');
    const removeHolder = element('span', 'panel-inline');
    removeHolder.append(remove);
    const dictionaryNote = element('p', 'panel-note');
    dictionaryNote.textContent = 'Words here are never marked as misspelled. Changes to the dictionary take effect at once.';

    this.alcove = element('input');
    this.alcove.readOnly = true;
    this.alcove.spellcheck = false;
    const browse = button('&Browse…');
    const browseHolder = element('span', 'panel-inline');
    browseHolder.append(browse);
    const alcoveNote = element('p', 'panel-note');
    alcoveNote.textContent =
      'Whispers are ordinary .xhtml files: open them in any browser, copy them, back them up. One whisper is one ' +
      'conversation.';
    browse.addEventListener('click', () => void this.chooseAlcove());

    this.result = element('p', 'panel-result');
    this.result.setAttribute('role', 'status');

    const { bar, cancel, apply } = dialogButtons([]);

    this.form = element('form', 'panel');
    this.form.method = 'dialog';
    this.form.append(
      heading,
      this.problem,
      group('Whispers', row('alcove-folder', '&Alcove folder:', this.alcove, browseHolder), alcoveNote),
      group(
        'Spelling',
        enabled.row,
        row('spelling-languages', '&Languages:', this.languages),
        languagesNote,
        fetchDictionaries.row,
        fetchNote,
      ),
      group(
        'Personal dictionary',
        dictionaryNote,
        row('dictionary-new-word', 'Add a &word:', this.newWord, addHolder),
        row('dictionary-words', 'Y&our words:', this.words, removeHolder),
      ),
      this.result,
      bar,
    );
    dialog.replaceChildren(this.form);
    dialog.setAttribute('aria-label', 'Preferences');
    enableAccessKeys(dialog, this.form);

    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.save(true);
    });
    cancel.addEventListener('click', () => dialog.close());
    apply.addEventListener('click', () => void this.save(false));
    add.addEventListener('click', () => void this.addWord());
    // Enter in the word box adds the word, rather than pressing OK.
    this.newWord.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      void this.addWord();
    });
    remove.addEventListener('click', () => void this.removeWord());
    this.words.addEventListener('keydown', (event) => {
      if (event.key !== 'Delete') return;
      event.preventDefault();
      void this.removeWord();
    });
  }

  async show(): Promise<void> {
    this.alcove.value = await this.whispers.alcoveFolder();
    const state = await this.editing.loadSpelling();
    this.problem.textContent = state.problem;
    this.problem.hidden = state.problem === '';
    this.enabled.checked = state.preferences.enabled;
    this.fetchDictionaries.checked = state.preferences.fetchDictionaries;
    const chosen = new Set(state.preferences.languages);
    this.languages.replaceChildren(
      ...state.availableLanguages.map((code) => {
        const option = choice('checkbox', `language-${code}`, languageName(code).replace(/&/g, '&&'));
        option.input.value = code;
        option.input.checked = chosen.has(code);
        return option.row;
      }),
    );
    if (state.availableLanguages.length === 0) {
      this.languages.textContent = "Spelling languages follow the system's own settings.";
    }
    this.showWords(state.dictionary);
    this.newWord.value = '';
    this.say('', false);
    this.dialog.showModal();
    this.enabled.focus();
    return new Promise((resolve) => this.dialog.addEventListener('close', () => resolve(), { once: true }));
  }

  /** The alcove folder is chosen in the system's own folder dialog, and takes effect at once. */
  private async chooseAlcove(): Promise<void> {
    try {
      const chosen = await this.whispers.chooseAlcoveFolder();
      if (chosen === '') return;
      this.alcove.value = chosen;
      this.say('New whispers will be kept here. The one open stays where it is.', false);
    } catch (problem) {
      this.say(problem instanceof Error ? problem.message : String(problem), true);
    }
  }

  private showWords(words: readonly string[]): void {
    this.words.replaceChildren(
      ...words.map((word) => {
        const option = element('option');
        option.value = word;
        option.textContent = word;
        return option;
      }),
    );
  }

  private read(): SpellingPreferences {
    const languages = [...this.languages.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .filter((box) => box.checked)
      .map((box) => box.value);
    return { enabled: this.enabled.checked, languages, fetchDictionaries: this.fetchDictionaries.checked };
  }

  private say(message: string, failed: boolean): void {
    this.result.textContent = message;
    this.result.classList.toggle('is-failure', failed);
  }

  private async save(close: boolean): Promise<void> {
    try {
      await this.editing.saveSpelling(this.read());
    } catch (problem) {
      this.say(problem instanceof Error ? problem.message : String(problem), true);
      return;
    }
    this.problem.hidden = true;
    if (close) this.dialog.close();
    else this.say('Saved.', false);
  }

  private async refreshWords(): Promise<void> {
    this.showWords((await this.editing.loadSpelling()).dictionary);
  }

  private async addWord(): Promise<void> {
    const word = this.newWord.value.trim();
    if (word === '') return;
    try {
      await this.editing.addToDictionary(word);
    } catch (problem) {
      this.say(problem instanceof Error ? problem.message : String(problem), true);
      return;
    }
    this.newWord.value = '';
    await this.refreshWords();
    this.say(`"${word}" added to your dictionary.`, false);
  }

  private async removeWord(): Promise<void> {
    const word = this.words.value;
    if (word === '') {
      this.say('Choose a word in the list to remove.', true);
      return;
    }
    try {
      await this.editing.removeFromDictionary(word);
    } catch (problem) {
      this.say(problem instanceof Error ? problem.message : String(problem), true);
      return;
    }
    await this.refreshWords();
    this.say(`"${word}" removed from your dictionary.`, false);
  }
}
