// Find in Files: the advanced find window, for everything the author has written.
//
// It is the shape a developer's find window has had for twenty years, because it is the right shape: what to find,
// where to look, how to match it, a button that finds them all, and a list of every place it stands — document by
// document, with the line and enough of it to recognize. Choosing a result opens that whisper and takes the author to
// the words.
//
// What it searches is a GreatHall: the alcove, and every folder beneath it when the author asks for all of it.

import type { HallFound, HallHit, HallSearch } from '../../../shared/hall';
import { button, choice, dialogButtons, element, enableAccessKeys, group, row } from './kit';

/** How many results the list shows at once before it scrolls. */
const ROWS_SHOWN = 14;

/** What the author last looked for, kept while the program runs so the window opens where they left it. */
const LAST: { asked: HallSearch } = {
  asked: { looked: '', everywhere: true, matchCase: false, wholeWord: false, regularExpression: false, includeThoughts: true },
};

/** One line of the results list: a document, or a place within it. */
interface ResultRow {
  readonly label: string;
  readonly path: string;
  readonly looked: string;
  readonly isDocument: boolean;
}

export class HallPanel {
  private readonly form: HTMLFormElement;
  private readonly looked: HTMLInputElement;
  private readonly everywhere: HTMLInputElement;
  private readonly hereOnly: HTMLInputElement;
  private readonly matchCase: HTMLInputElement;
  private readonly wholeWord: HTMLInputElement;
  private readonly regularExpression: HTMLInputElement;
  private readonly includeThoughts: HTMLInputElement;
  private readonly results: HTMLSelectElement;
  private readonly said: HTMLParagraphElement;
  private rows: ResultRow[] = [];
  private chosen: { path: string; looked: string } | undefined;
  private search: (asked: HallSearch) => Promise<HallFound> = async () => ({ hits: [], found: 0, looked: 0, problem: '' });

  constructor(private readonly dialog: HTMLDialogElement) {
    const heading = element('h2');
    heading.textContent = 'Find in Files';

    this.looked = element('input');
    this.looked.type = 'search';
    this.looked.spellcheck = false;
    const find = button('&Find All');

    const everywhere = choice('radio', 'hall-everywhere', 'The whole &GreatHall (every folder beneath the alcove)', 'hall-where');
    const hereOnly = choice('radio', 'hall-here', 'This &alcove only', 'hall-where');
    this.everywhere = everywhere.input;
    this.hereOnly = hereOnly.input;

    const matchCase = choice('checkbox', 'hall-case', 'Match &case');
    const wholeWord = choice('checkbox', 'hall-word', 'Match &whole word');
    const regularExpression = choice('checkbox', 'hall-regex', 'Use regular e&xpressions');
    const includeThoughts = choice('checkbox', 'hall-thoughts', "Look in the assistant's &thinking as well");
    this.matchCase = matchCase.input;
    this.wholeWord = wholeWord.input;
    this.regularExpression = regularExpression.input;
    this.includeThoughts = includeThoughts.input;

    this.said = element('p', 'panel-note');
    this.said.setAttribute('role', 'status');

    this.results = element('select');
    this.results.size = ROWS_SHOWN;
    this.results.className = 'hall-results';

    const { bar, ok, cancel } = dialogButtons([]);
    ok.textContent = 'Go To';
    cancel.textContent = 'Close';

    this.form = element('form', 'panel panel-wide');
    this.form.method = 'dialog';
    this.form.append(
      heading,
      row('hall-looked', 'Fi&nd what:', this.looked, find),
      group('Look in', everywhere.row, hereOnly.row, includeThoughts.row),
      group('How to match', matchCase.row, wholeWord.row, regularExpression.row),
      this.said,
      row('hall-results', '&Results:', this.results),
      bar,
    );
    dialog.replaceChildren(this.form);
    dialog.setAttribute('aria-label', 'Find in Files');
    enableAccessKeys(dialog, this.form);

    this.looked.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      void this.findAll();
    });
    find.addEventListener('click', () => void this.findAll());
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.goTo();
    });
    cancel.addEventListener('click', () => this.dialog.close());
    this.results.addEventListener('dblclick', () => this.goTo());
  }

  private read(): HallSearch {
    return {
      looked: this.looked.value,
      everywhere: this.everywhere.checked,
      matchCase: this.matchCase.checked,
      wholeWord: this.wholeWord.checked,
      regularExpression: this.regularExpression.checked,
      includeThoughts: this.includeThoughts.checked,
    };
  }

  private async findAll(): Promise<void> {
    const asked = this.read();
    LAST.asked = asked;
    if (asked.looked.trim() === '') {
      this.show([], 'Write what to look for.');
      return;
    }
    const found = await this.search(asked);
    if (found.problem !== '') {
      this.show([], found.problem);
      return;
    }
    this.show(found.hits, HallPanel.describe(found, asked));
    if (found.hits.length > 0) this.results.focus();
  }

  /** What the window says about what it found, in the words a find window uses. */
  private static describe(found: HallFound, asked: HallSearch): string {
    if (found.found === 0) return `No matches for "${asked.looked}" — ${found.looked} documents searched.`;
    const places = found.found === 1 ? '1 match' : `${found.found} matches`;
    const documents = found.hits.length === 1 ? '1 document' : `${found.hits.length} documents`;
    return `${places} in ${documents} — ${found.looked} searched.`;
  }

  /** Each document, then the places within it, as a find window lists them. */
  private show(hits: readonly HallHit[], said: string): void {
    this.said.textContent = said;
    this.rows = [];
    const options: HTMLOptionElement[] = [];
    for (const hit of hits) {
      const where = hit.folder === '' || hit.folder === '.' ? '' : `${hit.folder}/`;
      const kind = hit.kind === 'thinking' ? ' · thinking' : '';
      this.rows.push({ label: '', path: hit.path, looked: this.looked.value, isDocument: true });
      options.push(HallPanel.option(`${where}${hit.title}${kind}  (${hit.found})`, this.rows.length - 1, true));
      for (const line of hit.lines) {
        this.rows.push({ label: line.text, path: hit.path, looked: this.looked.value, isDocument: false });
        options.push(HallPanel.option(`    ${String(line.line).padStart(4, ' ')}:  ${line.text}`, this.rows.length - 1, false));
      }
    }
    this.results.replaceChildren(...options);
    this.results.disabled = options.length === 0;
    if (options.length > 0) this.results.selectedIndex = 0;
  }

  private static option(label: string, index: number, isDocument: boolean): HTMLOptionElement {
    const option = element('option');
    option.value = String(index);
    option.textContent = label;
    if (isDocument) option.className = 'hall-result-document';
    return option;
  }

  private goTo(): void {
    const row = this.rows[Number(this.results.value)];
    if (row === undefined) return;
    this.chosen = { path: row.path, looked: row.looked };
    this.dialog.close();
  }

  /**
   * Opens the window. Returns the whisper to open and what was looked for in it, so that the author lands on the
   * words rather than at the top of it; undefined when they chose none.
   */
  async ask(search: (asked: HallSearch) => Promise<HallFound>): Promise<{ path: string; looked: string } | undefined> {
    this.search = search;
    this.chosen = undefined;
    const asked = LAST.asked;
    this.looked.value = asked.looked;
    this.everywhere.checked = asked.everywhere;
    this.hereOnly.checked = !asked.everywhere;
    this.matchCase.checked = asked.matchCase;
    this.wholeWord.checked = asked.wholeWord;
    this.regularExpression.checked = asked.regularExpression;
    this.includeThoughts.checked = asked.includeThoughts;
    this.show([], 'Write what to look for.');
    this.dialog.showModal();
    this.looked.focus();
    this.looked.select();
    await new Promise<void>((resolve) => this.dialog.addEventListener('close', () => resolve(), { once: true }));
    return this.chosen;
  }
}
